# 需求：Trace Review（评审）+ 导航/视觉重构

> 状态：需求对齐中。达成一致后再写设计文档与代码。
> 关键决策已定：可插拔 Reviewer 端口（默认 API·opus）· 例行+手动触发 · session 评审 + 周期汇总 ·
> 左侧带标签导航栏 · 布局参考 aihot.virxact.com · 强调色用 Anthropic 珊瑚/陶土色。

---

## 一、背景与目标

人们每天用 Claude Code / Codex，却不知道 agent 到底表现得怎么样、自己的 prompt 是否给到位。
现有工具只能「看」trace，本次要让它能「评」trace：由一个 LLM 评审者自动审阅每次 run，指出
**agent 的不足**与**人类 prompt 的不足**，并给出可操作建议，用信息流的形式按时间呈现。

同时，随着板块从 2 个（Trace / Stats）增加到 3 个（+ Reviews），当前那个不起眼的布局切换必须重做成
清晰、统一、简约的导航（Anthropic 风格）。

---

## 二、需求一：Trace Review

### 2.1 评审对象与产出粒度

两级产出：

1. **Session 评审（主）**——信息流的每一行 = 一个 session 的评审结果。
2. **周期汇总（次）**——本周 / 本月的趋势汇总：反复出现的 prompt 问题、agent 高频弱点、被评审
   session 数与总体走势。用于回答「我最近用得怎么样」。

### 2.2 一次 Session 评审包含什么

- **总体评价**：一个总体质量分（建议 1–5 或 A–D 档，见待定项）+ 一句话摘要（信息流那一行显示它）。
- **findings（问题列表）**，每条：
  - `category`：`agent`（agent 不足）| `prompt`（人类 prompt 不足）
  - `severity`：high / medium / low
  - `title`：一句话问题
  - `detail`：展开说明
  - `evidence`：指向 trace 中的事件（可点回原文对应位置）——尽力而为，拿不到就省略
- **suggestions（建议）**：可操作的改进项（例如「下次先明确验收标准」「工具调用前先读现有实现，避免重复」）。

评审维度（喂给评审者的 rubric，初版建议）：

- agent 侧：是否正确理解任务 / 工具使用是否高效（重复读同一文件、无效命令、走弯路）/
  是否有幻觉或未验证即声称完成 / 是否忽略错误信号 / 自主程度是否得当。
- prompt 侧：需求是否清晰 / 是否缺少必要上下文与约束 / 目标是否可验证 / 是否频繁改需求或打断。

### 2.3 触发方式（例行 + 手动）

- **例行**：复用现有 `DailyScheduler` 模式，每日凌晨批量评审「昨日新完成、且尚未评审」的 session；
  之后重算 / 生成周期汇总。
- **手动**：在某个 session 页面点「立即评审」，同步触发一次并很快出结果。
- **幂等与省钱**：以 `sessionId + 内容哈希` 为键；session 未变化不重复评审。可设最小规模阈值
  （太短的 session 跳过例行，手动仍可）。

### 2.4 评审者如何调用模型（可插拔端口，默认 API）

- domain 定义 `Reviewer` 端口：`review(session) -> ReviewResult`。这是「如何评审一次 run」的抽象。
- infra 提供实现，默认 `AnthropicApiReviewer`（读 `ANTHROPIC_API_KEY`，模型可配 `REVIEW_MODEL`，
  默认建议 sonnet）。后续可加 `ClaudeCliReviewer` / 本地模型实现，application/api/web 零改动
  ——与现有 SourceAdapter 的扩展方式一致。
- 无 key 时：Reviews 板块正常显示历史结果，新评审给出「未配置评审者」的明确提示，不报错崩溃。

### 2.5 呈现（信息流 + 详情）

- **Reviews 板块** = 信息流，按时间由近及远，一行一个 session 评审：
  - 左侧色块（按总体分/最高 severity 着色，呼应 trace 里 error 红块的语言）
  - session 标题 · collection · 来源（claude-code / codex）· 时间
  - 一句话摘要 + finding 计数 chip（如 `agent 2` / `prompt 1`）
- **点进去**：详情面板，findings 按 category 分组展示，附建议；evidence 可跳回该 trace 对应位置。
- **周期汇总**：置顶卡片或 Reviews 内的子视图（本周/本月），展示高频问题与趋势。

### 2.6 领域模型草图（DDD，落地细节留给设计文档）

- 新增 `review` 领域：
  - 聚合/值对象：`Review`（一次 session 评审）、`Finding`（值对象）、`PeriodicSummary`（周期汇总）。
  - 端口：`Reviewer`（domain，infra 反向实现，默认 API）、`ReviewRepository`（domain，infra 用 SQLite 实现）。
  - 领域服务：把 session 聚合 + rubric 组织成评审输入、把模型输出校验/归一成 `Review`。
- application：`ReviewService`（triggerReview / 批量例行 / 生成周期汇总 / 查询信息流）。
- infra：`AnthropicApiReviewer`、`SqliteReviewRepository`（新表 `review` / `periodic_summary`，
  findings 以 JSON 存）、复用 `DailyScheduler`。
- api：`GET /reviews`（信息流分页）、`GET /reviews/:id`、`POST /reviews`（手动触发某 session）、
  `GET /reviews/summary?period=week|month`。
- 依赖方向不变：`api → application → domain ← infra`；review 是**派生数据**，JSONL trace 仍是唯一真相源。

---

## 三、需求二：导航与视觉重构

**布局**参考 https://aihot.virxact.com/ ——干净、内容优先、克制留白、feed 卡片语言；
**强调色**用 Anthropic 珊瑚/陶土色（`#CC785C`），底色走 Anthropic 暖白。

### 3.1 结构：带标签的左侧栏（非纯图标 rail）

采用参考站的**带标签左侧导航栏**（比 56px 纯图标 rail 更清晰），约 220–280px：

- 顶部：logo。
- 分组导航（选中项：teal 文字 + 10% teal 底色 + 8px 圆角）：
  - **内容**：Trace（会话浏览）· Stats（用量统计）· Reviews（评审）
  - 后续可扩展分组（如「关于 / 反馈」）。
- 底部：明暗主题切换（沿用 `useTheme`）。

右侧是当前板块内容：

- Trace：保留现有「collections 树 ↔ transcript」两栏。
- Stats：token 热力图，占满右侧。
- Reviews：评审信息流 + 详情。

移除现在那个不起眼的切换控件，改由左侧栏承担一级导航。

### 3.2 色彩与组件 token

**强调色用 Anthropic 珊瑚/陶土色**（不用参考站的 teal），底色走 Anthropic 暖白；
布局、圆角、阴影、feed 结构仍参考 aihot.virxact.com。

| 用途 | 值 |
|---|---|
| 强调色 coral | `#CC785C`（Anthropic 陶土色；选中态、主按钮、关键色块） |
| 选中态底色 | `rgba(204,120,92,0.12)` |
| 正文/标题 | `#1F1E1D`（近黑） |
| 次要文字 | `#6B6B6B`（灰） |
| 页面背景 | Anthropic 暖白 `#FAF9F5` |
| 卡片背景 | `#FFFFFF` |
| 边框 | `#E8E5DE`（暖灰） |
| 卡片圆角 / pill | `12px` / `999px`；导航项 `8px` |
| 阴影 | 极轻 `rgba(31,30,29,0.05) 0 1px 2px` |
| 字体 | system-ui 栈（`-apple-system, PingFang SC, Segoe UI, …`） |

明暗两套主题在设计文档里定完整 token（可借 dataviz skill 保证明暗一致）。评分/severity 的红/绿状态色
独立于强调色，避免珊瑚色与「低分暖红」混淆。

### 3.3 Reviews 信息流直接复用参考站的 feed 卡片语言

参考站的 feed 卡片与我们的 Review 天然对应，直接借用其视觉语言：

- **时间线**：左侧时间戳 + 竖线圆点连接，按日期分组（呼应参考站「7月23日 · 12 条」）。
- **每张卡片**：来源名（大写小字灰）· 来源标签 chip · 右上角**总体分**（1–5，配色圆点）+ 书签图标；
  加粗标题（= 一句话摘要）；正文摘要（灰）；**finding chips**（`#agent` / `#prompt`，对应参考站的
  `#开源/仓库` 标签）；虚线分隔；底部 teal 微底色的**「评审建议」高亮块**（对应参考站「推荐理由」）。
- **点进卡片**：详情面板，findings 按 category 分组 + 建议 + evidence 回跳。
- **周期汇总**：置顶卡片（对应参考站「当前热点 TOP 5」那个盒子），展示本周/本月高频问题与趋势。

---

## 四、已确认的决策

1. **总体评分刻度**：**1–5 分**，配合颜色（低分暖红、高分中性/绿），信息流可按分排序。
2. **默认评审模型**：**`claude-opus`**（质量优先）；`REVIEW_MODEL` 环境变量可覆盖为 sonnet/haiku。
3. **周期汇总周期**：**周 / 月**都支持，与 Stats 的 7d/30d/all 呼应。
4. **例行评审范围**：**只评已完成的 session**；running 的等它结束后再评。
5. **evidence 回跳**：**尽力而为**——模型给出事件序号即可跳回；拿不到只展示文字。

---

## 五、非目标（本轮不做）

- 不做多用户 / 权限 / 云端同步（仍是本地单用户）。
- 不做评审结果的人工批注 / 反馈闭环（后续可加）。
- 不改动 trace 解析与 live refresh 既有能力。

---

## 六、落地顺序（达成一致后）

1. 写设计文档（domain 模型、端口签名、表结构、API/DTO、UI 组件与色彩 token）。
2. 后端：review 领域 + Reviewer(API) + 仓储 + Service + 调度 + 路由（含测试）。
3. 前端：rail 导航 + 视觉重构 + Reviews 信息流/详情 + 周期汇总。
4. 文档：README 增补 Reviews 板块与 `ANTHROPIC_API_KEY` / `REVIEW_MODEL` 环境变量。
