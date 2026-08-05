/**
 * Reviewer —— 领域端口（Port）。
 *
 * 「如何评审一次 run」的抽象。接口在 domain，实现（Anthropic API / CLI / 本地模型）
 * 在 infra 反向依赖。application 只依赖此端口，替换实现零改动。
 */

import type { FindingCategory, Severity } from '@trace-review/shared';
import type { Session } from '../model/Session.js';
import type { Event } from '../model/Event.js';

export interface ReviewInput {
  session: Session;
  /** 已组装的完整事件序列（index 即证据序号）。 */
  events: readonly Event[];
}

/** 模型产出的原始草稿（未落 id/时间；由 ReviewParser 校验归一）。 */
export interface ReviewDraft {
  score: number;
  summary: string;
  findings: Array<{
    category: FindingCategory;
    severity: Severity;
    title: string;
    detail: string;
    suggestion: string;
    evidenceEventIndexes?: number[];
  }>;
}

export interface Reviewer {
  /** 实际模型名（用于落库与展示）。 */
  readonly model: string;
  /** 是否可用（如未配置 API key 则 false）。 */
  isReady(): boolean;
  /** 评审一次 run；失败抛错，由 application 兜成 failed Review。 */
  review(input: ReviewInput): Promise<ReviewDraft>;
}
