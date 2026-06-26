import { useEffect, useState } from 'react';
import type { CollectionDTO, SessionMetaDTO } from '@trace-review/shared';
import { api } from './api';
import { TranscriptViewer } from './TranscriptViewer';
import './styles.css';

export function App() {
  const [collections, setCollections] = useState<CollectionDTO[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMetaDTO[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    api.collections().then(setCollections).catch(() => setCollections([]));
  }, []);

  useEffect(() => {
    api
      .sessions({ collectionId: activeCollection ?? undefined, keyword: keyword || undefined })
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [activeCollection, keyword]);

  return (
    <div className="app">
      <div className="col-collections">
        <div className="col-head">Collections</div>
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
              className={`list-item ${activeCollection === c.id ? 'active' : ''}`}
              onClick={() => setActiveCollection(c.id)}
            >
              <div className="title" title={c.id}>
                {c.name.replace(/^-/, '').replace(/-/g, '/')}
              </div>
              <div className="sub">
                <span>{c.source}</span>
                <span>{c.sessionCount} sessions</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="col-sessions">
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
              onClick={() => setActiveSession(s.id)}
            >
              <div className="title">{s.title}</div>
              <div className="sub">
                <span className={`badge ${s.status}`}>{s.status}</span>
                <span>{s.eventCount} ev</span>
                {s.model && <span>{s.model}</span>}
              </div>
            </div>
          ))}
          {sessions.length === 0 && <div className="empty">无会话</div>}
        </div>
      </div>

      <div className="col-viewer">
        <TranscriptViewer sessionId={activeSession} />
      </div>
    </div>
  );
}
