/**
 * 统计路由：每日用量 + 汇总。api 层只做协议与 DTO 映射。
 */

import type { FastifyInstance } from 'fastify';
import type { StatsDTO, StatsRange } from '@trace-review/shared';
import type { StatisticService } from '../../application/service/StatisticService.js';

interface Deps {
  stats: StatisticService;
}

function normalizeRange(raw: unknown): StatsRange {
  return raw === '30d' || raw === 'all' ? raw : raw === '7d' ? '7d' : '30d';
}

export async function registerStatsRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get<{ Querystring: { range?: string } }>('/stats', async (req) => {
    const range = normalizeRange(req.query.range);
    const result = deps.stats.queryRange(range);
    const dto: StatsDTO = {
      range: result.range,
      from: result.from,
      to: result.to,
      days: result.days,
      summary: result.summary,
    };
    return dto;
  });
}
