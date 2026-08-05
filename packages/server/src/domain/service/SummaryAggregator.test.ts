import { describe, it, expect } from 'vitest';
import { SummaryAggregator } from './SummaryAggregator.js';
import { Review } from '../model/Review.js';
import { Finding } from '../model/Finding.js';

const agg = new SummaryAggregator();
const gen = new Date('2026-07-08T00:00:00Z');

let seq = 0;
function review(score: number, findings: Finding[], status: 'done' | 'failed' = 'done'): Review {
  seq += 1;
  return new Review(
    `r${seq}`,
    `s${seq}`,
    'c1',
    'claude-code',
    'claude-opus-5',
    'hash',
    status,
    score,
    'summary',
    findings,
    new Date('2026-07-01T00:00:00Z'),
  );
}

function finding(category: 'agent' | 'prompt', title: string): Finding {
  return new Finding(category, 'medium', title, 'detail', 'suggestion');
}

describe('SummaryAggregator', () => {
  it('counts reviewed sessions and averages done scores', () => {
    const s = agg.aggregate(
      'week',
      '2026-07-01',
      '2026-07-07',
      [review(5, []), review(3, []), review(0, [], 'failed')],
      gen,
    );
    expect(s.reviewedCount).toBe(3);
    // failed (score 0) excluded from average
    expect(s.avgScore).toBe(4);
  });

  it('merges recurring issues by (category, normalized title), count desc', () => {
    const s = agg.aggregate(
      'month',
      '2026-06-08',
      '2026-07-07',
      [
        review(4, [finding('prompt', 'Vague acceptance criteria')]),
        review(3, [finding('prompt', 'vague acceptance criteria'), finding('agent', 'Redundant reads')]),
        review(2, [finding('prompt', 'VAGUE  acceptance   criteria')]),
      ],
      gen,
    );
    expect(s.topIssues[0]!.category).toBe('prompt');
    expect(s.topIssues[0]!.count).toBe(3);
    expect(s.topIssues[0]!.title).toBe('Vague acceptance criteria'); // first-seen representative
    expect(s.topIssues[1]!.count).toBe(1);
  });

  it('returns zeros when no reviews', () => {
    const s = agg.aggregate('week', '2026-07-01', '2026-07-07', [], gen);
    expect(s.reviewedCount).toBe(0);
    expect(s.avgScore).toBe(0);
    expect(s.topIssues).toHaveLength(0);
  });

  it('caps topIssues at N', () => {
    const capped = new SummaryAggregator(2);
    const s = capped.aggregate(
      'week',
      '2026-07-01',
      '2026-07-07',
      [
        review(4, [finding('agent', 'a'), finding('agent', 'b'), finding('agent', 'c')]),
      ],
      gen,
    );
    expect(s.topIssues).toHaveLength(2);
  });
});
