/**
 * TranscriptAssembler —— 领域服务（Domain Service）。
 *
 * 职责：把「原始行 + 适配器」装配成聚合根，或把增量行并入已有聚合。
 * 这是跨实体的协调逻辑（依赖 SourceAdapter 端口与 Session 聚合），
 * 不属于任一单个实体，故以无状态领域服务承载。
 */

import type { Session } from '../model/Session.js';
import type {
  AdapterParseState,
  RawSessionRef,
  SourceAdapter,
} from '../port/SourceAdapter.js';

export class TranscriptAssembler {
  /** 全文装配为聚合根，返回聚合与可用于增量的解析状态。 */
  assemble(
    adapter: SourceAdapter,
    ref: RawSessionRef,
    lines: string[],
  ): { session: Session; state: AdapterParseState } {
    const { session, state } = adapter.parseSession(ref, lines);
    return { session, state };
  }

  /** 把 tail 出的新增行解析并并入已有聚合，返回新增事件数。 */
  applyIncrement(
    adapter: SourceAdapter,
    session: Session,
    ref: RawSessionRef,
    newLines: string[],
    state: AdapterParseState,
  ): { appended: number } {
    const inc = adapter.parseIncremental(ref, newLines, state);
    session.appendEvents(inc.events);
    if (inc.titlePatch) session.setTitle(inc.titlePatch);
    return { appended: inc.events.length };
  }
}
