# Trace Review

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![React](https://img.shields.io/badge/React-18-61dafb)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

A web tool for inspecting Claude Code / Codex agent run traces in real time (docent-style tree navigation + live refresh + daily token-usage stats + LLM trace review).

![demo](./docs/demo.gif)

## Architecture (DDD layering + dependency inversion)

```
monorepo (pnpm)
├─ packages/shared      transport DTOs (anemic), the front/back contract
├─ packages/server      backend, strictly layered:
│  ├─ domain/           core: rich entities + domain services + ports (zero framework deps)
│  │   ├─ model/        Session(aggregate root) / Event / Block / TokenUsage / SessionMeta / DailyStat / Review
│  │   ├─ service/      TranscriptAssembler / StatisticAggregator / ReviewInputBuilder / ReviewParser / SummaryAggregator
│  │   └─ port/         SessionRepository / TraceSource / SourceAdapter / StatisticRepository / ReviewRepository / Reviewer
│  ├─ application/      use-case orchestration: SessionQueryService / LiveStreamService / StatisticService / ReviewService
│  ├─ infra/            port implementations (depend inward on domain):
│  │   ├─ adapters/     ClaudeCodeAdapter / CodexAdapter / AdapterRegistry
│  │   ├─ persistence/  SqliteSessionRepository / SqliteStatisticRepository / SqliteReviewRepository
│  │   ├─ reviewer/     AnthropicApiReviewer (default Reviewer port impl)
│  │   ├─ filesource/   FsTraceSource (byte-offset tail + fs.watchFile)
│  │   └─ scheduler/    DailyScheduler (recompute yesterday + routine review across midnight)
│  ├─ api/              Fastify routes + SSE + DTO mapping
│  └─ main.ts           composition root (the only place that `new`s infra and injects it)
└─ packages/web         React + Vite left-nav (Trace / Stats / Reviews) + EventSource live refresh
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

## Daily token-usage statistics

On startup `StatisticService` scans all traces to backfill historical daily usage (aggregated by date × source × model);
`DailyScheduler` recomputes yesterday after crossing local midnight. The web Stats view shows daily tokens as a
heatmap with 7d / 30d / all ranges.
Conventions: token = input + output; message = user + assistant turns; source is the agent type (claude-code / codex).

## Trace review (LLM audit)

An LLM reviewer audits each run and points out shortcomings on **both sides** of the trace:

- **Agent side** — where the agent went wrong (wrong tool, missed context, over-engineering, gave up early…).
- **Prompt side** — where the human prompt could have been clearer or better scoped.

Each finding carries a severity, an actionable suggestion, and evidence event indexes. Every session review
gets a 1–5 score; the Reviews view is a newest-first tiled feed with a periodic (7d / 30d) summary of the
highest-frequency issues, and clicking a card opens a full detail page.

**Findings live on the trace.** Rather than reading a review as a separate report, the Trace view renders
findings as annotations anchored to the events they refer to — a card in the right-hand gutter beside the
event, a severity-coloured left border on every referenced event, and severity ticks on the minimap so the
distribution of problems across a long run is visible at a glance. A finding anchors at its lowest evidence
index and lists the rest as "同时引用"; hovering it highlights all events it cites. Findings with no evidence
sit in a summary banner at the top. Toggle the layer with **✦ 批注** (state persisted); score badges in the
session tree jump the other way, from a trace to its review.

Evidence indexes are positions in the event array *at review time*, so a trace that grew afterwards would
have drifted anchors. The reviewed event count is stored, and the banner says so explicitly rather than
silently pointing at the wrong events.

The reviewer is a pluggable domain port. The default `AnthropicApiReviewer` calls the Anthropic API
(`@anthropic-ai/sdk`). Reviews run in two ways: **routine** — `DailyScheduler` reviews
changed sessions after crossing local midnight (also kicked once on startup); **manual** — the *Re-review*
button in the detail pane. Idempotency uses a lightweight content fingerprint, so unchanged sessions are
skipped; only *successful* reviews count as done, so a failed one is retried next round instead of being
stuck forever. Sessions still `running` are not reviewed until they finish.

**Third-party gateways.** Setting `ANTHROPIC_BASE_URL` to an Anthropic-compatible gateway (GLM, Kimi,
etc.) auto-downgrades the request: native structured output and adaptive thinking are dropped in favour of
a prompt-level JSON contract plus lenient parsing (fenced ```` ```json ```` blocks and surrounding prose are
tolerated), because gateways typically ignore `output_config`. Official endpoints keep the native path.

Reviews are **derived data**: the JSONL trace stays the single source of truth, and the review DB can be
rebuilt from traces at any time.

> **Privacy / data flow.** This is a local single-user tool. The only outbound path is the review call,
> which sends trimmed trace content to the Anthropic API (or your configured `ANTHROPIC_BASE_URL`) — and it
> is **gated entirely on a credential** (`ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`). With no credential
> set, routine review no-ops and manual triggers return `409`; nothing leaves your machine.

## Running

```bash
pnpm install
cp .env.example .env   # optional: fill in a credential to enable trace review
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
| `DB_PATH` | `./trace-review.sqlite` | metadata + daily-stats + reviews index db |
| `ANTHROPIC_AUTH_TOKEN` | *(unset)* | gateway bearer token → `Authorization: Bearer`; enables review |
| `ANTHROPIC_API_KEY` | *(unset)* | alternative to the token → `x-api-key`; either one enables review |
| `ANTHROPIC_BASE_URL` | official API | custom / proxy endpoint for the review call |
| `REVIEW_MODEL` | `claude-opus-5` | model used by the default `AnthropicApiReviewer` |

Server config is read from a repo-root `.env` (copy `.env.example` to start). **Values in `.env` take
precedence over the ambient environment** — deliberately unlike Node's `--env-file`: users often already
export `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` in their shell for their *own* Claude Code, and those
would otherwise silently hijack this tool's reviewer config. Blank entries in `.env` mean "unset" and don't
override anything. With **no** credential (`ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`) the reviewer
stays disabled: routine review no-ops and manual triggers return `409`.

## Tests

```bash
pnpm -r test        # adapter parsing / tail offset / SQLite repos / daily aggregation / finding anchoring
pnpm -r typecheck
```
