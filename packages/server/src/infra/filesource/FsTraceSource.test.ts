import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsTraceSource } from './FsTraceSource.js';
import type { RawSessionRef } from '../../domain/index.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'trace-fs-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('FsTraceSource', () => {
  it('scans nested jsonl files into refs', async () => {
    const root = tmp();
    const proj = join(root, 'proj-a');
    mkdirSync(proj);
    writeFileSync(join(proj, 'sess-1.jsonl'), '{"a":1}\n');
    const src = new FsTraceSource('claude-code', [root]);
    const refs = await src.scan();
    expect(refs).toHaveLength(1);
    expect(refs[0]!.sessionId).toBe('sess-1');
    expect(refs[0]!.collectionId).toBe('proj-a');
  });

  it('tails only newly appended complete lines via byte offset', async () => {
    const root = tmp();
    const file = join(root, 'sess.jsonl');
    writeFileSync(file, '{"n":1}\n{"n":2}\n');
    const src = new FsTraceSource('claude-code', [root]);
    const ref: RawSessionRef = { sessionId: 'sess', collectionId: root, locator: file };

    const off0 = await src.currentOffset(ref);
    expect(off0).toBe(16);

    // append two more lines
    appendFileSync(file, '{"n":3}\n{"n":4}\n');
    const r1 = await src.tail(ref, off0);
    expect(r1.lines).toEqual(['{"n":3}', '{"n":4}']);
    expect(r1.newOffset).toBe(32);

    // nothing new
    const r2 = await src.tail(ref, r1.newOffset);
    expect(r2.lines).toEqual([]);
    expect(r2.newOffset).toBe(32);
  });

  it('holds back an incomplete trailing line until newline arrives', async () => {
    const root = tmp();
    const file = join(root, 'sess.jsonl');
    writeFileSync(file, '{"n":1}\n');
    const src = new FsTraceSource('claude-code', [root]);
    const ref: RawSessionRef = { sessionId: 'sess', collectionId: root, locator: file };
    const off = await src.currentOffset(ref);

    // partial line, no newline yet
    appendFileSync(file, '{"n":2}');
    const r1 = await src.tail(ref, off);
    expect(r1.lines).toEqual([]);
    expect(r1.newOffset).toBe(off);

    // complete it
    appendFileSync(file, '\n');
    const r2 = await src.tail(ref, off);
    expect(r2.lines).toEqual(['{"n":2}']);
  });
});
