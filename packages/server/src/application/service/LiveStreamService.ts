/**
 * LiveStreamService —— 应用服务（实时编排）。
 *
 * 职责：为「正在被查看的会话」维护一个 tail 循环：
 *   - subscribe: 加载聚合根，注册一个订阅者回调
 *   - 收到文件追加事件 → tail 增量行 → 领域服务并入聚合 → 推送增量 DTO
 *   - 引用计数：最后一个订阅者离开即停止该会话的实时追踪
 *
 * 借助 TraceSource.watch（infra）与 TranscriptAssembler（domain），
 * 自身只做编排与生命周期管理，不含解析/IO 细节。
 */

import type { StreamPatchDTO } from '@trace-review/shared';
import {
  type AppendEvent,
  type RawSessionRef,
  type SourceAdapter,
  type Session,
  type TraceSource,
  type TranscriptAssembler,
  type Unsubscribe,
} from '../../domain/index.js';
import type { SessionQueryService } from './SessionQueryService.js';

export type PatchListener = (patch: StreamPatchDTO) => void;

interface LiveSession {
  session: Session;
  ref: RawSessionRef;
  source: TraceSource;
  adapter: SourceAdapter;
  state: Record<string, unknown>;
  offset: number;
  listeners: Set<PatchListener>;
  /** 串行化该会话的 tail，避免并发读导致偏移竞态。 */
  pumping: Promise<void>;
}

export class LiveStreamService {
  private readonly live = new Map<string, LiveSession>();
  private watchUnsub: Unsubscribe | null = null;

  constructor(
    private readonly query: SessionQueryService,
    private readonly assembler: TranscriptAssembler,
    private readonly sources: TraceSource[],
  ) {}

  /** 启动对所有来源的监听，按 sessionId 路由到对应 live 会话。 */
  start(): void {
    if (this.watchUnsub) return;
    const unsubs = this.sources.map((s) => s.watch((e) => this.onAppend(e)));
    this.watchUnsub = () => unsubs.forEach((u) => u());
  }

  stop(): void {
    this.watchUnsub?.();
    this.watchUnsub = null;
  }

  /**
   * 订阅一个会话的实时增量。返回取消函数。
   * 首个订阅者会触发加载聚合根并记录当前偏移。
   */
  async subscribe(sessionId: string, listener: PatchListener): Promise<Unsubscribe | null> {
    let entry = this.live.get(sessionId);
    if (!entry) {
      const loaded = await this.query.loadDetail(sessionId);
      if (!loaded) return null;
      const source = this.query.sourceFor(sessionId);
      if (!source) return null;
      entry = {
        session: loaded.session,
        ref: loaded.ref,
        source,
        adapter: loaded.adapter,
        state: loaded.state,
        offset: loaded.offset,
        listeners: new Set(),
        pumping: Promise.resolve(),
      };
      this.live.set(sessionId, entry);
    }
    entry.listeners.add(listener);

    return () => {
      const e = this.live.get(sessionId);
      if (!e) return;
      e.listeners.delete(listener);
      if (e.listeners.size === 0) this.live.delete(sessionId);
    };
  }

  /** 文件追加事件：仅处理当前有订阅者的会话。 */
  private onAppend(e: AppendEvent): void {
    const entry = this.live.get(e.ref.sessionId);
    if (!entry) return;
    // 串行 pump，防止偏移竞态
    entry.pumping = entry.pumping.then(() => this.pump(entry!)).catch(() => {});
  }

  private async pump(entry: LiveSession): Promise<void> {
    const { lines, newOffset } = await entry.source.tail(entry.ref, entry.offset);
    if (lines.length === 0) {
      entry.offset = newOffset;
      return;
    }
    const before = entry.session.eventCount;
    this.assembler.applyIncrement(
      entry.adapter,
      entry.session,
      entry.ref,
      lines,
      entry.state,
    );
    entry.offset = newOffset;

    const newEvents = entry.session.events.slice(before);
    if (newEvents.length === 0) return;

    const meta = entry.session.toMeta(new Date());
    this.query.repository.upsertMeta(meta);

    const patch: StreamPatchDTO = {
      sessionId: entry.ref.sessionId,
      events: newEvents.map((ev) => ev.toDTO()),
      metaPatch: {
        status: meta.status,
        eventCount: meta.eventCount,
        lastEventAt: meta.lastEventAt ? meta.lastEventAt.toISOString() : null,
        title: meta.title,
        tokenUsage: entry.session.tokenUsage.toDTO(),
      },
    };
    for (const listener of entry.listeners) listener(patch);
  }
}
