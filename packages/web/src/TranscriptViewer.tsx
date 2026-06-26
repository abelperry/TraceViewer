import { useEffect, useRef } from 'react';
import type { EventDTO, Role } from '@trace-review/shared';
import { useLiveSession } from './useLiveSession';
import { BlockView } from './BlockView';

function roleClass(role: Role): string {
  return role;
}

function formatTs(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

/** 顶部迷你地图：每个事件一个色块，点击滚动到对应事件。 */
function Minimap({ events, onJump }: { events: EventDTO[]; onJump: (id: string) => void }) {
  return (
    <div className="minimap">
      {events.map((e) => (
        <div
          key={e.id}
          className={`cell mini-${e.role}`}
          title={`${e.role} · ${e.blocks.map((b) => b.type).join(', ')}`}
          onClick={() => onJump(e.id)}
        />
      ))}
    </div>
  );
}

export function TranscriptViewer({ sessionId }: { sessionId: string | null }) {
  const { meta, events, tokenUsage, connected } = useLiveSession(sessionId);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  // 自动滚到底（仅当用户本就在底部时）
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  if (!sessionId) {
    return <div className="empty">从左侧选择一个会话</div>;
  }

  const jump = (id: string) => {
    document.getElementById(`ev-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const onScroll = () => {
    const el = transcriptRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const isRunning = meta?.status === 'running';

  return (
    <>
      <div className="viewer-head">
        <div className="vt">
          {meta?.title ?? sessionId}{' '}
          {isRunning && connected && <span className="live-dot" title="live" />}
        </div>
        <div className="vm">
          <span>{meta?.source}</span>
          {meta?.model && <span>model: {meta.model}</span>}
          <span>{events.length} events</span>
          {tokenUsage && <span>tokens: {tokenUsage.total.toLocaleString()}</span>}
          {meta?.cwd && <span title={meta.cwd}>cwd: …{meta.cwd.slice(-30)}</span>}
          <span className={`badge ${meta?.status ?? ''}`}>{meta?.status}</span>
        </div>
      </div>
      <Minimap events={events} onJump={jump} />
      <div className="transcript" ref={transcriptRef} onScroll={onScroll}>
        {events.map((e) => (
          <div className="event" id={`ev-${e.id}`} key={e.id}>
            <div className={`event-head ${roleClass(e.role)}`}>
              <span>{e.role}</span>
              {e.isSidechain && <span className="badge">sidechain</span>}
              <span className="ts">{formatTs(e.timestamp)}</span>
            </div>
            <div className="event-body">
              {e.blocks.map((b, i) => (
                <BlockView key={i} block={b} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
