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
  type RawSessionRef,
  type SourceAdapter,
  type Session,
  type TraceSource,
  type TranscriptAssembler,
  type Unsubscribe,
  statusFromActivity,
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
  /** 该会话的文件监听取消函数。 */
  fileUnsub: Unsubscribe;
}

export class LiveStreamService {
  private readonly live = new Map<string, LiveSession>();

  constructor(
    private readonly query: SessionQueryService,
    private readonly assembler: TranscriptAssembler,
    private readonly sources: TraceSource[],
  ) {}

  /** 兼容旧组合根调用：现已改为按订阅的会话逐文件监听，无需全局 watch。 */
  start(): void {}

  stop(): void {
    for (const entry of this.live.values()) entry.fileUnsub();
    this.live.clear();
  }

  /**
   * 订阅一个会话的实时增量。返回取消函数。
   * 首个订阅者触发加载聚合根、记录偏移，并对该文件启动按需轮询监听。
   */
  async subscribe(sessionId: string, listener: PatchListener): Promise<Unsubscribe | null> {
    let entry = this.live.get(sessionId);
    if (!entry) {
      const loaded = await this.query.loadDetail(sessionId);
      if (!loaded) return null;
      const source = this.query.sourceFor(sessionId);
      if (!source) return null;
      const created: LiveSession = {
        session: loaded.session,
        ref: loaded.ref,
        source,
        adapter: loaded.adapter,
        state: loaded.state,
        offset: loaded.offset,
        listeners: new Set(),
        pumping: Promise.resolve(),
        fileUnsub: () => {},
      };
      created.fileUnsub = source.watchFile(loaded.ref, () => this.onChange(sessionId));
      this.live.set(sessionId, created);
      entry = created;
    }
    entry.listeners.add(listener);

    return () => {
      const e = this.live.get(sessionId);
      if (!e) return;
      e.listeners.delete(listener);
      if (e.listeners.size === 0) {
        e.fileUnsub();
        this.live.delete(sessionId);
      }
    };
  }

  /** 文件变化：串行 pump 增量。 */
  private onChange(sessionId: string): void {
    const entry = this.live.get(sessionId);
    if (!entry) return;
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

    // 状态口径与左栏一致：用文件 mtime（与 SessionQueryService.queryMetas 相同）
    const now = new Date();
    const mtime = await entry.source.lastModified(entry.ref);
    const lastActivity = laterOf(mtime, entry.session.lastEventAt);
    const baseMeta = entry.session.toMeta(now);
    const meta = baseMeta.withStatus(statusFromActivity(lastActivity, now));
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

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}
