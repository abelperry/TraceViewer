/**
 * ClaudeCodeAdapter —— SourceAdapter 端口的实现（infra 层，反向依赖 domain）。
 *
 * 解析 ~/.claude/projects/<proj>/<sessionId>.jsonl：
 *   - 每行一条 JSON 记录，经 parentUuid 串成树
 *   - 关注 type: user / assistant；内容块 text/thinking/tool_use/tool_result/image
 *   - tool_use.id ↔ tool_result.tool_use_id 通过 callId 统一配对
 *   - ai-title 记录回填会话标题；usage 累加 token
 *   - 其余记录(mode/permission-mode/file-history-snapshot/...) 跳过
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
} from '../../domain/index.js';
import type { Role } from '@trace-review/shared';
import { deriveTitle } from './title.js';

interface ClaudeState extends AdapterParseState {
  title: string | null;
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
}

function emptyState(): ClaudeState {
  return {
    title: null,
    cwd: null,
    gitBranch: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function parseTimestamp(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** tool_result.content 可能是字符串或块数组，统一拍平为字符串。 */
function flattenToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b;
        if (b && typeof b === 'object') {
          const obj = b as Record<string, unknown>;
          if (typeof obj.text === 'string') return obj.text;
          if (obj.type === 'image') return '[image]';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function mapBlocks(content: unknown): Block[] {
  if (typeof content === 'string') {
    return content.trim() ? [new TextBlock(content)] : [];
  }
  if (!Array.isArray(content)) return [];

  const blocks: Block[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    switch (b.type) {
      case 'text':
        if (typeof b.text === 'string' && b.text.length) blocks.push(new TextBlock(b.text));
        break;
      case 'thinking': {
        const t = (b.thinking ?? b.text) as unknown;
        if (typeof t === 'string' && t.length) blocks.push(new ThinkingBlock(t));
        break;
      }
      case 'tool_use':
        blocks.push(
          new ToolCallBlock(String(b.id ?? ''), String(b.name ?? ''), b.input ?? null),
        );
        break;
      case 'tool_result':
        blocks.push(
          new ToolResultBlock(
            String(b.tool_use_id ?? ''),
            flattenToolResultContent(b.content),
            b.is_error === true,
          ),
        );
        break;
      case 'image': {
        const src = (b.source ?? {}) as Record<string, unknown>;
        const mediaType = typeof src.media_type === 'string' ? src.media_type : undefined;
        // source.type=base64 时，data 为纯 base64，组装成可直接渲染的 data URL
        const data = typeof src.data === 'string' ? src.data : null;
        const dataUrl =
          src.type === 'base64' && data && mediaType ? `data:${mediaType};base64,${data}` : null;
        blocks.push(new ImageBlock(dataUrl, mediaType));
        break;
      }
      default:
        break;
    }
  }
  return blocks;
}

function normalizeRole(raw: unknown): Role {
  switch (raw) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    case 'tool':
      return 'tool';
    default:
      return 'user';
  }
}

export class ClaudeCodeAdapter implements SourceAdapter {
  readonly id = 'claude-code' as const;

  detect(locator: string, headLines: string[]): boolean {
    if (!locator.endsWith('.jsonl')) return false;
    for (const line of headLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const r = JSON.parse(trimmed) as Record<string, unknown>;
        // Claude 记录普遍带 uuid + sessionId；message 记录带 parentUuid
        if ('sessionId' in r && ('uuid' in r || 'parentUuid' in r)) return true;
        if (r.type === 'user' || r.type === 'assistant') return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  parseSession(ref: RawSessionRef, lines: string[]): ParsedSession {
    const state = emptyState();
    const events: Event[] = [];
    this.consume(ref, lines, state, events);

    const session = new Session(
      ref.sessionId,
      this.id,
      // 用真实 cwd 作 collectionId，与 Codex 一致 —— 同一工程下的两端会话归并到一个 collection
      state.cwd ?? ref.collectionId,
      state.title ?? deriveTitle(events) ?? ref.sessionId,
      state.cwd,
      state.gitBranch,
      state.model,
      events,
      new TokenUsage(state.inputTokens, state.outputTokens),
    );
    return { session, state };
  }

  parseIncremental(
    ref: RawSessionRef,
    newLines: string[],
    rawState: AdapterParseState,
  ): ParsedIncrement {
    const state = rawState as ClaudeState;
    const before = { in: state.inputTokens, out: state.outputTokens, title: state.title };
    const events: Event[] = [];
    this.consume(ref, newLines, state, events);
    const titlePatch = state.title && state.title !== before.title ? state.title : undefined;
    return { events, titlePatch };
  }

  /** 把若干原始行消费进事件数组，并就地更新解析状态（标题/cwd/token 等）。 */
  private consume(
    ref: RawSessionRef,
    lines: string[],
    state: ClaudeState,
    out: Event[],
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

      if (type === 'ai-title' && typeof r.aiTitle === 'string') {
        state.title = r.aiTitle;
        continue;
      }

      if (type !== 'user' && type !== 'assistant') continue;

      const message = (r.message ?? {}) as Record<string, unknown>;
      if (typeof message.model === 'string') state.model = message.model;
      if (typeof r.cwd === 'string') state.cwd = r.cwd;
      if (typeof r.gitBranch === 'string') state.gitBranch = r.gitBranch;

      const usage = message.usage as Record<string, unknown> | undefined;
      if (usage) {
        if (typeof usage.input_tokens === 'number') state.inputTokens += usage.input_tokens;
        if (typeof usage.output_tokens === 'number') state.outputTokens += usage.output_tokens;
      }

      const blocks = mapBlocks(message.content);
      if (blocks.length === 0) continue;

      // tool_result 在 Claude 里挂在 user 消息下，但本质是工具返回。
      // 纯 tool_result 的事件归类为 tool 角色，使迷你地图能区分工具返回。
      const baseRole = normalizeRole(message.role ?? type);
      const allToolResults =
        blocks.length > 0 && blocks.every((b) => b instanceof ToolResultBlock);
      const role: Role = allToolResults ? 'tool' : baseRole;

      const event = new Event(
        String(r.uuid ?? `${ref.sessionId}:${out.length}`),
        typeof r.parentUuid === 'string' ? r.parentUuid : null,
        ref.sessionId,
        role,
        parseTimestamp(r.timestamp),
        r.isSidechain === true,
        blocks,
      );
      out.push(event);
    }
  }

  /** 无 ai-title 时，用首条用户文本截断作为标题兜底。 */
  private fallbackTitle(events: Event[]): string | null {
    return deriveTitle(events);
  }
}
