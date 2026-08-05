import { describe, it, expect } from 'vitest';
import type { FindingDTO, ReviewDTO, Severity } from '@trace-review/shared';
import { anchorsMayBeStale, buildAnnotations } from './annotations';

function finding(
  severity: Severity,
  title: string,
  evidenceEventIndexes: number[],
  category: 'agent' | 'prompt' = 'agent',
): FindingDTO {
  return { category, severity, title, detail: 'd', suggestion: 's', evidenceEventIndexes };
}

function review(findings: FindingDTO[], over: Partial<ReviewDTO> = {}): ReviewDTO {
  return {
    id: 'r1',
    sessionId: 's1',
    collectionId: 'c1',
    source: 'claude-code',
    model: 'm',
    status: 'done',
    score: 4,
    summary: 'sum',
    counts: { agent: 0, prompt: 0 },
    findings,
    error: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    session: null,
    reviewedEventCount: 100,
    ...over,
  };
}

describe('buildAnnotations', () => {
  it('anchors a finding at its smallest evidence index and lists the rest', () => {
    const a = buildAnnotations(review([finding('high', 'f1', [44, 20, 25])]), 100);
    expect([...a.byAnchor.keys()]).toEqual([20]);
    const anchored = a.byAnchor.get(20)![0]!;
    expect(anchored.allIndexes).toEqual([20, 25, 44]);
    expect(a.anchoredCount).toBe(1);
  });

  it('marks every referenced event, not just the anchor', () => {
    const a = buildAnnotations(review([finding('medium', 'f1', [20, 25])]), 100);
    expect([...a.severityByEvent.entries()].sort()).toEqual([
      [20, 'medium'],
      [25, 'medium'],
    ]);
  });

  it('keeps the most severe severity when findings overlap on one event', () => {
    const a = buildAnnotations(
      review([finding('low', 'lo', [7]), finding('high', 'hi', [7]), finding('medium', 'md', [7])]),
      100,
    );
    expect(a.severityByEvent.get(7)).toBe('high');
    // 同一锚点上多条，按 severity 从重到轻
    expect(a.byAnchor.get(7)!.map((x) => x.finding.severity)).toEqual(['high', 'medium', 'low']);
  });

  it('buckets findings with no evidence as unanchored', () => {
    const a = buildAnnotations(review([finding('low', 'no-ev', []), finding('high', 'ev', [1])]), 100);
    expect(a.unanchored.map((f) => f.title)).toEqual(['no-ev']);
    expect(a.anchoredCount).toBe(1);
  });

  it('drops out-of-range indexes and treats a fully out-of-range finding as unanchored', () => {
    const a = buildAnnotations(review([finding('high', 'partly', [3, 999]), finding('low', 'gone', [500])]), 10);
    expect(a.byAnchor.get(3)![0]!.allIndexes).toEqual([3]);
    expect(a.severityByEvent.has(999)).toBe(false);
    expect(a.unanchored.map((f) => f.title)).toEqual(['gone']);
  });

  it('dedupes repeated indexes', () => {
    const a = buildAnnotations(review([finding('low', 'dup', [5, 5, 8])]), 100);
    expect(a.byAnchor.get(5)![0]!.allIndexes).toEqual([5, 8]);
  });

  it('returns empty for null or failed reviews', () => {
    expect(buildAnnotations(null, 100).anchoredCount).toBe(0);
    const failed = buildAnnotations(review([finding('high', 'f', [1])], { status: 'failed' }), 100);
    expect(failed.anchoredCount).toBe(0);
    expect(failed.byAnchor.size).toBe(0);
  });
});

describe('anchorsMayBeStale', () => {
  it('flags a trace that grew after the review', () => {
    expect(anchorsMayBeStale(review([], { reviewedEventCount: 46 }), 58)).toBe(true);
  });

  it('is quiet when the event count is unchanged', () => {
    expect(anchorsMayBeStale(review([], { reviewedEventCount: 46 }), 46)).toBe(false);
  });

  it('stays quiet for legacy rows with unknown count', () => {
    expect(anchorsMayBeStale(review([], { reviewedEventCount: 0 }), 58)).toBe(false);
    expect(anchorsMayBeStale(null, 58)).toBe(false);
  });
});
