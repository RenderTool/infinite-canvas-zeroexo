/**
 * ThumbNav - 通用缩略图导航（StackNode 与 SubjectNode 共用同一套框架）
 *
 * 堆叠 = 上下布局（内容区在上 + 水平导航在下）
 * 主体 = 左右布局（垂直导航在左 + 内容区在右）
 * 两者导航行为契约完全一致（自 StackBottomNav 原实现抽离，禁止自由发挥）：
 * - 圆形缩略图最多 THUMB_COUNT_MAX=5 个，超出用滑动窗口 + 1/N 页码
 * - 容器长度自适应降档 5→3→1（±10px 滞回，防 resize 阈值附近逐帧抖动）
 * - 箭头 26×26 / 缩略图 34 圆形 / 页码 tabular-nums / 导航底色 暗#1b1b1b 亮#fafaf7
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';

/** 最大缩略图数(容器长度充足时) */
export const THUMB_COUNT_MAX = 5;

/**
 * 缩略图数量降档（T10 滞回：±10px）
 * - 升档需越过 阈值+10，降档需跌破 阈值-10
 * - 5↔3 阈值 300，3↔1 阈值 220
 */
export function useThumbTier(navLength: number): number {
  const [thumbTier, setThumbTier] = useState<number>(THUMB_COUNT_MAX);
  useEffect(() => {
    setThumbTier((prev) => {
      const H = 10;
      let next = prev;
      if (next === THUMB_COUNT_MAX && navLength < 300 - H) next = navLength < 220 - H ? 1 : 3;
      else if (next === 3 && navLength < 220 - H) next = 1;
      else if (next === 1 && navLength >= 220 + H) next = navLength >= 300 + H ? THUMB_COUNT_MAX : 3;
      else if (next === 3 && navLength >= 300 + H) next = THUMB_COUNT_MAX;
      return next;
    });
  }, [navLength]);
  return thumbTier;
}

export interface ThumbNavItem {
  id: string;
  title?: string;
  /** 缩略图槽位内容(调用方渲染,34px 圆形内自适应) */
  thumb: React.ReactNode;
}

export interface ThumbNavProps {
  orientation: 'horizontal' | 'vertical';
  items: ThumbNavItem[];
  activeIndex: number;
  /** 总条目数(可能大于 items 窗口内数量,1/N 页码用) */
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (index: number) => void;
}

/** 通用缩略图导航(水平/垂直同机制):箭头 + 圆形缩略图窗口(上限5,滑动) + 1/N 页码 */
export function ThumbNav({
  orientation,
  items,
  activeIndex,
  total,
  onPrev,
  onNext,
  onJump,
}: ThumbNavProps): React.ReactElement {
  const { theme } = useTheme();
  const dark = theme.mode === 'dark';
  const navRef = useRef<HTMLDivElement>(null);
  // 容器实测长度:水平量宽 / 垂直量高(ResizeObserver 首帧后即实测纠正)
  const [navLength, setNavLength] = useState(620);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) {
        setNavLength(orientation === 'vertical' ? r.height : r.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [orientation]);
  const thumbCount = useThumbTier(navLength);
  const half = Math.floor(thumbCount / 2);
  const start = Math.max(0, Math.min(activeIndex - half, Math.max(0, total - thumbCount)));
  // 导航底色对齐剧本节点「黑色标题栏」:暗色 #1b1b1b / 亮色 #fafaf7
  const navBg = dark ? '#1b1b1b' : '#fafaf7';
  const borderSubtle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
  const muted = dark ? 'rgba(255,255,255,0.68)' : 'var(--color-text-secondary, #57534e)';
  const arrowBase: React.CSSProperties = {
    width: 26,
    height: 26,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 7,
    background: 'transparent',
    color: muted,
    cursor: 'pointer',
    padding: 0,
    transition: 'background 0.15s cubic-bezier(0.22,1,0.36,1), color 0.15s',
  };
  const arrowStyle = (disabled: boolean): React.CSSProperties => ({
    ...arrowBase,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.32 : 1,
  });
  const arrowHover = (disabled: boolean): React.CSSProperties =>
    disabled ? {} : { background: dark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.07)', color: dark ? '#fff' : '#17191c' };
  const thumbBtnBase: React.CSSProperties = {
    width: 34,
    height: 34,
    // 降档阈值间隙内空间不足时也不得被压扁(否则圆形变椭圆,视觉"挤压")
    flexShrink: 0,
    border: 'none',
    borderRadius: 999,
    overflow: 'hidden',
    cursor: 'pointer',
    background: dark ? 'rgba(255,255,255,0.1)' : '#fff',
    // 头像式满幅:无内边距,缩略图 cover 填满圆形
    padding: 0,
    transition: 'box-shadow 0.15s, transform 0.15s',
  };
  const vertical = orientation === 'vertical';
  const PrevIcon = vertical ? ChevronUp : ChevronLeft;
  const NextIcon = vertical ? ChevronDown : ChevronRight;
  const containerStyle: React.CSSProperties = vertical
    ? { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 48, height: '100%', padding: '8px 0', background: navBg, borderRadius: '8px 0 0 8px', minHeight: 0, overflow: 'hidden' }
    : { display: 'flex', alignItems: 'center', width: '100%', height: 48, padding: '0 8px', gap: 5, background: navBg, borderRadius: '0 0 8px 8px', minWidth: 0, overflow: 'hidden' };
  const windowStyle: React.CSSProperties = vertical
    ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'center', minHeight: 0 }
    : { display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'center', minWidth: 0 };

  return (
    <div ref={navRef} style={containerStyle}>
      <button
        type="button"
        title={vertical ? '上一个状态' : '上一张'}
        aria-label={vertical ? '上一个状态' : '上一张'}
        disabled={activeIndex <= 0}
        onClick={onPrev}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, arrowHover(activeIndex <= 0))}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = muted; }}
        style={arrowStyle(activeIndex <= 0)}
      ><PrevIcon size={17} /></button>
      <div style={windowStyle}>{Array.from({ length: thumbCount }, (_, offset) => {
        const index = start + offset;
        const item = items[index];
        return item ? (
          <button
            key={item.id}
            type="button"
            title={item.title}
            aria-label={`切换到 ${item.title ?? ''}`}
            onClick={() => onJump(index)}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              ...thumbBtnBase,
              outline: index === activeIndex ? `2px solid var(--color-primary, #e94560)` : 'none',
              outlineOffset: 2,
              boxShadow: index === activeIndex ? `0 0 0 2px ${navBg}, 0 0 0 3.5px var(--color-primary, #e94560)` : 'none',
            }}
          >{item.thumb}</button>
        ) : <div key={`empty-${offset}`} style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 999, border: `1px dashed ${borderSubtle}`, background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)' }} />;
      })}</div>
      <button
        type="button"
        title={vertical ? '下一个状态' : '下一张'}
        aria-label={vertical ? '下一个状态' : '下一张'}
        disabled={activeIndex >= total - 1}
        onClick={onNext}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, arrowHover(activeIndex >= total - 1))}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = muted; }}
        style={arrowStyle(activeIndex >= total - 1)}
      ><NextIcon size={17} /></button>
      <span style={{ color: muted, fontSize: 12, minWidth: 24, textAlign: 'center', fontVariantNumeric: 'tabular-nums', flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeIndex + 1}/{total}</span>
    </div>
  );
}
