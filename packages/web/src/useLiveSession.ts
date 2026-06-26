import { useEffect, useRef, useState } from 'react';
import type {
  EventDTO,
  SessionDetailDTO,
  SessionMetaDTO,
  StreamPatchDTO,
  TokenUsageDTO,
} from '@trace-review/shared';
import { api } from './api';

export interface LiveSessionState {
  meta: SessionMetaDTO | null;
  events: EventDTO[];
  tokenUsage: TokenUsageDTO | null;
  connected: boolean;
  error: string | null;
}

/**
 * 订阅一个会话的实时流：
 *   - 通过 SSE 的 init 事件拿到全文快照
 *   - 通过 patch 事件增量 append 新事件、合并元数据
 * 切换 sessionId 时自动重连。
 */
export function useLiveSession(sessionId: string | null): LiveSessionState {
  const [state, setState] = useState<LiveSessionState>({
    meta: null,
    events: [],
    tokenUsage: null,
    connected: false,
    error: null,
  });
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    esRef.current?.close();
    if (!sessionId) {
      setState({ meta: null, events: [], tokenUsage: null, connected: false, error: null });
      return;
    }

    setState({ meta: null, events: [], tokenUsage: null, connected: false, error: null });
    const es = new EventSource(api.streamUrl(sessionId));
    esRef.current = es;

    es.addEventListener('init', (e) => {
      const detail = JSON.parse((e as MessageEvent).data) as SessionDetailDTO;
      setState({
        meta: detail.meta,
        events: detail.events,
        tokenUsage: detail.tokenUsage,
        connected: true,
        error: null,
      });
    });

    es.addEventListener('patch', (e) => {
      const patch = JSON.parse((e as MessageEvent).data) as StreamPatchDTO;
      setState((prev) => ({
        ...prev,
        events: [...prev.events, ...patch.events],
        tokenUsage: patch.metaPatch.tokenUsage ?? prev.tokenUsage,
        meta: prev.meta
          ? { ...prev.meta, ...patch.metaPatch }
          : prev.meta,
      }));
    });

    es.onerror = () => {
      setState((prev) => ({ ...prev, connected: false }));
    };

    return () => {
      es.close();
    };
  }, [sessionId]);

  return state;
}
