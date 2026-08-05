import type {
  CollectionDTO,
  PeriodicSummaryDTO,
  ReviewDTO,
  ReviewFeedDTO,
  ReviewScoreDTO,
  SessionDetailDTO,
  SessionMetaDTO,
  SourceId,
  StatsDTO,
  StatsRange,
  SummaryPeriod,
} from '@trace-review/shared';

const BASE = '/api';

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** POST 无 body；把非 2xx 的 status 作为错误码抛出（供 409/404 分支处理）。 */
async function postJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST' });
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
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
  stats: (range: StatsRange) => getJSON<StatsDTO>(`/stats?range=${range}`),

  // ---- reviews ----
  reviewStatus: () => getJSON<{ ready: boolean }>('/reviews/status'),
  reviews: (params: { collectionId?: string; source?: SourceId; limit?: number; before?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.collectionId) qs.set('collectionId', params.collectionId);
    if (params.source) qs.set('source', params.source);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.before) qs.set('before', params.before);
    const q = qs.toString();
    return getJSON<ReviewFeedDTO>(`/reviews${q ? `?${q}` : ''}`);
  },
  review: (id: string) => getJSON<ReviewDTO>(`/reviews/${id}`),
  reviewBySession: (sessionId: string) => getJSON<ReviewDTO>(`/reviews/session/${sessionId}`),
  triggerReview: (sessionId: string) => postJSON<ReviewDTO>(`/reviews/session/${sessionId}`),
  reviewSummary: (period: SummaryPeriod) =>
    getJSON<PeriodicSummaryDTO>(`/reviews/summary?period=${period}`),
  /** sessionId → 分数，供 Trace 会话树标记已评审 */
  reviewScores: () => getJSON<Record<string, ReviewScoreDTO>>('/reviews/scores'),
};
