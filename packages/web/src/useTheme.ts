import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'tr.theme';

function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  // 跟随系统偏好
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** 主题状态：应用到 <html data-theme>，持久化到 localStorage。 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return [theme, toggle];
}
