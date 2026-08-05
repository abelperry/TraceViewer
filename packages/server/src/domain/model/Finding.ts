/**
 * Finding —— 值对象（Value Object）。
 *
 * 一次评审里的单条问题：归属（agent 不足 / prompt 不足）、严重度、
 * 一句话标题、展开说明、可操作建议，以及可选的证据事件序号。
 * 不可变、无身份标识；相等性由内容决定。
 */

import type { FindingCategory, Severity, FindingDTO } from '@trace-review/shared';

export type { FindingCategory, Severity };

export class Finding {
  constructor(
    readonly category: FindingCategory,
    readonly severity: Severity,
    /** 一句话问题 */
    readonly title: string,
    /** 展开说明 */
    readonly detail: string,
    /** 针对本条的可操作建议 */
    readonly suggestion: string,
    /** 证据事件序号（loadDetail 后 events 的 index），拿不到为空。 */
    readonly evidenceEventIndexes: number[] = [],
  ) {}

  toDTO(): FindingDTO {
    return {
      category: this.category,
      severity: this.severity,
      title: this.title,
      detail: this.detail,
      suggestion: this.suggestion,
      evidenceEventIndexes: [...this.evidenceEventIndexes],
    };
  }
}

/** severity 从高到低的排序权重（供 topSeverity/展示排序）。 */
export const SEVERITY_RANK: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};
