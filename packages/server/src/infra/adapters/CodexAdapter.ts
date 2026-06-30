/**
 * CodexAdapter —— SourceAdapter 端口的实现（infra，反向依赖 domain）。
 *
 * 解析 Codex rollout JSONL（~/.codex/sessions/.../rollout-*.jsonl）：
 *   - 信封格式 {timestamp, type, payload}
 *   - session_meta: 取 cwd（作为 collection）、git.branch、model_provider
 *   - response_item 为权威事件源：
 *       message(role+content[input_text/output_text]) → text 事件
 *       reasoning(summary/content，多为加密空) → thinking 事件（空则跳过）
 *       function_call(name/arguments(JSON字符串)/call_id) → tool_call
 *       function_call_output(call_id/output) → tool_result，exit code≠0 视为 error
 *
 * 与 Claude 不同：Codex 无 parentUuid 树，事件为线性序列——
 * 用「前一个事件 id」作为 parentId，使 buildTree 仍能形成链。
 *
 * collection 取 session_meta.cwd（工程路径），而非文件所在日期目录，
 * 与 Claude 的 collection 语义保持一致。
 */

import {
  Event,
  ImageBlock,
  Session,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultBlock,
  TokenUsage,
  type Block,
} from '../../domain/index.js';
import type {
  AdapterParseState,
  ParsedIncrement,
  ParsedSession,
  RawSessionRef,
  SourceAdapter,
  UsageSample,
} from '../../domain/index.js';
import type { Role } from '@trace-review/shared';
import { deriveTitle } from './title.js';

interface CodexState extends AdapterParseState {
  cwd: string | null;
  collectionId: string | null;
  gitBranch: string | null;
  model: string | null;
  title: string | null;
  /** 线性序列里上一个事件的 id，用作下一个事件的 parentId。 */
  lastEventId: string | null;
  /** 事件序号，用于生成稳定 id。 */
  seq: number;
}

function emptyState(): CodexState {
  return {
    cwd: null,
    collectionId: null,
    gitBranch: null,
    model: null,
    title: null,
    lastEventId: null,
    seq: 0,
  };
}

function parseTimestamp(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** message.content 数组拍平为文本。 */
function flattenMessageContent(content: unknown): { text: string; images: ImageBlock[] } {
  const images: ImageBlock[] = [];
  if (typeof content === 'string') return { text: content, images };
  if (!Array.isArray(content)) return { text: '', images };
  const parts: string[] = [];
  for (const it of content) {
    if (!it || typeof it !== 'object') continue;
    const obj = it as Record<string, unknown>;
    if ((obj.type === 'input_text' || obj.type === 'output_text') && typeof obj.text === 'string') {
      parts.push(obj.text);
    } else if (obj.type === 'input_image') {
      const url = typeof obj.image_url === 'string' ? obj.image_url : null;
      images.push(new ImageBlock(url, undefined));
    }
  }
  return { text: parts.join('\n'), images };
}

/** function_call.arguments 是 JSON 字符串，解析为对象；失败则原样保留。 */
function parseArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** 从 output 文本里探测进程退出码，非 0 视为错误。 */
function detectError(output: string): boolean {
  const m = output.match(/exited with code (\d+)/);
  return m ? m[1] !== '0' : false;
}

export class CodexAdapter implements SourceAdapter {
  readonly id = 'codex' as const;

  detect(locator: string, headLines: string[]): boolean {
    if (!locator.endsWith('.jsonl')) return false;
    for (const line of headLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const r = JSON.parse(trimmed) as Record<string, unknown>;
        // Codex 信封：{timestamp, type, payload}，首行多为 session_meta
        if (r.type === 'session_meta' && r.payload && typeof r.payload === 'object') return true;
        if ('payload' in r && 'timestamp' in r && 'type' in r) return true;
      } catch {
        return false;
      }
      return false; // 只看第一条非空行
    }
    return false;
  }

  parseSession(ref: RawSessionRef, lines: string[]): ParsedSession {
    const state = emptyState();
    const events: Event[] = [];
    let input = 0;
    let output = 0;
    const usage = { input, output };
    this.consume(ref, lines, state, events, usage);

    const session = new Session(
      ref.sessionId,
      this.id,
      state.collectionId ?? ref.collectionId,
      state.title ?? this.fallbackTitle(events) ?? ref.sessionId,
      state.cwd,
      state.gitBranch,
      state.model,
      events,
      new TokenUsage(usage.input, usage.output),
    );
    return { session, state };
  }

  parseIncremental(
    ref: RawSessionRef,
    newLines: string[],
    rawState: AdapterParseState,
  ): ParsedIncrement {
    const state = rawState as CodexState;
    const events: Event[] = [];
    const usage = { input: 0, output: 0 };
    const beforeTitle = state.title;
    this.consume(ref, newLines, state, events, usage);
    const titlePatch = state.title && state.title !== beforeTitle ? state.title : undefined;
    return { events, titlePatch };
  }

  private consume(
    ref: RawSessionRef,
    lines: string[],
    state: CodexState,
    out: Event[],
    usage: { input: number; output: number },
  ): void {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let r: Record<string, unknown>;
      try {
        r = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }

      const type = r.type;
      const payload = (r.payload ?? {}) as Record<string, unknown>;
      const ts = parseTimestamp(r.timestamp);

      if (type === 'session_meta') {
        if (typeof payload.cwd === 'string') {
          state.cwd = payload.cwd;
          state.collectionId = payload.cwd;
        }
        const git = payload.git as Record<string, unknown> | undefined;
        if (git && typeof git.branch === 'string') state.gitBranch = git.branch;
        if (typeof payload.model_provider === 'string') state.model = payload.model_provider;
        continue;
      }

      if (type === 'event_msg') {
        // token 统计（明文镜像），其余 UI 事件忽略
        if (payload.type === 'token_count') {
          const info = payload as Record<string, unknown>;
          if (typeof info.input_tokens === 'number') usage.input += info.input_tokens;
          if (typeof info.output_tokens === 'number') usage.output += info.output_tokens;
        }
        continue;
      }

      if (type !== 'response_item') continue;

      const blocks = this.mapResponseItem(payload);
      if (!blocks || blocks.length === 0) continue;

      const role = this.roleFor(payload, blocks);
      const id = `${ref.sessionId}:${state.seq++}`;
      const event = new Event(id, state.lastEventId, ref.sessionId, role, ts, false, blocks);
      state.lastEventId = id;
      out.push(event);
    }
  }

  private mapResponseItem(payload: Record<string, unknown>): Block[] | null {
    switch (payload.type) {
      case 'message': {
        const { text, images } = flattenMessageContent(payload.content);
        const blocks: Block[] = [];
        if (text.trim()) blocks.push(new TextBlock(text));
        blocks.push(...images);
        return blocks;
      }
      case 'reasoning': {
        const summary = Array.isArray(payload.summary)
          ? payload.summary
              .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>).text : s))
              .filter((t): t is string => typeof t === 'string' && t.length > 0)
          : [];
        const content = typeof payload.content === 'string' ? payload.content : '';
        const text = [content, ...summary].filter(Boolean).join('\n').trim();
        // 加密/空 reasoning 跳过
        return text ? [new ThinkingBlock(text)] : [];
      }
      case 'function_call': {
        return [
          new ToolCallBlock(
            String(payload.call_id ?? ''),
            String(payload.name ?? ''),
            parseArguments(payload.arguments),
          ),
        ];
      }
      case 'function_call_output': {
        const output = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '');
        return [new ToolResultBlock(String(payload.call_id ?? ''), output, detectError(output))];
      }
      default:
        return null;
    }
  }

  /** 纯 tool_result 归 tool 角色；function_call 归 assistant；message 按其 role。 */
  private roleFor(payload: Record<string, unknown>, blocks: Block[]): Role {
    if (blocks.every((b) => b instanceof ToolResultBlock)) return 'tool';
    if (payload.type === 'function_call' || payload.type === 'reasoning') return 'assistant';
    const role = payload.role;
    if (role === 'assistant') return 'assistant';
    if (role === 'user') return 'user';
    if (role === 'developer' || role === 'system') return 'system';
    return 'assistant';
  }

  private fallbackTitle(events: Event[]): string | null {
    return deriveTitle(events);
  }

  /**
   * 抽取用量样本：
   *   - token_count 的 info.total_token_usage 是累计值 → 取相邻差分还原增量，
   *     按该事件时间戳归日；model 用 session_meta 的 model_provider
   *   - message(role=user/assistant 且含文本) → message 轮次
   * token 样本与 message 样本分别 push（token 样本 isMessage=false）。
   */
  extractUsage(ref: RawSessionRef, lines: string[]): UsageSample[] {
    const samples: UsageSample[] = [];
    let model: string | null = null;
    let prevInput = 0;
    let prevOutput = 0;
    let seenUsage = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let r: Record<string, unknown>;
      try {
        r = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = r.type;
      const payload = (r.payload ?? {}) as Record<string, unknown>;
      const ts = parseTimestamp(r.timestamp);

      if (type === 'session_meta') {
        if (typeof payload.model_provider === 'string') model = payload.model_provider;
        continue;
      }

      if (type === 'event_msg' && payload.type === 'token_count') {
        const info = payload.info as Record<string, unknown> | null | undefined;
        const usage = info?.total_token_usage as Record<string, unknown> | undefined;
        if (!usage || !ts) continue;
        const curInput = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
        const curOutput = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
        // 累计值差分；首次出现即为该次全量增量
        const dInput = seenUsage ? Math.max(0, curInput - prevInput) : curInput;
        const dOutput = seenUsage ? Math.max(0, curOutput - prevOutput) : curOutput;
        prevInput = curInput;
        prevOutput = curOutput;
        seenUsage = true;
        if (dInput === 0 && dOutput === 0) continue;
        samples.push({
          timestamp: ts,
          source: this.id,
          model,
          sessionId: ref.sessionId,
          inputTokens: dInput,
          outputTokens: dOutput,
          isMessage: false,
        });
        continue;
      }

      if (type === 'response_item' && payload.type === 'message' && ts) {
        const role = payload.role;
        if (role !== 'user' && role !== 'assistant') continue;
        const { text } = flattenMessageContent(payload.content);
        if (!text.trim()) continue;
        samples.push({
          timestamp: ts,
          source: this.id,
          model,
          sessionId: ref.sessionId,
          inputTokens: 0,
          outputTokens: 0,
          isMessage: true,
        });
      }
    }
    return samples;
  }
}
