/**
 * 把一条评审的 findings 锚定到轨迹事件上（纯计算，无 React、可单测）。
 *
 * evidenceEventIndexes 是「评审当时」事件数组里的下标。一条 finding 常引用多个事件，
 * 锚点取其中最小的那个（第一次出问题的地方），其余在卡片上列为「同时引用」；
 * 若重复给每个引用都放一张卡，读起来会被同一条意见反复打断。
 */

import type { FindingDTO, ReviewDTO, Severity } from '@trace-review/shared';

/** severity 从重到轻，用于同一事件上多条 finding 取最重的那个做标记色。 */
const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export interface AnchoredFinding {
  finding: FindingDTO;
  /** 锚点事件下标（该 finding 引用的最小下标） */
  anchorIndex: number;
  /** 该 finding 引用的全部事件下标（含锚点），升序 */
  allIndexes: number[];
}

export interface Annotations {
  /** 事件下标 → 锚在该事件上的 findings（按 severity 从重到轻） */
  byAnchor: Map<number, AnchoredFinding[]>;
  /** 被任意 finding 引用到的事件下标 → 其中最重的 severity（minimap 刻度用） */
  severityByEvent: Map<number, Severity>;
  /** 没有任何 evidence、无处可锚的 findings —— 收到顶部总结卡里 */
  unanchored: FindingDTO[];
  /** 有锚点的 finding 总数 */
  anchoredCount: number;
}

export const EMPTY_ANNOTATIONS: Annotations = {
  byAnchor: new Map(),
  severityByEvent: new Map(),
  unanchored: [],
  anchoredCount: 0,
};

/**
 * @param review 该会话的评审；null / failed 时返回空
 * @param eventCount 当前轨迹的事件数，用于丢弃越界锚点（轨迹被截断/重放时）
 */
export function buildAnnotations(review: ReviewDTO | null, eventCount: number): Annotations {
  if (!review || review.status === 'failed') return EMPTY_ANNOTATIONS;

  const byAnchor = new Map<number, AnchoredFinding[]>();
  const severityByEvent = new Map<number, Severity>();
  const unanchored: FindingDTO[] = [];
  let anchoredCount = 0;

  for (const finding of review.findings) {
    // 只保留仍落在当前轨迹范围内的引用
    const idxs = [...new Set(finding.evidenceEventIndexes)]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < eventCount)
      .sort((a, b) => a - b);

    if (idxs.length === 0) {
      unanchored.push(finding);
      continue;
    }

    for (const i of idxs) {
      const prev = severityByEvent.get(i);
      if (!prev || SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[prev]) {
        severityByEvent.set(i, finding.severity);
      }
    }

    const anchorIndex = idxs[0]!;
    const list = byAnchor.get(anchorIndex) ?? [];
    list.push({ finding, anchorIndex, allIndexes: idxs });
    byAnchor.set(anchorIndex, list);
    anchoredCount += 1;
  }

  for (const list of byAnchor.values()) {
    list.sort((a, b) => SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity]);
  }

  return { byAnchor, severityByEvent, unanchored, anchoredCount };
}

/**
 * 锚点是否可能已偏移：评审后轨迹又长了，下标就对不上了。
 * reviewedEventCount=0 表示历史数据未记录，无法判断 → 不告警（不如沉默）。
 */
export function anchorsMayBeStale(review: ReviewDTO | null, currentEventCount: number): boolean {
  if (!review || review.reviewedEventCount <= 0) return false;
  return currentEventCount !== review.reviewedEventCount;
}
