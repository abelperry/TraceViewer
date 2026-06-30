/**
 * TraceSource —— 领域端口（Port）。
 *
 * 原始 trace「来源」的抽象：发现有哪些会话、读取全文、增量 tail、监听追加。
 * 接口在 domain，实现（本地文件系统/远程/对象存储）在 infra，反向依赖本接口。
 *
 * 增量读取以「字节偏移」为游标，避免每次重读全文——这是实时刷新的基础。
 */

import type { RawSessionRef } from './SourceAdapter.js';

export interface TailResult {
  /** 自 fromOffset 之后新读到的整行（已按行切分，去除行尾换行）。 */
  lines: string[];
  /** 读取后的新偏移，下次从此继续。 */
  newOffset: number;
}

export interface AppendEvent {
  ref: RawSessionRef;
}

export type Unsubscribe = () => void;

export interface TraceSource {
  /** 来源标识，对应某种格式/根目录。 */
  readonly id: string;

  /** 发现当前所有会话引用。 */
  scan(): Promise<RawSessionRef[]>;

  /** 读取文件头若干行（供 adapter.detect 使用）。 */
  readHead(ref: RawSessionRef, maxLines: number): Promise<string[]>;

  /** 读取全文行。 */
  readAll(ref: RawSessionRef): Promise<string[]>;

  /** 当前文件字节大小（作为初始偏移）。 */
  currentOffset(ref: RawSessionRef): Promise<number>;

  /** 文件最后修改时间（mtime），用作实时活动信号。无法获取返回 null。 */
  lastModified(ref: RawSessionRef): Promise<Date | null>;

  /** 从给定偏移增量读取。 */
  tail(ref: RawSessionRef, fromOffset: number): Promise<TailResult>;

  /** 监听追加/新增会话，回调被触发的会话引用。 */
  watch(onAppend: (e: AppendEvent) => void): Unsubscribe;

  /** 监听单个文件的变化（按需轮询，用于实时查看某会话）。 */
  watchFile(ref: RawSessionRef, onChange: () => void): Unsubscribe;
}
