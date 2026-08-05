/**
 * DTO 映射：api 层负责把 domain 充血实体翻译成传输 DTO。
 * domain 实体不外泄到前端，映射集中在此。
 */

import type {
  CollectionDTO,
  PeriodicSummaryDTO,
  ReviewDTO,
  ReviewRowDTO,
  ReviewSessionRefDTO,
  SessionDetailDTO,
  SessionMetaDTO,
} from '@trace-review/shared';
import type {
  CollectionSummary,
  PeriodicSummary,
  Review,
  Session,
  SessionMeta,
} from '../../domain/index.js';

export function metaToDTO(meta: SessionMeta): SessionMetaDTO {
  return meta.toDTO();
}

export function collectionToDTO(c: CollectionSummary): CollectionDTO {
  return {
    id: c.collectionId,
    name: c.collectionId,
    sources: c.sources,
    rootPath: c.collectionId,
    sessionCount: c.sessionCount,
  };
}

export function sessionToDetailDTO(session: Session, now: Date): SessionDetailDTO {
  return {
    meta: session.toMeta(now).toDTO(),
    tokenUsage: session.tokenUsage.toDTO(),
    events: session.events.map((e) => e.toDTO()),
  };
}

/** SessionMeta → 评审详情里的会话身份块（定位 trace 所需的最小信息）。 */
export function metaToReviewSessionRef(meta: SessionMeta): ReviewSessionRefDTO {
  const dto = meta.toDTO();
  return {
    id: dto.id,
    title: dto.title,
    collectionId: dto.collectionId,
    cwd: dto.cwd,
    gitBranch: dto.gitBranch,
    startedAt: dto.startedAt,
    lastEventAt: dto.lastEventAt,
    eventCount: dto.eventCount,
    status: dto.status,
  };
}

/** 详情；meta 为 null（会话已删除）时 session 字段为 null。 */
export function reviewToDTO(review: Review, meta: SessionMeta | null = null): ReviewDTO {
  return review.toDTO(meta ? metaToReviewSessionRef(meta) : null);
}

/** 信息流行；标题与会话开始时间由 api 层 join meta 补入（拿不到标题回落 sessionId）。 */
export function reviewToRowDTO(review: Review, meta: SessionMeta | null): ReviewRowDTO {
  const dto = meta?.toDTO() ?? null;
  return review.toRowDTO(dto?.title ?? review.sessionId, dto?.startedAt ?? null);
}

export function periodicSummaryToDTO(summary: PeriodicSummary): PeriodicSummaryDTO {
  return summary.toDTO();
}
