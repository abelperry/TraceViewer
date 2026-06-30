/**
 * SessionQueryService —— 应用服务（用例编排）。
 *
 * 职责：编排 TraceSource + AdapterRegistry + Repository + 领域服务，完成
 *   - syncIndex: 扫描来源、解析元数据、写入仓储索引（启动与定时刷新）
 *   - listCollections / queryMetas: 读模型查询（直接走仓储）
 *   - loadDetail: 打开会话时按需解析全文为聚合根
 *
 * 不含领域规则（规则在聚合/领域服务），不含 IO 细节（细节在 infra）。
 */

import {
  TranscriptAssembler,
  statusFromActivity,
  type Session,
  type SessionRepository,
  type SourceAdapter,
  type RawSessionRef,
  type CollectionSummary,
  type SessionMeta,
  type SessionQueryFilter,
  type TraceSource,
} from '../../domain/index.js';
import type { AdapterRegistry } from '../../infra/adapters/AdapterRegistry.js';

export interface LoadedSession {
  session: Session;
  ref: RawSessionRef;
  adapter: SourceAdapter;
  /** 解析状态与读取偏移，供实时增量复用。 */
  state: Record<string, unknown>;
  offset: number;
}

export class SessionQueryService {
  private readonly assembler = new TranscriptAssembler();
  /** sessionId → {ref, source}，syncIndex 时建立，供 loadDetail/实时 定位。 */
  private readonly refIndex = new Map<string, { ref: RawSessionRef; source: TraceSource }>();

  constructor(
    private readonly sources: TraceSource[],
    private readonly registry: AdapterRegistry,
    private readonly repo: SessionRepository,
  ) {}

  /** 扫描所有来源，解析元数据写入仓储；返回入库会话数。 */
  async syncIndex(now: Date = nowOrEpoch()): Promise<number> {
    const seen = new Set<string>();
    for (const source of this.sources) {
      const refs = await source.scan();
      for (const ref of refs) {
        const adapter = await this.resolveAdapter(source, ref);
        if (!adapter) continue;
        try {
          const lines = await source.readAll(ref);
          const { session } = this.assembler.assemble(adapter, ref, lines);
          this.repo.upsertMeta(session.toMeta(now));
          this.refIndex.set(ref.sessionId, { ref, source });
          seen.add(ref.sessionId);
        } catch {
          // 单个文件解析失败不应中断整体扫描
          continue;
        }
      }
    }
    this.repo.pruneExcept(seen);
    return seen.size;
  }

  /**
   * 增量发现：只扫文件列表（不读内容），对「库里还没有」的新会话才解析入库。
   * 已存在的会话跳过——其状态由 queryMetas 按 mtime 实时覆盖，无需重解析。
   * 开销远小于 syncIndex，可高频调用以让新会话尽快出现。
   * 返回新入库的会话数。
   */
  async refreshIndex(now: Date = nowOrEpoch()): Promise<number> {
    let added = 0;
    for (const source of this.sources) {
      const refs = await source.scan();
      for (const ref of refs) {
        // 已索引则只补 refIndex 定位、跳过解析
        if (this.repo.findMeta(ref.sessionId)) {
          if (!this.refIndex.has(ref.sessionId)) this.refIndex.set(ref.sessionId, { ref, source });
          continue;
        }
        const adapter = await this.resolveAdapter(source, ref);
        if (!adapter) continue;
        try {
          const lines = await source.readAll(ref);
          const { session } = this.assembler.assemble(adapter, ref, lines);
          this.repo.upsertMeta(session.toMeta(now));
          this.refIndex.set(ref.sessionId, { ref, source });
          added++;
        } catch {
          continue;
        }
      }
    }
    return added;
  }

  listCollections(): CollectionSummary[] {
    return this.repo.listCollections();
  }

  /**
   * 查询元数据，并用文件 mtime 实时覆盖 status。
   *
   * 库里的 status 是 syncIndex 那一刻的快照，可能过期；这里按 mtime
   * （文件系统真相）重算，使「正在写入」的会话立刻显示 running。
   */
  async queryMetas(filter: SessionQueryFilter): Promise<SessionMeta[]> {
    const metas = this.repo.queryMetas(filter);
    const now = new Date();
    return Promise.all(
      metas.map(async (meta) => {
        const entry = this.refIndex.get(meta.id);
        if (!entry) return meta;
        const mtime = await entry.source.lastModified(entry.ref);
        // 取 mtime 与最后事件时间的较晚者作为活动信号
        const lastActivity = laterOf(mtime, meta.lastEventAt);
        return meta.withStatus(statusFromActivity(lastActivity, now));
      }),
    );
  }

  findMeta(id: string): SessionMeta | null {
    return this.repo.findMeta(id);
  }

  /** 打开会话：解析全文为聚合根，返回聚合 + 增量所需的状态/偏移。 */
  async loadDetail(sessionId: string): Promise<LoadedSession | null> {
    const entry = this.refIndex.get(sessionId) ?? (await this.rediscover(sessionId));
    if (!entry) return null;
    const { ref, source } = entry;
    const adapter = await this.resolveAdapter(source, ref);
    if (!adapter) return null;

    const lines = await source.readAll(ref);
    const { session, state } = this.assembler.assemble(adapter, ref, lines);
    const offset = await source.currentOffset(ref);
    return { session, ref, adapter, state: state as Record<string, unknown>, offset };
  }

  getRef(sessionId: string): RawSessionRef | undefined {
    return this.refIndex.get(sessionId)?.ref;
  }

  sourceFor(sessionId: string): TraceSource | undefined {
    return this.refIndex.get(sessionId)?.source;
  }

  get transcriptAssembler(): TranscriptAssembler {
    return this.assembler;
  }

  get repository(): SessionRepository {
    return this.repo;
  }

  private async resolveAdapter(
    source: TraceSource,
    ref: RawSessionRef,
  ): Promise<SourceAdapter | undefined> {
    const head = await source.readHead(ref, 5);
    return this.registry.detect(ref.locator, head);
  }

  private async rediscover(
    sessionId: string,
  ): Promise<{ ref: RawSessionRef; source: TraceSource } | undefined> {
    for (const source of this.sources) {
      const refs = await source.scan();
      for (const ref of refs) {
        this.refIndex.set(ref.sessionId, { ref, source });
      }
    }
    return this.refIndex.get(sessionId);
  }
}

function nowOrEpoch(): Date {
  return new Date();
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}
