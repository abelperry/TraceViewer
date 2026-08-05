/**
 * ReviewParser —— 领域服务。
 *
 * 把评审者产出的原始 ReviewDraft 校验/归一成 Review 聚合：
 *   - score 必须为 1..5 的整数
 *   - 每条 finding 的 category/severity 必须落在枚举内，title/detail/suggestion 非空
 *   - evidenceEventIndexes 归一为去重、非负整数
 * 任一校验失败即抛错，由 application 兜成 failed Review。
 *
 * 纯函数、零依赖，可独立单测。
 */

import type { SourceId } from '@trace-review/shared';
import { Review } from '../model/Review.js';
import { Finding, type FindingCategory, type Severity } from '../model/Finding.js';
import type { ReviewDraft } from '../port/Reviewer.js';

/** 落库/展示所需的上下文，由 application 提供（draft 不含这些）。 */
export interface ReviewContext {
  id: string;
  sessionId: string;
  collectionId: string;
  source: SourceId;
  model: string;
  contentHash: string;
  createdAt: Date;
  /** 事件总数，用于校验 evidence 序号越界。 */
  eventCount: number;
}

const CATEGORIES: readonly FindingCategory[] = ['agent', 'prompt'];
const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low'];

export class ReviewParser {
  toReview(draft: ReviewDraft, ctx: ReviewContext): Review {
    const score = this.validateScore(draft.score);
    const summary = requireNonEmpty(draft.summary, 'summary');
    const findings = (draft.findings ?? []).map((f, i) => this.toFinding(f, i, ctx.eventCount));

    return new Review(
      ctx.id,
      ctx.sessionId,
      ctx.collectionId,
      ctx.source,
      ctx.model,
      ctx.contentHash,
      'done',
      score,
      summary,
      findings,
      ctx.createdAt,
      null,
      ctx.eventCount,
    );
  }

  private validateScore(score: unknown): number {
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
      throw new Error(`invalid score: ${String(score)} (expected integer 1..5)`);
    }
    return score;
  }

  private toFinding(
    f: ReviewDraft['findings'][number],
    index: number,
    eventCount: number,
  ): Finding {
    if (!CATEGORIES.includes(f.category)) {
      throw new Error(`finding[${index}]: invalid category ${String(f.category)}`);
    }
    if (!SEVERITIES.includes(f.severity)) {
      throw new Error(`finding[${index}]: invalid severity ${String(f.severity)}`);
    }
    const title = requireNonEmpty(f.title, `finding[${index}].title`);
    const detail = requireNonEmpty(f.detail, `finding[${index}].detail`);
    const suggestion = requireNonEmpty(f.suggestion, `finding[${index}].suggestion`);
    const evidence = normalizeEvidence(f.evidenceEventIndexes, eventCount);
    return new Finding(f.category, f.severity, title, detail, suggestion, evidence);
  }
}

function requireNonEmpty(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`missing/empty field: ${field}`);
  }
  return v.trim();
}

/** 去重、丢弃非整数/负数/越界，升序。拿不到即空数组（尽力而为）。 */
function normalizeEvidence(raw: number[] | undefined, eventCount: number): number[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<number>();
  for (const n of raw) {
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < eventCount) {
      set.add(n);
    }
  }
  return [...set].sort((a, b) => a - b);
}
