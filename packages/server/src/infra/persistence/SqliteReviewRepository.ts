/**
 * SqliteReviewRepository —— ReviewRepository 端口的实现（infra，反向依赖 domain）。
 *
 * 表 review，session_id 唯一（一 session 一条最新）。findings 以 JSON 列存取。
 * 风格对齐 SqliteSessionRepository：预编译语句、构造注入 Database、close()。
 * 与会话/统计库共用同一个连接。
 */

import type Database from 'better-sqlite3';
import {
  Review,
  Finding,
  type ReviewRepository,
  type ReviewQueryFilter,
  type ReviewStatus,
  type SessionReviewScore,
  type FindingCategory,
  type Severity,
} from '../../domain/index.js';
import type { SourceId } from '@trace-review/shared';

interface ReviewRow {
  id: string;
  session_id: string;
  collection_id: string;
  source: string;
  model: string;
  content_hash: string;
  status: string;
  score: number;
  summary: string;
  findings_json: string;
  error: string | null;
  created_at: string;
  event_count: number;
}

interface FindingJson {
  category: FindingCategory;
  severity: Severity;
  title: string;
  detail: string;
  suggestion: string;
  evidenceEventIndexes: number[];
}

export class SqliteReviewRepository implements ReviewRepository {
  constructor(private readonly db: Database.Database) {
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS review (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL UNIQUE,
        collection_id TEXT NOT NULL,
        source        TEXT NOT NULL,
        model         TEXT NOT NULL,
        content_hash  TEXT NOT NULL,
        status        TEXT NOT NULL,
        score         INTEGER NOT NULL,
        summary       TEXT NOT NULL,
        findings_json TEXT NOT NULL,
        error         TEXT,
        created_at    TEXT NOT NULL,
        event_count   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_review_created ON review(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_review_collection ON review(collection_id);
    `);
    // 已存在的库补列：evidence 的 #index 是评审当时事件数组里的位置，
    // 存下当时的事件数才能判断轨迹后来又长了、锚点是否已偏移。
    // 旧数据补为 0，前端把 0 当作「未知」不告警。
    const cols = this.db.prepare('PRAGMA table_info(review)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'event_count')) {
      this.db.exec('ALTER TABLE review ADD COLUMN event_count INTEGER NOT NULL DEFAULT 0');
    }
  }

  upsert(review: Review): void {
    this.db
      .prepare(
        `INSERT INTO review
          (id, session_id, collection_id, source, model, content_hash, status, score, summary, findings_json, error, created_at, event_count)
         VALUES
          (@id, @session_id, @collection_id, @source, @model, @content_hash, @status, @score, @summary, @findings_json, @error, @created_at, @event_count)
         ON CONFLICT(session_id) DO UPDATE SET
          id=excluded.id, collection_id=excluded.collection_id, source=excluded.source,
          model=excluded.model, content_hash=excluded.content_hash, status=excluded.status,
          score=excluded.score, summary=excluded.summary, findings_json=excluded.findings_json,
          error=excluded.error, created_at=excluded.created_at, event_count=excluded.event_count`,
      )
      .run(this.toRow(review));
  }

  findBySession(sessionId: string): Review | null {
    const row = this.db.prepare('SELECT * FROM review WHERE session_id = ?').get(sessionId) as
      | ReviewRow
      | undefined;
    return row ? this.fromRow(row) : null;
  }

  succeededHashes(): Map<string, string> {
    const rows = this.db
      .prepare("SELECT session_id, content_hash FROM review WHERE status = 'done'")
      .all() as { session_id: string; content_hash: string }[];
    return new Map(rows.map((r) => [r.session_id, r.content_hash]));
  }

  scoresBySession(): Map<string, SessionReviewScore> {
    const rows = this.db
      .prepare('SELECT session_id, id, score, status FROM review')
      .all() as { session_id: string; id: string; score: number; status: ReviewStatus }[];
    return new Map(
      rows.map((r) => [r.session_id, { reviewId: r.id, score: r.score, status: r.status }]),
    );
  }

  queryFeed(filter: ReviewQueryFilter): Review[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.collectionId) {
      clauses.push('collection_id = @collectionId');
      params.collectionId = filter.collectionId;
    }
    if (filter.source) {
      clauses.push('source = @source');
      params.source = filter.source;
    }
    if (filter.before) {
      clauses.push('created_at < @before');
      params.before = filter.before;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    const rows = this.db
      .prepare(`SELECT * FROM review ${where} ORDER BY created_at DESC LIMIT @limit`)
      .all({ ...params, limit }) as ReviewRow[];
    return rows.map((r) => this.fromRow(r));
  }

  findById(id: string): Review | null {
    const row = this.db.prepare('SELECT * FROM review WHERE id = ?').get(id) as
      | ReviewRow
      | undefined;
    return row ? this.fromRow(row) : null;
  }

  queryByDateRange(from: string, to: string): Review[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM review
         WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
         ORDER BY created_at DESC`,
      )
      .all(from, to) as ReviewRow[];
    return rows.map((r) => this.fromRow(r));
  }

  close(): void {
    this.db.close();
  }

  private toRow(r: Review): ReviewRow {
    const findings: FindingJson[] = r.findings.map((f) => ({
      category: f.category,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      suggestion: f.suggestion,
      evidenceEventIndexes: f.evidenceEventIndexes,
    }));
    return {
      id: r.id,
      session_id: r.sessionId,
      collection_id: r.collectionId,
      source: r.source,
      model: r.model,
      content_hash: r.contentHash,
      status: r.status,
      score: r.score,
      summary: r.summary,
      findings_json: JSON.stringify(findings),
      error: r.error,
      created_at: r.createdAt.toISOString(),
      event_count: r.eventCount,
    };
  }

  private fromRow(row: ReviewRow): Review {
    const parsed = safeParse(row.findings_json);
    const findings = parsed.map(
      (f) =>
        new Finding(
          f.category,
          f.severity,
          f.title,
          f.detail,
          f.suggestion,
          Array.isArray(f.evidenceEventIndexes) ? f.evidenceEventIndexes : [],
        ),
    );
    return new Review(
      row.id,
      row.session_id,
      row.collection_id,
      row.source as SourceId,
      row.model,
      row.content_hash,
      row.status as ReviewStatus,
      row.score,
      row.summary,
      findings,
      new Date(row.created_at),
      row.error,
      row.event_count ?? 0,
    );
  }
}

function safeParse(json: string): FindingJson[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as FindingJson[]) : [];
  } catch {
    return [];
  }
}
