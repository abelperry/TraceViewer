/**
 * PeriodicSummary —— 值对象（周期汇总）。
 *
 * 本周 / 本月的确定性聚合：被评审 session 数、平均分、高频问题。
 * 不额外调用模型、不落库——由 SummaryAggregator 从已存 Review 实时归并。
 */

import type {
  SummaryPeriod,
  RecurringIssueDTO,
  PeriodicSummaryDTO,
  FindingCategory,
} from '@trace-review/shared';

export type { SummaryPeriod };

/** 高频问题：按 (category, 归一化 title) 归并计数。 */
export interface RecurringIssue {
  category: FindingCategory;
  /** 归并后的代表标题 */
  title: string;
  count: number;
  exampleSessionId: string;
}

export class PeriodicSummary {
  constructor(
    readonly period: SummaryPeriod,
    /** YYYY-MM-DD 闭区间 */
    readonly from: string,
    readonly to: string,
    /** 覆盖的 session 数 */
    readonly reviewedCount: number,
    readonly avgScore: number,
    /** 高频问题：按 count 降序。 */
    readonly topIssues: RecurringIssue[],
    readonly generatedAt: Date,
  ) {}

  toDTO(): PeriodicSummaryDTO {
    return {
      period: this.period,
      from: this.from,
      to: this.to,
      reviewedCount: this.reviewedCount,
      avgScore: this.avgScore,
      topIssues: this.topIssues.map(
        (i): RecurringIssueDTO => ({
          category: i.category,
          title: i.title,
          count: i.count,
          exampleSessionId: i.exampleSessionId,
        }),
      ),
    };
  }
}
