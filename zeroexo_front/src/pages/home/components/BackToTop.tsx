/**
 * BackToTop - 返回顶部浮动按钮
 *
 * 监听所在页面的滚动容器（向上查找 overflow 祖先），
 * 滚动超过阈值后淡入显示，点击平滑回到顶部。
 * 视觉与主页 AiInputBar(elevated) 一致：无硬边线 + 半透明 + 毛玻璃 + 轻投影，
 * hover 时切换为主题 accent 色。
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { Z_INDEX } from '@/shared/constants/z-index.js';

/** 滚动超过该像素数后显示按钮 */
const SHOW_THRESHOLD = 400;

export function BackToTop(): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const [visible, setVisible] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);

  // 向上查找最近的可滚动容器，监听其滚动事件
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    let scroller: HTMLElement | null = anchor.parentElement;
    while (scroller) {
      const overflowY = getComputedStyle(scroller).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    scrollerRef.current = scroller;
    const handleScroll = () => {
      setVisible(scroller!.scrollTop > SHOW_THRESHOLD);
    };
    handleScroll();
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', handleScroll);
  }, []);

  const handleClick = () => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div ref={anchorRef} style={{ position: 'fixed', right: 24, bottom: 24, zIndex: Z_INDEX.FAB }}>
      <button
        type="button"
        aria-label="返回顶部"
        title="返回顶部"
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: '1px solid transparent',
          background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(12px)',
          color: theme.toolbar.text,
          cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(12px)',
          pointerEvents: visible ? 'auto' : 'none',
          transition: 'all .25s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = accent;
          e.currentTarget.style.color = '#fff';
          e.currentTarget.style.boxShadow = `0 8px 24px ${accent}40`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.85)';
          e.currentTarget.style.color = theme.toolbar.text;
          e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.14)';
        }}
      >
        <ArrowUp size={18} />
      </button>
    </div>
  );
}
