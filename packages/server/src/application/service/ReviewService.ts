/**
 * ReviewService —— 应用服务（评审编排）。
 *
 *   - reviewSession: 手动/单个评审。loadDetail → 指纹 → reviewer → parser → upsert；
 *     reviewer 未就绪抛 ReviewerNotReady（api 409），评审过程异常兜成 failed Review。
 *   - runRoutine: 例行批量。只评 status=done 且指纹变化的 session，单轮上限 CAP，串行。
 *   - queryFeed / getById / getBySession: 读模型查询（直接走仓储）。
 *   - summarize: 周/月周期汇总，实时聚合（不落库）。
 *
 * 不含领域规则（规则在聚合/领域服务），不含 IO/模型细节（在 infra 反向实现的端口）。
 */

import { randomUUID } from 'node:crypto';
import {
  Review,
  ReviewInputBuilder,
  ReviewParser,
  SummaryAggregator,
  localDateKey,
  type Reviewer,
  type ReviewRepository,
  type ReviewQueryFilter,
  type SessionReviewScore,
  type PeriodicSummary,
  type SummaryPeriod,
} from '../../domain/index.js';
import type { SessionQueryService } from './SessionQueryService.js';

/** 例行单轮最多评审的会话数（余下下轮继续）。 */
export const ROUTINE_CAP = 20;

/** reviewer 未配置（无 API key）时手动触发抛出，api 映射为 409。 */
export class ReviewerNotReady extends Error {
  constructor() {
    super('reviewer not ready: missing API key / configuration');
    this.name = 'ReviewerNotReady';
  }
}

/** 目标 session 不存在，api 映射为 404。 */
export class SessionNotFound extends Error {
  constructor(sessionId: string) {
    super(`session not found: ${sessionId}`);
    this.name = 'SessionNotFound';
  }
}

export class ReviewService {
  private readonly builder = new ReviewInputBuilder();
  private readonly parser = new ReviewParser();
  private readonly aggregator = new SummaryAggregator();

  constructor(
    private readonly query: SessionQueryService,
    private readonly reviewer: Reviewer,
    private readonly repo: ReviewRepository,
  ) {}

  reviewerReady(): boolean {
    return this.reviewer.isReady();
  }

  /** 手动/单个评审一次 session。 */
  async reviewSession(sessionId: string, now: Date = new Date()): Promise<Review> {
    if (!this.reviewer.isReady()) throw new ReviewerNotReady();

    const loaded = await this.query.loadDetail(sessionId);
    if (!loaded) throw new SessionNotFound(sessionId);
    const { session } = loaded;
    const events = session.events;

    const meta = this.query.findMeta(sessionId);
    const contentHash = fingerprint(
      meta?.eventCount ?? session.eventCount,
      meta?.lastEventAt ?? session.lastEventAt,
    );

    const id = randomUUID();
    try {
      const draft = await this.reviewer.review(this.builder.build(session, events));
      const review = this.parser.toReview(draft, {
        id,
        sessionId,
        collectionId: session.collectionId,
        source: session.source,
        model: this.reviewer.model,
        contentHash,
        createdAt: now,
        eventCount: events.length,
      });
      this.repo.upsert(review);
      return review;
    } catch (err) {
      const review = Review.failed(
        id,
        sessionId,
        session.collectionId,
        session.source,
        this.reviewer.model,
        contentHash,
        messageOf(err),
        now,
        events.length,
      );
      this.repo.upsert(review);
      return review;
    }
  }

  /**
   * 例行批量：只评已完成、且指纹相对上次**成功**评审有变化的 session，单轮至多 CAP 条。
   * reviewer 未就绪则空跑返回 0。返回本轮新评审数。
   * 上次失败的会话会被重试（失败多为暂时性：网关/网络/解析），避免永久卡住。
   */
  async runRoutine(now: Date = new Date()): Promise<number> {
    if (!this.reviewer.isReady()) return 0;

    const metas = await this.query.queryMetas({});
    const hashes = this.repo.succeededHashes();
    let reviewed = 0;

    for (const meta of metas) {
      if (reviewed >= ROUTINE_CAP) break;
      if (meta.status !== 'done') continue;
      const fp = fingerprint(meta.eventCount, meta.lastEventAt);
      if (hashes.get(meta.id) === fp) continue; // 未变化，跳过

      try {
        await this.reviewSession(meta.id, now);
        reviewed += 1;
      } catch {
        // 单个失败不应中断整轮（reviewSession 内部已把评审异常兜成 failed 并落库；
        // 这里兜的是 loadDetail 等编排异常）
        continue;
      }
    }
    return reviewed;
  }

  queryFeed(filter: ReviewQueryFilter): Review[] {
    return this.repo.queryFeed(filter);
  }

  getById(id: string): Review | null {
    return this.repo.findById(id);
  }

  getBySession(sessionId: string): Review | null {
    return this.repo.findBySession(sessionId);
  }

  /** sessionId → 分数，供 Trace 会话树反向标记「已评审 / 几分」。 */
  sessionScores(): Map<string, SessionReviewScore> {
    return this.repo.scoresBySession();
  }

  /** 周期汇总（week=最近 7 天 / month=最近 30 天，与 Stats 口径对齐），实时聚合。 */
  summarize(period: SummaryPeriod, ref: Date = new Date()): PeriodicSummary {
    const to = localDateKey(ref);
    const days = period === 'week' ? 6 : 29;
    const fromDate = new Date(ref);
    fromDate.setDate(fromDate.getDate() - days);
    const from = localDateKey(fromDate);
    const reviews = this.repo.queryByDateRange(from, to);
    return this.aggregator.aggregate(period, from, to, reviews, ref);
  }
}

/** 轻量内容指纹：事件数 + 最后活动时刻。done 会话不再增长，足以判「是否需重评」。 */
function fingerprint(eventCount: number, lastEventAt: Date | null): string {
  return `${eventCount}|${lastEventAt ? lastEventAt.getTime() : 0}`;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
