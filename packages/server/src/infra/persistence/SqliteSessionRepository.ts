/**
 * SqliteSessionRepository —— SessionRepository 端口的实现（infra，反向依赖 domain）。
 *
 * 只持久化元数据快照，不存全文。换 Postgres 等只需另写一个实现，domain 不动。
 * 使用 better-sqlite3 同步 API（本地单用户，事务简单、无并发压力）。
 */

import Database from 'better-sqlite3';
import {
  SessionMeta,
  type CollectionSummary,
  type SessionQueryFilter,
  type SessionRepository,
} from '../../domain/index.js';
import type { SessionStatus, SourceId } from '@trace-review/shared';

interface MetaRow {
  id: string;
  source: string;
  collection_id: string;
  title: string;
  cwd: string | null;
  git_branch: string | null;
  model: string | null;
  status: string;
  started_at: number | null;
  last_event_at: number | null;
  event_count: number;
}

export class SqliteSessionRepository implements SessionRepository {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_meta (
        id            TEXT PRIMARY KEY,
        source        TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        title         TEXT NOT NULL,
        cwd           TEXT,
        git_branch    TEXT,
        model         TEXT,
        status        TEXT NOT NULL,
        started_at    INTEGER,
        last_event_at INTEGER,
        event_count   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_meta_collection ON session_meta(collection_id);
      CREATE INDEX IF NOT EXISTS idx_meta_last_event ON session_meta(last_event_at DESC);
    `);
  }

  upsertMeta(meta: SessionMeta): void {
    this.db
      .prepare(
        `INSERT INTO session_meta
          (id, source, collection_id, title, cwd, git_branch, model, status, started_at, last_event_at, event_count)
         VALUES
          (@id, @source, @collection_id, @title, @cwd, @git_branch, @model, @status, @started_at, @last_event_at, @event_count)
         ON CONFLICT(id) DO UPDATE SET
          source=excluded.source, collection_id=excluded.collection_id, title=excluded.title,
          cwd=excluded.cwd, git_branch=excluded.git_branch, model=excluded.model,
          status=excluded.status, started_at=excluded.started_at,
          last_event_at=excluded.last_event_at, event_count=excluded.event_count`,
      )
      .run(this.toRow(meta));
  }

  findMeta(id: string): SessionMeta | null {
    const row = this.db.prepare('SELECT * FROM session_meta WHERE id = ?').get(id) as
      | MetaRow
      | undefined;
    return row ? this.fromRow(row) : null;
  }

  queryMetas(filter: SessionQueryFilter): SessionMeta[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.collectionId) {
      clauses.push('collection_id = @collectionId');
      params.collectionId = filter.collectionId;
    }
    if (filter.keyword) {
      clauses.push('(title LIKE @kw OR cwd LIKE @kw)');
      params.kw = `%${filter.keyword}%`;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = filter.limit ?? 200;
    const offset = filter.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT * FROM session_meta ${where}
         ORDER BY last_event_at DESC NULLS LAST
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as MetaRow[];
    return rows.map((r) => this.fromRow(r));
  }

  listCollections(): CollectionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT collection_id, source, COUNT(*) AS cnt
         FROM session_meta GROUP BY collection_id, source
         ORDER BY collection_id`,
      )
      .all() as { collection_id: string; source: string; cnt: number }[];
    return rows.map((r) => ({
      collectionId: r.collection_id,
      source: r.source,
      sessionCount: r.cnt,
    }));
  }

  pruneExcept(existingIds: Set<string>): number {
    const all = this.db.prepare('SELECT id FROM session_meta').all() as { id: string }[];
    const toDelete = all.filter((r) => !existingIds.has(r.id)).map((r) => r.id);
    if (toDelete.length === 0) return 0;
    const del = this.db.prepare('DELETE FROM session_meta WHERE id = ?');
    const tx = this.db.transaction((ids: string[]) => {
      for (const id of ids) del.run(id);
    });
    tx(toDelete);
    return toDelete.length;
  }

  close(): void {
    this.db.close();
  }

  private toRow(meta: SessionMeta): MetaRow {
    return {
      id: meta.id,
      source: meta.source,
      collection_id: meta.collectionId,
      title: meta.title,
      cwd: meta.cwd,
      git_branch: meta.gitBranch,
      model: meta.model,
      status: meta.status,
      started_at: meta.startedAt ? meta.startedAt.getTime() : null,
      last_event_at: meta.lastEventAt ? meta.lastEventAt.getTime() : null,
      event_count: meta.eventCount,
    };
  }

  private fromRow(row: MetaRow): SessionMeta {
    return new SessionMeta(
      row.id,
      row.source as SourceId,
      row.collection_id,
      row.title,
      row.cwd,
      row.git_branch,
      row.model,
      row.status as SessionStatus,
      row.started_at ? new Date(row.started_at) : null,
      row.last_event_at ? new Date(row.last_event_at) : null,
      row.event_count,
    );
  }
}
