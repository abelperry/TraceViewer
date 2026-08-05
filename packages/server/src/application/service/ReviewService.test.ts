import { describe, it, expect } from 'vitest';
import { ReviewService, ReviewerNotReady, SessionNotFound, ROUTINE_CAP } from './ReviewService.js';
import { Review } from '../../domain/index.js';
import type { Reviewer, ReviewInput, ReviewDraft } from '../../domain/index.js';
import type {
  ReviewRepository,
  ReviewQueryFilter,
  SessionReviewScore,
} from '../../domain/index.js';
import type { SessionQueryService } from './SessionQueryService.js';

// ---- fakes ---------------------------------------------------------------

function fakeSession(id: string, eventCount: number, lastEventMs: number) {
  return {
    id,
    source: 'claude-code',
    collectionId: 'col-a',
    events: Array.from({ length: eventCount }, (_, i) => ({ index: i })),
    eventCount,
    lastEventAt: lastEventMs ? new Date(lastEventMs) : null,
  };
}

function fakeMeta(id: string, status: string, eventCount: number, lastEventMs: number) {
  return {
    id,
    status,
    eventCount,
    lastEventAt: lastEventMs ? new Date(lastEventMs) : null,
    title: `title ${id}`,
  };
}

function fakeQuery(
  sessions: Record<string, ReturnType<typeof fakeSession>>,
  metas: ReturnType<typeof fakeMeta>[],
): SessionQueryService {
  return {
    async loadDetail(id: string) {
      const session = sessions[id];
      return session ? { session } : null;
    },
    findMeta(id: string) {
      return metas.find((m) => m.id === id) ?? null;
    },
    async queryMetas() {
      return metas;
    },
  } as unknown as SessionQueryService;
}

class FakeRepo implements ReviewRepository {
  readonly byId = new Map<string, Review>();
  readonly bySession = new Map<string, Review>();

  upsert(review: Review): void {
    // 模拟 session_id UNIQUE：覆盖同 session 的旧记录
    const prev = this.bySession.get(review.sessionId);
    if (prev) this.byId.delete(prev.id);
    this.bySession.set(review.sessionId, review);
    this.byId.set(review.id, review);
  }
  findBySession(sessionId: string): Review | null {
    return this.bySession.get(sessionId) ?? null;
  }
  succeededHashes(): Map<string, string> {
    const out = new Map<string, string>();
    // 与 SQL 实现一致：只算成功的评审
    for (const r of this.bySession.values()) {
      if (r.status === 'done') out.set(r.sessionId, r.contentHash);
    }
    return out;
  }
  scoresBySession(): Map<string, SessionReviewScore> {
    const out = new Map<string, SessionReviewScore>();
    for (const r of this.bySession.values()) {
      out.set(r.sessionId, { reviewId: r.id, score: r.score, status: r.status });
    }
    return out;
  }
  queryFeed(_filter: ReviewQueryFilter): Review[] {
    return [...this.byId.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }
  findById(id: string): Review | null {
    return this.byId.get(id) ?? null;
  }
  queryByDateRange(): Review[] {
    return [...this.byId.values()];
  }
}

const GOOD_DRAFT: ReviewDraft = {
  score: 4,
  summary: 'overall solid',
  findings: [
    {
      category: 'agent',
      severity: 'medium',
      title: 'redundant reads',
      detail: 'read the same file twice',
      suggestion: 'cache the first read',
      evidenceEventIndexes: [1, 2],
    },
  ],
};

class FixedReviewer implements Reviewer {
  readonly model = 'fake-model';
  calls = 0;
  constructor(private readonly draft: ReviewDraft = GOOD_DRAFT) {}
  isReady() {
    return true;
  }
  async review(_input: ReviewInput): Promise<ReviewDraft> {
    this.calls += 1;
    return this.draft;
  }
}

class ThrowingReviewer implements Reviewer {
  readonly model = 'fake-model';
  isReady() {
    return true;
  }
  async review(): Promise<ReviewDraft> {
    throw new Error('boom');
  }
}

class NotReadyReviewer implements Reviewer {
  readonly model = 'fake-model';
  isReady() {
    return false;
  }
  async review(): Promise<ReviewDraft> {
    throw new Error('should not be called');
  }
}

/** 前 failTimes 次抛错，之后成功 —— 模拟网关/网络等暂时性故障。 */
class FlakyReviewer implements Reviewer {
  readonly model = 'fake-model';
  calls = 0;
  constructor(private readonly failTimes: number) {}
  isReady() {
    return true;
  }
  async review(): Promise<ReviewDraft> {
    this.calls += 1;
    if (this.calls <= this.failTimes) throw new Error('transient gateway error');
    return GOOD_DRAFT;
  }
}

// ---- tests ---------------------------------------------------------------

describe('ReviewService.reviewSession', () => {
  it('reviews a session and persists a done review', async () => {
    const query = fakeQuery(
      { s1: fakeSession('s1', 10, 1000) },
      [fakeMeta('s1', 'done', 10, 1000)],
    );
    const repo = new FakeRepo();
    const svc = new ReviewService(query, new FixedReviewer(), repo);

    const review = await svc.reviewSession('s1', new Date(5000));
    expect(review.status).toBe('done');
    expect(review.score).toBe(4);
    expect(review.sessionId).toBe('s1');
    expect(review.contentHash).toBe('10|1000');
    expect(repo.findBySession('s1')?.id).toBe(review.id);
    expect(review.counts()).toEqual({ agent: 1, prompt: 0 });
  });

  it('throws ReviewerNotReady when reviewer has no key', async () => {
    const query = fakeQuery({ s1: fakeSession('s1', 3, 1000) }, [fakeMeta('s1', 'done', 3, 1000)]);
    const svc = new ReviewService(query, new NotReadyReviewer(), new FakeRepo());
    await expect(svc.reviewSession('s1')).rejects.toBeInstanceOf(ReviewerNotReady);
  });

  it('throws SessionNotFound for unknown session', async () => {
    const query = fakeQuery({}, []);
    const svc = new ReviewService(query, new FixedReviewer(), new FakeRepo());
    await expect(svc.reviewSession('nope')).rejects.toBeInstanceOf(SessionNotFound);
  });

  it('persists a failed review when the reviewer throws', async () => {
    const query = fakeQuery({ s1: fakeSession('s1', 3, 1000) }, [fakeMeta('s1', 'done', 3, 1000)]);
    const repo = new FakeRepo();
    const svc = new ReviewService(query, new ThrowingReviewer(), repo);

    const review = await svc.reviewSession('s1', new Date(5000));
    expect(review.status).toBe('failed');
    expect(review.error).toContain('boom');
    expect(repo.findBySession('s1')?.status).toBe('failed');
  });
});

describe('ReviewService.runRoutine', () => {
  it('reviews only done sessions with changed fingerprints', async () => {
    const metas = [
      fakeMeta('s1', 'done', 10, 1000),
      fakeMeta('s2', 'active', 5, 2000), // 跳过：未完成
      fakeMeta('s3', 'done', 8, 3000),
    ];
    const query = fakeQuery(
      {
        s1: fakeSession('s1', 10, 1000),
        s2: fakeSession('s2', 5, 2000),
        s3: fakeSession('s3', 8, 3000),
      },
      metas,
    );
    const repo = new FakeRepo();
    const reviewer = new FixedReviewer();
    const svc = new ReviewService(query, reviewer, repo);

    const first = await svc.runRoutine(new Date(9000));
    expect(first).toBe(2); // s1 + s3
    expect(reviewer.calls).toBe(2);

    // 第二轮：指纹未变，全部跳过
    const second = await svc.runRoutine(new Date(9000));
    expect(second).toBe(0);
    expect(reviewer.calls).toBe(2);
  });

  it('re-reviews a session after its fingerprint changes', async () => {
    const metas = [fakeMeta('s1', 'done', 10, 1000)];
    const sessions = { s1: fakeSession('s1', 10, 1000) };
    const query = fakeQuery(sessions, metas);
    const repo = new FakeRepo();
    const reviewer = new FixedReviewer();
    const svc = new ReviewService(query, reviewer, repo);

    expect(await svc.runRoutine()).toBe(1);

    // 会话增长：更新 meta + session 指纹
    metas[0] = fakeMeta('s1', 'done', 12, 4000);
    sessions.s1 = fakeSession('s1', 12, 4000);
    expect(await svc.runRoutine()).toBe(1);
    expect(reviewer.calls).toBe(2);
  });

  it('retries a previously failed session on the next round (unchanged fingerprint)', async () => {
    // 失败的评审也会带同一 contentHash 落库；若把它当「已完成」，
    // 病因修好后也永远不会自愈。这里锁住「失败必重试」。
    const metas = [fakeMeta('s1', 'done', 10, 1000)];
    const query = fakeQuery({ s1: fakeSession('s1', 10, 1000) }, metas);
    const repo = new FakeRepo();
    const reviewer = new FlakyReviewer(1);
    const svc = new ReviewService(query, reviewer, repo);

    expect(await svc.runRoutine()).toBe(1);
    expect(repo.findBySession('s1')?.status).toBe('failed');

    // 指纹没变，但上一轮失败 → 必须重试并成功
    expect(await svc.runRoutine()).toBe(1);
    expect(reviewer.calls).toBe(2);
    expect(repo.findBySession('s1')?.status).toBe('done');

    // 成功之后才开始跳过
    expect(await svc.runRoutine()).toBe(0);
    expect(reviewer.calls).toBe(2);
  });

  it('no-ops when reviewer is not ready', async () => {
    const query = fakeQuery({ s1: fakeSession('s1', 10, 1000) }, [fakeMeta('s1', 'done', 10, 1000)]);
    const svc = new ReviewService(query, new NotReadyReviewer(), new FakeRepo());
    expect(await svc.runRoutine()).toBe(0);
  });

  it('caps the number of sessions reviewed per round at ROUTINE_CAP', async () => {
    const n = ROUTINE_CAP + 5;
    const metas = Array.from({ length: n }, (_, i) => fakeMeta(`s${i}`, 'done', 3, 1000 + i));
    const sessions: Record<string, ReturnType<typeof fakeSession>> = {};
    for (let i = 0; i < n; i++) sessions[`s${i}`] = fakeSession(`s${i}`, 3, 1000 + i);
    const query = fakeQuery(sessions, metas);
    const reviewer = new FixedReviewer();
    const svc = new ReviewService(query, reviewer, new FakeRepo());

    expect(await svc.runRoutine()).toBe(ROUTINE_CAP);
    expect(reviewer.calls).toBe(ROUTINE_CAP);
  });
});

describe('ReviewService.summarize', () => {
  it('aggregates reviews in the period window', async () => {
    const query = fakeQuery({}, []);
    const repo = new FakeRepo();
    const svc = new ReviewService(query, new FixedReviewer(), repo);

    // 直接塞几条 review 进仓储（queryByDateRange 返回全部）
    const mk = (id: string, sessionId: string) =>
      new Review(
        id,
        sessionId,
        'col-a',
        'claude-code',
        'fake-model',
        'h',
        'done',
        3,
        'summary',
        [],
        new Date(1000),
      );
    repo.upsert(mk('r1', 's1'));
    repo.upsert(mk('r2', 's2'));

    const summary = svc.summarize('week', new Date(10_000));
    expect(summary.period).toBe('week');
    expect(summary.reviewedCount).toBe(2);
    expect(summary.toDTO().reviewedCount).toBe(2);
  });
});
