import { useEffect, useMemo, useState } from 'react';
import type { DailyPointDTO, StatsDTO, StatsRange } from '@trace-review/shared';
import { api } from './api';

const RANGES: StatsRange[] = ['7d', '30d', 'all'];

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/** 把每日点补齐成连续日期（缺失日补 0），并按周对齐成网格。 */
function buildGrid(days: DailyPointDTO[], from: string, to: string) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const cells: DailyPointDTO[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    cells.push(byDate.get(key) ?? { date: key, sessionCount: 0, messageCount: 0, totalTokens: 0 });
  }
  // 前置空位，使第一列从周日开始对齐（getDay: 0=Sun）
  const pad = new Date(`${cells[0]?.date ?? from}T00:00:00`).getDay();
  const weeks = Math.ceil((pad + cells.length) / 7);
  return { cells, pad, weeks };
}

export function StatsView() {
  const [range, setRange] = useState<StatsRange>('30d');
  const [data, setData] = useState<StatsDTO | null>(null);

  useEffect(() => {
    api.stats(range).then(setData).catch(() => setData(null));
  }, [range]);

  const grid = useMemo(
    () => (data ? buildGrid(data.days, data.from, data.to) : null),
    [data],
  );
  const max = useMemo(
    () => (data ? Math.max(1, ...data.days.map((d) => d.totalTokens)) : 1),
    [data],
  );

  if (!data) return <div className="empty">加载中…</div>;

  const level = (v: number): number => {
    if (v <= 0) return 0;
    const r = v / max;
    if (r > 0.66) return 4;
    if (r > 0.33) return 3;
    if (r > 0.1) return 2;
    return 1;
  };

  return (
    <div className="stats">
      <div className="stats-toolbar">
        <div className="stats-title">Token usage</div>
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {r === 'all' ? 'All' : r}
            </button>
          ))}
        </div>
      </div>

      <div className="stat-cards">
        <div className="stat-card">
          <div className="sc-label">Sessions</div>
          <div className="sc-value">{fmt(data.summary.sessions)}</div>
        </div>
        <div className="stat-card">
          <div className="sc-label">Messages</div>
          <div className="sc-value">{fmt(data.summary.messages)}</div>
        </div>
        <div className="stat-card">
          <div className="sc-label">Total tokens</div>
          <div className="sc-value">{fmt(data.summary.totalTokens)}</div>
        </div>
        <div className="stat-card">
          <div className="sc-label">Active days</div>
          <div className="sc-value">{data.summary.activeDays}</div>
        </div>
      </div>

      {grid && (
        <div className="heatmap">
          <div
            className="heat-grid"
            style={{ ['--heat-cols' as string]: String(grid.weeks) }}
          >
            {Array.from({ length: grid.pad }).map((_, i) => (
              <div key={`pad${i}`} className="heat-cell pad" />
            ))}
            {grid.cells.map((c) => {
              const v = c.totalTokens;
              return (
                <div
                  key={c.date}
                  className={`heat-cell lvl${level(v)}`}
                  title={`${c.date} · Tokens: ${fmt(v)}`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
