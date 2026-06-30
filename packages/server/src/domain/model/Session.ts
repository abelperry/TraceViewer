/**
 * Session —— 聚合根（Aggregate Root）。充血模型的核心。
 *
 * 持有事件集合，并维护其不变量与派生信息：
 *   - appendEvents: 实时追加（tail 增量），保证有序与计数一致
 *   - buildTree: 用 parentId 组装事件树（领域逻辑，不外泄到 application）
 *   - pairToolCalls: 跨事件按 callId 配对「工具调用 ↔ 结果」
 *   - recomputeStatus: running/done 判定规则内聚于聚合
 *   - tokenUsage / duration: 派生属性
 *
 * 状态判定阈值由领域常量定义，外层不得绕过聚合直接改 events。
 */

import type { SessionStatus, SourceId } from '@trace-review/shared';
import type { Event } from './Event.js';
import { SessionMeta } from './SessionMeta.js';
import { TokenUsage } from './TokenUsage.js';

/** 距最后一次活动超过此时长（ms）视为已结束。 */
export const RUNNING_THRESHOLD_MS = 2 * 60_000;

/**
 * 由「最后活动时刻」判定运行状态的纯规则（领域逻辑，单一出处）。
 * 最后活动可以是最后事件时间戳，或文件 mtime（更实时）。
 */
export function statusFromActivity(
  lastActivity: Date | null,
  now: Date,
): SessionStatus {
  if (!lastActivity) return 'done';
  return now.getTime() - lastActivity.getTime() < RUNNING_THRESHOLD_MS ? 'running' : 'done';
}

export interface EventNode {
  event: Event;
  children: EventNode[];
}

export interface ToolPair {
  callId: string;
  callEventId: string;
  toolName: string;
  resultEventId: string | null;
  isError: boolean;
}

export class Session {
  private _events: Event[];

  constructor(
    readonly id: string,
    readonly source: SourceId,
    readonly collectionId: string,
    private _title: string,
    readonly cwd: string | null,
    readonly gitBranch: string | null,
    readonly model: string | null,
    events: Event[] = [],
    private _tokenUsage: TokenUsage = TokenUsage.zero(),
  ) {
    this._events = [...events];
  }

  get events(): readonly Event[] {
    return this._events;
  }

  get title(): string {
    return this._title;
  }

  get tokenUsage(): TokenUsage {
    return this._tokenUsage;
  }

  get eventCount(): number {
    return this._events.length;
  }

  get startedAt(): Date | null {
    return this._events[0]?.timestamp ?? null;
  }

  get lastEventAt(): Date | null {
    for (let i = this._events.length - 1; i >= 0; i--) {
      const ts = this._events[i]?.timestamp;
      if (ts) return ts;
    }
    return null;
  }

  get durationMs(): number | null {
    const start = this.startedAt;
    const end = this.lastEventAt;
    return start && end ? end.getTime() - start.getTime() : null;
  }

  /** 追加增量事件（tail 时调用）。维护顺序，外层不得直接操作内部数组。 */
  appendEvents(newEvents: Event[]): void {
    if (newEvents.length === 0) return;
    this._events.push(...newEvents);
  }

  addTokenUsage(usage: TokenUsage): void {
    this._tokenUsage = this._tokenUsage.add(usage);
  }

  setTitle(title: string): void {
    if (title.trim()) this._title = title.trim();
  }

  /** running/done 判定规则内聚在聚合根。 */
  recomputeStatus(now: Date): SessionStatus {
    return statusFromActivity(this.lastEventAt, now);
  }

  /** 用 parentId 组装事件树。无父或父不存在的事件视为根。 */
  buildTree(): EventNode[] {
    const nodes = new Map<string, EventNode>();
    for (const event of this._events) {
      nodes.set(event.id, { event, children: [] });
    }
    const roots: EventNode[] = [];
    for (const event of this._events) {
      const node = nodes.get(event.id)!;
      const parent = event.parentId ? nodes.get(event.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /** 跨事件按 callId 配对工具调用与结果。 */
  pairToolCalls(): ToolPair[] {
    const results = new Map<string, { eventId: string; isError: boolean }>();
    for (const event of this._events) {
      for (const r of event.toolResults()) {
        results.set(r.callId, { eventId: event.id, isError: r.isError });
      }
    }
    const pairs: ToolPair[] = [];
    for (const event of this._events) {
      for (const call of event.toolCalls()) {
        const matched = results.get(call.callId);
        pairs.push({
          callId: call.callId,
          callEventId: event.id,
          toolName: call.name,
          resultEventId: matched?.eventId ?? null,
          isError: matched?.isError ?? false,
        });
      }
    }
    return pairs;
  }

  /** 导出元数据快照（供仓储索引）。 */
  toMeta(now: Date): SessionMeta {
    return new SessionMeta(
      this.id,
      this.source,
      this.collectionId,
      this._title,
      this.cwd,
      this.gitBranch,
      this.model,
      this.recomputeStatus(now),
      this.startedAt,
      this.lastEventAt,
      this.eventCount,
    );
  }
}
