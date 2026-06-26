/**
 * SessionRepository —— 领域端口（Port）。
 *
 * 会话「元数据索引」的抽象。接口在 domain，实现（SQLite/Postgres/…）在 infra，
 * 反向依赖本接口。换存储只新增实现，application/domain 不动。
 *
 * 仓储只负责元数据快照（SessionMeta），不持久化全文事件——
 * 全文始终以 TraceSource 的 JSONL 为唯一真实来源、按需解析。
 */

import type { SessionMeta } from '../model/SessionMeta.js';

export interface SessionQueryFilter {
  collectionId?: string;
  /** 对 title / cwd 做包含匹配。 */
  keyword?: string;
  limit?: number;
  offset?: number;
}

export interface CollectionSummary {
  collectionId: string;
  source: string;
  sessionCount: number;
}

export interface SessionRepository {
  upsertMeta(meta: SessionMeta): void;
  findMeta(id: string): SessionMeta | null;
  queryMetas(filter: SessionQueryFilter): SessionMeta[];
  listCollections(): CollectionSummary[];
  /** 删除不再存在于来源的会话索引。返回删除数量。 */
  pruneExcept(existingIds: Set<string>): number;
}
