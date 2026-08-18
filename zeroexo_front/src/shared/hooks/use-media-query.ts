/**
 * useMediaQuery - 响应式媒体查询 hook
 *
 * 监听 window.matchMedia 的变化,返回当前是否匹配。
 * 用于移动端适配(断点 768px)。
 */

import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** 移动端断点:<= 768px */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 768px)');
}
