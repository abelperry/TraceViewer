/**
 * SourceAdapter —— 领域端口（Port）。
 *
 * 「如何把某种原始 trace 翻译成领域事件」是一个领域概念，因此接口定义在 domain，
 * 具体格式（Claude Code / Codex / …）的实现落在 infra/adapters，反向依赖本接口。
 *
 * 新增一种格式 = 实现本接口 + 在 registry 注册，application/api 零改动。
 */

import type { SourceId } from '@trace-review/shared';
import type { Event } from '../model/Event.js';
import type { Session } from '../model/Session.js';

/** 一次原始会话引用（由 TraceSource 发现），用于定位与读取。 */
export interface RawSessionRef {
  /** 稳定的 session 标识（通常取自文件名/内部 id）。 */
  sessionId: string;
  /** collection 标识（通常为所在目录）。 */
  collectionId: string;
  /** 物理定位（文件路径等），由 TraceSource 解释，adapter 不关心。 */
  locator: string;
}

/** 增量解析所需的跨调用状态（adapter 自行定义内部形状）。 */
export interface AdapterParseState {
  [key: string]: unknown;
}

export interface ParsedSession {
  session: Session;
  state: AdapterParseState;
}

export interface ParsedIncrement {
  events: Event[];
  /** 标题/模型等可能在增量中才出现，回填到聚合。 */
  titlePatch?: string;
}

export interface SourceAdapter {
  readonly id: SourceId;

  /** 根据路径与文件头若干行判断是否属于本格式。 */
  detect(locator: string, headLines: string[]): boolean;

  /** 解析全文为聚合根，并返回可用于后续增量的状态。 */
  parseSession(ref: RawSessionRef, lines: string[]): ParsedSession;

  /** 解析 tail 出的新增行为增量事件。 */
  parseIncremental(
    ref: RawSessionRef,
    newLines: string[],
    state: AdapterParseState,
  ): ParsedIncrement;
}
