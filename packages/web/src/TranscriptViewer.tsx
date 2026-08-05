import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventDTO, FindingDTO, ReviewDTO, Role, Severity } from '@trace-review/shared';
import { useLiveSession } from './useLiveSession';
import { BlockView } from './BlockView';
import { api } from './api';
import {
  anchorsMayBeStale,
  buildAnnotations,
  EMPTY_ANNOTATIONS,
  type AnchoredFinding,
} from './annotations';
import { scoreClass } from './reviewScore';

const ANNOT_KEY = 'tr.annotations';

function roleClass(role: Role): string {
  return role;
}

function formatTs(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

const CAT_LABEL = { agent: 'Agent', prompt: 'Prompt' } as const;

/**
 * 顶部迷你地图：每个事件一个色块，点击滚动到对应事件。
 * 被评审 finding 引用到的事件额外打一道 severity 刻度——一眼看出问题分布在哪一段。
 */
function Minimap({
  events,
  severityByEvent,
  onJump,
}: {
  events: EventDTO[];
  severityByEvent: Map<number, Severity>;
  onJump: (id: string) => void;
}) {
  return (
    <div className="minimap">
      {events.map((e, i) => {
        const hasError = e.blocks.some((b) => b.type === 'tool_result' && b.isError);
        const sev = severityByEvent.get(i);
        return (
          <div
            key={e.id}
            className={`cell ${hasError ? 'mini-error' : `mini-${e.role}`} ${
              sev ? `mini-flag mini-sev-${sev}` : ''
            }`}
            title={`#${i} ${e.role}${hasError ? ' · error' : ''}${sev ? ` · 评审标记 ${sev}` : ''}`}
            onClick={() => onJump(e.id)}
          />
        );
      })}
    </div>
  );
}

/** 右侧批注栏里的一条 finding。 */
function AnnotationCard({
  item,
  focused,
  onFocus,
  onBlur,
  onJump,
}: {
  item: AnchoredFinding;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onJump: (index: number) => void;
}) {
  const { finding, allIndexes, anchorIndex } = item;
  const others = allIndexes.filter((i) => i !== anchorIndex);
  return (
    <div
      className={`annot-card sev-${finding.severity} ${focused ? 'focused' : ''}`}
      onMouseEnter={onFocus}
      onMouseLeave={onBlur}
    >
      <div className="annot-head">
        <span className={`sev-dot sev-${finding.severity}`} />
        <span className={`chip cat-${finding.category}`}>{CAT_LABEL[finding.category]}</span>
      </div>
      <div className="annot-title">{finding.title}</div>
      <div className="annot-detail">{finding.detail}</div>
      <div className="annot-sugg">
        <span className="fs-label">建议</span>
        {finding.suggestion}
      </div>
      {others.length > 0 && (
        <div className="annot-also">
          <span className="ev-label">同时引用</span>
          {others.map((i) => (
            <button key={i} className="ev-chip" onClick={() => onJump(i)} title="跳到该事件">
              #{i}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 轨迹顶部总结卡：分数 + 一句话，外加无处可锚的 findings 与锚点偏移提示。 */
function ReviewBanner({
  review,
  unanchored,
  stale,
  currentCount,
}: {
  review: ReviewDTO;
  unanchored: FindingDTO[];
  stale: boolean;
  currentCount: number;
}) {
  return (
    <div className="annot-banner">
      <div className="ab-top">
        <span className={`score-badge ${scoreClass(review.score, review.status)}`}>
          {review.score}
        </span>
        <span className="ab-summary">{review.summary}</span>
      </div>
      {stale && (
        <div className="ab-stale">
          本次评审基于 {review.reviewedEventCount} 个事件，当前 {currentCount} 个 —— 证据序号可能已偏移
        </div>
      )}
      {unanchored.length > 0 && (
        <div className="ab-unanchored">
          <div className="ev-label">未锚定 {unanchored.length} 条（评审未给出证据事件）</div>
          {unanchored.map((f, i) => (
            <div key={i} className="ab-un-item">
              <span className={`sev-dot sev-${f.severity}`} />
              <span className={`chip cat-${f.category}`}>{CAT_LABEL[f.category]}</span>
              <span className="ab-un-title">{f.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TranscriptViewer({
  sessionId,
  jumpIndex = null,
  jumpToken = 0,
}: {
  sessionId: string | null;
  /** evidence 跳转目标事件序号（transcript 位置，0-based）。 */
  jumpIndex?: number | null;
  /** 每次点击 evidence 自增，用于重复跳到同一序号也能再次触发。 */
  jumpToken?: number;
}) {
  const { meta, events, tokenUsage, connected } = useLiveSession(sessionId);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [flashId, setFlashId] = useState<string | null>(null);
  const lastTokenRef = useRef(0);
  const [review, setReview] = useState<ReviewDTO | null>(null);
  const [showAnnot, setShowAnnot] = useState(() => localStorage.getItem(ANNOT_KEY) !== '0');
  const [focusedAnchor, setFocusedAnchor] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem(ANNOT_KEY, showAnnot ? '1' : '0');
  }, [showAnnot]);

  // 拉该会话的评审；没有评审是常态（404），静默即可
  useEffect(() => {
    setReview(null);
    setFocusedAnchor(null);
    if (!sessionId) return;
    let alive = true;
    api
      .reviewBySession(sessionId)
      .then((r) => alive && setReview(r))
      .catch(() => alive && setReview(null));
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const annotations = useMemo(
    () => (showAnnot ? buildAnnotations(review, events.length) : EMPTY_ANNOTATIONS),
    [showAnnot, review, events.length],
  );
  const stale = anchorsMayBeStale(review, events.length);

  // 自动滚到底（仅当用户本就在底部时）
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  // evidence 跳转：滚到目标事件并短暂高亮。events 可能尚未加载完，
  // 故依赖 events.length，加载到目标后再执行（token 去重，避免重复触发）。
  useEffect(() => {
    if (jumpIndex == null || jumpToken === lastTokenRef.current) return;
    const target = events[jumpIndex];
    if (!target) return; // 目标还没加载，等 events 增长后再来
    lastTokenRef.current = jumpToken;
    atBottomRef.current = false;
    document.getElementById(`ev-${target.id}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
    setFlashId(target.id);
    const t = setTimeout(() => setFlashId(null), 2200);
    return () => clearTimeout(t);
  }, [jumpIndex, jumpToken, events]);

  if (!sessionId) {
    return <div className="empty">从左侧选择一个会话</div>;
  }

  const jump = (id: string) => {
    document.getElementById(`ev-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const jumpToIndex = (index: number) => {
    const target = events[index];
    if (!target) return;
    atBottomRef.current = false;
    jump(target.id);
    setFlashId(target.id);
    setTimeout(() => setFlashId(null), 2200);
  };

  const onScroll = () => {
    const el = transcriptRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const isRunning = meta?.status === 'running';
  const hasAnnot = showAnnot && review !== null && review.status !== 'failed';
  // 悬停某条批注时，把它引用的全部事件一起高亮
  const highlighted = new Set<number>(
    focusedAnchor != null
      ? (annotations.byAnchor.get(focusedAnchor) ?? []).flatMap((a) => a.allIndexes)
      : [],
  );

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
          {review && review.status !== 'failed' && (
            <button
              className={`annot-toggle ${showAnnot ? 'on' : ''}`}
              onClick={() => setShowAnnot((v) => !v)}
              title={showAnnot ? '隐藏评审批注' : '显示评审批注'}
            >
              ✦ 批注 {review.findings.length}
            </button>
          )}
        </div>
      </div>
      <Minimap events={events} severityByEvent={annotations.severityByEvent} onJump={jump} />
      <div
        className={`transcript ${hasAnnot && annotations.anchoredCount > 0 ? 'with-annot' : ''}`}
        ref={transcriptRef}
        onScroll={onScroll}
      >
        {hasAnnot && review && (
          <ReviewBanner
            review={review}
            unanchored={annotations.unanchored}
            stale={stale}
            currentCount={events.length}
          />
        )}
        {events.map((e, i) => {
          const hasError = e.blocks.some((b) => b.type === 'tool_result' && b.isError);
          const cards = annotations.byAnchor.get(i);
          const sev = annotations.severityByEvent.get(i);
          return (
            <div className="event-row" key={e.id}>
              <div
                className={`event ${flashId === e.id ? 'flash' : ''} ${
                  sev ? `flagged flag-${sev}` : ''
                } ${highlighted.has(i) ? 'ref-highlight' : ''}`}
                id={`ev-${e.id}`}
              >
                <div className={`event-head ${roleClass(e.role)} ${hasError ? 'has-error' : ''}`}>
                  <span className="ev-index">#{i}</span>
                  <span>{e.role}</span>
                  {hasError && <span className="badge err-badge">error</span>}
                  {e.isSidechain && <span className="badge">sidechain</span>}
                  <span className="ts">{formatTs(e.timestamp)}</span>
                </div>
                <div className="event-body">
                  {e.blocks.map((b, bi) => (
                    <BlockView key={bi} block={b} />
                  ))}
                </div>
              </div>
              {cards && cards.length > 0 && (
                <div className="annot-gutter">
                  {cards.map((item, ci) => (
                    <AnnotationCard
                      key={ci}
                      item={item}
                      focused={focusedAnchor === i}
                      onFocus={() => setFocusedAnchor(i)}
                      onBlur={() => setFocusedAnchor(null)}
                      onJump={jumpToIndex}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
