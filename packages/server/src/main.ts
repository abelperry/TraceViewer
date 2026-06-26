import { homedir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';

import { AdapterRegistry } from './infra/adapters/AdapterRegistry.js';
import { ClaudeCodeAdapter } from './infra/adapters/ClaudeCodeAdapter.js';
import { FsTraceSource } from './infra/filesource/FsTraceSource.js';
import { SqliteSessionRepository } from './infra/persistence/SqliteSessionRepository.js';
import { SessionQueryService } from './application/service/SessionQueryService.js';
import { LiveStreamService } from './application/service/LiveStreamService.js';
import { registerRestRoutes } from './api/routes/sessionRoutes.js';
import { registerStreamRoutes } from './api/sse/streamRoutes.js';

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
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), 'trace-review.sqlite');

  // ---- infra ----
  const registry = new AdapterRegistry([new ClaudeCodeAdapter()]);
  const claudeSource = new FsTraceSource('claude-code', [claudeRoot]);
  const sources = [claudeSource];
  const repo = new SqliteSessionRepository(dbPath);

  // ---- application ----
  const query = new SessionQueryService(sources, registry, repo);
  const live = new LiveStreamService(query, query.transcriptAssembler, sources);

  // 启动时建立索引并开启文件监听
  const indexed = await query.syncIndex();
  live.start();

  // ---- api ----
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  app.get('/health', async () => ({ status: 'ok', indexed }));
  await registerRestRoutes(app, { query });
  await registerStreamRoutes(app, { query, live });

  await app.listen({ port, host: '127.0.0.1' });
  app.log.info(`indexed ${indexed} sessions from ${claudeRoot}`);

  const shutdown = () => {
    live.stop();
    repo.close();
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
