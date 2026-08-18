/** StackNode 的纯呈现组件：媒体预览、替换按钮和导航，不持有图事务状态。 */

import { useState } from 'react';
import { FileText, Upload } from 'lucide-react';
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
  return <VideoNodeView node={node} pins={[]} isSelected={false} isHovered={false} forceShowPins={false} updateNode={() => {}} invK={1} connectionController={null} contentOnly />;
}

function StackImageContent({ src, storageKey }: { src: string; storageKey?: string }): React.ReactElement {
  const hydrated = useHydratedContent(storageKey, src);
  return hydrated ? <img src={hydrated} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : <div style={{ width: '100%', height: '100%', background: '#555' }} />;
}

export function MainReplaceButton({ onClick }: { onClick: () => void }): React.ReactElement {
  const [hover, setHover] = useState(false);
  return <button type="button" title="替换当前卡片" aria-label="替换当前卡片" onClick={(event) => { event.stopPropagation(); onClick(); }} onPointerDown={(event) => event.stopPropagation()} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ position: 'absolute', left: 8, bottom: 8, width: 28, height: 28, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 999, background: 'rgba(15,23,42,0.72)', color: '#fff', cursor: 'pointer', opacity: hover ? 1 : 0, transform: hover ? 'scale(1)' : 'scale(0.92)', transition: 'opacity 0.15s, transform 0.15s', zIndex: 10 }}><Upload size={14} /></button>;
}

export function StackBottomNav({ cards, activeIndex, onJump, onPrev, onNext }: { cards: StackCard[]; activeIndex: number; onJump: (index: number) => void; onPrev: () => void; onNext: () => void }): React.ReactElement {
  const { theme } = useTheme();
  const dark = theme.mode === 'dark';
  const total = cards.length;
  const start = Math.max(0, Math.min(activeIndex - 2, Math.max(0, total - THUMB_COUNT)));
  const muted = dark ? 'rgba(255,255,255,0.68)' : 'var(--color-text-secondary, #57534e)';
  const arrowStyle = (disabled: boolean): React.CSSProperties => ({ width: 30, height: 30, border: 'none', borderRadius: 999, background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', color: muted, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.35 : 1, padding: 0, fontSize: 16 });
  return <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: 48, padding: '0 8px', gap: 5 }}>
    <button type="button" title="上一张" aria-label="上一张" disabled={activeIndex <= 0} onClick={onPrev} onPointerDown={(event) => event.stopPropagation()} style={arrowStyle(activeIndex <= 0)}>&#10094;</button>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'center' }}>{Array.from({ length: THUMB_COUNT }, (_, offset) => {
      const index = start + offset; const card = cards[index];
      return card ? <button key={card.id} type="button" title={card.title ?? card.sourceType} aria-label={`切换到 ${card.title ?? card.sourceType}`} onClick={() => onJump(index)} onPointerDown={(event) => event.stopPropagation()} style={{ width: 34, height: 34, border: 'none', outline: index === activeIndex ? '2px solid var(--color-primary, #e94560)' : 'none', outlineOffset: 2, borderRadius: 999, overflow: 'hidden', cursor: 'pointer', background: dark ? 'rgba(255,255,255,0.1)' : '#fff', padding: 2 }}><Thumbnail card={card} /></button> : <div key={`empty-${offset}`} style={{ width: 34, height: 34, borderRadius: 999, background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)' }} />;
    })}</div>
    <button type="button" title="下一张" aria-label="下一张" disabled={activeIndex >= total - 1} onClick={onNext} onPointerDown={(event) => event.stopPropagation()} style={arrowStyle(activeIndex >= total - 1)}>&#10095;</button>
    <span style={{ color: muted, fontSize: 12, minWidth: 34, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{activeIndex + 1}/{total}</span>
  </div>;
}
