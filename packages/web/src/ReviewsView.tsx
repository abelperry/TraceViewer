import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FindingDTO,
  PeriodicSummaryDTO,
  ReviewDTO,
  ReviewRowDTO,
  Severity,
  SourceId,
  SummaryPeriod,
} from '@trace-review/shared';
import { api } from './api';
import { buildLabels } from './collectionLabel';
import { scoreClass } from './reviewScore';

function relTime(iso: string): string {
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

/** 会话运行时间：今天/昨天用时分，更早用日期 —— 与「多久前评审的」区分开。 */
function sessionTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = d.toTimeString().slice(0, 5);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `昨天 ${hm}`;
  if (days < 365) return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 详情头部的时间区间：`07-26 14:32 – 15:10`（跨天则右侧也带日期）。 */
function timeRange(startedAt: string | null, lastEventAt: string | null): string {
  if (!startedAt) return '';
  const a = new Date(startedAt);
  if (Number.isNaN(a.getTime())) return '';
  const left = sessionTime(startedAt);
  if (!lastEventAt) return left;
  const b = new Date(lastEventAt);
  if (Number.isNaN(b.getTime())) return left;
  const sameDay = a.toDateString() === b.toDateString();
  return `${left} – ${sameDay ? b.toTimeString().slice(0, 5) : sessionTime(lastEventAt)}`;
}

const CATEGORY_LABEL: Record<'agent' | 'prompt', string> = {
  agent: 'Agent',
  prompt: 'Prompt',
};

function ScoreBadge({ score, status }: { score: number; status: string }) {
  if (status === 'failed') return <span className="score-badge neutral">失败</span>;
  return <span className={`score-badge ${scoreClass(score, status)}`}>{score}</span>;
}

function SeverityDot({ severity }: { severity: Severity }) {
  return <span className={`sev-dot sev-${severity}`} title={severity} />;
}

function CountChips({ counts }: { counts: { agent: number; prompt: number } }) {
  return (
    <span className="count-chips">
      {counts.agent > 0 && <span className="chip cat-agent">agent {counts.agent}</span>}
      {counts.prompt > 0 && <span className="chip cat-prompt">prompt {counts.prompt}</span>}
      {counts.agent === 0 && counts.prompt === 0 && <span className="chip clean">无问题</span>}
    </span>
  );
}

// ---- periodic summary --------------------------------------------------

function PeriodicSummaryCard({
  period,
  onPeriod,
  summary,
  onOpenExample,
}: {
  period: SummaryPeriod;
  onPeriod: (p: SummaryPeriod) => void;
  summary: PeriodicSummaryDTO | null;
  onOpenExample: (sessionId: string) => void;
}) {
  return (
    <div className="summary-card">
      <div className="summary-head">
        <span className="summary-title">周期汇总</span>
        <div className="seg small">
          <button className={period === 'week' ? 'on' : ''} onClick={() => onPeriod('week')}>
            近 7 天
          </button>
          <button className={period === 'month' ? 'on' : ''} onClick={() => onPeriod('month')}>
            近 30 天
          </button>
        </div>
      </div>
      {summary && (
        <>
          <div className="summary-metrics">
            <div className="sm">
              <div className="sm-value">{summary.reviewedCount}</div>
              <div className="sm-label">已评审</div>
            </div>
            <div className="sm">
              <div className="sm-value">{summary.avgScore || '—'}</div>
              <div className="sm-label">平均分</div>
            </div>
            <div className="sm sm-range" title={`${summary.from} → ${summary.to}`}>
              <div className="sm-value">
                {summary.from.slice(5)} – {summary.to.slice(5)}
              </div>
              <div className="sm-label">区间</div>
            </div>
          </div>
          {summary.topIssues.length > 0 && (
            <div className="top-issues">
              <div className="ti-head">高频问题</div>
              {summary.topIssues.map((it, i) => (
                <div
                  key={i}
                  className="ti-row"
                  onClick={() => onOpenExample(it.exampleSessionId)}
                  title="查看示例会话评审"
                >
                  <span className={`chip cat-${it.category}`}>{CATEGORY_LABEL[it.category]}</span>
                  <span className="ti-title">{it.title}</span>
                  <span className="ti-count">×{it.count}</span>
                </div>
              ))}
            </div>
          )}
          {summary.reviewedCount === 0 && <div className="ti-empty">区间内暂无评审</div>}
        </>
      )}
    </div>
  );
}

// ---- feed row ----------------------------------------------------------

function ReviewCard({
  row,
  projectLabel,
  onClick,
}: {
  row: ReviewRowDTO;
  projectLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="review-card" onClick={onClick}>
      <div className="rc-top">
        <ScoreBadge score={row.score} status={row.status} />
        <span className="rc-project" title={row.collectionId}>
          {projectLabel}
        </span>
        {row.topSeverity && <SeverityDot severity={row.topSeverity} />}
        <span className="rc-time" title={`评审于 ${relTime(row.createdAt)} 前`}>
          {sessionTime(row.sessionStartedAt)}
        </span>
      </div>
      <div className="rc-title" title={row.sessionTitle}>
        {row.sessionTitle}
      </div>
      <div className="rc-summary">{row.status === 'failed' ? '评审失败' : row.summary}</div>
      <div className="rc-meta">
        <span className="chip src">{row.source}</span>
        <CountChips counts={row.counts} />
      </div>
    </div>
  );
}

// ---- detail ------------------------------------------------------------

function FindingItem({
  finding,
  sessionId,
  onOpenEvidence,
}: {
  finding: FindingDTO;
  sessionId: string;
  onOpenEvidence: (sessionId: string, eventIndex: number) => void;
}) {
  return (
    <div className={`finding sev-${finding.severity}`}>
      <div className="finding-head">
        <SeverityDot severity={finding.severity} />
        <span className="finding-title">{finding.title}</span>
      </div>
      <div className="finding-detail">{finding.detail}</div>
      <div className="finding-suggestion">
        <span className="fs-label">建议</span>
        {finding.suggestion}
      </div>
      {finding.evidenceEventIndexes.length > 0 && (
        <div className="evidence">
          <span className="ev-label">证据</span>
          {finding.evidenceEventIndexes.map((idx) => (
            <button
              key={idx}
              className="ev-chip"
              onClick={() => onOpenEvidence(sessionId, idx)}
              title="跳到轨迹中的该事件"
            >
              #{idx}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewDetailPage({
  review,
  reviewerReady,
  projectLabel,
  onBack,
  onReReview,
  onOpenTrace,
  reReviewing,
  onOpenEvidence,
}: {
  review: ReviewDTO | null;
  reviewerReady: boolean;
  projectLabel: string;
  onBack: () => void;
  onReReview: (sessionId: string) => void;
  onOpenTrace: (sessionId: string) => void;
  reReviewing: boolean;
  onOpenEvidence: (sessionId: string, eventIndex: number) => void;
}) {
  if (!review) {
    return (
      <div className="page-scroll">
        <div className="page-inner">
          <button className="btn-back" onClick={onBack}>
            ← 返回列表
          </button>
          <div className="empty">载入中…</div>
        </div>
      </div>
    );
  }

  const agent = review.findings.filter((f) => f.category === 'agent');
  const prompt = review.findings.filter((f) => f.category === 'prompt');
  const s = review.session;

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <button className="btn-back" onClick={onBack}>
          ← 返回列表
        </button>

        {/* 身份区：这条评审说的是「哪个 trace」——项目 › 标题 + 真实运行时间 + 规模 */}
        <div className="rd-ident">
          <div className="rd-ident-main">
            <div className="rd-crumb">
              <ScoreBadge score={review.score} status={review.status} />
              <span className="rd-project" title={review.collectionId}>
                {projectLabel}
              </span>
              <span className="rd-crumb-sep">›</span>
              <span className="rd-session-title" title={s?.title ?? review.sessionId}>
                {s?.title ?? review.sessionId}
              </span>
            </div>
            <div className="rd-facts">
              {s?.startedAt && <span>{timeRange(s.startedAt, s.lastEventAt)}</span>}
              {s && <span>{s.eventCount} 事件</span>}
              {s?.status === 'running' && <span className="rd-running">运行中</span>}
              {s?.gitBranch && <span className="rd-branch">{s.gitBranch}</span>}
              <span>{review.source}</span>
              <span className="rd-model">{review.model}</span>
              <span title={`评审于 ${new Date(review.createdAt).toLocaleString()}`}>
                评审于 {relTime(review.createdAt)}前
              </span>
            </div>
            {s?.cwd && (
              <div className="rd-cwd" title={s.cwd}>
                {s.cwd}
              </div>
            )}
            {!s && <div className="rd-gone">原会话已不存在（trace 文件可能已删除）</div>}
          </div>
          <div className="rd-actions">
            <button
              className="btn-open-trace"
              onClick={() => onOpenTrace(review.sessionId)}
              title="在 Trace 视图打开这条轨迹"
            >
              ❯_ 打开轨迹
            </button>
            <button
              className="btn-rereview"
              disabled={!reviewerReady || reReviewing}
              onClick={() => onReReview(review.sessionId)}
              title={reviewerReady ? '重新评审此会话' : '未配置评审凭据'}
            >
              {reReviewing ? '评审中…' : '↻ 重新评审'}
            </button>
          </div>
        </div>

        {review.status === 'failed' ? (
          <div className="rd-error">
            <div className="rd-error-title">评审失败</div>
            <div className="rd-error-body">{review.error}</div>
          </div>
        ) : (
          <>
            <div className="rd-summary">{review.summary}</div>
            {/* 两侧并列：这个工具的核心就是「agent 侧 + prompt 侧」一起看 */}
            <div className="rd-groups">
              <FindingGroup
                title={`Agent 侧 · ${agent.length}`}
                findings={agent}
                sessionId={review.sessionId}
                onOpenEvidence={onOpenEvidence}
              />
              <FindingGroup
                title={`Prompt 侧 · ${prompt.length}`}
                findings={prompt}
                sessionId={review.sessionId}
                onOpenEvidence={onOpenEvidence}
              />
            </div>
            {review.findings.length === 0 && <div className="ti-empty">未发现明显问题 🎉</div>}
          </>
        )}
      </div>
    </div>
  );
}

function FindingGroup({
  title,
  findings,
  sessionId,
  onOpenEvidence,
}: {
  title: string;
  findings: FindingDTO[];
  sessionId: string;
  onOpenEvidence: (sessionId: string, eventIndex: number) => void;
}) {
  if (findings.length === 0) return null;
  return (
    <div className="finding-group">
      <div className="fg-title">{title}</div>
      {findings.map((f, i) => (
        <FindingItem key={i} finding={f} sessionId={sessionId} onOpenEvidence={onOpenEvidence} />
      ))}
    </div>
  );
}

// ---- container ---------------------------------------------------------

/**
 * Reviews 视图：两级页面导航（不是左右两栏）。
 *   列表页：周期汇总 + 平铺的评审卡片网格；
 *   详情页：点卡片后整页展开一条评审。
 * 「当前打开哪条评审」由 App 持有，因此跳去 Trace 看 evidence 再回来仍停在同一条。
 */
export function ReviewsView({
  onOpenEvidence,
  onOpenTrace,
  activeReviewId,
  onSelectReview,
}: {
  onOpenEvidence: (sessionId: string, eventIndex: number) => void;
  onOpenTrace: (sessionId: string) => void;
  /** null = 停在列表页 */
  activeReviewId: string | null;
  onSelectReview: (reviewId: string | null) => void;
}) {
  const [rows, setRows] = useState<ReviewRowDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewDTO | null>(null);
  const [period, setPeriod] = useState<SummaryPeriod>('week');
  const [summary, setSummary] = useState<PeriodicSummaryDTO | null>(null);
  const [ready, setReady] = useState(true);
  const [source, setSource] = useState<SourceId | ''>('');
  const [reReviewing, setReReviewing] = useState(false);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);

  useEffect(() => {
    api.reviewStatus().then((s) => setReady(s.ready)).catch(() => {});
    // 项目短标签要在全体 collection 里去重，故拉一次完整列表
    api
      .collections()
      .then((cs) => setCollectionIds(cs.map((c) => c.id)))
      .catch(() => {});
  }, []);

  // 与 Trace 会话树共用同一套短标签，保证同一项目两处显示一致
  const labels = useMemo(() => buildLabels(collectionIds), [collectionIds]);
  const labelOf = useCallback(
    (collectionId: string) => labels.get(collectionId) ?? collectionId,
    [labels],
  );

  const loadFeed = useCallback(() => {
    api
      .reviews({ source: source || undefined, limit: 50 })
      .then((feed) => {
        setRows(feed.rows);
        setNextCursor(feed.nextCursor);
      })
      .catch(() => {});
  }, [source]);

  // 只在列表页轮询，详情页不必刷
  useEffect(() => {
    if (activeReviewId) return;
    loadFeed();
    const t = setInterval(loadFeed, 15_000);
    return () => clearInterval(t);
  }, [loadFeed, activeReviewId]);

  useEffect(() => {
    api.reviewSummary(period).then(setSummary).catch(() => {});
  }, [period, rows.length]);

  // 详情页内容跟着 activeReviewId 走（含从 Trace 徽章跳来的情况）
  useEffect(() => {
    if (!activeReviewId) {
      setDetail(null);
      return;
    }
    let alive = true;
    api
      .review(activeReviewId)
      .then((r) => alive && setDetail(r))
      .catch(() => alive && setDetail(null));
    return () => {
      alive = false;
    };
  }, [activeReviewId]);

  const loadMore = () => {
    if (!nextCursor) return;
    api
      .reviews({ source: source || undefined, limit: 50, before: nextCursor })
      .then((feed) => {
        setRows((prev) => [...prev, ...feed.rows]);
        setNextCursor(feed.nextCursor);
      })
      .catch(() => {});
  };

  // 周期汇总里的示例会话只有 sessionId，先换成 reviewId 再打开详情页
  const openBySession = useCallback(
    (sessionId: string) => {
      api
        .reviewBySession(sessionId)
        .then((r) => onSelectReview(r.id))
        .catch(() => {});
    },
    [onSelectReview],
  );

  const reReview = (sessionId: string) => {
    setReReviewing(true);
    api
      .triggerReview(sessionId)
      .then((r) => {
        setDetail(r);
        onSelectReview(r.id);
      })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 409) {
          setReady(false);
          alert('评审器未配置：请设置 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY 后重启服务。');
        }
      })
      .finally(() => setReReviewing(false));
  };

  // ---- 详情页 ----
  if (activeReviewId) {
    return (
      <div className="reviews-view">
        <ReviewDetailPage
          review={detail}
          reviewerReady={ready}
          projectLabel={detail ? labelOf(detail.collectionId) : ''}
          onBack={() => onSelectReview(null)}
          onReReview={reReview}
          onOpenTrace={onOpenTrace}
          reReviewing={reReviewing}
          onOpenEvidence={onOpenEvidence}
        />
      </div>
    );
  }

  // ---- 列表页 ----
  return (
    <div className="reviews-view">
      <div className="page-scroll">
        <div className="page-inner">
          <div className="page-head">
            <h1 className="page-title">Reviews</h1>
            <select
              className="mini-select"
              value={source}
              onChange={(e) => setSource(e.target.value as SourceId | '')}
            >
              <option value="">全部来源</option>
              <option value="claude-code">claude-code</option>
              <option value="codex">codex</option>
            </select>
          </div>

          {!ready && (
            <div className="notice">
              未配置 <code>ANTHROPIC_AUTH_TOKEN</code> / <code>ANTHROPIC_API_KEY</code>，
              例行评审不运行、手动触发不可用。
            </div>
          )}

          <PeriodicSummaryCard
            period={period}
            onPeriod={setPeriod}
            summary={summary}
            onOpenExample={openBySession}
          />

          <div className="review-grid">
            {rows.map((row) => (
              <ReviewCard
                key={row.id}
                row={row}
                projectLabel={labelOf(row.collectionId)}
                onClick={() => onSelectReview(row.id)}
              />
            ))}
          </div>
          {rows.length === 0 && <div className="empty">暂无评审</div>}
          {nextCursor && (
            <div className="show-more center" onClick={loadMore}>
              加载更多
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
