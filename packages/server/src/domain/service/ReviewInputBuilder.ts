/**
 * ReviewInputBuilder —— 领域服务。
 *
 * 把 Session 聚合 + 完整事件序列组织成「喂给评审者的文本」，并裁剪超长 trace
 * 以控制 token。裁剪是领域知识：保留结构（每个事件的 index/role、文本、
 * 工具调用名+关键入参、工具结果是否 error + 截断输出、thinking 摘要），
 * 丢弃巨大的正文体量。index 即证据序号，评审者据此回引。
 *
 * 纯函数、零依赖，可独立单测。
 */

import type { Session } from '../model/Session.js';
import type { Event } from '../model/Event.js';
import {
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultBlock,
  ImageBlock,
} from '../model/Block.js';
import type { ReviewInput } from '../port/Reviewer.js';

/** 裁剪预算。事件数上限 + 单块字符上限，避免把整条 trace 塞给模型。 */
export interface TrimBudget {
  /** 最多保留的事件数（超出则首尾保留、中间省略）。 */
  maxEvents: number;
  /** 单个文本/思考块的最大字符数。 */
  maxBlockChars: number;
  /** 工具结果输出的最大字符数。 */
  maxToolOutputChars: number;
}

export const DEFAULT_TRIM_BUDGET: TrimBudget = {
  maxEvents: 200,
  maxBlockChars: 2000,
  maxToolOutputChars: 800,
};

export class ReviewInputBuilder {
  constructor(private readonly budget: TrimBudget = DEFAULT_TRIM_BUDGET) {}

  build(session: Session, events: readonly Event[]): ReviewInput {
    return { session, events };
  }

  /**
   * 渲染成给评审者的纯文本 transcript。每行带 `#index`（证据序号）。
   * 事件数超预算时保留首尾、中间以省略行标注。
   */
  render(session: Session, events: readonly Event[]): string {
    const header = this.renderHeader(session);
    const lines: string[] = [];
    const { maxEvents } = this.budget;
    const total = events.length;

    const indexesToRender = pickEventIndexes(total, maxEvents);
    let prev = -1;
    for (const i of indexesToRender) {
      if (prev >= 0 && i > prev + 1) {
        lines.push(`… (省略 ${i - prev - 1} 个事件) …`);
      }
      lines.push(this.renderEvent(events[i]!, i));
      prev = i;
    }
    return `${header}\n\n${lines.join('\n')}`;
  }

  private renderHeader(session: Session): string {
    const parts = [
      `会话标题: ${session.title}`,
      `来源: ${session.source}`,
      `模型: ${session.model ?? '未知'}`,
      `事件数: ${session.eventCount}`,
    ];
    if (session.cwd) parts.push(`工作目录: ${session.cwd}`);
    if (session.gitBranch) parts.push(`分支: ${session.gitBranch}`);
    return parts.join('\n');
  }

  private renderEvent(event: Event, index: number): string {
    const segments: string[] = [];
    for (const block of event.blocks) {
      if (block instanceof TextBlock) {
        segments.push(this.trim(block.text, this.budget.maxBlockChars));
      } else if (block instanceof ThinkingBlock) {
        segments.push(`[thinking] ${this.trim(block.text, this.budget.maxBlockChars)}`);
      } else if (block instanceof ToolCallBlock) {
        segments.push(`[tool_call ${block.name}] ${this.trim(stringifyInput(block.input), this.budget.maxBlockChars)}`);
      } else if (block instanceof ToolResultBlock) {
        const tag = block.isError ? 'tool_result ERROR' : 'tool_result';
        segments.push(`[${tag}] ${this.trim(block.output, this.budget.maxToolOutputChars)}`);
      } else if (block instanceof ImageBlock) {
        segments.push('[image]');
      }
    }
    const body = segments.filter((s) => s.trim()).join('\n');
    return `#${index} <${event.role}>\n${body}`;
  }

  private trim(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}…[截断 ${text.length - max} 字]`;
  }
}

/** 选择要渲染的事件下标：不超预算全取；超了保留首尾各一半。 */
function pickEventIndexes(total: number, maxEvents: number): number[] {
  if (total <= maxEvents) return range(0, total);
  const head = Math.ceil(maxEvents / 2);
  const tail = maxEvents - head;
  return [...range(0, head), ...range(total - tail, total)];
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i < end; i++) out.push(i);
  return out;
}

function stringifyInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}
