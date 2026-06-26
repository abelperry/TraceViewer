import { useEffect, useState } from 'react';
import type { CollectionDTO, SessionMetaDTO } from '@trace-review/shared';
import { api } from './api';
import { TranscriptViewer } from './TranscriptViewer';
import { ColResizer } from './ColResizer';
import { useTheme } from './useTheme';
import './styles.css';

function collName(id: string): string {
  return id.replace(/^-/, '').replace(/-/g, '/');
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

export function App() {
  const [collections, setCollections] = useState<CollectionDTO[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMetaDTO[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [colW, setColW] = usePersistedWidth('tr.colW', 240);
  const [sessW, setSessW] = usePersistedWidth('tr.sessW', 320);
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    const load = () => api.collections().then(setCollections).catch(() => {});
    load();
    const t = setInterval(load, 10_000); // collection 变化较少，10s 轮询
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const load = () =>
      api
        .sessions({ collectionId: activeCollection ?? undefined, keyword: keyword || undefined })
        .then(setSessions)
        .catch(() => {});
    load();
    // 轻量轮询：列表自动反映实时 status 与新会话
    const t = setInterval(load, 4_000);
    return () => clearInterval(t);
  }, [activeCollection, keyword]);

  // 当前选中 session 所属的 collection（用于左栏联动高亮）
  const ownerCollection = activeSession
    ? sessions.find((s) => s.id === activeSession)?.collectionId ?? null
    : null;

  return (
    <div className="app">
      <div className="col-collections" style={{ width: colW }}>
        <div className="col-head">
          <span>Collections</span>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <div className="col-scroll">
          <div
            className={`list-item ${activeCollection === null ? 'active' : ''}`}
            onClick={() => setActiveCollection(null)}
          >
            <div className="title">全部</div>
          </div>
          {collections.map((c) => (
            <div
              key={c.id}
              className={`list-item ${activeCollection === c.id ? 'active' : ''} ${
                ownerCollection === c.id ? 'owner' : ''
              }`}
              onClick={() => setActiveCollection(c.id)}
            >
              <div className="title" title={c.id}>
                {collName(c.name)}
              </div>
              <div className="sub">
                <span>{c.source}</span>
                <span>{c.sessionCount} sessions</span>
              </div>
            </div>
          ))}
        </div>
        <ColResizer width={colW} setWidth={setColW} min={160} max={420} />
      </div>

      <div className="col-sessions" style={{ width: sessW }}>
        <div className="col-head">Sessions</div>
        <input
          className="search"
          placeholder="搜索标题 / cwd…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="col-scroll">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`list-item ${activeSession === s.id ? 'active' : ''}`}
              onClick={() => {
                setActiveSession(s.id);
                setActiveCollection(s.collectionId);
              }}
            >
              <div className="title">{s.title}</div>
              <div className="sub">
                <span className={`badge ${s.status}`}>{s.status}</span>
                <span>{s.eventCount} ev</span>
                {s.model && <span>{s.model}</span>}
              </div>
              {activeCollection === null && (
                <div className="sub coll-tag" title={s.collectionId}>
                  📁 {collName(s.collectionId)}
                </div>
              )}
            </div>
          ))}
          {sessions.length === 0 && <div className="empty">无会话</div>}
        </div>
        <ColResizer width={sessW} setWidth={setSessW} min={220} max={640} />
      </div>

      <div className="col-viewer">
        <TranscriptViewer sessionId={activeSession} />
      </div>
    </div>
  );
}
