/**
 * FsTraceSource —— TraceSource 端口的实现（infra，反向依赖 domain）。
 *
 * 来源为本地文件系统下的若干根目录（如 ~/.claude/projects）。
 *   - scan: 递归发现 *.jsonl，每个文件即一个会话
 *   - collectionId: 取文件所在目录名（与 Claude 的工程目录约定一致）
 *   - tail: 按字节偏移增量读取，避免重读全文（实时刷新的基础）
 *   - watch: chokidar 监听 add/change，回调对应会话引用
 *
 * 换远程/对象存储只需另写一个 TraceSource 实现，上层不动。
 */

import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  AppendEvent,
  RawSessionRef,
  TailResult,
  TraceSource,
  Unsubscribe,
} from '../../domain/index.js';

export class FsTraceSource implements TraceSource {
  readonly id: string;
  private readonly roots: string[];

  constructor(id: string, roots: string[]) {
    this.id = id;
    this.roots = roots;
  }

  async scan(): Promise<RawSessionRef[]> {
    const refs: RawSessionRef[] = [];
    for (const root of this.roots) {
      await this.walk(root, refs);
    }
    return refs;
  }

  private async walk(dir: string, out: RawSessionRef[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // 根目录可能不存在，忽略
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, out);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push(this.toRef(full));
      }
    }
  }

  private toRef(filePath: string): RawSessionRef {
    return {
      sessionId: basename(filePath, '.jsonl'),
      collectionId: basename(dirname(filePath)),
      locator: filePath,
    };
  }

  async readHead(ref: RawSessionRef, maxLines: number): Promise<string[]> {
    const lines = await this.readAll(ref);
    return lines.slice(0, maxLines);
  }

  async readAll(ref: RawSessionRef): Promise<string[]> {
    const content = await readFile(ref.locator, 'utf8');
    return content.split('\n').filter((l) => l.length > 0);
  }

  async currentOffset(ref: RawSessionRef): Promise<number> {
    try {
      const s = await stat(ref.locator);
      return s.size;
    } catch {
      return 0;
    }
  }

  async lastModified(ref: RawSessionRef): Promise<Date | null> {
    try {
      const s = await stat(ref.locator);
      return s.mtime;
    } catch {
      return null;
    }
  }

  /**
   * 从字节偏移增量读取，按完整行切分。
   * 若读到的尾部不是完整行（无换行结尾），保留该残行不返回，
   * newOffset 回退到最后一个换行处，确保下次从完整行开始。
   */
  async tail(ref: RawSessionRef, fromOffset: number): Promise<TailResult> {
    const size = await this.currentOffset(ref);
    if (size <= fromOffset) {
      return { lines: [], newOffset: fromOffset };
    }
    const chunk = await this.readRange(ref.locator, fromOffset, size - 1);
    const lastNl = chunk.lastIndexOf('\n');
    if (lastNl === -1) {
      // 尚无完整行，等待更多数据
      return { lines: [], newOffset: fromOffset };
    }
    const complete = chunk.slice(0, lastNl);
    const consumedBytes = Buffer.byteLength(complete, 'utf8') + 1; // +1 换行
    const lines = complete.split('\n').filter((l) => l.length > 0);
    return { lines, newOffset: fromOffset + consumedBytes };
  }

  private readRange(filePath: string, start: number, end: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(filePath, { start, end });
      stream.on('data', (c) => chunks.push(c as Buffer));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
  }

  watch(onAppend: (e: AppendEvent) => void): Unsubscribe {
    const watcher: FSWatcher = chokidar.watch(this.roots, {
      persistent: true,
      ignoreInitial: true,
      depth: 10,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });
    const emit = (filePath: string) => {
      if (!filePath.endsWith('.jsonl')) return;
      onAppend({ ref: this.toRef(filePath) });
    };
    watcher.on('add', emit);
    watcher.on('change', emit);
    return () => {
      void watcher.close();
    };
  }
}
