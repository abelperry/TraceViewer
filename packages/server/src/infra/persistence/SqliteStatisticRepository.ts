/**
 * SqliteStatisticRepository —— StatisticRepository 端口的实现（infra，反向依赖 domain）。
 *
 * 表 daily_stat，主键 (date, source, model)，upsert 幂等 —— rebuild 某天可安全覆盖。
 * 与会话索引库共用同一个 Database 连接。
 */

import type Database from 'better-sqlite3';
import {
  DailyStat,
  type StatisticRepository,
} from '../../domain/index.js';
import type { SourceId } from '@trace-review/shared';

interface StatRow {
  date: string;
  source: string;
  model: string | null;
  session_count: number;
  message_count: number;
  input_tokens: number;
  output_tokens: number;
}

export class SqliteStatisticRepository implements StatisticRepository {
  constructor(private readonly db: Database.Database) {
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_stat (
        date          TEXT NOT NULL,
        source        TEXT NOT NULL,
        model         TEXT NOT NULL DEFAULT '',
        session_count INTEGER NOT NULL DEFAULT 0,
        message_count INTEGER NOT NULL DEFAULT 0,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, source, model)
      );
      CREATE INDEX IF NOT EXISTS idx_stat_date ON daily_stat(date);
    `);
  }

  upsertMany(stats: DailyStat[]): void {
    if (stats.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO daily_stat
        (date, source, model, session_count, message_count, input_tokens, output_tokens)
       VALUES (@date, @source, @model, @session_count, @message_count, @input_tokens, @output_tokens)
       ON CONFLICT(date, source, model) DO UPDATE SET
        session_count=excluded.session_count, message_count=excluded.message_count,
        input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens`,
    );
    const tx = this.db.transaction((rows: DailyStat[]) => {
      for (const s of rows) {
        stmt.run({
          date: s.date,
          source: s.source,
          model: s.model ?? '',
          session_count: s.sessionCount,
          message_count: s.messageCount,
          input_tokens: s.inputTokens,
          output_tokens: s.outputTokens,
        });
      }
    });
    tx(stats);
  }

  deleteDate(date: string): void {
    this.db.prepare('DELETE FROM daily_stat WHERE date = ?').run(date);
  }

  queryRange(from: string, to: string): DailyStat[] {
    const rows = this.db
      .prepare('SELECT * FROM daily_stat WHERE date >= ? AND date <= ? ORDER BY date')
      .all(from, to) as StatRow[];
    return rows.map((r) => this.fromRow(r));
  }

  knownDates(): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT date FROM daily_stat ORDER BY date')
      .all() as { date: string }[];
    return rows.map((r) => r.date);
  }

  private fromRow(r: StatRow): DailyStat {
    return new DailyStat(
      r.date,
      r.source as SourceId,
      r.model === '' ? null : r.model,
      r.session_count,
      r.message_count,
      r.input_tokens,
      r.output_tokens,
    );
  }
}
