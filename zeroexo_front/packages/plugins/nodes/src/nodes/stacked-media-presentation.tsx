/** StackNode 的纯呈现组件：媒体预览、替换按钮和导航，不持有图事务状态。 */

import { useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Upload } from 'lucide-react';
import type { NodeRendererProps } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { VideoNodeView } from './video-node-view.js';
import { useHydratedContent } from '../utils/hydrate.js';
import type { StackCard } from './stacked-media-types.js';

const THUMB_COUNT = 5;

function Thumbnail({ card }: { card: StackCard }): React.ReactElement {
  const src = useHydratedContent(card.data.storageKey as string | undefined, (card.data.content as string | undefined) ?? '');
  if (card.sourceType !== 'image' && card.sourceType !== 'video') return <FileText size={15} />;
  if (!src) return <div style={{ width: '100%', height: '100%', background: '#555' }} />;
  return card.sourceType === 'image'
    ? <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    : <video src={src} muted preload="metadata" playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
}

export function StackMediaContent({ card, width, height }: { card: StackCard; width: number; height: number }): React.ReactElement {
  if (card.sourceType === 'image') {
    return <StackImageContent src={(card.data.content as string | undefined) ?? ''} storageKey={card.data.storageKey as string | undefined} />;
  }
  if (card.sourceType !== 'video') {
    return <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', alignContent: 'center', gap: 10, color: 'var(--color-text-secondary, #78716c)', background: 'var(--color-bg-surface, #f5f5f4)' }}><FileText size={28} strokeWidth={1.6} /><span style={{ maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{card.title || card.sourceType}</span></div>;
  }
  const node = { id: card.id, type: card.sourceType, title: card.title ?? '', data: card.data, size: { width, height }, position: { x: 0, y: 0 } } as NodeRendererProps['node'];
  return <VideoNodeView node={node} pins={[]} isSelected={true} isHovered={true} forceShowPins={false} updateNode={() => {}} invK={1} connectionController={null} contentOnly forcePlayback />;
}

function StackImageContent({ src, storageKey }: { src: string; storageKey?: string }): React.ReactElement {
  const hydrated = useHydratedContent(storageKey, src);
  return hydrated ? <img src={hydrated} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : <div style={{ width: '100%', height: '100%', background: '#555' }} />;
}

export function MainReplaceButton({ onClick }: { onClick: () => void }): React.ReactElement {
  const [hover, setHover] = useState(false);
  // 视觉与 ReplaceButton(left) 对齐:左上角 6,6 · 24×24 · 圆角 6,纯 Upload icon(hover 显示)
  return <button type="button" title="替换当前卡片" aria-label="替换当前卡片" onClick={(event) => { event.stopPropagation(); onClick(); }} onPointerDown={(event) => event.stopPropagation()} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ position: 'absolute', left: 6, top: 6, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', transition: 'opacity 0.15s', zIndex: 10, opacity: hover ? 0.85 : 0 }}><Upload size={13} /></button>;
}

export function StackBottomNav({ cards, activeIndex, onJump, onPrev, onNext }: { cards: StackCard[]; activeIndex: number; onJump: (index: number) => void; onPrev: () => void; onNext: () => void }): React.ReactElement {
  const { theme } = useTheme();
  const dark = theme.mode === 'dark';
  const total = cards.length;
  const start = Math.max(0, Math.min(activeIndex - 2, Math.max(0, total - THUMB_COUNT)));
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
    border: 'none',
    borderRadius: 999,
    overflow: 'hidden',
    cursor: 'pointer',
    background: dark ? 'rgba(255,255,255,0.1)' : '#fff',
    padding: 2,
    transition: 'box-shadow 0.15s, transform 0.15s',
  };
  return <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: 48, padding: '0 8px', gap: 5, background: navBg, borderRadius: '0 0 8px 8px' }}>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'center' }}>{Array.from({ length: THUMB_COUNT }, (_, offset) => {
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
        ><Thumbnail card={card} /></button>
      ) : <div key={`empty-${offset}`} style={{ width: 34, height: 34, borderRadius: 999, border: `1px dashed ${borderSubtle}`, background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)' }} />;
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
    <span style={{ color: muted, fontSize: 12, minWidth: 34, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{activeIndex + 1}/{total}</span>
  </div>;
}
