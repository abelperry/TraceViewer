import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteStatisticRepository } from './SqliteStatisticRepository.js';
import { DailyStat } from '../../domain/index.js';

const dbs: Database.Database[] = [];
function repo(): SqliteStatisticRepository {
  const db = new Database(':memory:');
  dbs.push(db);
  return new SqliteStatisticRepository(db);
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

describe('SqliteStatisticRepository', () => {
  it('upserts and queries a range', () => {
    const r = repo();
    r.upsertMany([
      new DailyStat('2026-06-28', 'claude-code', 'opus', 2, 10, 100, 50),
      new DailyStat('2026-06-30', 'codex', 'gpt', 1, 5, 30, 20),
    ]);
    const got = r.queryRange('2026-06-28', '2026-06-30');
    expect(got).toHaveLength(2);
    const opus = got.find((s) => s.model === 'opus')!;
    expect(opus.totalTokens).toBe(150);
    expect(opus.sessionCount).toBe(2);
  });

  it('upsert is idempotent on (date,source,model)', () => {
    const r = repo();
    r.upsertMany([new DailyStat('2026-06-30', 'codex', 'gpt', 1, 5, 30, 20)]);
    r.upsertMany([new DailyStat('2026-06-30', 'codex', 'gpt', 3, 9, 99, 11)]);
    const got = r.queryRange('2026-06-30', '2026-06-30');
    expect(got).toHaveLength(1);
    expect(got[0]!.sessionCount).toBe(3);
    expect(got[0]!.inputTokens).toBe(99);
  });

  it('handles null model via empty-string key', () => {
    const r = repo();
    r.upsertMany([new DailyStat('2026-06-30', 'codex', null, 1, 1, 1, 1)]);
    const got = r.queryRange('2026-06-30', '2026-06-30');
    expect(got[0]!.model).toBeNull();
  });

  it('deleteDate clears a day before rebuild', () => {
    const r = repo();
    r.upsertMany([
      new DailyStat('2026-06-30', 'codex', 'gpt', 1, 1, 1, 1),
      new DailyStat('2026-06-30', 'claude-code', 'opus', 1, 1, 1, 1),
    ]);
    r.deleteDate('2026-06-30');
    expect(r.queryRange('2026-06-30', '2026-06-30')).toHaveLength(0);
  });

  it('knownDates returns distinct sorted dates', () => {
    const r = repo();
    r.upsertMany([
      new DailyStat('2026-06-30', 'codex', 'gpt', 1, 1, 1, 1),
      new DailyStat('2026-06-28', 'codex', 'gpt', 1, 1, 1, 1),
      new DailyStat('2026-06-28', 'claude-code', 'opus', 1, 1, 1, 1),
    ]);
    expect(r.knownDates()).toEqual(['2026-06-28', '2026-06-30']);
  });
});
