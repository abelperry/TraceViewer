import { useEffect, useMemo, useState } from 'react';
import type { CollectionDTO, ReviewScoreDTO, SessionMetaDTO } from '@trace-review/shared';
import { api } from './api';
import { TranscriptViewer } from './TranscriptViewer';
import { ColResizer } from './ColResizer';
import { buildLabels } from './collectionLabel';
import { scoreClass } from './reviewScore';

const DEFAULT_VISIBLE = 5;

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

/**
 * Trace 视图：collection → session 两栏树导航 + 右侧轨迹查看器。
 * activeSession 由 App 持有，evidence 跳转可直接切到某会话某事件。
 */
export function TraceView({
  activeSession,
  onSelectSession,
  onOpenReview,
  jumpIndex = null,
  jumpToken = 0,
}: {
  activeSession: string | null;
  onSelectSession: (id: string) => void;
  /** 点会话行上的评审徽章：切到 Reviews 打开该条评审的详情页 */
  onOpenReview: (reviewId: string) => void;
  jumpIndex?: number | null;
  jumpToken?: number;
}) {
  const [collections, setCollections] = useState<CollectionDTO[]>([]);
  const [sessions, setSessions] = useState<SessionMetaDTO[]>([]);
  const [keyword, setKeyword] = useState('');
  const [navW, setNavW] = usePersistedWidth('tr.navW', 300);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [scores, setScores] = useState<Record<string, ReviewScoreDTO>>({});

  useEffect(() => {
    const load = () => api.collections().then(setCollections).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  // 评审分数：让会话树能直接看出「哪条 trace 已评审、几分」
  useEffect(() => {
    const load = () => api.reviewScores().then(setScores).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
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

  const labels = useMemo(
    () => buildLabels(groups.map((g) => g.collection.id)),
    [groups],
  );

  // 搜索时自动展开所有有结果的 collection
  useEffect(() => {
    if (keyword) setExpanded(new Set(groups.map((g) => g.collection.id)));
  }, [keyword, groups]);

  // 从评审跳来（evidence / 打开轨迹）时定位会话：展开其所属 collection；
  // 若它落在 show more 的折叠区里，一并展开全部，否则用户在树里看不到自己在哪。
  useEffect(() => {
    if (!activeSession) return;
    const owner = groups.find((g) => g.sessions.some((s) => s.id === activeSession));
    if (!owner) return;
    const cid = owner.collection.id;
    setExpanded((prev) => (prev.has(cid) ? prev : new Set(prev).add(cid)));
    if (owner.sessions.findIndex((s) => s.id === activeSession) >= DEFAULT_VISIBLE) {
      setShowAll((prev) => (prev.has(cid) ? prev : new Set(prev).add(cid)));
    }
  }, [activeSession, groups]);

  // 展开后把当前会话滚进可视区
  useEffect(() => {
    if (!activeSession) return;
    const t = setTimeout(() => {
      document
        .querySelector('.tree-session.active')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 60);
    return () => clearTimeout(t);
  }, [activeSession, expanded, showAll]);

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
    <div className="trace-view">
      <div className="col-nav" style={{ width: navW }}>
        <div className="col-head">
          <span className="col-title">Sessions</span>
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
                    {visible.map((s) => {
                      const rv = scores[s.id];
                      return (
                        <div
                          key={s.id}
                          className={`tree-session ${activeSession === s.id ? 'active' : ''}`}
                          onClick={() => onSelectSession(s.id)}
                          title={s.title}
                        >
                          <span className={`dot ${s.status}`} />
                          <span className="sess-title">{s.title}</span>
                          {rv && (
                            <span
                              className={`sess-score ${scoreClass(rv.score, rv.status)}`}
                              title={
                                rv.status === 'failed' ? '评审失败，点击查看' : `评审 ${rv.score} 分，点击查看`
                              }
                              onClick={(e) => {
                                e.stopPropagation(); // 别把点击当成"选中会话"
                                onOpenReview(rv.reviewId);
                              }}
                            >
                              {rv.status === 'failed' ? '!' : rv.score}
                            </span>
                          )}
                          <span className="sess-time">{relTime(s.lastEventAt)}</span>
                        </div>
                      );
                    })}
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
        <TranscriptViewer sessionId={activeSession} jumpIndex={jumpIndex} jumpToken={jumpToken} />
      </div>
    </div>
  );
}
