/**
 * 评审路由：信息流 / 详情 / 手动触发 / 周期汇总 / 批量分数。
 * api 层只做协议与 DTO 映射；会话身份（标题、时间、分支等）在此 join session meta 补入。
 */

import type { FastifyInstance } from 'fastify';
import type {
  ReviewDTO,
  ReviewFeedDTO,
  ReviewScoreDTO,
  PeriodicSummaryDTO,
  SourceId,
  SummaryPeriod,
} from '@trace-review/shared';
import {
  ReviewService,
  ReviewerNotReady,
  SessionNotFound,
} from '../../application/service/ReviewService.js';
import type { SessionQueryService } from '../../application/service/SessionQueryService.js';
import { reviewToDTO, reviewToRowDTO, periodicSummaryToDTO } from '../dto/mappers.js';

interface Deps {
  reviews: ReviewService;
  query: SessionQueryService;
}

const DEFAULT_FEED_LIMIT = 50;
const MAX_FEED_LIMIT = 200;

function normalizeSource(raw: unknown): SourceId | undefined {
  return raw === 'claude-code' || raw === 'codex' ? raw : undefined;
}

function normalizePeriod(raw: unknown): SummaryPeriod {
  return raw === 'month' ? 'month' : 'week';
}

export async function registerReviewRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { reviews, query } = deps;

  const metaOf = (sessionId: string) => query.findMeta(sessionId) ?? null;

  // reviewer 是否就绪（无 API key → 前端禁用手动触发并给出提示）
  app.get('/reviews/status', async () => ({ ready: reviews.reviewerReady() }));

  // sessionId → 分数，供 Trace 会话树反向标记「已评审 / 几分」
  app.get('/reviews/scores', async () => {
    const out: Record<string, ReviewScoreDTO> = {};
    for (const [sessionId, s] of reviews.sessionScores()) out[sessionId] = s;
    return out;
  });

  // 周期汇总（放在 /:id 之前无所谓，Fastify 静态段优先）
  app.get<{ Querystring: { period?: string } }>('/reviews/summary', async (req) => {
    const period = normalizePeriod(req.query.period);
    const dto: PeriodicSummaryDTO = periodicSummaryToDTO(reviews.summarize(period));
    return dto;
  });

  // 信息流：newest → oldest，游标 = 末行 createdAt
  app.get<{
    Querystring: { collectionId?: string; source?: string; limit?: string; before?: string };
  }>('/reviews', async (req) => {
    const { collectionId, source, before } = req.query;
    const limit = Math.min(
      Math.max(1, Number(req.query.limit) || DEFAULT_FEED_LIMIT),
      MAX_FEED_LIMIT,
    );
    const found = reviews.queryFeed({
      collectionId,
      source: normalizeSource(source),
      before,
      limit,
    });
    const rows = found.map((r) => reviewToRowDTO(r, metaOf(r.sessionId)));
    const last = found[found.length - 1];
    const nextCursor =
      last && found.length === limit ? last.createdAt.toISOString() : null;
    const dto: ReviewFeedDTO = { rows, nextCursor };
    return dto;
  });

  // 按 session 取评审
  app.get<{ Params: { sessionId: string } }>('/reviews/session/:sessionId', async (req, reply) => {
    const review = reviews.getBySession(req.params.sessionId);
    if (!review) {
      reply.code(404);
      return { error: 'review not found' };
    }
    return reviewToDTO(review, metaOf(review.sessionId));
  });

  // 手动触发一次评审
  app.post<{ Params: { sessionId: string } }>('/reviews/session/:sessionId', async (req, reply) => {
    try {
      const review = await reviews.reviewSession(req.params.sessionId);
      const dto: ReviewDTO = reviewToDTO(review, metaOf(review.sessionId));
      return dto;
    } catch (err) {
      if (err instanceof ReviewerNotReady) {
        reply.code(409);
        return { error: 'reviewer not configured', hint: 'set ANTHROPIC_API_KEY' };
      }
      if (err instanceof SessionNotFound) {
        reply.code(404);
        return { error: 'session not found' };
      }
      throw err;
    }
  });

  // 评审详情
  app.get<{ Params: { id: string } }>('/reviews/:id', async (req, reply) => {
    const review = reviews.getById(req.params.id);
    if (!review) {
      reply.code(404);
      return { error: 'review not found' };
    }
    return reviewToDTO(review, metaOf(review.sessionId));
  });
}
