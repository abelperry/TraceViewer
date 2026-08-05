/**
 * 评分 → 语义色类。Reviews 详情/信息流与 Trace 会话树徽章共用，
 * 保证同一个分数在两处显示成同一个颜色。
 */

/** 1..5 → good/warn/bad；failed（score=0）走中性。 */
export function scoreClass(score: number, status: string): string {
  if (status === 'failed') return 'neutral';
  if (score >= 4) return 'good';
  if (score === 3) return 'warn';
  return 'bad';
}
