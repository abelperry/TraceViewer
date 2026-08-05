import { describe, it, expect } from 'vitest';
import { ReviewParser, type ReviewContext } from './ReviewParser.js';
import type { ReviewDraft } from '../port/Reviewer.js';

const parser = new ReviewParser();

const ctx: ReviewContext = {
  id: 'r1',
  sessionId: 's1',
  collectionId: 'c1',
  source: 'claude-code',
  model: 'claude-opus-5',
  contentHash: 'hash',
  createdAt: new Date('2026-07-01T00:00:00Z'),
  eventCount: 10,
};

function draft(p: Partial<ReviewDraft> = {}): ReviewDraft {
  return {
    score: 4,
    summary: 'ok',
    findings: [],
    ...p,
  };
}

describe('ReviewParser', () => {
  it('parses a valid draft into a done Review', () => {
    const r = parser.toReview(
      draft({
        findings: [
          {
            category: 'agent',
            severity: 'high',
            title: 'looped on same file',
            detail: 'read the file 5 times',
            suggestion: 'cache reads',
            evidenceEventIndexes: [2, 5],
          },
        ],
      }),
      ctx,
    );
    expect(r.status).toBe('done');
    expect(r.score).toBe(4);
    expect(r.findings[0]!.evidenceEventIndexes).toEqual([2, 5]);
  });

  it('rejects out-of-range score', () => {
    expect(() => parser.toReview(draft({ score: 0 }), ctx)).toThrow(/score/);
    expect(() => parser.toReview(draft({ score: 6 }), ctx)).toThrow(/score/);
    expect(() => parser.toReview(draft({ score: 3.5 }), ctx)).toThrow(/score/);
  });

  it('rejects invalid category/severity enums', () => {
    expect(() =>
      parser.toReview(
        draft({
          findings: [
            { category: 'other' as never, severity: 'high', title: 't', detail: 'd', suggestion: 's' },
          ],
        }),
        ctx,
      ),
    ).toThrow(/category/);
    expect(() =>
      parser.toReview(
        draft({
          findings: [
            { category: 'agent', severity: 'urgent' as never, title: 't', detail: 'd', suggestion: 's' },
          ],
        }),
        ctx,
      ),
    ).toThrow(/severity/);
  });

  it('rejects empty required finding fields', () => {
    expect(() =>
      parser.toReview(
        draft({
          findings: [{ category: 'agent', severity: 'low', title: '  ', detail: 'd', suggestion: 's' }],
        }),
        ctx,
      ),
    ).toThrow(/title/);
  });

  it('drops out-of-range / non-integer evidence indexes and dedups+sorts', () => {
    const r = parser.toReview(
      draft({
        findings: [
          {
            category: 'prompt',
            severity: 'medium',
            title: 't',
            detail: 'd',
            suggestion: 's',
            evidenceEventIndexes: [5, 5, 2, -1, 99, 3.2],
          },
        ],
      }),
      ctx,
    );
    expect(r.findings[0]!.evidenceEventIndexes).toEqual([2, 5]);
  });

  it('treats missing evidence as empty (best-effort)', () => {
    const r = parser.toReview(
      draft({ findings: [{ category: 'agent', severity: 'low', title: 't', detail: 'd', suggestion: 's' }] }),
      ctx,
    );
    expect(r.findings[0]!.evidenceEventIndexes).toEqual([]);
  });
});
