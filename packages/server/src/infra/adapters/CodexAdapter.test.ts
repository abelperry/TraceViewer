import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CodexAdapter } from './CodexAdapter.js';
import { ToolCallBlock } from '../../domain/index.js';
import type { RawSessionRef } from '../../domain/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, '__fixtures__/codex-sample.jsonl'), 'utf8');
const lines = fixture.split('\n').filter((l) => l.trim());

const ref: RawSessionRef = {
  sessionId: 'codex-1',
  collectionId: '2026/06/22', // 日期目录（应被 cwd 覆盖）
  locator: '/tmp/rollout-x.jsonl',
};

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();

  it('detects codex envelope format', () => {
    expect(adapter.detect('/x/rollout.jsonl', lines.slice(0, 1))).toBe(true);
    expect(adapter.detect('/x/rollout.txt', lines.slice(0, 1))).toBe(false);
    // Claude 记录不应被误判
    expect(adapter.detect('/x/s.jsonl', ['{"type":"user","uuid":"u","sessionId":"s"}'])).toBe(false);
  });

  it('derives collection from session_meta cwd, not date dir', () => {
    const { session } = adapter.parseSession(ref, lines);
    expect(session.collectionId).toBe('/Users/yangdayong/Zhipu/code/vibe-playground');
    expect(session.cwd).toBe('/Users/yangdayong/Zhipu/code/vibe-playground');
    expect(session.gitBranch).toBe('feat_preview_sandbox');
  });

  it('maps function_call/output and message blocks', () => {
    const { session } = adapter.parseSession(ref, lines);
    const kinds = new Set(session.events.flatMap((e) => e.blocks.map((b) => b.type)));
    expect(kinds.has('text')).toBe(true);
    expect(kinds.has('tool_call')).toBe(true);
    expect(kinds.has('tool_result')).toBe(true);
  });

  it('parses function_call arguments JSON string into object', () => {
    const { session } = adapter.parseSession(ref, lines);
    const call = session.events
      .flatMap((e) => e.blocks)
      .find((b): b is ToolCallBlock => b instanceof ToolCallBlock);
    expect(call).toBeDefined();
    expect(call!.name).toBe('exec_command');
    expect(typeof call!.input).toBe('object');
  });

  it('pairs tool calls with results by call_id', () => {
    const { session } = adapter.parseSession(ref, lines);
    const pairs = session.pairToolCalls();
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.some((p) => p.resultEventId !== null)).toBe(true);
  });

  it('builds a linear parentId chain', () => {
    const { session } = adapter.parseSession(ref, lines);
    const roots = session.buildTree();
    // 线性链：单根
    expect(roots.length).toBe(1);
    const count = (nodes: ReturnType<typeof session.buildTree>): number =>
      nodes.reduce((n, node) => n + 1 + count(node.children), 0);
    expect(count(roots)).toBe(session.eventCount);
  });

  it('classifies tool_result events as tool role', () => {
    const { session } = adapter.parseSession(ref, lines);
    const toolEvents = session.events.filter((e) => e.role === 'tool');
    expect(toolEvents.length).toBeGreaterThan(0);
    for (const e of toolEvents) {
      expect(e.blocks.every((b) => b.type === 'tool_result')).toBe(true);
    }
  });

  it('skips empty (encrypted) reasoning', () => {
    const { session } = adapter.parseSession(ref, lines);
    const thinking = session.events.flatMap((e) => e.blocks).filter((b) => b.type === 'thinking');
    // fixture 中 reasoning 均为加密空 → 应被跳过
    expect(thinking.length).toBe(0);
  });

  it('appends incremental events', () => {
    const half = Math.floor(lines.length / 2);
    const { session, state } = adapter.parseSession(ref, lines.slice(0, half));
    const before = session.eventCount;
    const inc = adapter.parseIncremental(ref, lines.slice(half), state);
    session.appendEvents(inc.events);
    expect(session.eventCount).toBe(before + inc.events.length);
  });
});

describe('detectError exit code', () => {
  it('flags non-zero exit as error', () => {
    const adapter = new CodexAdapter();
    const ref2: RawSessionRef = { sessionId: 's', collectionId: 'c', locator: '/x/rollout.jsonl' };
    const fakeLines = [
      JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'session_meta', payload: { cwd: '/p' } }),
      JSON.stringify({
        timestamp: '2026-01-01T00:00:01Z',
        type: 'response_item',
        payload: { type: 'function_call', name: 'exec', arguments: '{}', call_id: 'c1' },
      }),
      JSON.stringify({
        timestamp: '2026-01-01T00:00:02Z',
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'c1', output: 'Process exited with code 1\n' },
      }),
    ];
    const { session } = adapter.parseSession(ref2, fakeLines);
    const pairs = session.pairToolCalls();
    expect(pairs[0]?.isError).toBe(true);
  });
});
