/**
 * ReviewRepository —— 领域端口（Port）。
 *
 * 评审结果的持久化抽象。接口在 domain，实现（SQLite）在 infra 反向依赖。
 * 幂等策略：一个 session 只保留最新一条 review（upsert 按 sessionId 覆盖）。
 */

import type { SourceId } from '@trace-review/shared';
import type { Review } from '../model/Review.js';

/** sessionId → 评审概览（Trace 会话树反向标记用，避免拉全量 review）。 */
export interface SessionReviewScore {
  reviewId: string;
  score: number;
  status: Review['status'];
}

export interface ReviewQueryFilter {
  collectionId?: string;
  source?: SourceId;
  limit?: number;
  /** createdAt 游标（ISO），取严格早于它的记录——信息流向后翻页。 */
  before?: string;
}

export interface ReviewRepository {
  /** 按 sessionId 覆盖最新一条。 */
  upsert(review: Review): void;
  findBySession(sessionId: string): Review | null;
  /**
   * 「已成功评审」的 sessionId → contentHash，供例行跳过未变化的会话。
   *
   * 只含 status=done：失败的评审（网络/网关/解析异常等多为暂时性）不能算已完成，
   * 否则会被指纹永久跳过、修好病因后也不会自愈，只能手动重评。
   */
  succeededHashes(): Map<string, string>;
  /** 全量 sessionId → 分数（含 failed），供 Trace 会话树标记。 */
  scoresBySession(): Map<string, SessionReviewScore>;
  /** 信息流分页：createdAt 降序。 */
  queryFeed(filter: ReviewQueryFilter): Review[];
  findById(id: string): Review | null;
  /** 周期汇总所需：createdAt 落在 [from, to] 闭区间内的所有 review。 */
  queryByDateRange(from: string, to: string): Review[];
}
