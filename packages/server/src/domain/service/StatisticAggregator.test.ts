import { describe, it, expect } from 'vitest';
import { StatisticAggregator } from './StatisticAggregator.js';
import type { UsageSample } from '../model/DailyStat.js';

const agg = new StatisticAggregator();

function sample(p: Partial<UsageSample> & { timestamp: Date }): UsageSample {
  return {
    source: 'claude-code',
    model: 'opus',
    sessionId: 's1',
    inputTokens: 0,
    outputTokens: 0,
    isMessage: false,
    ...p,
  };
}

describe('StatisticAggregator', () => {
  it('buckets by date × source × model', () => {
    const d = new Date('2026-06-30T10:00:00');
    const stats = agg.aggregate([
      sample({ timestamp: d, model: 'opus', inputTokens: 10, outputTokens: 5 }),
      sample({ timestamp: d, model: 'sonnet', inputTokens: 1, outputTokens: 2 }),
      sample({ timestamp: d, source: 'codex', model: 'gpt', inputTokens: 3, outputTokens: 4 }),
    ]);
    expect(stats).toHaveLength(3);
  });

  it('sums tokens and counts messages within a bucket', () => {
    const d = new Date('2026-06-30T10:00:00');
    const stats = agg.aggregate([
      sample({ timestamp: d, inputTokens: 10, outputTokens: 5, isMessage: true }),
      sample({ timestamp: d, inputTokens: 20, outputTokens: 7, isMessage: true }),
      sample({ timestamp: d, inputTokens: 0, outputTokens: 0, isMessage: false }),
    ]);
    expect(stats).toHaveLength(1);
    const s = stats[0]!;
    expect(s.inputTokens).toBe(30);
    expect(s.outputTokens).toBe(12);
    expect(s.totalTokens).toBe(42);
    expect(s.messageCount).toBe(2);
  });

  it('dedups sessionCount within a bucket', () => {
    const d = new Date('2026-06-30T10:00:00');
    const stats = agg.aggregate([
      sample({ timestamp: d, sessionId: 'a' }),
      sample({ timestamp: d, sessionId: 'a' }),
      sample({ timestamp: d, sessionId: 'b' }),
    ]);
    expect(stats[0]!.sessionCount).toBe(2);
  });

  it('splits samples across day boundaries by local date', () => {
    const stats = agg.aggregate([
      sample({ timestamp: new Date('2026-06-29T23:00:00'), inputTokens: 1 }),
      sample({ timestamp: new Date('2026-06-30T01:00:00'), inputTokens: 1 }),
    ]);
    const dates = stats.map((s) => s.date).sort();
    expect(dates).toEqual(['2026-06-29', '2026-06-30']);
  });
});
