import type {
  CollectionDTO,
  SessionDetailDTO,
  SessionMetaDTO,
} from '@trace-review/shared';

const BASE = '/api';

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  collections: () => getJSON<CollectionDTO[]>('/collections'),
  sessions: (params: { collectionId?: string; keyword?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.collectionId) qs.set('collectionId', params.collectionId);
    if (params.keyword) qs.set('keyword', params.keyword);
    if (params.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return getJSON<SessionMetaDTO[]>(`/sessions${q ? `?${q}` : ''}`);
  },
  sessionDetail: (id: string) => getJSON<SessionDetailDTO>(`/sessions/${id}`),
  streamUrl: (id: string) => `${BASE}/sessions/${id}/stream`,
};
