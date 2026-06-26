import type {
  SessionMetaDTO,
  SessionStatus,
  SourceId,
} from '@trace-review/shared';

/**
 * SessionMeta —— 值对象。
 *
 * 列表/搜索所需的轻量元数据快照，是 {@link SessionRepository} 索引的单位。
 * 与全文事件分离：仓储只存它，正文按需从 TraceSource 解析。
 */
export class SessionMeta {
  constructor(
    readonly id: string,
    readonly source: SourceId,
    readonly collectionId: string,
    readonly title: string,
    readonly cwd: string | null,
    readonly gitBranch: string | null,
    readonly model: string | null,
    readonly status: SessionStatus,
    readonly startedAt: Date | null,
    readonly lastEventAt: Date | null,
    readonly eventCount: number,
  ) {}

  toDTO(): SessionMetaDTO {
    return {
      id: this.id,
      source: this.source,
      collectionId: this.collectionId,
      title: this.title,
      cwd: this.cwd,
      gitBranch: this.gitBranch,
      model: this.model,
      status: this.status,
      startedAt: this.startedAt ? this.startedAt.toISOString() : null,
      lastEventAt: this.lastEventAt ? this.lastEventAt.toISOString() : null,
      eventCount: this.eventCount,
    };
  }
}
