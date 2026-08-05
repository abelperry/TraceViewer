import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteReviewRepository } from './SqliteReviewRepository.js';
import { Review, Finding } from '../../domain/index.js';
import type { SourceId } from '@trace-review/shared';

const repos: SqliteReviewRepository[] = [];
function repo(): SqliteReviewRepository {
  const r = new SqliteReviewRepository(new Database(':memory:'));
  repos.push(r);
  return r;
}

afterEach(() => {
  for (const r of repos.splice(0)) r.close();
});

function review(
  id: string,
  sessionId: string,
  createdAtIso: string,
  opts: { collectionId?: string; source?: SourceId; score?: number; hash?: string; findings?: Finding[] } = {},
): Review {
  return new Review(
    id,
    sessionId,
    opts.collectionId ?? 'c1',
    opts.source ?? 'claude-code',
    'claude-opus-5',
    opts.hash ?? 'h1',
    'done',
    opts.score ?? 4,
    'summary',
    opts.findings ?? [new Finding('agent', 'high', 'title', 'detail', 'sug', [1, 2])],
    new Date(createdAtIso),
  );
}

describe('SqliteReviewRepository', () => {
  it('upserts and reads back with findings round-trip', () => {
    const r = repo();
    r.upsert(review('r1', 's1', '2026-07-01T00:00:00Z'));
    const got = r.findBySession('s1');
    expect(got?.id).toBe('r1');
    expect(got?.findings[0]!.evidenceEventIndexes).toEqual([1, 2]);
    expect(r.findById('r1')?.sessionId).toBe('s1');
  });

  it('upsert overwrites the same session (keeps one row, latest)', () => {
    const r = repo();
    r.upsert(review('r1', 's1', '2026-07-01T00:00:00Z', { score: 3, hash: 'old' }));
    r.upsert(review('r2', 's1', '2026-07-02T00:00:00Z', { score: 5, hash: 'new' }));
    const feed = r.queryFeed({});
    expect(feed).toHaveLength(1);
    expect(feed[0]!.id).toBe('r2');
    expect(feed[0]!.score).toBe(5);
    expect(r.succeededHashes().get('s1')).toBe('new');
  });

  it('queryFeed orders by createdAt desc and paginates with before cursor', () => {
    const r = repo();
    r.upsert(review('r1', 's1', '2026-07-01T00:00:00Z'));
    r.upsert(review('r2', 's2', '2026-07-03T00:00:00Z'));
    r.upsert(review('r3', 's3', '2026-07-02T00:00:00Z'));
    const all = r.queryFeed({});
    expect(all.map((x) => x.id)).toEqual(['r2', 'r3', 'r1']);
    const page = r.queryFeed({ before: '2026-07-03T00:00:00.000Z', limit: 1 });
    expect(page.map((x) => x.id)).toEqual(['r3']);
  });

  it('queryFeed filters by collection and source', () => {
    const r = repo();
    r.upsert(review('r1', 's1', '2026-07-01T00:00:00Z', { collectionId: 'c1', source: 'claude-code' }));
    r.upsert(review('r2', 's2', '2026-07-02T00:00:00Z', { collectionId: 'c2', source: 'codex' }));
    expect(r.queryFeed({ collectionId: 'c2' }).map((x) => x.id)).toEqual(['r2']);
    expect(r.queryFeed({ source: 'codex' }).map((x) => x.id)).toEqual(['r2']);
  });

  it('succeededHashes maps sessionId to contentHash', () => {
    const r = repo();
    r.upsert(review('r1', 's1', '2026-07-01T00:00:00Z', { hash: 'abc' }));
    expect(r.succeededHashes()).toEqual(new Map([['s1', 'abc']]));
  });

  it('succeededHashes excludes failed reviews so routine can retry them', () => {
    const r = repo();
    r.upsert(review('r1', 's1', '2026-07-01T00:00:00Z', { hash: 'ok' }));
    r.upsert(
      Review.failed('r2', 's2', 'c1', 'claude-code', 'm', 'bad', 'boom', new Date('2026-07-01T00:00:00Z')),
    );
    expect(r.succeededHashes()).toEqual(new Map([['s1', 'ok']]));
    // 失败那条仍在库里、能在信息流里看到，只是不算「已完成」
    expect(r.findBySession('s2')?.status).toBe('failed');
  });

  it('scoresBySession maps sessionId to score/status/reviewId, failed included', () => {
    const r = repo();
    r.upsert(review('r1', 's1', '2026-07-01T00:00:00Z', { score: 5 }));
    r.upsert(
      Review.failed('r2', 's2', 'c1', 'claude-code', 'm', 'h', 'boom', new Date('2026-07-01T00:00:00Z')),
    );
    const scores = r.scoresBySession();
    expect(scores.get('s1')).toEqual({ reviewId: 'r1', score: 5, status: 'done' });
    expect(scores.get('s2')).toEqual({ reviewId: 'r2', score: 0, status: 'failed' });
  });

  it('round-trips eventCount (锚点校验用) and defaults legacy rows to 0', () => {
    const r = repo();
    const withCount = new Review(
      'r1', 's1', 'c1', 'claude-code', 'm', 'h', 'done', 4, 'sum', [], new Date('2026-07-01T00:00:00Z'), null, 46,
    );
    r.upsert(withCount);
    expect(r.findBySession('s1')?.eventCount).toBe(46);
    // 未传时落 0，前端把 0 当「未知」不告警
    r.upsert(review('r2', 's2', '2026-07-01T00:00:00Z'));
    expect(r.findBySession('s2')?.eventCount).toBe(0);
  });

  it('queryByDateRange returns reviews within inclusive date bounds', () => {
    const r = repo();
    r.upsert(review('r1', 's1', '2026-06-30T23:00:00Z'));
    r.upsert(review('r2', 's2', '2026-07-01T10:00:00Z'));
    r.upsert(review('r3', 's3', '2026-07-07T23:59:00Z'));
    r.upsert(review('r4', 's4', '2026-07-08T00:00:00Z'));
    const inRange = r.queryByDateRange('2026-07-01', '2026-07-07');
    expect(inRange.map((x) => x.id).sort()).toEqual(['r2', 'r3']);
  });
});
