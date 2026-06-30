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
