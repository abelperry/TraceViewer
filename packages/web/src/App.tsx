import { useEffect, useMemo, useState } from 'react';
import type { CollectionDTO, SessionMetaDTO } from '@trace-review/shared';
import { api } from './api';
import { TranscriptViewer } from './TranscriptViewer';
import { ColResizer } from './ColResizer';
import { useTheme } from './useTheme';
import './styles.css';

const DEFAULT_VISIBLE = 5;

function collName(id: string): string {
  return id.replace(/^-/, '').replace(/-/g, '/');
}

/** 弱信息路径段：去重时跳过，不作为标签主体。 */
const NOISE_SEG = /^(gen\d+|extracted|uploads?|[0-9a-f-]{8,})$/i;

/**
 * 为一组 collection 计算可辨识的短标签。
 * 标签主体取「最深的有信息段」（跳过 hash/gen0/extracted 等噪声）；
 * 若仍重复，向上找最近的、能区分的有信息祖先段作前缀（用 ›）。
 */
function buildLabels(ids: string[]): Map<string, string> {
  // 每个 id 的有信息段序列（保留原序）
  const meaningful = new Map<string, string[]>();
  for (const id of ids) {
    const segs = collName(id).split('/').filter(Boolean);
    const kept = segs.filter((s) => !NOISE_SEG.test(s));
    meaningful.set(id, kept.length ? kept : segs); // 全是噪声则退回原段
  }

  const labelAt = (id: string, depth: number): string => {
    const p = meaningful.get(id)!;
    const tail = p.slice(Math.max(0, p.length - depth));
    return tail.join(' › ');
  };

  const labels = new Map<string, string>();
  let pending = [...ids];
  let depth = 1;
  while (pending.length > 0 && depth <= 6) {
    const buckets = new Map<string, string[]>();
    for (const id of pending) {
      const t = labelAt(id, depth);
      const arr = buckets.get(t);
      if (arr) arr.push(id);
      else buckets.set(t, [id]);
    }
    const next: string[] = [];
    for (const [tail, group] of buckets) {
      if (group.length === 1) labels.set(group[0]!, tail);
      else {
        const canDeepen = group.some((id) => meaningful.get(id)!.length > depth);
        if (canDeepen) next.push(...group);
        else group.forEach((id) => labels.set(id, tail));
      }
    }
    pending = next;
    depth++;
  }
  for (const id of pending) labels.set(id, collName(id));
  return labels;
}

function relTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

function usePersistedWidth(key: string, initial: number) {
  const [w, setW] = useState<number>(() => {
    const saved = localStorage.getItem(key);
    return saved ? Number(saved) : initial;
  });
  useEffect(() => {
    localStorage.setItem(key, String(w));
  }, [key, w]);
  return [w, setW] as const;
}

interface CollGroup {
  collection: CollectionDTO;
  sessions: SessionMetaDTO[];
}

export function App() {
  const [collections, setCollections] = useState<CollectionDTO[]>([]);
  const [sessions, setSessions] = useState<SessionMetaDTO[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [navW, setNavW] = usePersistedWidth('tr.navW', 300);
  const [theme, toggleTheme] = useTheme();
  // 展开的 collection 集合；每个 collection 是否“显示全部”
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = () => api.collections().then(setCollections).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const load = () =>
      api
        .sessions({ keyword: keyword || undefined, limit: 2000 })
        .then(setSessions)
        .catch(() => {});
    load();
    const t = setInterval(load, 4_000);
    return () => clearInterval(t);
  }, [keyword]);

  // 按 collection 分组；组内已由后端按时间倒序返回
  const groups = useMemo<CollGroup[]>(() => {
    const byColl = new Map<string, SessionMetaDTO[]>();
    for (const s of sessions) {
      const arr = byColl.get(s.collectionId) ?? [];
      arr.push(s);
      byColl.set(s.collectionId, arr);
    }
    return collections
      .map((c) => ({ collection: c, sessions: byColl.get(c.id) ?? [] }))
      .filter((g) => g.sessions.length > 0);
  }, [collections, sessions]);

  // 组内可辨识短标签（重名自动补父级路径段）
  const labels = useMemo(
    () => buildLabels(groups.map((g) => g.collection.id)),
    [groups],
  );

  // 搜索时自动展开所有有结果的 collection
  useEffect(() => {
    if (keyword) setExpanded(new Set(groups.map((g) => g.collection.id)));
  }, [keyword, groups]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleShowAll = (id: string) => {
    setShowAll((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const ownerCollection = activeSession
    ? sessions.find((s) => s.id === activeSession)?.collectionId ?? null
    : null;

  return (
    <div className="app">
      <div className="col-nav" style={{ width: navW }}>
        <div className="col-head">
          <span>Sessions</span>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <input
          className="search"
          placeholder="搜索标题 / cwd…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="col-scroll">
          {groups.map(({ collection, sessions: list }) => {
            const isOpen = expanded.has(collection.id);
            const all = showAll.has(collection.id);
            const visible = all ? list : list.slice(0, DEFAULT_VISIBLE);
            const hidden = list.length - visible.length;
            return (
              <div className="tree-group" key={collection.id}>
                <div
                  className={`tree-coll ${ownerCollection === collection.id ? 'owner' : ''}`}
                  onClick={() => toggleExpand(collection.id)}
                  title={collection.id}
                >
                  <span className={`twisty ${isOpen ? 'open' : ''}`}>▸</span>
                  <span className="coll-icon">🗂</span>
                  <span className="coll-name">{labels.get(collection.id) ?? collection.name}</span>
                  <span className="coll-count">{list.length}</span>
                </div>
                {isOpen && (
                  <div className="tree-children">
                    {visible.map((s) => (
                      <div
                        key={s.id}
                        className={`tree-session ${activeSession === s.id ? 'active' : ''}`}
                        onClick={() => setActiveSession(s.id)}
                        title={s.title}
                      >
                        <span className={`dot ${s.status}`} />
                        <span className="sess-title">{s.title}</span>
                        <span className="sess-time">{relTime(s.lastEventAt)}</span>
                      </div>
                    ))}
                    {hidden > 0 && (
                      <div className="show-more" onClick={() => toggleShowAll(collection.id)}>
                        show more（{hidden}）
                      </div>
                    )}
                    {all && list.length > DEFAULT_VISIBLE && (
                      <div className="show-more" onClick={() => toggleShowAll(collection.id)}>
                        收起
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {groups.length === 0 && <div className="empty">无会话</div>}
        </div>
        <ColResizer width={navW} setWidth={setNavW} min={220} max={520} />
      </div>

      <div className="col-viewer">
        <TranscriptViewer sessionId={activeSession} />
      </div>
    </div>
  );
}
