/**
 * StatisticRepository —— 领域端口（Port）。
 *
 * 每日用量统计的持久化抽象。接口在 domain，实现（SQLite/…）在 infra 反向依赖。
 * 以 (date, source, model) 为主键，upsert 幂等 —— rebuild 某天可安全覆盖。
 */

import type { DailyStat } from '../model/DailyStat.js';

export interface StatisticRepository {
  /** 批量 upsert（按 date+source+model 主键覆盖）。 */
  upsertMany(stats: DailyStat[]): void;
  /** 删除某天所有来源/模型的统计（rebuild 前清理，避免残留旧切分）。 */
  deleteDate(date: string): void;
  /** 查询 [from, to] 闭区间（YYYY-MM-DD）内的所有统计。 */
  queryRange(from: string, to: string): DailyStat[];
  /** 已落库的所有日期（升序），用于 backfill 跳过已算天。 */
  knownDates(): string[];
}
