/**
 * 用量统计领域模型。
 *
 * UsageSample —— 由 adapter 从原始 trace 抽出的「原子用量样本」（未聚合）。
 * DailyStat   —— 聚合单位：按 (date × source × model) 汇总的一天用量，充血值对象。
 *
 * 口径（已与需求确认）：
 *   - token = inputTokens + outputTokens（求和）
 *   - message = user / assistant 轮次（adapter 决定哪些样本 isMessage）
 *   - source 即 agent_type（claude-code / codex）
 */

import type { SourceId } from '@trace-review/shared';

/** 一条原子用量样本。token 与 message 解耦：纯计数样本 token 可为 0。 */
export interface UsageSample {
  /** 事件发生时刻，用于归日。 */
  timestamp: Date;
  source: SourceId;
  model: string | null;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  /** 是否计入 message 轮次（user/assistant 文本消息）。 */
  isMessage: boolean;
}

/** 本地日期 YYYY-MM-DD（按运行环境时区）。 */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * DailyStat —— 充血值对象。聚合键为 (date, source, model)。
 * 累加保持不可变语义：add 返回新实例。
 */
export class DailyStat {
  constructor(
    readonly date: string,
    readonly source: SourceId,
    readonly model: string | null,
    readonly sessionCount: number,
    readonly messageCount: number,
    readonly inputTokens: number,
    readonly outputTokens: number,
  ) {}

  get totalTokens(): number {
    return this.inputTokens + this.outputTokens;
  }

  /** 聚合键。 */
  get key(): string {
    return `${this.date}|${this.source}|${this.model ?? ''}`;
  }

  static empty(date: string, source: SourceId, model: string | null): DailyStat {
    return new DailyStat(date, source, model, 0, 0, 0, 0);
  }

  /** 合并同键的另一条统计（sessionCount 由聚合器单独去重计算，这里直接相加）。 */
  merge(other: DailyStat): DailyStat {
    return new DailyStat(
      this.date,
      this.source,
      this.model,
      this.sessionCount + other.sessionCount,
      this.messageCount + other.messageCount,
      this.inputTokens + other.inputTokens,
      this.outputTokens + other.outputTokens,
    );
  }
}
