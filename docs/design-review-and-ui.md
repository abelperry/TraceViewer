# 设计文档：Trace Review（评审）+ 导航/视觉重构

> 对应需求：[requirements-review-and-ui.md](./requirements-review-and-ui.md)。本文定 domain 模型、端口签名、
> 表结构、API/DTO、前端组件树与色彩 token。落地前的最终对齐物。

---

## 0. 总览与依赖方向

新增一个 `review` 领域，与现有 `session` / `statistic` 平级，复用同一套分层与依赖倒置：

```
api  →  application  →  domain  ←  infra(implements port)
```

- **domain**：`Review` / `Finding` / `PeriodicSummary`（充血）；端口 `Reviewer` / `ReviewRepository`；
  领域服务 `ReviewInputBuilder`（把 Session 聚合 + rubric 组织成模型输入）、`ReviewParser`（把模型 JSON
  校验/归一成 `Review`）。
- **application**：`ReviewService`（手动触发 / 例行批量 / 周期汇总 / 信息流查询）。
- **infra**：`AnthropicApiReviewer`（默认实现，读 `ANTHROPIC_API_KEY` / `REVIEW_MODEL`）、
  `SqliteReviewRepository`（新表 `review` / `periodic_summary`）；复用 `DailyScheduler`。
- **api**：`reviewRoutes`（`/reviews` 系列）。
- **shared**：新增 `ReviewDTO` / `FindingDTO` / `PeriodicSummaryDTO` / `ReviewFeedDTO`。

review 是**派生数据**，JSONL trace 仍是唯一真相源；删库可从 trace 重建。

---

## 1. domain 模型

### 1.1 值对象 `Finding`（`domain/model/Finding.ts`）

```ts
export type FindingCategory = 'agent' | 'prompt';
export type Severity = 'high' | 'medium' | 'low';

export class Finding {
  constructor(
    readonly category: FindingCategory,
    readonly severity: Severity,
    readonly title: string,        // 一句话问题
    readonly detail: string,       // 展开说明
    readonly suggestion: string,   // 针对本条的可操作建议
    /** 证据事件序号（loadDetail 后 events 的 index），拿不到为空。 */
    readonly evidenceEventIndexes: number[] = [],
  ) {}
}
```

### 1.2 聚合根 `Review`（`domain/model/Review.ts`）

一次 session 评审。充血：自带评分归类、findings 分组、颜色档位等行为。

```ts
export type ReviewStatus = 'done' | 'failed';

export class Review {
  constructor(
    readonly id: string,              // reviewId（uuid）
    readonly sessionId: string,
    readonly collectionId: string,
    readonly source: SourceId,
    readonly model: string,           // 实际使用的模型
    readonly contentHash: string,     // 评审时 session 内容哈希（幂等键的一半）
    readonly status: ReviewStatus,
    readonly score: number,           // 1..5（failed 时为 0）
    readonly summary: string,         // 一句话摘要（信息流那行）
    readonly findings: Finding[],
    readonly createdAt: Date,
    readonly error: string | null = null,
  ) {}

  /** 按 category 分组，供详情面板。 */
  findingsByCategory(): Record<FindingCategory, Finding[]> { /* ... */ }

  /** 计数 chip：{agent, prompt}。 */
  counts(): Record<FindingCategory, number> { /* ... */ }

  /** 最高 severity（无 findings 时 null）。 */
  topSeverity(): Severity | null { /* ... */ }

  static failed(sessionId, collectionId, source, model, contentHash, error, createdAt): Review { /* ... */ }
}
```

评分与颜色档位的映射放前端（纯展示），domain 只存 1–5 的 `score`。

### 1.3 值对象 `PeriodicSummary`（`domain/model/PeriodicSummary.ts`）

```ts
export type SummaryPeriod = 'week' | 'month';

export class PeriodicSummary {
  constructor(
    readonly period: SummaryPeriod,
    readonly from: string,             // YYYY-MM-DD 闭区间
    readonly to: string,
    readonly reviewedCount: number,    // 覆盖的 session 数
    readonly avgScore: number,
    /** 高频问题：按 (category,title 归并) 计数降序。 */
    readonly topIssues: RecurringIssue[],
    readonly generatedAt: Date,
  ) {}
}

export interface RecurringIssue {
  category: FindingCategory;
  title: string;       // 归并后的代表标题
  count: number;
  exampleSessionId: string;
}
```

周期汇总先做**确定性聚合**（不额外调用模型）：从已存 `Review.findings` 里按 (category, 归一化 title)
归并计数。这样零额外 token、可随时重算。后续若要「LLM 生成趋势叙述」再加。

### 1.4 端口 `Reviewer`（`domain/port/Reviewer.ts`）

「如何评审一次 run」的抽象。infra 反向实现，默认 API。

```ts
import type { Session } from '../model/Session.js';
import type { Event } from '../model/Event.js';

export interface ReviewInput {
  session: Session;
  events: Event[];       // 已组装的完整事件序列（供渲染证据序号）
}

export interface ReviewDraft {         // 模型产出的原始结构（未落 id/时间）
  score: number;
  summary: string;
  findings: Array<{
    category: FindingCategory; severity: Severity;
    title: string; detail: string; suggestion: string;
    evidenceEventIndexes?: number[];
  }>;
}

export interface Reviewer {
  /** 实际模型名（用于落库与展示）。 */
  readonly model: string;
  /** 是否可用（如未配置 API key 则 false）。 */
  isReady(): boolean;
  /** 评审一次 run；失败抛错，由 application 兜成 failed Review。 */
  review(input: ReviewInput): Promise<ReviewDraft>;
}
```

### 1.5 端口 `ReviewRepository`（`domain/port/ReviewRepository.ts`）

```ts
export interface ReviewQueryFilter {
  collectionId?: string;
  source?: SourceId;
  limit?: number;
  before?: string;     // createdAt 游标（ISO），信息流分页
}

export interface ReviewRepository {
  upsert(review: Review): void;                       // 按 sessionId 覆盖最新一条
  findBySession(sessionId: string): Review | null;
  /** 已评审且 contentHash 命中的 sessionId 集合（例行时跳过未变化的）。 */
  reviewedHashes(): Map<string, string>;              // sessionId -> contentHash
  queryFeed(filter: ReviewQueryFilter): Review[];     // createdAt 降序
  findById(id: string): Review | null;
  /** 周期汇总所需：区间内所有 review（按 createdAt）。 */
  queryByDateRange(from: string, to: string): Review[];
}
```

幂等策略：一个 session 只保留**最新**一条 review（`upsert` 按 `sessionId` 覆盖）。是否需要重评由
`contentHash` 判断——见 §3.2。

### 1.6 领域服务

- `ReviewInputBuilder`（`domain/service/`）：`build(session, events): ReviewInput`；负责裁剪超长 trace
  （保留结构：user/assistant 文本、tool_call 名+关键入参、tool_result 是否 error + 截断输出、thinking 摘要），
  控制 token。裁剪规则是领域知识，放这里。
- `ReviewParser`：`toReview(draft, ctx): Review`；校验 score∈[1,5]、category/severity 枚举、字段非空，
  归一 evidence 序号，生成 id/createdAt。非法输出抛错（→ failed Review）。
- `SummaryAggregator`：`aggregate(period, from, to, reviews): PeriodicSummary`；确定性归并。

`domain/index.ts` 追加导出这些模型/端口/服务。

---

## 2. 表结构（SQLite，复用同一个 `Database`）

```sql
CREATE TABLE IF NOT EXISTS review (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL UNIQUE,     -- 一 session 一条最新
  collection_id TEXT NOT NULL,
  source        TEXT NOT NULL,
  model         TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  status        TEXT NOT NULL,            -- 'done' | 'failed'
  score         INTEGER NOT NULL,
  summary       TEXT NOT NULL,
  findings_json TEXT NOT NULL,            -- Finding[] 序列化
  error         TEXT,
  created_at    TEXT NOT NULL             -- ISO
);
CREATE INDEX IF NOT EXISTS idx_review_created ON review(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_collection ON review(collection_id);

CREATE TABLE IF NOT EXISTS periodic_summary (
  period       TEXT NOT NULL,             -- 'week' | 'month'
  from_date    TEXT NOT NULL,
  to_date      TEXT NOT NULL,
  reviewed     INTEGER NOT NULL,
  avg_score    REAL NOT NULL,
  issues_json  TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (period, from_date)
);
```

`SqliteReviewRepository` 构造注入 `Database`（与 `SqliteSessionRepository` 一致），`CREATE TABLE IF NOT EXISTS`
在构造时执行；findings 以 JSON 存取。周期汇总可只算不落库（实时聚合），初版先**不建 periodic_summary 落库**、
按需实时算——保留表定义但延后；避免过度设计。→ **决定：周期汇总实时算，不落库**，删掉上面第二张表，
仅保留 `review` 表。

---

## 3. application：`ReviewService`

```ts
class ReviewService {
  constructor(
    private query: SessionQueryService,     // 复用 loadDetail 拿聚合+events
    private reviewer: Reviewer,
    private repo: ReviewRepository,
  ) {}

  async reviewSession(sessionId): Promise<Review>        // 手动/单个
  async runRoutine(now?: Date): Promise<number>          // 例行批量，返回新评审数
  queryFeed(filter): Review[]
  getById(id): Review | null
  getBySession(sessionId): Review | null
  summarize(period: SummaryPeriod, ref?: Date): PeriodicSummary   // 实时聚合
}
```

### 3.1 `reviewSession`

1. `query.loadDetail(sessionId)` → 聚合 + events；算 `contentHash`（对 events 规范化后 hash）。
2. `reviewer.isReady()` 为 false → 抛 `ReviewerNotReady`（api 返回 409 + 明确文案）。
3. `ReviewInputBuilder.build` → `reviewer.review` → `ReviewParser.toReview`；异常兜成 `Review.failed`。
4. `repo.upsert(review)`；返回。

### 3.2 `runRoutine`（例行，复用 DailyScheduler）

- 取所有 session meta（`query.queryMetas`），**只取 status=done**；
- 对每个算 `contentHash`，与 `repo.reviewedHashes()` 比对：无记录或 hash 变化 → 需要评审；
- 逐个 `reviewSession`（串行，控制并发与费用），可设单次上限（如每轮最多 N 条）；
- 返回新评审数。DailyScheduler 的回调里调用 `runRoutine`。

`contentHash`：对 `events` 取 `eventCount + lastEventAt + 首尾事件 id` 的轻量指纹即可（无需读全文哈希），
既能判「有没有新增」，又便宜。

### 3.3 `summarize`

按 period 推算 [from,to]（week=最近 7 天 / 自然周，month=最近 30 天；与 Stats 口径对齐用「最近 N 天」），
`repo.queryByDateRange` → `SummaryAggregator.aggregate`。

---

## 4. infra

### 4.1 `AnthropicApiReviewer`（`infra/reviewer/AnthropicApiReviewer.ts`）

- 依赖 `@anthropic-ai/sdk`（新增依赖）。
- 构造：`new AnthropicApiReviewer({ apiKey: env.ANTHROPIC_API_KEY, model: env.REVIEW_MODEL ?? 'claude-opus-4-8' })`。
- `isReady()` = 有非空 apiKey。
- `review()`：system 提示 = 评审 rubric（§需求 2.2 两类维度 + 输出 JSON schema 约束），
  user = `ReviewInputBuilder` 产出的裁剪文本；用 tool/JSON 模式强制结构化输出；解析成 `ReviewDraft`。
- 网络/解析异常直接抛，由 service 兜 failed。
- 单测用**假 Reviewer**（返回固定 draft）验证 service/parser，不打真实网络。

### 4.2 `SqliteReviewRepository`（`infra/persistence/`）

按 §1.5 端口实现；风格对齐 `SqliteSessionRepository`（预编译语句、JSON 列、构造注入 Database、`close()`）。

### 4.3 composition root（`main.ts`）

```ts
const reviewer = new AnthropicApiReviewer({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.REVIEW_MODEL,
});
const reviewRepo = new SqliteReviewRepository(db);
const reviews = new ReviewService(query, reviewer, reviewRepo);

// 例行：并入 DailyScheduler 的每日回调（stats.rebuildDay 之后）
const scheduler = new DailyScheduler(async (yesterday) => {
  await stats.rebuildDay(yesterday);
  await reviews.runRoutine();
});

await registerReviewRoutes(app, { reviews });
```

无 API key 时 `reviewer.isReady()`=false：例行 `runRoutine` 空跑（跳过），手动触发返回 409。启动日志提示。

---

## 5. api + shared DTO

### 5.1 shared 新增

```ts
export type FindingCategory = 'agent' | 'prompt';
export type Severity = 'high' | 'medium' | 'low';

export interface FindingDTO {
  category: FindingCategory; severity: Severity;
  title: string; detail: string; suggestion: string;
  evidenceEventIndexes: number[];
}

export interface ReviewDTO {
  id: string; sessionId: string; collectionId: string;
  source: SourceId; model: string;
  status: 'done' | 'failed';
  score: number; summary: string;
  counts: { agent: number; prompt: number };
  findings: FindingDTO[];
  error: string | null;
  createdAt: string;
}

// 信息流：轻量行 + 游标
export interface ReviewRowDTO {
  id: string; sessionId: string; sessionTitle: string;
  collectionId: string; source: SourceId;
  score: number; summary: string;
  counts: { agent: number; prompt: number };
  topSeverity: Severity | null;
  status: 'done' | 'failed';
  createdAt: string;
}
export interface ReviewFeedDTO { rows: ReviewRowDTO[]; nextCursor: string | null; }

export interface RecurringIssueDTO { category: FindingCategory; title: string; count: number; exampleSessionId: string; }
export interface PeriodicSummaryDTO {
  period: 'week' | 'month'; from: string; to: string;
  reviewedCount: number; avgScore: number; topIssues: RecurringIssueDTO[];
}
```

api 层负责把 `Review`（含 sessionTitle 需 join meta）映射成 DTO；domain 实体不外泄。

### 5.2 路由（`api/routes/reviewRoutes.ts`）

| Method | Path | 说明 |
|---|---|---|
| GET | `/reviews` | 信息流分页；query：`collectionId?` `source?` `limit?` `before?` → `ReviewFeedDTO` |
| GET | `/reviews/:id` | 单条详情 → `ReviewDTO` |
| GET | `/reviews/by-session/:sessionId` | 该 session 的最新评审（无则 404）→ `ReviewDTO` |
| POST | `/reviews` | body `{ sessionId }` 手动触发；未就绪 409 → `ReviewDTO` |
| GET | `/reviews/summary` | query `period=week\|month` → `PeriodicSummaryDTO` |

---

## 6. 前端

### 6.1 组件树（`packages/web/src`）

```
App.tsx                      顶层：SideNav + 当前板块路由（本地 state，无需 router）
├─ SideNav.tsx               左侧带标签导航栏（logo / 分组 / 主题切换）
├─ views/TraceView.tsx       现有两栏（collections 树 ↔ TranscriptViewer）抽出为一个 view
├─ views/StatsView.tsx       现有 StatsView 挪入
└─ views/ReviewsView.tsx     新：信息流 + 详情
   ├─ ReviewFeed.tsx         时间线 + ReviewCard 列表 + 分页
   ├─ ReviewCard.tsx         一行卡片（评分圆点/标题/摘要/finding chips/建议块）
   ├─ ReviewDetail.tsx       详情面板：findings 分组 + 建议 + evidence 跳回 Trace
   └─ PeriodicSummaryCard.tsx 置顶周期汇总（week/month 切换）
```

- App 用一个 `view: 'trace'|'stats'|'reviews'` state 驱动；现有 App 的两栏逻辑下沉到 `TraceView`。
- evidence 跳回：点击 → 切到 trace view + 定位该 session + 高亮对应事件（复用现有 minimap/滚动）。
- Reviews 数据用轮询（与现有列表一致，10s 级）；手动触发后乐观刷新该行。

### 6.2 色彩 token（`styles.css`，新增 CSS 变量，明暗两套）

```css
:root {              /* 亮色（Anthropic 暖白 + 珊瑚） */
  --accent: #CC785C;
  --accent-soft: rgba(204,120,92,0.12);
  --bg: #FAF9F5;
  --surface: #FFFFFF;
  --border: #E8E5DE;
  --text: #1F1E1D;
  --text-muted: #6B6B6B;
  --radius-card: 12px;
  --radius-pill: 999px;
  --shadow-card: 0 1px 2px rgba(31,30,29,0.05);
  /* 状态色（独立于 accent） */
  --sev-high: #C0392B; --sev-medium: #D9822B; --sev-low: #7A8B99;
  --score-good: #2E7D5B; --score-bad: #C0392B;
}
[data-theme='dark'] { /* 深色对应值，设计时定 */ }
```

- 评分圆点：score 4–5 用 `--score-good`，1–2 用 `--score-bad`，3 用中性；与 `--accent` 区分。
- 沿用现有 `useTheme`；将现有硬编码色逐步迁到变量（不做大范围重构，够用即可）。

### 6.3 SideNav 视觉

- 宽 ~240px；顶部 logo（文字即可）；分组标题小字灰（「内容」）；
- 导航项：图标+文字，选中 = `--accent` 文字 + `--accent-soft` 底 + 8px 圆角；
- 底部主题切换（复用现有）。

---

## 7. 测试计划

- domain：`Review`（分组/计数/topSeverity/failed）、`ReviewParser`（越界/枚举/缺字段→抛错）、
  `SummaryAggregator`（归并计数）。纯函数，零框架。
- infra：`SqliteReviewRepository`（upsert 覆盖同 session、queryFeed 降序+游标、reviewedHashes、
  queryByDateRange）用 `:memory:`。
- application：`ReviewService` 用**假 Reviewer**（固定 draft / 抛错 / isReady=false 三种）验证
  reviewSession/runRoutine（跳过未变化）/summarize。
- 不打真实 Anthropic 网络；`AnthropicApiReviewer` 只做 `isReady` 与提示词组装的轻量单测。

---

## 8. 落地顺序（TaskCreate 拆分）

1. shared：新增 review 相关 DTO。
2. domain：Finding/Review/PeriodicSummary + Reviewer/ReviewRepository 端口 + 三个领域服务 + 导出 + 单测。
3. infra：SqliteReviewRepository（+测）、AnthropicApiReviewer（+假实现供测）。
4. application：ReviewService（+假 Reviewer 测），并入 DailyScheduler。
5. api：reviewRoutes + DTO 映射；main.ts 组合根接线；新增依赖 `@anthropic-ai/sdk`。
6. web：SideNav + 视图拆分（TraceView/StatsView/ReviewsView）+ 色彩 token。
7. web：ReviewFeed/Card/Detail/PeriodicSummary + evidence 跳回联动。
8. 文档：README 增补 Reviews 板块 + `ANTHROPIC_API_KEY`/`REVIEW_MODEL` 环境变量表。

---

## 9. 已确认的落地细节

1. **依赖**：引入官方 `@anthropic-ai/sdk`（结构化输出/重试/错误处理现成）。
2. **例行单轮上限**：每次 `runRoutine` 最多评审 **20** 条，余下下轮继续。
3. **裁剪预算**：`ReviewInputBuilder` 按事件数上限 + 单块截断控制输入规模，具体阈值实现时定。
4. **周期汇总不落库**：实时聚合（§2）。
