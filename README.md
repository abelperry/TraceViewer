# Trace Review

**简体中文** | [English](./README.en.md)

实时查看 Claude Code / Codex agent 运行 trace 的 Web 工具（docent 风格树形导航 + 实时刷新 + 每日 token 用量统计）。

## 架构（DDD 分层 + 依赖倒置）

```
monorepo (pnpm)
├─ packages/shared      传输 DTO（贫血），前后端契约面
├─ packages/server      后端，严格分层：
│  ├─ domain/           内核：充血实体 + 领域服务 + port 接口（零框架依赖）
│  │   ├─ model/        Session(聚合根) / Event / Block / TokenUsage / SessionMeta / DailyStat
│  │   ├─ service/      TranscriptAssembler（装配/增量并入） / StatisticAggregator（按天聚合）
│  │   └─ port/         SessionRepository / TraceSource / SourceAdapter / StatisticRepository
│  ├─ application/      用例编排：SessionQueryService / LiveStreamService / StatisticService
│  ├─ infra/            port 实现（反向依赖 domain）：
│  │   ├─ adapters/     ClaudeCodeAdapter / CodexAdapter / AdapterRegistry
│  │   ├─ persistence/  SqliteSessionRepository / SqliteStatisticRepository
│  │   ├─ filesource/   FsTraceSource（字节偏移 tail + fs.watchFile 监听）
│  │   └─ scheduler/    DailyScheduler（跨午夜重算昨日用量）
│  ├─ api/              Fastify 路由 + SSE + DTO 映射
│  └─ main.ts           组合根（唯一 new infra 并注入的地方）
└─ packages/web         React + Vite 两栏树形视图 + EventSource 实时刷新 + Stats 热力图
```

依赖方向：`api → application → domain ← infra`。domain 只被依赖、不依赖外层。换存储（SQLite→Postgres）或来源（本地→远程）只新增 infra 实现，domain/application 不动。

## 支持的格式

| 格式 | 来源目录 | collection 归类 |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | 按会话 cwd |
| Codex | `~/.codex/**/rollout-*.jsonl` | 按会话 cwd |

同一工程目录下的 Claude 与 Codex 会话会合并到同一个 collection。

## 扩展新 trace 格式

实现 `domain/port/SourceAdapter.ts` 接口（`detect` / `parseSession` / `parseIncremental` / `extractUsage`），
放到 `infra/adapters/`，在 `main.ts` 的 `AdapterRegistry` 注册并加一个 `FsTraceSource` 来源即可，
application / api / web 零改动。Codex 适配器即按此方式追加。

## 实时刷新原理

JSONL 是唯一真实数据源。打开某会话时 `LiveStreamService` 用 `fs.watchFile` 轮询该文件，
检测到变化后从上次字节偏移增量读取、按完整行切分（残行留到下次），`parseIncremental`
转成增量事件并入聚合，经 SSE `patch` 事件推给订阅的前端。running/done 状态由文件 mtime 判定。

> 注：曾用 chokidar 监听整个目录树，但其 `change` 事件在 macOS 下不可靠，故改为按订阅文件轮询。

## 每日 token 用量统计

`StatisticService` 启动时扫描全部 trace 回填历史每日用量（date × source × model 聚合），
`DailyScheduler` 在跨过本地午夜后重算昨日。前端 Stats 视图以热力图展示每日 token，支持 7d / 30d / all。
口径：token = input + output；message = user + assistant 轮次；source 即 agent 类型（claude-code / codex）。

## 运行

```bash
pnpm install
pnpm dev            # 同时启动 server(:4000) 与 web(:5173)
# 或分别：
pnpm dev:server
pnpm dev:web
```

打开 http://localhost:5173 。

### 环境变量（server）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `4000` | 后端端口 |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code trace 扫描根目录 |
| `CODEX_SESSIONS_DIR` | `~/.codex` | Codex trace 扫描根目录 |
| `DB_PATH` | `./trace-review.sqlite` | 元数据 + 每日统计索引库 |

## 测试

```bash
pnpm -r test        # 适配器解析 / tail 偏移 / SQLite 仓储 / 每日聚合
pnpm -r typecheck
```
