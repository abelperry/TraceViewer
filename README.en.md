# Trace Review

[简体中文](./README.md) | **English**

A web tool for inspecting Claude Code / Codex agent run traces in real time (docent-style tree navigation + live refresh + daily token-usage stats).

## Architecture (DDD layering + dependency inversion)

```
monorepo (pnpm)
├─ packages/shared      transport DTOs (anemic), the front/back contract
├─ packages/server      backend, strictly layered:
│  ├─ domain/           core: rich entities + domain services + ports (zero framework deps)
│  │   ├─ model/        Session(aggregate root) / Event / Block / TokenUsage / SessionMeta / DailyStat
│  │   ├─ service/      TranscriptAssembler (assemble/append) / StatisticAggregator (per-day rollup)
│  │   └─ port/         SessionRepository / TraceSource / SourceAdapter / StatisticRepository
│  ├─ application/      use-case orchestration: SessionQueryService / LiveStreamService / StatisticService
│  ├─ infra/            port implementations (depend inward on domain):
│  │   ├─ adapters/     ClaudeCodeAdapter / CodexAdapter / AdapterRegistry
│  │   ├─ persistence/  SqliteSessionRepository / SqliteStatisticRepository
│  │   ├─ filesource/   FsTraceSource (byte-offset tail + fs.watchFile)
│  │   └─ scheduler/    DailyScheduler (recompute yesterday across midnight)
│  ├─ api/              Fastify routes + SSE + DTO mapping
│  └─ main.ts           composition root (the only place that `new`s infra and injects it)
└─ packages/web         React + Vite two-pane tree view + EventSource live refresh + Stats heatmap
```

Dependency direction: `api → application → domain ← infra`. The domain is only depended upon, never depends outward. Swapping storage (SQLite→Postgres) or source (local→remote) only adds an infra implementation — domain/application stay untouched.

## Supported formats

| Format | Source directory | Collection grouping |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | by session cwd |
| Codex | `~/.codex/**/rollout-*.jsonl` | by session cwd |

Claude and Codex sessions under the same project directory are merged into one collection.

## Adding a new trace format

Implement the `domain/port/SourceAdapter.ts` interface (`detect` / `parseSession` / `parseIncremental` / `extractUsage`),
drop it in `infra/adapters/`, register it in `main.ts`'s `AdapterRegistry` and add one `FsTraceSource`.
application / api / web need no changes. The Codex adapter was added exactly this way.

## How live refresh works

JSONL is the single source of truth. When a session is opened, `LiveStreamService` polls that file with
`fs.watchFile`; on change it reads incrementally from the last byte offset, splits on complete lines (an
incomplete trailing line is held until next time), and `parseIncremental` turns the new lines into events
merged into the aggregate, pushed to subscribers via an SSE `patch` event. running/done is derived from file mtime.

> Note: an earlier version watched the whole directory tree with chokidar, but its `change` event is unreliable
> on macOS, so it was switched to per-subscribed-file polling.

## Daily token-usage statistics

On startup `StatisticService` scans all traces to backfill historical daily usage (aggregated by date × source × model);
`DailyScheduler` recomputes yesterday after crossing local midnight. The web Stats view shows daily tokens as a
heatmap with 7d / 30d / all ranges.
Conventions: token = input + output; message = user + assistant turns; source is the agent type (claude-code / codex).

## Running

```bash
pnpm install
pnpm dev            # start server(:4000) and web(:5173) together
# or separately:
pnpm dev:server
pnpm dev:web
```

Open http://localhost:5173 .

### Environment variables (server)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | backend port |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code trace scan root |
| `CODEX_SESSIONS_DIR` | `~/.codex` | Codex trace scan root |
| `DB_PATH` | `./trace-review.sqlite` | metadata + daily-stats index db |

## Tests

```bash
pnpm -r test        # adapter parsing / tail offset / SQLite repos / daily aggregation
pnpm -r typecheck
```
