import { useState } from 'react';
import { SideNav } from './SideNav';
import { TraceView } from './TraceView';
import { StatsView } from './StatsView';
import { ReviewsView } from './ReviewsView';
import { useTheme } from './useTheme';
import './styles.css';

export type View = 'trace' | 'stats' | 'reviews';

export function App() {
  const [view, setView] = useState<View>('trace');
  const [activeSession, setActiveSession] = useState<string | null>(null);
  // evidence 跳转：index=目标事件序号，token 每次点击自增以便重复触发
  const [jump, setJump] = useState<{ index: number; token: number } | null>(null);
  // 当前打开的评审详情页（null=列表页）。放在 App 是为了跳去 Trace 看 evidence
  // 再切回 Reviews 时仍停在同一条评审上——ReviewsView 会随视图切换卸载。
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();

  const openSession = (id: string) => {
    setActiveSession(id);
    setJump(null);
  };

  // 从评审 evidence 跳到轨迹：切到 Trace、打开会话、带上事件序号
  const openEvidence = (sessionId: string, eventIndex: number) => {
    setActiveSession(sessionId);
    setJump((prev) => ({ index: eventIndex, token: (prev?.token ?? 0) + 1 }));
    setView('trace');
  };

  // 「打开轨迹」：切到 Trace 并定位会话，但不跳到某个具体事件
  const openTrace = (sessionId: string) => {
    setActiveSession(sessionId);
    setJump(null);
    setView('trace');
  };

  // Trace 会话树上点评审徽章：切到 Reviews 并直接进该条评审的详情页
  const openReview = (reviewId: string) => {
    setActiveReviewId(reviewId);
    setView('reviews');
  };

  return (
    <div className="app">
      <SideNav view={view} onSelect={setView} theme={theme} onToggleTheme={toggleTheme} />
      <main className="col-main">
        {view === 'trace' && (
          <TraceView
            activeSession={activeSession}
            onSelectSession={openSession}
            onOpenReview={openReview}
            jumpIndex={jump?.index ?? null}
            jumpToken={jump?.token ?? 0}
          />
        )}
        {view === 'stats' && <StatsView />}
        {view === 'reviews' && (
          <ReviewsView
            onOpenEvidence={openEvidence}
            onOpenTrace={openTrace}
            activeReviewId={activeReviewId}
            onSelectReview={setActiveReviewId}
          />
        )}
      </main>
    </div>
  );
}
