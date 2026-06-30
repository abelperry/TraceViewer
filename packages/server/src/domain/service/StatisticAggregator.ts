/**
 * StatisticAggregator —— 领域服务。
 *
 * 把原子用量样本（UsageSample[]）按 (date × source × model) 聚合成 DailyStat[]。
 * sessionCount 需在聚合键内对 sessionId 去重，因此单独用 Set 计算，
 * 不能简单相加（同一会话当天可能产生多条样本）。
 *
 * 纯函数、零依赖，可独立单测。
 */

import { DailyStat, localDateKey, type UsageSample } from '../model/DailyStat.js';

interface Acc {
  date: string;
  source: UsageSample['source'];
  model: string | null;
  sessions: Set<string>;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
}

export class StatisticAggregator {
  aggregate(samples: UsageSample[]): DailyStat[] {
    const buckets = new Map<string, Acc>();
    for (const s of samples) {
      const date = localDateKey(s.timestamp);
      const key = `${date}|${s.source}|${s.model ?? ''}`;
      let acc = buckets.get(key);
      if (!acc) {
        acc = {
          date,
          source: s.source,
          model: s.model,
          sessions: new Set(),
          messageCount: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
        buckets.set(key, acc);
      }
      acc.sessions.add(s.sessionId);
      if (s.isMessage) acc.messageCount += 1;
      acc.inputTokens += s.inputTokens;
      acc.outputTokens += s.outputTokens;
    }
    return [...buckets.values()].map(
      (a) =>
        new DailyStat(
          a.date,
          a.source,
          a.model,
          a.sessions.size,
          a.messageCount,
          a.inputTokens,
          a.outputTokens,
        ),
    );
  }
}
