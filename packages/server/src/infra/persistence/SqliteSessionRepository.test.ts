import { describe, it, expect, afterEach } from 'vitest';
import { SqliteSessionRepository } from './SqliteSessionRepository.js';
import { SessionMeta } from '../../domain/index.js';

const repos: SqliteSessionRepository[] = [];
function repo(): SqliteSessionRepository {
  const r = new SqliteSessionRepository(':memory:');
  repos.push(r);
  return r;
}

afterEach(() => {
  for (const r of repos.splice(0)) r.close();
});

function meta(id: string, collectionId: string, lastEventMs: number): SessionMeta {
  return new SessionMeta(
    id,
    'claude-code',
    collectionId,
    `title-${id}`,
    '/work',
    'main',
    'opus',
    'done',
    new Date(lastEventMs - 1000),
    new Date(lastEventMs),
    5,
  );
}

describe('SqliteSessionRepository', () => {
  it('upserts and reads back a meta', () => {
    const r = repo();
    r.upsertMeta(meta('s1', 'c1', 1000));
    const got = r.findMeta('s1');
    expect(got?.title).toBe('title-s1');
    expect(got?.eventCount).toBe(5);
  });

  it('upsert is idempotent on id', () => {
    const r = repo();
    r.upsertMeta(meta('s1', 'c1', 1000));
    r.upsertMeta(meta('s1', 'c1', 2000));
    expect(r.queryMetas({})).toHaveLength(1);
  });

  it('queries by collection and orders by last_event desc', () => {
    const r = repo();
    r.upsertMeta(meta('s1', 'c1', 1000));
    r.upsertMeta(meta('s2', 'c1', 3000));
    r.upsertMeta(meta('s3', 'c2', 2000));
    const c1 = r.queryMetas({ collectionId: 'c1' });
    expect(c1.map((m) => m.id)).toEqual(['s2', 's1']);
  });

  it('keyword filters on title', () => {
    const r = repo();
    r.upsertMeta(meta('alpha', 'c1', 1000));
    r.upsertMeta(meta('beta', 'c1', 2000));
    const hits = r.queryMetas({ keyword: 'alph' });
    expect(hits.map((m) => m.id)).toEqual(['alpha']);
  });

  it('lists collections with counts', () => {
    const r = repo();
    r.upsertMeta(meta('s1', 'c1', 1000));
    r.upsertMeta(meta('s2', 'c1', 2000));
    r.upsertMeta(meta('s3', 'c2', 3000));
    const cols = r.listCollections();
    const c1 = cols.find((c) => c.collectionId === 'c1');
    expect(c1?.sessionCount).toBe(2);
  });

  it('prunes metas not in the existing set', () => {
    const r = repo();
    r.upsertMeta(meta('s1', 'c1', 1000));
    r.upsertMeta(meta('s2', 'c1', 2000));
    const removed = r.pruneExcept(new Set(['s1']));
    expect(removed).toBe(1);
    expect(r.findMeta('s2')).toBeNull();
    expect(r.findMeta('s1')).not.toBeNull();
  });
});
