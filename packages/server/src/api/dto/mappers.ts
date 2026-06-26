/**
 * DTO 映射：api 层负责把 domain 充血实体翻译成传输 DTO。
 * domain 实体不外泄到前端，映射集中在此。
 */

import type {
  CollectionDTO,
  SessionDetailDTO,
  SessionMetaDTO,
} from '@trace-review/shared';
import type { CollectionSummary, Session, SessionMeta } from '../../domain/index.js';

export function metaToDTO(meta: SessionMeta): SessionMetaDTO {
  return meta.toDTO();
}

export function collectionToDTO(c: CollectionSummary): CollectionDTO {
  return {
    id: c.collectionId,
    name: c.collectionId,
    source: c.source,
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
