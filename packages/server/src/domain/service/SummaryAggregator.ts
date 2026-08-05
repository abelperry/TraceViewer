/**
 * SummaryAggregator —— 领域服务。
 *
 * 把区间内的 Review 确定性归并成 PeriodicSummary：被评审 session 数、平均分、
 * 高频问题（按 (category, 归一化 title) 归并计数降序）。零额外 token、可随时重算。
 *
 * 纯函数、零依赖，可独立单测。
 */

import { PeriodicSummary, type RecurringIssue, type SummaryPeriod } from '../model/PeriodicSummary.js';
import type { Review } from '../model/Review.js';
import type { FindingCategory } from '../model/Finding.js';

/** topIssues 默认取前 N 条。 */
export const DEFAULT_TOP_ISSUES = 5;

interface IssueAcc {
  category: FindingCategory;
  title: string; // 代表标题（首次出现的原文）
  count: number;
  exampleSessionId: string;
}

export class SummaryAggregator {
  constructor(private readonly topN = DEFAULT_TOP_ISSUES) {}

  aggregate(
    period: SummaryPeriod,
    from: string,
    to: string,
    reviews: Review[],
    generatedAt: Date,
  ): PeriodicSummary {
    const done = reviews.filter((r) => r.status === 'done');
    const reviewedCount = reviews.length;
    const avgScore =
      done.length === 0
        ? 0
        : round1(done.reduce((sum, r) => sum + r.score, 0) / done.length);

    const buckets = new Map<string, IssueAcc>();
    for (const r of done) {
      for (const f of r.findings) {
        const norm = normalizeTitle(f.title);
        const key = `${f.category}|${norm}`;
        const acc = buckets.get(key);
        if (acc) {
          acc.count += 1;
        } else {
          buckets.set(key, {
            category: f.category,
            title: f.title,
            count: 1,
            exampleSessionId: r.sessionId,
          });
        }
      }
    }

    const topIssues: RecurringIssue[] = [...buckets.values()]
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
      .slice(0, this.topN);

    return new PeriodicSummary(period, from, to, reviewedCount, avgScore, topIssues, generatedAt);
  }
}

/** 归一化标题用于归并：小写、trim、折叠空白。 */
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
