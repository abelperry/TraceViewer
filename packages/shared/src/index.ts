/**
 * 传输用 DTO（贫血结构）。
 *
 * 这些类型是前后端的契约面：后端 api 层把 domain 充血实体映射成这些扁平结构，
 * 前端直接消费。domain 实体不会出现在这里。
 */

export type SourceId = 'claude-code' | 'codex' | (string & {});

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type SessionStatus = 'running' | 'done';

export type BlockType =
  | 'text'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'image';

export interface TextBlockDTO {
  type: 'text';
  text: string;
}

export interface ThinkingBlockDTO {
  type: 'thinking';
  text: string;
}

export interface ToolCallBlockDTO {
  type: 'tool_call';
  callId: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlockDTO {
  type: 'tool_result';
  callId: string;
  output: string;
  isError: boolean;
}

export interface ImageBlockDTO {
  type: 'image';
  /** 媒体类型，如 image/png */
  mediaType?: string;
  /** 可直接用于 <img src> 的 data URL（base64）。无数据时为 null。 */
  dataUrl: string | null;
}

export type BlockDTO =
  | TextBlockDTO
  | ThinkingBlockDTO
  | ToolCallBlockDTO
  | ToolResultBlockDTO
  | ImageBlockDTO;

export interface EventDTO {
  id: string;
  parentId: string | null;
  sessionId: string;
  role: Role;
  /** ISO 8601 */
  timestamp: string | null;
  isSidechain: boolean;
  blocks: BlockDTO[];
}

export interface TokenUsageDTO {
  input: number;
  output: number;
  total: number;
}

/** 列表/搜索用的轻量元数据 */
export interface SessionMetaDTO {
  id: string;
  source: SourceId;
  collectionId: string;
  title: string;
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
  status: SessionStatus;
  startedAt: string | null;
  lastEventAt: string | null;
  eventCount: number;
}

/** 打开一个 session 时返回的全文 */
export interface SessionDetailDTO {
  meta: SessionMetaDTO;
  tokenUsage: TokenUsageDTO;
  events: EventDTO[];
}

export interface CollectionDTO {
  id: string;
  name: string;
  sources: SourceId[];
  rootPath: string;
  sessionCount: number;
}

/** SSE 增量推送的载荷 */
export interface StreamPatchDTO {
  sessionId: string;
  /** 新追加的事件 */
  events: EventDTO[];
  /** 元数据变化（状态、计数、token 等） */
  metaPatch: Partial<SessionMetaDTO> & { tokenUsage?: TokenUsageDTO };
}

export type StatsRange = '7d' | '30d' | 'all';

/** 某一天的用量（已跨 source/model 折叠） */
export interface DailyPointDTO {
  date: string;
  sessionCount: number;
  messageCount: number;
  totalTokens: number;
}

export interface StatsDTO {
  range: StatsRange;
  /** 区间起止（YYYY-MM-DD，闭区间） */
  from: string;
  to: string;
  days: DailyPointDTO[];
  summary: {
    sessions: number;
    messages: number;
    totalTokens: number;
    activeDays: number;
  };
}

// ────────────────────────────── Review（评审） ──────────────────────────────

/** 问题归属：agent 不足 | 人类 prompt 不足 */
export type FindingCategory = 'agent' | 'prompt';

/** 问题严重度 */
export type Severity = 'high' | 'medium' | 'low';

/** 评审状态：done 正常 | failed 评审过程出错 */
export type ReviewStatus = 'done' | 'failed';

/** 周期汇总口径 */
export type SummaryPeriod = 'week' | 'month';

export interface FindingDTO {
  category: FindingCategory;
  severity: Severity;
  /** 一句话问题 */
  title: string;
  /** 展开说明 */
  detail: string;
  /** 针对本条的可操作建议 */
  suggestion: string;
  /** 证据事件序号（events 的 index），拿不到为空 */
  evidenceEventIndexes: number[];
}

/**
 * 评审所指向的会话身份（由 api 层 join SessionMeta 补入）。
 *
 * 评审是派生数据，光有 sessionId 人看不出「这是哪个 trace」；这里带上定位所需的
 * 最小信息：项目（collectionId）、标题、真实运行时间、规模、分支。
 * 会话已被删除时为 null。
 */
export interface ReviewSessionRefDTO {
  id: string;
  title: string;
  collectionId: string;
  cwd: string | null;
  gitBranch: string | null;
  /** 会话开始时间（ISO 8601）——注意与 review.createdAt（何时评审）区分 */
  startedAt: string | null;
  lastEventAt: string | null;
  eventCount: number;
  status: SessionStatus;
}

/** 单条评审详情 */
export interface ReviewDTO {
  id: string;
  sessionId: string;
  collectionId: string;
  source: SourceId;
  model: string;
  status: ReviewStatus;
  /** 1..5（failed 时为 0） */
  score: number;
  /** 一句话摘要 */
  summary: string;
  counts: { agent: number; prompt: number };
  findings: FindingDTO[];
  error: string | null;
  /** 评审发生的时间（≠ 会话运行时间，见 session.startedAt）。ISO 8601 */
  createdAt: string;
  /** 被评审会话的身份信息；会话已删除时为 null */
  session: ReviewSessionRefDTO | null;
  /**
   * 评审当时会话的事件总数。findings 的 evidenceEventIndexes 是那一刻的数组下标，
   * 若轨迹之后又增长，锚点就会错位——前端拿它和当前事件数比对来提示。
   * 0 = 未知（早于该字段的历史数据）。
   */
  reviewedEventCount: number;
}

/** 信息流轻量行 */
export interface ReviewRowDTO {
  id: string;
  sessionId: string;
  sessionTitle: string;
  collectionId: string;
  source: SourceId;
  score: number;
  summary: string;
  counts: { agent: number; prompt: number };
  topSeverity: Severity | null;
  status: ReviewStatus;
  /** 评审发生的时间（≠ 会话运行时间）。ISO 8601 */
  createdAt: string;
  /** 会话开始时间，信息流按它标注「这个 trace 是什么时候跑的」 */
  sessionStartedAt: string | null;
}

/** sessionId → 评审概览，供 Trace 会话树反向标记「已评审 / 几分」 */
export interface ReviewScoreDTO {
  score: number;
  status: ReviewStatus;
  reviewId: string;
}

/** 信息流分页结果（createdAt 降序 + 游标） */
export interface ReviewFeedDTO {
  rows: ReviewRowDTO[];
  /** 下一页游标（createdAt ISO），无更多为 null */
  nextCursor: string | null;
}

/** 周期汇总里的高频问题 */
export interface RecurringIssueDTO {
  category: FindingCategory;
  title: string;
  count: number;
  exampleSessionId: string;
}

/** 周期汇总（实时聚合，不落库） */
export interface PeriodicSummaryDTO {
  period: SummaryPeriod;
  /** YYYY-MM-DD 闭区间 */
  from: string;
  to: string;
  reviewedCount: number;
  avgScore: number;
  topIssues: RecurringIssueDTO[];
}
