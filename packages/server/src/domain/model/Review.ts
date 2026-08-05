/**
 * Review —— 聚合根（Aggregate Root）。充血模型。
 *
 * 一次 session 评审的结果：总体分（1–5）、一句话摘要、若干 Finding，
 * 以及评审元信息（模型、内容哈希、状态、时间）。自带按类别分组、
 * 计数、最高严重度等派生行为；评分→颜色的映射放前端，domain 只存 score。
 */

import type {
  ReviewStatus,
  ReviewDTO,
  ReviewRowDTO,
  ReviewSessionRefDTO,
  SourceId,
} from '@trace-review/shared';
import { Finding, SEVERITY_RANK, type FindingCategory, type Severity } from './Finding.js';

export type { ReviewStatus };

export class Review {
  constructor(
    readonly id: string,
    readonly sessionId: string,
    readonly collectionId: string,
    readonly source: SourceId,
    /** 实际使用的模型 */
    readonly model: string,
    /** 评审时 session 内容哈希（幂等键的一半）。 */
    readonly contentHash: string,
    readonly status: ReviewStatus,
    /** 1..5（failed 时为 0）。 */
    readonly score: number,
    /** 一句话摘要（信息流那行显示它）。 */
    readonly summary: string,
    readonly findings: Finding[],
    readonly createdAt: Date,
    readonly error: string | null = null,
    /**
     * 评审当时 session 的事件总数。evidence 的 #index 是那一刻事件数组里的位置，
     * 轨迹后来若继续增长，索引就会错位；存下它才能判断锚点是否还可信。
     * 0 = 未知（早于本字段的历史数据）。
     */
    readonly eventCount: number = 0,
  ) {}

  /** 按 category 分组，供详情面板。 */
  findingsByCategory(): Record<FindingCategory, Finding[]> {
    const grouped: Record<FindingCategory, Finding[]> = { agent: [], prompt: [] };
    for (const f of this.findings) grouped[f.category].push(f);
    return grouped;
  }

  /** 计数 chip：{agent, prompt}。 */
  counts(): Record<FindingCategory, number> {
    const grouped = this.findingsByCategory();
    return { agent: grouped.agent.length, prompt: grouped.prompt.length };
  }

  /** 最高 severity（无 findings 时 null）。 */
  topSeverity(): Severity | null {
    let top: Severity | null = null;
    for (const f of this.findings) {
      if (!top || SEVERITY_RANK[f.severity] > SEVERITY_RANK[top]) top = f.severity;
    }
    return top;
  }

  /** 评审过程失败时的占位 Review（score=0，无 findings，带错误信息）。 */
  static failed(
    id: string,
    sessionId: string,
    collectionId: string,
    source: SourceId,
    model: string,
    contentHash: string,
    error: string,
    createdAt: Date,
    eventCount = 0,
  ): Review {
    return new Review(
      id,
      sessionId,
      collectionId,
      source,
      model,
      contentHash,
      'failed',
      0,
      error,
      [],
      createdAt,
      error,
      eventCount,
    );
  }

  /**
   * 详情 DTO。session 由 api 层 join SessionMeta 补入（会话已删除时传 null）：
   * 评审是派生数据，只有 sessionId 的话使用者看不出指向哪个 trace。
   */
  toDTO(session: ReviewSessionRefDTO | null = null): ReviewDTO {
    return {
      id: this.id,
      sessionId: this.sessionId,
      collectionId: this.collectionId,
      source: this.source,
      model: this.model,
      status: this.status,
      score: this.score,
      summary: this.summary,
      counts: this.counts(),
      findings: this.findings.map((f) => f.toDTO()),
      error: this.error,
      createdAt: this.createdAt.toISOString(),
      session,
      reviewedEventCount: this.eventCount,
    };
  }

  /** 信息流轻量行；sessionTitle / sessionStartedAt 由 api 层 join meta 补入。 */
  toRowDTO(sessionTitle: string, sessionStartedAt: string | null = null): ReviewRowDTO {
    return {
      id: this.id,
      sessionId: this.sessionId,
      sessionTitle,
      collectionId: this.collectionId,
      source: this.source,
      score: this.score,
      summary: this.summary,
      counts: this.counts(),
      topSeverity: this.topSeverity(),
      status: this.status,
      createdAt: this.createdAt.toISOString(),
      sessionStartedAt,
    };
  }
}
