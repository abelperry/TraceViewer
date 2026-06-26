import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ClaudeCodeAdapter } from './ClaudeCodeAdapter.js';
import { ToolCallBlock } from '../../domain/index.js';
import type { RawSessionRef } from '../../domain/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, '__fixtures__/claude-sample.jsonl'), 'utf8');
const lines = fixture.split('\n').filter((l) => l.trim());

const ref: RawSessionRef = {
  sessionId: 'sess-1',
  collectionId: 'col-1',
  locator: '/tmp/sess-1.jsonl',
};

describe('ClaudeCodeAdapter', () => {
  const adapter = new ClaudeCodeAdapter();

  it('detects claude-code format from head lines', () => {
    expect(adapter.detect('/x/sess.jsonl', lines.slice(0, 3))).toBe(true);
    expect(adapter.detect('/x/sess.txt', lines.slice(0, 3))).toBe(false);
    expect(adapter.detect('/x/sess.jsonl', ['not json'])).toBe(false);
  });

  it('parses a session with events and metadata', () => {
    const { session } = adapter.parseSession(ref, lines);
    expect(session.id).toBe('sess-1');
    expect(session.source).toBe('claude-code');
    expect(session.eventCount).toBeGreaterThan(0);
    // ai-title 应回填标题
    expect(session.title).toBe('Generate Dockerfile for project preview');
  });

  it('maps all four block types', () => {
    const { session } = adapter.parseSession(ref, lines);
    const kinds = new Set(session.events.flatMap((e) => e.blocks.map((b) => b.type)));
    expect(kinds.has('text')).toBe(true);
    expect(kinds.has('thinking')).toBe(true);
    expect(kinds.has('tool_call')).toBe(true);
    expect(kinds.has('tool_result')).toBe(true);
  });

  it('pairs tool calls with results by callId', () => {
    const { session } = adapter.parseSession(ref, lines);
    const pairs = session.pairToolCalls();
    expect(pairs.length).toBeGreaterThan(0);
    const matched = pairs.filter((p) => p.resultEventId !== null);
    expect(matched.length).toBeGreaterThan(0);
    // 每个配对的 callId 应能在某个事件的 tool_call 中找到
    for (const p of pairs) {
      const found = session.events.some((e) =>
        e.blocks.some((b) => b instanceof ToolCallBlock && b.callId === p.callId),
      );
      expect(found).toBe(true);
    }
  });

  it('builds a parentId tree spanning all events', () => {
    const { session } = adapter.parseSession(ref, lines);
    const roots = session.buildTree();
    const count = (nodes: ReturnType<typeof session.buildTree>): number =>
      nodes.reduce((n, node) => n + 1 + count(node.children), 0);
    expect(count(roots)).toBe(session.eventCount);
  });

  it('appends incremental events into the aggregate', () => {
    const half = Math.floor(lines.length / 2);
    const { session, state } = adapter.parseSession(ref, lines.slice(0, half));
    const before = session.eventCount;
    const inc = adapter.parseIncremental(ref, lines.slice(half), state);
    session.appendEvents(inc.events);
    expect(session.eventCount).toBe(before + inc.events.length);
    expect(session.eventCount).toBeGreaterThan(before);
  });

  it('classifies pure tool_result events as tool role', () => {
    const { session } = adapter.parseSession(ref, lines);
    const toolEvents = session.events.filter((e) => e.role === 'tool');
    // fixture 含 tool_result，应至少有一个 tool 角色事件
    expect(toolEvents.length).toBeGreaterThan(0);
    // tool 角色事件应只含 tool_result 块
    for (const e of toolEvents) {
      expect(e.blocks.every((b) => b.type === 'tool_result')).toBe(true);
    }
  });

  it('produces serializable DTOs', () => {
    const { session } = adapter.parseSession(ref, lines);
    const dto = session.events[0]!.toDTO();
    expect(() => JSON.stringify(dto)).not.toThrow();
    expect(dto.sessionId).toBe('sess-1');
  });
});
