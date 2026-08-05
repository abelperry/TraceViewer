import { useEffect, useState } from 'react';
import type { View } from './App';

interface NavItem {
  id: View;
  label: string;
  icon: string;
  hint: string;
}

const ITEMS: NavItem[] = [
  { id: 'trace', label: 'Trace', icon: '❯_', hint: '浏览运行轨迹' },
  { id: 'stats', label: 'Stats', icon: '▤', hint: 'Token 用量统计' },
  { id: 'reviews', label: 'Reviews', icon: '✦', hint: '评审信息流' },
];

const STORAGE_KEY = 'tr.navCollapsed';

/**
 * 左侧主导航：三段带标签的竖向条目（Trace / Stats / Reviews）+ 主题切换。
 * 可折叠为纯图标条（状态存 localStorage）；折叠时用 title 提供悬浮提示。
 * 珊瑚色标识当前视图。
 */
export function SideNav({
  view,
  onSelect,
  theme,
  onToggleTheme,
}: {
  view: View;
  onSelect: (v: View) => void;
  theme: string;
  onToggleTheme: () => void;
}) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === '1',
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // 折叠时标签不可见，把文字挪进 title
  return (
    <nav className={`sidenav ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidenav-brand" title="trace-review">
        <span className="brand-mark">◈</span>
        {!collapsed && (
          <span className="brand-text">
            trace<em>review</em>
          </span>
        )}
      </div>
      <div className="sidenav-items">
        {ITEMS.map((it) => (
          <button
            key={it.id}
            className={`nav-item ${view === it.id ? 'on' : ''}`}
            onClick={() => onSelect(it.id)}
            title={collapsed ? `${it.label} · ${it.hint}` : it.hint}
          >
            <span className="nav-icon">{it.icon}</span>
            {!collapsed && <span className="nav-label">{it.label}</span>}
          </button>
        ))}
      </div>
      <div className="sidenav-foot">
        <button
          className="nav-item nav-theme"
          onClick={onToggleTheme}
          title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
        >
          <span className="nav-icon">{theme === 'dark' ? '☀' : '☾'}</span>
          {!collapsed && <span className="nav-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>}
        </button>
        <button
          className="nav-item nav-collapse"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          <span className="nav-icon">{collapsed ? '»' : '«'}</span>
          {!collapsed && <span className="nav-label">收起</span>}
        </button>
      </div>
    </nav>
  );
}
