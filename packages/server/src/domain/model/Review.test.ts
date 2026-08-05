import { describe, it, expect } from 'vitest';
import { Review } from './Review.js';
import { Finding } from './Finding.js';

function finding(p: Partial<Finding> = {}): Finding {
  return new Finding(
    p.category ?? 'agent',
    p.severity ?? 'low',
    p.title ?? 't',
    p.detail ?? 'd',
    p.suggestion ?? 's',
    p.evidenceEventIndexes ?? [],
  );
}

function review(findings: Finding[], score = 4): Review {
  return new Review(
    'r1',
    's1',
    'c1',
    'claude-code',
    'claude-opus-5',
    'hash',
    'done',
    score,
    'summary',
    findings,
    new Date('2026-07-01T00:00:00Z'),
  );
}

describe('Review', () => {
  it('groups findings by category', () => {
    const r = review([
      finding({ category: 'agent' }),
      finding({ category: 'prompt' }),
      finding({ category: 'agent' }),
    ]);
    const g = r.findingsByCategory();
    expect(g.agent).toHaveLength(2);
    expect(g.prompt).toHaveLength(1);
  });

  it('counts per category', () => {
    const r = review([finding({ category: 'agent' }), finding({ category: 'prompt' })]);
    expect(r.counts()).toEqual({ agent: 1, prompt: 1 });
  });

  it('reports top severity (null when empty)', () => {
    expect(review([]).topSeverity()).toBeNull();
    const r = review([
      finding({ severity: 'low' }),
      finding({ severity: 'high' }),
      finding({ severity: 'medium' }),
    ]);
    expect(r.topSeverity()).toBe('high');
  });

  it('builds a failed placeholder review', () => {
    const r = Review.failed(
      'r2',
      's2',
      'c2',
      'codex',
      'claude-opus-5',
      'h',
      'boom',
      new Date('2026-07-02T00:00:00Z'),
    );
    expect(r.status).toBe('failed');
    expect(r.score).toBe(0);
    expect(r.findings).toHaveLength(0);
    expect(r.error).toBe('boom');
    expect(r.topSeverity()).toBeNull();
  });

  it('maps to DTO with counts and ISO time', () => {
    const dto = review([finding({ category: 'agent' })]).toDTO();
    expect(dto.counts).toEqual({ agent: 1, prompt: 0 });
    expect(dto.createdAt).toBe('2026-07-01T00:00:00.000Z');
    expect(dto.findings[0]!.title).toBe('t');
  });

  it('maps to row DTO with injected session title', () => {
    const row = review([finding({ severity: 'high' })]).toRowDTO('My Session');
    expect(row.sessionTitle).toBe('My Session');
    expect(row.topSeverity).toBe('high');
    expect(row.score).toBe(4);
  });
});
