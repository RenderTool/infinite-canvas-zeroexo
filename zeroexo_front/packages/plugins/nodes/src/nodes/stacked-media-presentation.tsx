/** StackNode 的纯呈现组件：媒体预览、替换按钮和导航，不持有图事务状态。 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Upload, Video } from 'lucide-react';
import type { NodeRendererProps } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { VideoNodeView } from './video-node-view.js';
import { SelfRichTextEditor } from '../rich-text-editor/SelfRichTextEditor.js';
import { useHydratedContent } from '../utils/hydrate.js';
import type { StackCard } from './stacked-media-types.js';

/** 最大缩略图数(容器宽度充足时) */
const THUMB_COUNT_MAX = 5;

/** 视频首帧 poster 缓存(按 hydrated src 键控,避免重复解码) */
const VIDEO_POSTER_CACHE = new Map<string, string>();

/** 抓取视频首帧作 poster:未播放的 <video> 元素在部分浏览器不显示帧画面(黑块),
 *  导航缩略图需要头像式首帧预览 */
function useVideoPoster(src: string | undefined): string | undefined {
  const [poster, setPoster] = useState<string | undefined>(src ? VIDEO_POSTER_CACHE.get(src) : undefined);
  useEffect(() => {
    if (!src) return;
    const cached = VIDEO_POSTER_CACHE.get(src);
    if (cached) { setPoster(cached); return; }
    let cancelled = false;
    const vid = document.createElement('video');
    vid.muted = true;
    vid.preload = 'auto';
    vid.src = src;
    vid.onloadeddata = () => {
      try { vid.currentTime = Math.min(0.1, (vid.duration || 0.1) / 2); } catch { /* 部分源 seek 失败则用首帧 */ }
    };
    vid.onseeked = () => {
      if (cancelled) return;
      try {
        const w = vid.videoWidth; const h = vid.videoHeight;
        if (!w || !h) return;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(vid, 0, 0, w, h);
        const url = canvas.toDataURL('image/jpeg', 0.72);
        VIDEO_POSTER_CACHE.set(src, url);
        if (!cancelled) setPoster(url);
      } catch { /* 跨域/解码失败静默降级为视频元素 */ }
    };
    return () => { cancelled = true; vid.src = ''; };
  }, [src]);
  return poster;
}

/** 未 hydrate 时的头像式占位：sourceType 图标骨架(不再显示灰块) */
function ThumbSkeleton({ card, dark }: { card: StackCard; dark: boolean }): React.ReactElement {
  const Icon = card.sourceType === 'video' ? Video : card.sourceType === 'image' ? ImageIcon : FileText;
  return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', color: dark ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.35)' }}><Icon size={14} strokeWidth={1.8} /></div>;
}

function Thumbnail({ card, dark }: { card: StackCard; dark: boolean }): React.ReactElement {
  const src = useHydratedContent(card.data.storageKey as string | undefined, (card.data.content as string | undefined) ?? '');
  if (card.sourceType !== 'image' && card.sourceType !== 'video') return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: dark ? 'rgba(255,255,255,0.55)' : 'rgba(15,23,42,0.45)' }}><FileText size={15} /></div>;
  if (!src) return <ThumbSkeleton card={card} dark={dark} />;
  if (card.sourceType === 'image') {
    return <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
  }
  return <VideoThumb src={src} />;
}

/** 视频缩略图:优先首帧 poster(头像式预览),poster 未就绪时回退 video 元素 */
function VideoThumb({ src }: { src: string }): React.ReactElement {
  const poster = useVideoPoster(src);
  return poster
    ? <img src={poster} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    : <video src={src} muted preload="auto" playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
}

/** 文本卡片编辑:完整编辑状态机(移植 text-node-view 交互契约,见 .trae 早期文档经验)
 *  - 非编辑态:静态渲染 HTML,不拦截指针 —— 单击选中/拖拽移动节点,与普通节点一致
 *  - 双击进入编辑态:挂载 contentEditable + 拖拽拦截(保留划词能力)
 *  - 退出白名单(document mousedown capture):胶囊工具栏渲染在节点树外部(canvas overlay,
 *    与节点是兄弟关系),closest('[data-node-shell]') 无法命中 —— 必须用 data 属性白名单
 *    [data-capsule-toolbar],否则点加粗等按钮会误退出编辑(早期文档核心经验)
 *  - 本地草稿:退出/卸载(切卡)时差异落盘,避免逐键污染命令历史 */
function StackTextEditor({ html, isDark, onCommit }: { html: string; isDark: boolean; onCommit: (html: string) => void }): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(html);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // ref 镜像供卸载 cleanup/退出回调读取最新值(避免 stale closure 丢落盘)
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const htmlRef = useRef(html);
  htmlRef.current = html;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => { setDraft(html); }, [html]);

  const commitIfChanged = useCallback((): void => {
    if (draftRef.current !== htmlRef.current) onCommitRef.current(draftRef.current);
  }, []);

  const exitEditing = useCallback((): void => {
    setIsEditing(false);
    commitIfChanged();
  }, [commitIfChanged]);

  // 进入编辑态后聚焦 contentEditable(对齐 text-node-view)
  useEffect(() => {
    if (!isEditing) return;
    const editable = wrapperRef.current?.querySelector('.zxe-content-editable') as HTMLElement | null;
    editable?.focus();
  }, [isEditing]);

  // 编辑态:点击节点外退出 —— 白名单机制(data 属性,不用 class 名)
  useEffect(() => {
    if (!isEditing) return;
    const handleMouseDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (wrapperRef.current?.contains(target)) return;
      if (target.closest('[data-node-shell]')) return;
      if (target.closest('[data-capsule-toolbar]')) return;
      if (target.closest('.zxe-rt-wrap')) return;
      exitEditing();
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => document.removeEventListener('mousedown', handleMouseDown, true);
  }, [isEditing, exitEditing]);

  // 卸载兜底:编辑中切卡/收纳导致组件卸载时落盘草稿
  useEffect(() => () => {
    if (draftRef.current !== htmlRef.current) onCommitRef.current(draftRef.current);
  }, []);

  // 编辑态拖拽拦截:编辑区外(padding 空白/工具条)阻断冒泡防节点拖拽,
  // 编辑区内部放行保留划词;双通道(pointer+mouse)对齐 text-node-view
  const interceptDrag = (e: React.PointerEvent | React.MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (!target.closest('.zxe-content-editable')) {
      e.stopPropagation();
    }
  };

  if (!isEditing) {
    // 非编辑态:静态 HTML —— 可单击选中/直接拖拽节点,双击才进编辑
    return (
      <div
        style={{ width: '100%', height: '100%', overflowY: 'auto', padding: '12px 16px', boxSizing: 'border-box', fontSize: 14, lineHeight: 1.6, cursor: 'text' }}
        onDoubleClick={() => setIsEditing(true)}
        dangerouslySetInnerHTML={{ __html: html || '<span style="opacity:0.5">双击编辑文本</span>' }}
      />
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="nodrag nopan nowheel"
      style={{ width: '100%', height: '100%', overflowY: 'auto', padding: '12px 16px', boxSizing: 'border-box', fontSize: 14, lineHeight: 1.6 }}
      onPointerDown={interceptDrag}
      onMouseDown={interceptDrag}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); exitEditing(); } }}
    >
      <SelfRichTextEditor value={draft} onChange={setDraft} hideToolbar isDark={isDark} onEscape={exitEditing} />
    </div>
  );
}

export function StackMediaContent({ card, width, height, isDark = false, onTextCommit }: { card: StackCard; width: number; height: number; isDark?: boolean; onTextCommit?: (cardId: string, html: string) => void }): React.ReactElement {
  if (card.sourceType === 'image') {
    return <StackImageContent src={(card.data.content as string | undefined) ?? ''} storageKey={card.data.storageKey as string | undefined} isDark={isDark} />;
  }
  if (card.sourceType === 'text') {
    // 文本卡片保留编辑能力:富文本编辑器,失焦落盘(对齐文本节点 data.content HTML 格式)
    const html = (card.data.content as string | undefined) ?? '';
    return <StackTextEditor html={html} isDark={isDark} onCommit={(next) => onTextCommit?.(card.id, next)} />;
  }
  if (card.sourceType !== 'video') {
    // 空态/未知类型占位底色统一为 contentSurface(与空文本卡一致,消除三类空卡色差)
    return <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', alignContent: 'center', gap: 10, color: isDark ? 'rgba(255,255,255,0.6)' : 'var(--color-text-secondary, #78716c)', background: isDark ? '#161616' : '#ffffff' }}><FileText size={28} strokeWidth={1.6} /><span style={{ maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{card.title || card.sourceType}</span></div>;
  }
  const node = { id: card.id, type: card.sourceType, title: card.title ?? '', data: card.data, size: { width, height }, position: { x: 0, y: 0 } } as NodeRendererProps['node'];
  return <VideoNodeView node={node} pins={[]} isSelected={true} isHovered={true} forceShowPins={false} updateNode={() => {}} invK={1} connectionController={null} contentOnly forcePlayback emptyBackground={isDark ? '#161616' : '#ffffff'} />;
}

function StackImageContent({ src, storageKey, isDark = false }: { src: string; storageKey?: string; isDark?: boolean }): React.ReactElement {
  const hydrated = useHydratedContent(storageKey, src);
  // 未 hydrate 占位底色统一为 contentSurface(与空文本卡一致,不再用 #555 灰块)
  return hydrated ? <img src={hydrated} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : <div style={{ width: '100%', height: '100%', background: isDark ? '#161616' : '#ffffff' }} />;
}

export function MainReplaceButton({ onClick, alwaysVisible = false }: { onClick: () => void; alwaysVisible?: boolean }): React.ReactElement {
  const [hover, setHover] = useState(false);
  // 视觉与 ReplaceButton(left) 对齐:左上角 6,6 · 24×24 · 圆角 6,纯 Upload icon
  // alwaysVisible:空态时常显(对齐图片节点空态 ReplaceButton alwaysVisible=true)
  const opacity = alwaysVisible ? (hover ? 0.85 : 1) : (hover ? 0.85 : 0);
  return <button type="button" title="替换当前卡片" aria-label="替换当前卡片" onClick={(event) => { event.stopPropagation(); onClick(); }} onPointerDown={(event) => event.stopPropagation()} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ position: 'absolute', left: 6, top: 6, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', transition: 'opacity 0.15s', zIndex: 10, opacity }}><Upload size={13} /></button>;
}

export function StackBottomNav({ cards, activeIndex, onJump, onPrev, onNext }: { cards: StackCard[]; activeIndex: number; onJump: (index: number) => void; onPrev: () => void; onNext: () => void }): React.ReactElement {
  const { theme } = useTheme();
  const dark = theme.mode === 'dark';
  const total = cards.length;
  // 宽度自适应:节点缩窄时缩略图 5→3→1 降档,保证导航永不溢出
  // 预算:箭头 26×2 + 页码 ≈34 + gap/padding ≈83 → 固定开销 ≈117,单缩略图 ≈38
  const navRef = useRef<HTMLDivElement>(null);
  const [navWidth, setNavWidth] = useState(620);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number' && w > 0) setNavWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // T10: 降档阈值 ±10px 滞回 —— resize 在阈值(300/220)附近逐帧抖动时，
  // 无滞回会让缩略图数量 1/3/5 反复切换(图标来回跳动)；升档需越过 阈值+10，降档需跌破 阈值-10
  const [thumbTier, setThumbTier] = useState<number>(THUMB_COUNT_MAX);
  useEffect(() => {
    setThumbTier((prev) => {
      const H = 10;
      let next = prev;
      if (next === THUMB_COUNT_MAX && navWidth < 300 - H) next = navWidth < 220 - H ? 1 : 3;
      else if (next === 3 && navWidth < 220 - H) next = 1;
      else if (next === 1 && navWidth >= 220 + H) next = navWidth >= 300 + H ? THUMB_COUNT_MAX : 3;
      else if (next === 3 && navWidth >= 300 + H) next = THUMB_COUNT_MAX;
      return next;
    });
  }, [navWidth]);
  const thumbCount = thumbTier;
  const half = Math.floor(thumbCount / 2);
  const start = Math.max(0, Math.min(activeIndex - half, Math.max(0, total - thumbCount)));
  // 导航底色对齐剧本节点「黑色标题栏」:暗色 #1b1b1b / 亮色 #fafaf7
  const navBg = dark ? '#1b1b1b' : '#fafaf7';
  const borderSubtle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
  const muted = dark ? 'rgba(255,255,255,0.68)' : 'var(--color-text-secondary, #57534e)';
  // 空态与有卡态同一底色/透明度,仅缩略图位显示空占位,不再整体发灰
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
    padding: 2,
    transition: 'box-shadow 0.15s, transform 0.15s',
  };
  return <div ref={navRef} style={{ display: 'flex', alignItems: 'center', width: '100%', height: 48, padding: '0 8px', gap: 5, background: navBg, borderRadius: '0 0 8px 8px', minWidth: 0, overflow: 'hidden' }}>
    <button
      type="button"
      title="上一张"
      aria-label="上一张"
      disabled={activeIndex <= 0}
      onClick={onPrev}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseEnter={(e) => Object.assign(e.currentTarget.style, arrowHover(activeIndex <= 0))}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = muted; }}
      style={arrowStyle(activeIndex <= 0)}
    ><ChevronLeft size={17} /></button>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'center', minWidth: 0 }}>{Array.from({ length: thumbCount }, (_, offset) => {
      const index = start + offset; const card = cards[index];
      return card ? (
        <button
          key={card.id}
          type="button"
          title={card.title ?? card.sourceType}
          aria-label={`切换到 ${card.title ?? card.sourceType}`}
          onClick={() => onJump(index)}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            ...thumbBtnBase,
            outline: index === activeIndex ? `2px solid var(--color-primary, #e94560)` : 'none',
            outlineOffset: 2,
            boxShadow: index === activeIndex ? `0 0 0 2px ${navBg}, 0 0 0 3.5px var(--color-primary, #e94560)` : 'none',
          }}
        ><Thumbnail card={card} dark={dark} /></button>
      ) : <div key={`empty-${offset}`} style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 999, border: `1px dashed ${borderSubtle}`, background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)' }} />;
    })}</div>
    <button
      type="button"
      title="下一张"
      aria-label="下一张"
      disabled={activeIndex >= total - 1}
      onClick={onNext}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseEnter={(e) => Object.assign(e.currentTarget.style, arrowHover(activeIndex >= total - 1))}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = muted; }}
      style={arrowStyle(activeIndex >= total - 1)}
    ><ChevronRight size={17} /></button>
    <span style={{ color: muted, fontSize: 12, minWidth: 24, textAlign: 'center', fontVariantNumeric: 'tabular-nums', flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeIndex + 1}/{total}</span>
  </div>;
}
