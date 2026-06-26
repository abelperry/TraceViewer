# Trace Review

实时查看 Claude Code / Codex agent 运行 trace 的 Web 工具（docent 风格三栏视图 + 实时刷新）。

## 架构（DDD 分层 + 依赖倒置）

```
monorepo (pnpm)
├─ packages/shared      传输 DTO（贫血），前后端契约面
├─ packages/server      后端，严格分层：
│  ├─ domain/           内核：充血实体 + 领域服务 + port 接口（零框架依赖）
│  │   ├─ model/        Session(聚合根) / Event / Block / TokenUsage / SessionMeta
│  │   ├─ service/      TranscriptAssembler（装配/增量并入）
│  │   └─ port/         SessionRepository / TraceSource / SourceAdapter（接口在此）
│  ├─ application/      用例编排：SessionQueryService / LiveStreamService
│  ├─ infra/            port 实现（反向依赖 domain）：
│  │   ├─ adapters/     ClaudeCodeAdapter + AdapterRegistry
│  │   ├─ persistence/  SqliteSessionRepository
│  │   └─ filesource/   FsTraceSource（字节偏移 tail + chokidar 监听）
│  ├─ api/              Fastify 路由 + SSE + DTO 映射
│  └─ main.ts           组合根（唯一 new infra 并注入的地方）
└─ packages/web         React + Vite 三栏视图 + EventSource 实时刷新
```

依赖方向：`api → application → domain ← infra`。domain 只被依赖、不依赖外层。换存储（SQLite→Postgres）或来源（本地→远程）只新增 infra 实现，domain/application 不动。

## 扩展新 trace 格式

实现 `domain/port/SourceAdapter.ts` 接口（`detect` / `parseSession` / `parseIncremental`），
放到 `infra/adapters/`，在 `main.ts` 的 `AdapterRegistry` 注册即可，server/web 零改动。
Codex 适配器即按此方式追加。

## 实时刷新原理

JSONL 是唯一真实数据源。`FsTraceSource` 记录每个文件的字节偏移，chokidar 检测到追加后
只读新增字节、按完整行切分（残行留到下次），`parseIncremental` 转成增量事件并入聚合，
经 SSE `patch` 事件推给订阅的前端。

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
| `PORT` | 4000 | 后端端口 |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | 扫描根目录 |
| `DB_PATH` | `./trace-review.sqlite` | 元数据索引库 |

## 测试

```bash
pnpm -r test        # 16 个测试：适配器解析 / tail 偏移 / SQLite 仓储
pnpm -r typecheck
```
