import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import cors from '@fastify/cors';

import { AdapterRegistry } from './infra/adapters/AdapterRegistry.js';
import { ClaudeCodeAdapter } from './infra/adapters/ClaudeCodeAdapter.js';
import { CodexAdapter } from './infra/adapters/CodexAdapter.js';
import { FsTraceSource } from './infra/filesource/FsTraceSource.js';
import { SqliteSessionRepository } from './infra/persistence/SqliteSessionRepository.js';
import { SqliteStatisticRepository } from './infra/persistence/SqliteStatisticRepository.js';
import { SqliteReviewRepository } from './infra/persistence/SqliteReviewRepository.js';
import { AnthropicApiReviewer } from './infra/reviewer/AnthropicApiReviewer.js';
import { loadDotEnv } from './infra/config/loadDotEnv.js';
import { DailyScheduler } from './infra/scheduler/DailyScheduler.js';
import { SessionQueryService } from './application/service/SessionQueryService.js';
import { LiveStreamService } from './application/service/LiveStreamService.js';
import { StatisticService } from './application/service/StatisticService.js';
import { ReviewService } from './application/service/ReviewService.js';
import { registerRestRoutes } from './api/routes/sessionRoutes.js';
import { registerStreamRoutes } from './api/sse/streamRoutes.js';
import { registerStatsRoutes } from './api/routes/statsRoutes.js';
import { registerReviewRoutes } from './api/routes/reviewRoutes.js';

/**
 * 组合根（Composition Root）。
 *
 * 唯一允许实例化具体 infra 并注入 application 的地方。
 * 依赖方向：main → api → application → domain ← infra(implements port)。
 */
async function bootstrap(): Promise<void> {
  // 载入仓库根 .env（本地密钥/端点，勿入库）。文件值优先于环境变量：使用者
  // 常已在 shell 里为自己的 Claude Code 导出 ANTHROPIC_* ，不能让它们劫持本工具配置。
  loadDotEnv(fileURLToPath(new URL('../../../.env', import.meta.url)));

  // ---- 配置 ----
  const port = Number(process.env.PORT ?? 4000);
  const claudeRoot =
    process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), '.claude', 'projects');
  const codexRoot = process.env.CODEX_SESSIONS_DIR ?? join(homedir(), '.codex');
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), 'trace-review.sqlite');
  // 唯一对外数据出口：无凭据（AUTH_TOKEN / API_KEY）时 reviewer 未就绪，例行空跑、手动 409。
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const anthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN ?? '';
  const anthropicBaseURL = process.env.ANTHROPIC_BASE_URL;
  const reviewModel = process.env.REVIEW_MODEL;

  // ---- infra ----
  // 新增格式 = 注册一个 adapter + 一个 trace source，application/api/web 零改动。
  const registry = new AdapterRegistry([new ClaudeCodeAdapter(), new CodexAdapter()]);
  const claudeSource = new FsTraceSource('claude-code', [claudeRoot]);
  const codexSource = new FsTraceSource('codex', [codexRoot]);
  const sources = [claudeSource, codexSource];
  const db = new Database(dbPath);
  const repo = new SqliteSessionRepository(db);
  const statRepo = new SqliteStatisticRepository(db);
  const reviewRepo = new SqliteReviewRepository(db);
  const reviewer = new AnthropicApiReviewer({
    apiKey: anthropicApiKey,
    authToken: anthropicAuthToken,
    baseURL: anthropicBaseURL,
    model: reviewModel,
  });

  // ---- application ----
  const query = new SessionQueryService(sources, registry, repo);
  const live = new LiveStreamService(query, query.transcriptAssembler, sources);
  const stats = new StatisticService(sources, registry, statRepo);
  const reviews = new ReviewService(query, reviewer, reviewRepo);

  // 启动时建立索引并开启文件监听
  const indexed = await query.syncIndex();
  live.start();

  // 低频增量发现：周期性扫描，让新建会话尽快出现在列表（只解析新会话，开销小）
  const discoverTimer = setInterval(() => {
    query.refreshIndex().catch(() => {});
  }, 15_000);

  // 启动时回填用量统计（幂等），并启动凌晨重算调度
  const statDays = await stats.backfill();
  const scheduler = new DailyScheduler(async (yesterday) => {
    await stats.rebuildDay(yesterday);
    // 例行评审复用同一跨天调度：只评新增/变化的已完成会话，单轮上限内。
    await reviews.runRoutine();
  });
  scheduler.start();

  // ---- api ----
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  app.get('/health', async () => ({ status: 'ok', indexed, statDays }));
  await registerRestRoutes(app, { query });
  await registerStreamRoutes(app, { query, live });
  await registerStatsRoutes(app, { stats });
  await registerReviewRoutes(app, { reviews, query });

  await app.listen({ port, host: '127.0.0.1' });
  app.log.info(`indexed ${indexed} sessions, ${statDays} stat rows from ${claudeRoot} & ${codexRoot}`);

  // 启动即跑一轮例行评审（幂等：已评审且未变化的会话会被指纹跳过）。
  // 未配置 API key 时空跑；不阻塞启动。
  if (reviews.reviewerReady()) {
    void reviews
      .runRoutine()
      .then((n) => n > 0 && app.log.info(`routine review: ${n} session(s) reviewed`))
      .catch((err) => app.log.error(err, 'routine review failed'));
  } else {
    app.log.info('reviewer not configured (no ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY): reviews are manual-only no-ops');
  }

  const shutdown = () => {
    clearInterval(discoverTimer);
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
