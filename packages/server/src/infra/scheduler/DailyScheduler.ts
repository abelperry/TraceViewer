/**
 * DailyScheduler —— 轻量自实现调度（infra）。
 *
 * 每隔一段时间检查本地日期是否跨过午夜；跨天则重算「昨天」并落库。
 * 零外部依赖（不引 node-cron），适合本地单用户。
 */

import { localDateKey } from '../../domain/index.js';

export class DailyScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastSeenDate: string;

  constructor(
    private readonly onNewDay: (yesterday: string) => Promise<void>,
    private readonly checkIntervalMs = 10 * 60_000, // 每 10 分钟检查
  ) {
    this.lastSeenDate = localDateKey(new Date());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.checkIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const today = localDateKey(new Date());
    if (today === this.lastSeenDate) return;
    const yesterday = this.lastSeenDate;
    this.lastSeenDate = today;
    void this.onNewDay(yesterday).catch(() => {});
  }
}
