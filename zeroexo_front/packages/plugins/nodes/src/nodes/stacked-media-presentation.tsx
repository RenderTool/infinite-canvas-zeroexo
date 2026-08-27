/** StackNode 的纯呈现组件：媒体预览、替换按钮和导航，不持有图事务状态。 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Upload, Video } from 'lucide-react';
import type { NodeRendererProps } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { VideoNodeView } from './video-node-view.js';
import { SelfRichTextEditor } from '../rich-text-editor/SelfRichTextEditor.js';
import { useHydratedContent, usePreviewImage, resolveAnyThumbUrl, resolveContentUrl } from '../utils/hydrate.js';
import { resolveVideoThumbnail } from '@zeroexo/plugin-persistence';
import type { StackCard } from './stacked-media-types.js';
import { ThumbNav } from './thumb-nav.js';

/** 未 hydrate 时的头像式占位：sourceType 图标骨架(不再显示灰块) */
function ThumbSkeleton({ card, dark }: { card: StackCard; dark: boolean }): React.ReactElement {
  const Icon = card.sourceType === 'video' ? Video : card.sourceType === 'image' ? ImageIcon : FileText;
  return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', color: dark ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.35)' }}><Icon size={14} strokeWidth={1.8} /></div>;
}

/** 视频缩略图:回退链(持久化缩略图→后端 thumb→重建内容 URL video 首帧),不加载全量视频;
 *  无缩略图时回退图标骨架,不渲染黑块 */
function VideoCardThumb({ storageKey, content, dark }: { storageKey?: string; content?: string; dark: boolean }): React.ReactElement {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!storageKey) return;
    let cancelled = false;
    // 回退链:持久化缩略图 → 后端 thumb 级资源 → 重建内容 URL(video preload=metadata 首帧)
    (async () => {
      // 1. 持久化缩略图(video-node-view 上传/播放时经 storeVideoThumbnail 存入)
      try {
        const persisted = await resolveVideoThumbnail(storageKey);
        if (persisted && !cancelled) { setThumbUrl(persisted); return; }
      } catch { /* 继续下一级 */ }
      // 2. 后端 thumb 级资源(resources/ 后端 size=thumb 认证链路)
      const thumb = await resolveAnyThumbUrl(storageKey);
      if (thumb && !cancelled) { setThumbUrl(thumb); return; }
      // 3. 重建内容 URL(刷新后 blob 失效场景,本地键从 IndexedDB 读,零网络)
      const src = await resolveContentUrl(storageKey, content ?? '');
      if (src && !cancelled) setVideoSrc(src);
    })();
    return () => { cancelled = true; };
  }, [storageKey, content]);
  if (thumbUrl) {
    return <img src={thumbUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
  }
  if (videoSrc) {
    // 小槽位 video 回退:preload=metadata 仅拉头部显示首帧,不加载全量视频
    return <video src={videoSrc} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
  }
  return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', color: dark ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.35)' }}><Video size={14} strokeWidth={1.8} /></div>;
}

function Thumbnail({ card, dark, quality = 'sm' }: { card: StackCard; dark: boolean; quality?: 'sm' | 'preview' }): React.ReactElement {
  if (card.sourceType !== 'image' && card.sourceType !== 'video') return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: dark ? 'rgba(255,255,255,0.55)' : 'rgba(15,23,42,0.45)' }}><FileText size={15} /></div>;
  if (card.sourceType === 'video') {
    return <VideoCardThumb storageKey={card.data.storageKey as string | undefined} content={(card.data.content as string | undefined) ?? ''} dark={dark} />;
  }
  return <ImageCardThumb storageKey={card.data.storageKey as string | undefined} content={(card.data.content as string | undefined) ?? ''} card={card} dark={dark} quality={quality} />;
}

/** 供详情面板(StackDetailsModal)/导航复用:卡片缩略图(视频回退链 + 图标骨架);
 *  quality:'sm'=导航条小槽位(后端 sm 级省带宽),'preview'=详情面板大格子(预览图级,
 *  三档图片契约征集 #77:展示层自适应不拉原图,原图只在图片浏览器) */
export { Thumbnail };

function ImageCardThumb({ storageKey, content, card, dark, quality = 'sm' }: { storageKey?: string; content: string; card: StackCard; dark: boolean; quality?: 'sm' | 'preview' }): React.ReactElement {
  // 大格子走 preview 级(征集 #77 纠正 #75:不再用原图级,后端无变体自动回退原图保证旧图不黑)
  const previewSrc = usePreviewImage(quality === 'preview' ? storageKey : undefined, quality === 'preview' ? content : '');
  // 小槽位(导航条 34px)优先 thumb 级资源(resources/ 后端 size=sm),回退全量 hydrate;
  const fallbackSrc = useHydratedContent(quality === 'sm' ? storageKey : undefined, quality === 'sm' ? content : '');
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (quality !== 'sm') { setThumb(null); return; }
    let cancelled = false;
    resolveAnyThumbUrl(storageKey).then((u) => { if (!cancelled) setThumb(u); });
    return () => { cancelled = true; };
  }, [storageKey, quality]);
  const final = quality === 'preview' ? previewSrc : (thumb || fallbackSrc);
  if (!final) return <ThumbSkeleton card={card} dark={dark} />;
  return <img src={final} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
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
        dangerouslySetInnerHTML={{ __html: html }}
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

export function StackMediaContent({ card, width, height, isDark = false, onTextCommit, invK = 1, isSelected = true, isHovered = true }: { card: StackCard; width: number; height: number; isDark?: boolean; onTextCommit?: (cardId: string, html: string) => void; invK?: number; isSelected?: boolean; isHovered?: boolean }): React.ReactElement {
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
  return <VideoNodeView node={node} pins={[]} isSelected={isSelected} isHovered={isHovered} forceShowPins={false} updateNode={() => {}} invK={invK} connectionController={null} contentOnly forcePlayback={isSelected && isHovered} emptyBackground={isDark ? '#161616' : '#ffffff'} />;
}

function StackImageContent({ src, storageKey, isDark = false }: { src: string; storageKey?: string; isDark?: boolean }): React.ReactElement {
  // 堆叠活跃卡封面:三档契约(征集 #77)展示层自适应 — preview 级,不拉原图,
  // 原图仅在点击后的图片浏览器(AssetDetailViewer)中使用
  const hydrated = usePreviewImage(storageKey, src);
  // 未 hydrate 时显示图标骨架而非空白
  if (!hydrated) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDark ? '#161616' : '#ffffff', color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.35)' }}>
        <ImageIcon size={28} strokeWidth={1.6} />
      </div>
    );
  }
  return <img src={hydrated} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />;
}

export function MainReplaceButton({ onClick, visible = false }: { onClick: () => void; visible?: boolean }): React.ReactElement {
  const [hover, setHover] = useState(false);
  // 视觉与 ReplaceButton(left) 对齐:左上角 6,6 · 24×24 · 圆角 6,纯 Upload icon
  // 显隐语义与胶囊工具栏"选中显示"对齐:无论是否空节点,仅节点激活(选中)时显示 —— 保持卡片视觉清爽
  const opacity = visible ? (hover ? 0.85 : 1) : 0;
  // 隐藏时同步屏蔽指针事件(opacity 0 仍接收点击)
  const pointerEvents = visible ? 'auto' : 'none';
  return <button type="button" title="替换当前卡片" aria-label="替换当前卡片" onClick={(event) => { event.stopPropagation(); onClick(); }} onPointerDown={(event) => event.stopPropagation()} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ position: 'absolute', left: 6, top: 6, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', transition: 'opacity 0.15s', zIndex: 10, opacity, pointerEvents }}><Upload size={13} /></button>;
}

export function StackBottomNav({ cards, activeIndex, onJump, onPrev, onNext }: { cards: StackCard[]; activeIndex: number; onJump: (index: number) => void; onPrev: () => void; onNext: () => void }): React.ReactElement {
  const { theme } = useTheme();
  const dark = theme.mode === 'dark';
  // 通用缩略图导航(thumb-nav.tsx):宽度自适应降档 5→3→1 + 上限5滑动窗口 + 1/N 页码,
  // 行为契约与主体节点垂直导航完全一致(同一套框架)
  return (
    <ThumbNav
      orientation="horizontal"
      items={cards.map((card) => ({ id: card.id, title: card.title ?? card.sourceType, thumb: <Thumbnail card={card} dark={dark} /> }))}
      activeIndex={activeIndex}
      total={cards.length}
      onPrev={onPrev}
      onNext={onNext}
      onJump={onJump}
    />
  );
}
