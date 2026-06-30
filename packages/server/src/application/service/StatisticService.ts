/**
 * StatisticService —— 应用服务（用量统计编排）。
 *
 *   - backfill: 扫描所有 trace → adapter.extractUsage → 聚合 → 按天落库，
 *     跳过已落库的历史天（幂等、可重复执行）
 *   - rebuildDay: 重算指定某天（凌晨调度调用），先清后写
 *   - queryRange: 按 7d/30d/all 返回每日聚合 + 汇总
 *
 * 不含格式细节（在 adapter）、不含聚合规则（在领域服务 StatisticAggregator）。
 */

import {
  StatisticAggregator,
  localDateKey,
  type DailyStat,
  type RawSessionRef,
  type SourceAdapter,
  type StatisticRepository,
  type TraceSource,
  type UsageSample,
} from '../../domain/index.js';
import type { AdapterRegistry } from '../../infra/adapters/AdapterRegistry.js';

export type StatsRange = '7d' | '30d' | 'all';

export interface DailyPoint {
  date: string;
  sessionCount: number;
  messageCount: number;
  totalTokens: number;
}

export interface StatsResult {
  range: StatsRange;
  from: string;
  to: string;
  days: DailyPoint[];
  summary: {
    sessions: number;
    messages: number;
    totalTokens: number;
    activeDays: number;
  };
}

export class StatisticService {
  private readonly aggregator = new StatisticAggregator();

  constructor(
    private readonly sources: TraceSource[],
    private readonly registry: AdapterRegistry,
    private readonly repo: StatisticRepository,
  ) {}

  /** 扫描全部 trace，聚合并落库。skipKnown=true 时跳过已落库日期。 */
  async backfill(now: Date = new Date()): Promise<number> {
    const samples = await this.collectAllSamples();
    const stats = this.aggregator.aggregate(samples);
    // 今天可能还在变化：仅落「今天之前」的天为稳定历史；今天也落但后续会被覆盖
    this.repo.upsertMany(stats);
    return stats.length;
  }

  /** 重算指定某天（先清该天，再用全量样本里属于该天的部分覆盖）。 */
  async rebuildDay(date: string): Promise<void> {
    const samples = (await this.collectAllSamples()).filter(
      (s) => localDateKey(s.timestamp) === date,
    );
    this.repo.deleteDate(date);
    this.repo.upsertMany(this.aggregator.aggregate(samples));
  }

  queryRange(range: StatsRange, now: Date = new Date()): StatsResult {
    const to = localDateKey(now);
    let from: string;
    if (range === 'all') {
      const known = this.repo.knownDates();
      from = known[0] ?? to;
    } else {
      const days = range === '7d' ? 6 : 29;
      const fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - days);
      from = localDateKey(fromDate);
    }
    const stats = this.repo.queryRange(from, to);
    return this.fold(range, from, to, stats);
  }

  /** 把 (date×source×model) 行折叠成每日点 + 汇总。 */
  private fold(range: StatsRange, from: string, to: string, stats: DailyStat[]): StatsResult {
    const byDate = new Map<string, DailyPoint>();
    for (const s of stats) {
      let p = byDate.get(s.date);
      if (!p) {
        p = { date: s.date, sessionCount: 0, messageCount: 0, totalTokens: 0 };
        byDate.set(s.date, p);
      }
      p.sessionCount += s.sessionCount;
      p.messageCount += s.messageCount;
      p.totalTokens += s.totalTokens;
    }
    const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const summary = {
      sessions: days.reduce((n, d) => n + d.sessionCount, 0),
      messages: days.reduce((n, d) => n + d.messageCount, 0),
      totalTokens: days.reduce((n, d) => n + d.totalTokens, 0),
      activeDays: days.filter((d) => d.sessionCount > 0 || d.totalTokens > 0).length,
    };
    return { range, from, to, days, summary };
  }

  /** 遍历所有来源与会话，抽取用量样本。 */
  private async collectAllSamples(): Promise<UsageSample[]> {
    const all: UsageSample[] = [];
    for (const source of this.sources) {
      const refs = await source.scan();
      for (const ref of refs) {
        const adapter = await this.resolveAdapter(source, ref);
        if (!adapter) continue;
        try {
          const lines = await source.readAll(ref);
          all.push(...adapter.extractUsage(ref, lines));
        } catch {
          continue;
        }
      }
    }
    return all;
  }

  private async resolveAdapter(
    source: TraceSource,
    ref: RawSessionRef,
  ): Promise<SourceAdapter | undefined> {
    const head = await source.readHead(ref, 5);
    return this.registry.detect(ref.locator, head);
  }
}
