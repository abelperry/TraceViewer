import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import cors from '@fastify/cors';

import { AdapterRegistry } from './infra/adapters/AdapterRegistry.js';
import { ClaudeCodeAdapter } from './infra/adapters/ClaudeCodeAdapter.js';
import { CodexAdapter } from './infra/adapters/CodexAdapter.js';
import { FsTraceSource } from './infra/filesource/FsTraceSource.js';
import { SqliteSessionRepository } from './infra/persistence/SqliteSessionRepository.js';
import { SqliteStatisticRepository } from './infra/persistence/SqliteStatisticRepository.js';
import { DailyScheduler } from './infra/scheduler/DailyScheduler.js';
import { SessionQueryService } from './application/service/SessionQueryService.js';
import { LiveStreamService } from './application/service/LiveStreamService.js';
import { StatisticService } from './application/service/StatisticService.js';
import { registerRestRoutes } from './api/routes/sessionRoutes.js';
import { registerStreamRoutes } from './api/sse/streamRoutes.js';
import { registerStatsRoutes } from './api/routes/statsRoutes.js';

/**
 * 组合根（Composition Root）。
 *
 * 唯一允许实例化具体 infra 并注入 application 的地方。
 * 依赖方向：main → api → application → domain ← infra(implements port)。
 */
async function bootstrap(): Promise<void> {
  // ---- 配置 ----
  const port = Number(process.env.PORT ?? 4000);
  const claudeRoot =
    process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), '.claude', 'projects');
  const codexRoot = process.env.CODEX_SESSIONS_DIR ?? join(homedir(), '.codex');
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), 'trace-review.sqlite');

  // ---- infra ----
  // 新增格式 = 注册一个 adapter + 一个 trace source，application/api/web 零改动。
  const registry = new AdapterRegistry([new ClaudeCodeAdapter(), new CodexAdapter()]);
  const claudeSource = new FsTraceSource('claude-code', [claudeRoot]);
  const codexSource = new FsTraceSource('codex', [codexRoot]);
  const sources = [claudeSource, codexSource];
  const db = new Database(dbPath);
  const repo = new SqliteSessionRepository(db);
  const statRepo = new SqliteStatisticRepository(db);

  // ---- application ----
  const query = new SessionQueryService(sources, registry, repo);
  const live = new LiveStreamService(query, query.transcriptAssembler, sources);
  const stats = new StatisticService(sources, registry, statRepo);

  // 启动时建立索引并开启文件监听
  const indexed = await query.syncIndex();
  live.start();

  // 启动时回填用量统计（幂等），并启动凌晨重算调度
  const statDays = await stats.backfill();
  const scheduler = new DailyScheduler((yesterday) => stats.rebuildDay(yesterday));
  scheduler.start();

  // ---- api ----
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  app.get('/health', async () => ({ status: 'ok', indexed, statDays }));
  await registerRestRoutes(app, { query });
  await registerStreamRoutes(app, { query, live });
  await registerStatsRoutes(app, { stats });

  await app.listen({ port, host: '127.0.0.1' });
  app.log.info(`indexed ${indexed} sessions, ${statDays} stat rows from ${claudeRoot} & ${codexRoot}`);

  const shutdown = () => {
    live.stop();
    scheduler.stop();
    db.close();
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
