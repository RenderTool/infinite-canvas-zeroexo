/**
 * StackNodeView - 堆叠媒体节点视图
 *
 * 设计参考: image-viewer.html
 * 单卡片视图 + 底部导航栏(左箭头 + 圆形缩略图 + 右箭头 + 页码)
 *
 * 布局:
 * - 上部: 单卡片内容区(占满节点内容区)
 * - 下部: 底部固定导航栏(透明背景,跟随节点缩放)
 *
 * 使用 BaseNodeView 作为外壳,提供统一的 PIN 渲染和标题栏。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Upload } from 'lucide-react';
import { UpdateNodeDataCommand } from '@zeroexo/core';
import { uploadImage, uploadMediaFile } from '@zeroexo/plugin-persistence';
import type { EdgeRecord, NodeRecord, NodeRendererProps } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView } from '../base-node-view.js';
import { VideoNodeView } from './video-node-view.js';
import { useHydratedContent } from '../utils/hydrate.js';
import { StackCollectToast } from './stacked-media-toast.js';
import { collectCard, undoCollect as undoCollectModel } from './stacked-media-model.js';
import {
  parseStackedMediaData,
  type StackCard,
} from './stacked-media-types.js';

export interface StackedMediaNodeViewProps extends NodeRendererProps {
  connectionController: ConnectionController | null;
  /** 画布图 store(订阅入边渲染连线预览行) */
  store?: ReactGraphStore | null;
}

/** 非打扰式收纳提示快照(胶囊「移除」据此反向恢复) */
interface CollectSnapshot {
  label: string;
  sourceNode: NodeRecord;
  edge: EdgeRecord;
  cardId: string;
  prevActiveIndex: number;
  prevCards: StackCard[];
}

// ===== 布局常量 =====

/** 切换动画时长(期间视频渲染静帧缩略图) */
const SWITCH_ANIM_MS = 300;

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ===== 媒体缩略图(hydrate 感知) =====

function MediaThumbnail({
  cardData,
  type,
  style,
}: {
  cardData: Record<string, unknown>;
  type: 'image' | 'video';
  style?: React.CSSProperties;
}): React.ReactElement {
  const content = (cardData?.content as string | undefined) ?? '';
  const storageKey = cardData?.storageKey as string | undefined;
  const src = useHydratedContent(storageKey, content);

  if (!src) {
    return <div style={{ width: '100%', height: '100%', background: '#555', ...style }} />;
  }
  if (type === 'image') {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', ...style }}
      />
    );
  }
  return (
    <video
      src={src}
      muted
      preload="metadata"
      playsInline
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none', ...style }}
    />
  );
}

/** 根据卡片类型渲染对应媒体内容 */
function renderCardContent(
  card: StackCard,
  cardWidth: number,
  cardHeight: number,
): React.ReactElement {
  if (card.sourceType === 'image') {
    // 使用图片原生渲染(更轻量)
    const content = (card.data?.content as string | undefined) ?? '';
    const storageKey = card.data?.storageKey as string | undefined;
    return <ImageContent src={content} storageKey={storageKey} />;
  }

  // 视频: 使用 VideoNodeView contentOnly 渲染
  const virtualNode = {
    id: card.id,
    type: card.sourceType,
    title: card.title ?? '',
    data: card.data,
    size: { width: cardWidth, height: cardHeight },
    position: { x: 0, y: 0 },
  } as unknown as NodeRendererProps['node'];

  const props = {
    node: virtualNode,
    pins: [],
    isSelected: false,
    isHovered: false,
    forceShowPins: false,
    updateNode: () => {},
    invK: 1,
    connectionController: null,
    contentOnly: true,
  } as NodeRendererProps & { contentOnly: boolean; connectionController: ConnectionController | null };

  return <VideoNodeView {...props} />;
}

function ImageContent({ src, storageKey }: { src: string; storageKey?: string }): React.ReactElement {
  const hydratedSrc = useHydratedContent(storageKey, src);
  if (!hydratedSrc) {
    return <div style={{ width: '100%', height: '100%', background: '#555' }} />;
  }
  return (
    <img
      src={hydratedSrc}
      alt=""
      draggable={false}
      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
    />
  );
}

/** 主图区替换按钮:hover 父容器显示,复用 base-node-view ReplaceButton 的视觉 */
function MainReplaceButton({ onClick }: { onClick: () => void }): React.ReactElement {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      title="替换当前卡片"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        left: 6,
        bottom: 6,
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        border: 'none',
        background: 'rgba(0,0,0,0.55)',
        color: '#fff',
        cursor: 'pointer',
        transition: 'opacity 0.15s',
        zIndex: 10,
        opacity: hover ? 0.85 : 0,
      }}
    >
      <Upload size={13} />
    </button>
  );
}

// ===== 底部导航栏(完全复刻 image-viewer.html:两端箭头 + 滑动窗口缩略图 + 页码) =====

/** 固定缩略图数量 */
const FIXED_THUMB_COUNT = 5;

/** 滑动窗口:以 activeIndex 为中心,两端 clamp 到合法范围 */
function windowRange(activeIndex: number, total: number): { start: number; count: number } {
  if (total <= FIXED_THUMB_COUNT) return { start: 0, count: total };
  let start = activeIndex - Math.floor(FIXED_THUMB_COUNT / 2);
  if (start < 0) start = 0;
  if (start + FIXED_THUMB_COUNT > total) start = total - FIXED_THUMB_COUNT;
  return { start, count: FIXED_THUMB_COUNT };
}

function BottomNav({
  cards,
  activeIndex,
  onJump,
  onPrev,
  onNext,
}: {
  cards: StackCard[];
  activeIndex: number;
  onJump: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
}): React.ReactElement {
  const { theme } = useTheme();
  const total = cards.length;
  const isDark = theme.mode === 'dark';

  const borderColor = isDark ? 'rgba(255,255,255,0.15)' : 'var(--color-border, #e7e5e4)';
  const textMuted = isDark ? 'rgba(255,255,255,0.7)' : 'var(--color-text-secondary, #57534e)';
  const pageColor = isDark ? 'rgba(255,255,255,0.5)' : 'var(--color-text-tertiary, #a8a29e)';
  const hoverPrimary = 'var(--color-primary, #e94560)';

  // 箭头按钮样式(完全复刻 image-viewer.html;禁用态降透明度)
  const makeArrowStyle = (disabled: boolean): React.CSSProperties => ({
    width: 32,
    height: 32,
    border: `1px solid ${borderColor}`,
    borderRadius: '50%',
    background: isDark ? 'transparent' : 'var(--color-bg-page, #ffffff)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: 14,
    color: textMuted,
    userSelect: 'none',
    flexShrink: 0,
    padding: 0,
    opacity: disabled ? 0.35 : 1,
    transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
  });

  const onArrowEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.borderColor = hoverPrimary;
    e.currentTarget.style.color = hoverPrimary;
    e.currentTarget.style.transform = 'scale(1.1)';
  };
  const onArrowLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.borderColor = borderColor;
    e.currentTarget.style.color = textMuted;
    e.currentTarget.style.transform = 'scale(1)';
  };

  // 滑动窗口:始终渲染 5 格,窗口内有卡片的位置显示缩略图,其余为虚线占位
  const win = windowRange(activeIndex, total);
  const slots = Array.from({ length: FIXED_THUMB_COUNT }, (_, i) => {
    const realIndex = win.start + i;
    const card = realIndex < total ? cards[realIndex] : undefined;
    return card ? { card, realIndex } : null;
  });
  const prevDisabled = activeIndex <= 0;
  const nextDisabled = activeIndex >= total - 1;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        height: 48,
        padding: '0 8px',
        gap: 4,
      }}
    >
      {/* 左箭头(导航栏最左端,首张禁用) */}
      <button
        type="button"
        onClick={onPrev}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={prevDisabled}
        style={makeArrowStyle(prevDisabled)}
        title="上一张"
        onMouseEnter={prevDisabled ? undefined : onArrowEnter}
        onMouseLeave={prevDisabled ? undefined : onArrowLeave}
      >
        &#10094;
      </button>

      {/* 滑动窗口圆形缩略图(始终 5 格,中间弹性区) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        {slots.map((slot, i) => {
          if (!slot) {
            // 窗口外占位:虚线边框
            return (
              <div
                key={`empty-${i}`}
                style={{
                  width: 40,
                  height: 40,
                  border: `2px dashed ${isDark ? 'rgba(255,255,255,0.12)' : 'var(--color-border, #e7e5e4)'}`,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: 'transparent',
                  opacity: 0.5,
                }}
              />
            );
          }
          const isActive = slot.realIndex === activeIndex;
          return (
            <div
              key={slot.card.id}
              onClick={() => onJump(slot.realIndex)}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                width: 40,
                height: 40,
                border: `2px solid ${isActive ? hoverPrimary : 'transparent'}`,
                borderRadius: '50%',
                overflow: 'hidden',
                cursor: 'pointer',
                flexShrink: 0,
                background: isDark ? 'rgba(255,255,255,0.1)' : 'var(--color-bg-page, #ffffff)',
                padding: 2,
                transition: 'border-color 0.2s ease-out, transform 0.2s ease-out',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.3)' : 'var(--color-border-strong, #d6d3d1)';
                  e.currentTarget.style.transform = 'scale(1.08)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.borderColor = 'transparent';
                  e.currentTarget.style.transform = 'scale(1)';
                }
              }}
              title={slot.card.title ?? slot.card.sourceType}
            >
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden' }}>
                <MediaThumbnail cardData={slot.card.data} type={slot.card.sourceType} />
              </div>
            </div>
          );
        })}
      </div>

      {/* 右箭头(导航栏最右端,末张禁用) + 页码 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onNext}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={nextDisabled}
          style={makeArrowStyle(nextDisabled)}
          title="下一张"
          onMouseEnter={nextDisabled ? undefined : onArrowEnter}
          onMouseLeave={nextDisabled ? undefined : onArrowLeave}
        >
          &#10095;
        </button>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: pageColor,
            minWidth: 32,
            textAlign: 'center',
            userSelect: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {total > 0 ? `${activeIndex + 1}/${total}` : '0/0'}
        </span>
      </div>
    </div>
  );
}

/** StackNodeView 主组件 */
export function StackedMediaNodeView({
  node,
  pins,
  isSelected,
  isHovered,
  forceShowPins,
  updateNode,
  invK,
  connectionController,
  externalRenaming,
  onRenameFinish,
  commandQueue,
  store,
}: StackedMediaNodeViewProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const data = parseStackedMediaData(node.data as Record<string, unknown> | undefined);
  const [activeIndex, setActiveIndex] = useState(data.activeIndex);
  /** 切换动画期间(true 时所有卡片渲染静帧缩略图,视频暂停渲染) */
  const [isAnimating, setIsAnimating] = useState(false);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, []);

  // 同步外部数据变更(移出/撤销等)
  useEffect(() => {
    if (data.activeIndex !== activeIndex && !isAnimating) {
      setActiveIndex(data.activeIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.activeIndex]);

  // 卡片数量变化时钳制活跃索引(外部删除卡片场景)
  useEffect(() => {
    if (data.cards.length > 0 && activeIndex > data.cards.length - 1) {
      setActiveIndex(data.cards.length - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.cards.length]);

  // ===== 订阅 graph:检测入边(连入 Popconfirm) =====
  const [graphVersion, setGraphVersion] = useState(0);
  useEffect(() => {
    if (!store) return;
    const unsub = store.subscribeGraph(() => setGraphVersion((v) => v + 1));
    return unsub;
  }, [store]);

  const incomingPreviews = useMemo(() => {
    if (!store) return [] as Array<{ edge: EdgeRecord; sourceNode: NodeRecord }>;
    const graph = store.getGraph();
    const result: Array<{ edge: EdgeRecord; sourceNode: NodeRecord }> = [];
    for (const edge of graph.edges) {
      if (edge.target.nodeId !== node.id || edge.target.pinId !== 'prompt') continue;
      const sourceNode = graph.nodes.find((n) => n.id === edge.source.nodeId);
      if (sourceNode && (sourceNode.type === 'image' || sourceNode.type === 'video')) {
        result.push({ edge, sourceNode });
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, node.id, graphVersion]);

  // 非打扰式收纳:检测到新连线(image/video 源连入 prompt pin)时直接自动收纳,
  // 画布锚定胶囊提示 5 秒内可「移除」撤销,不弹窗
  const [collectToast, setCollectToast] = useState<CollectSnapshot | null>(null);

  const handledEdgesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (incomingPreviews.length === 0) return;
    for (const { edge, sourceNode } of incomingPreviews) {
      if (handledEdgesRef.current.has(edge.id)) continue;
      handledEdgesRef.current.add(edge.id);
      handleCollectRef.current(edge, sourceNode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingPreviews.length]);

  /** 开始切换动画(期间视频渲染静帧缩略图) */
  const beginSwitchAnimation = useCallback(() => {
    setIsAnimating(true);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = setTimeout(() => setIsAnimating(false), SWITCH_ANIM_MS);
  }, []);

  const handlePrev = useCallback(() => {
    if (activeIndex > 0) {
      beginSwitchAnimation();
      setActiveIndex(activeIndex - 1);
      updateNode({ data: { ...data, activeIndex: activeIndex - 1 } });
    }
  }, [activeIndex, data, updateNode, beginSwitchAnimation]);

  const handleNext = useCallback(() => {
    if (activeIndex < data.cards.length - 1) {
      beginSwitchAnimation();
      setActiveIndex(activeIndex + 1);
      updateNode({ data: { ...data, activeIndex: activeIndex + 1 } });
    }
  }, [activeIndex, data, updateNode, beginSwitchAnimation]);

  const handleJump = useCallback((index: number) => {
    if (index === activeIndex) return;
    beginSwitchAnimation();
    setActiveIndex(index);
    updateNode({ data: { ...data, activeIndex: index } });
  }, [activeIndex, data, updateNode, beginSwitchAnimation]);

  // ===== 收纳:连线预览 → 卡片(删边 + 删源节点 + 追加卡片,自动执行 + 胶囊可撤销) =====
  const handleCollect = useCallback((edge: EdgeRecord, sourceNode: NodeRecord) => {
    if (!commandQueue) return;
    const result = collectCard(node.id, data, sourceNode, edge);
    commandQueue.execute(result.command);
    setActiveIndex(result.cards.length - 1);
    // 画布锚定胶囊快照(仅保留最近一次可撤销)
    setCollectToast({
      label: `已收纳 · ${sourceNode.type === 'video' ? '视频' : '图片'}`,
      sourceNode,
      edge,
      cardId: result.cardId,
      prevActiveIndex: data.activeIndex,
      prevCards: data.cards,
    });
  }, [commandQueue, data.cards, data.activeIndex, node.id]);

  // 用 ref 保存 handleCollect 供入边 effect 使用(避免 stale closure)
  const handleCollectRef = useRef(handleCollect);
  handleCollectRef.current = handleCollect;

  // ===== 撤销收纳:恢复源节点 + 连线 + 卡片列表(快照反向命令,不依赖 undo 栈) =====
  const handleUndoCollect = useCallback(() => {
    if (!collectToast || !commandQueue) return;
    const { sourceNode, edge, prevActiveIndex, prevCards } = collectToast;
    const result = undoCollectModel(node.id, sourceNode, edge, prevCards, prevActiveIndex);
    commandQueue.execute(result.command);
    setActiveIndex(result.activeIndex);
  }, [collectToast, commandQueue, node.id]);

  // ===== 上传:文件 → StackCard 追加(空态/有卡态均可) =====
  const [uploading, setUploading] = useState(false);
  const emptyFileInputRef = useRef<HTMLInputElement>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  /** 上传单个文件 → StackCard(图片走 uploadImage,视频走 uploadMediaFile) */
  const fileToCard = useCallback(async (file: File): Promise<StackCard | null> => {
    const fileName = file.name.replace(/\.[^.]+$/, '');
    if (file.type.startsWith('image/')) {
      const img = await uploadImage(file);
      return {
        id: genId('card'),
        sourceType: 'image',
        data: {
          content: img.url,
          storageKey: img.storageKey,
          status: 'success',
          naturalWidth: img.width,
          naturalHeight: img.height,
          mimeType: img.mimeType,
        },
        title: fileName,
        size: node.size ?? { width: 620, height: 348 },
      };
    }
    if (file.type.startsWith('video/')) {
      const media = await uploadMediaFile(file, 'video');
      return {
        id: genId('card'),
        sourceType: 'video',
        data: {
          content: media.url,
          storageKey: media.storageKey,
          status: 'success',
          naturalWidth: media.width,
          naturalHeight: media.height,
          durationMs: media.durationMs,
          mimeType: media.mimeType,
        },
        title: fileName,
        size: node.size ?? { width: 620, height: 348 },
      };
    }
    return null;
  }, [node.size]);

  /** 多文件追加为卡片(空态上传入口) */
  const handleFilesPick = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0 || !commandQueue || uploading) return;
    setUploading(true);
    const newCards: StackCard[] = [];
    for (const file of Array.from(files)) {
      try {
        const card = await fileToCard(file);
        if (card) newCards.push(card);
      } catch (err) {
        console.warn('[StackNode] 上传失败:', file.name, err);
      }
    }
    if (newCards.length > 0) {
      const updatedCards = [...data.cards, ...newCards];
      // 跳到本次上传的第一张
      const nextActive = updatedCards.length - newCards.length;
      commandQueue.execute(new UpdateNodeDataCommand(node.id, {
        cards: updatedCards,
        activeIndex: nextActive,
      } as Record<string, unknown>));
      setActiveIndex(nextActive);
    }
    setUploading(false);
  }, [commandQueue, uploading, fileToCard, data.cards, node.id]);

  const hasCards = data.cards.length > 0;

  // 标题栏图标
  const titleIcon = <Package size={14} />;

  const activeCard = hasCards ? data.cards[activeIndex] : null;

  /** 替换活跃卡片内容(主图区替换按钮) */
  const handleReplacePick = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !commandQueue || uploading || !activeCard) return;
    setUploading(true);
    try {
      const card = await fileToCard(file);
      if (card) {
        const updatedCards = data.cards.map((c, i) => (i === activeIndex ? card : c));
        commandQueue.execute(new UpdateNodeDataCommand(node.id, {
          cards: updatedCards,
        } as Record<string, unknown>));
      }
    } catch (err) {
      console.warn('[StackNode] 替换失败:', file.name, err);
    }
    setUploading(false);
  }, [commandQueue, uploading, activeCard, fileToCard, data.cards, activeIndex, node.id]);

  // ===== 内容区 =====
  const mainContent = !hasCards ? (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      color: theme.toolbar.textMuted,
      // 空态背景与有卡态主图区一致,消除"合入后发灰"
      background: theme.node.contentBackground,
      border: '1px solid var(--color-border, #e7e5e4)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <Package size={48} opacity={0.5} />
      <span style={{ fontSize: 14 }}>{t('nodes.stackEmptyHint') ?? '连接图片/视频节点'}</span>
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        {t('nodes.stackEmptySubHint') ?? '连入后选择加入堆叠'}
      </span>
      {/* 空态上传按钮:直接上传图片/视频生成卡片 */}
      <button
        type="button"
        onClick={() => emptyFileInputRef.current?.click()}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={uploading}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 4,
          padding: '5px 14px',
          borderRadius: 6,
          border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.25)' : 'var(--color-border, #e7e5e4)'}`,
          background: 'transparent',
          color: 'inherit',
          fontSize: 12,
          cursor: uploading ? 'not-allowed' : 'pointer',
          opacity: uploading ? 0.5 : 1,
        }}
      >
        <Upload size={13} />
        {uploading ? '上传中…' : '上传图片/视频'}
      </button>
    </div>
  ) : (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
      }}
    >
      {/* 主图区域(占满内容区) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          borderRadius: 8,
          border: '1px solid var(--color-border, #e7e5e4)',
          background: theme.node.contentBackground,
        }}
      >
        {activeCard && renderCardContent(activeCard, (node.size?.width ?? 620) - 32, (node.size?.height ?? 348) - 80)}
      </div>
      {/* 活跃卡替换按钮(hover 主图区显示,复用 ReplaceButton 视觉) */}
      <MainReplaceButton onClick={() => replaceFileInputRef.current?.click()} />
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
      }}
    >
      {/* BaseNodeView(上方,占主要空间,留给导航栏 56px) */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <BaseNodeView
          node={node}
          pins={pins}
          isSelected={isSelected}
          isHovered={isHovered}
          title={node.title ?? t('nodes.stackedMediaTitle') ?? '堆叠媒体'}
          color={theme.node.fill}
          connectionController={connectionController}
          forceShowPins={forceShowPins}
          contentPadding={0}
          invK={invK}
          titleIcon={titleIcon}
          updateNode={updateNode}
          externalRenaming={externalRenaming}
          onRenameFinish={onRenameFinish}
          store={store}
        >
          {mainContent}
        </BaseNodeView>
      </div>

      {/* 导航栏(节点下方,独立于 BaseNodeView 之外,高度固定) */}
      {hasCards && (
        <div
          style={{
            flexShrink: 0,
            height: 56,
            display: 'flex',
            alignItems: 'center',
            padding: '0 4px',
          }}
        >
          <BottomNav
            cards={data.cards}
            activeIndex={activeIndex}
            onJump={handleJump}
            onPrev={handlePrev}
            onNext={handleNext}
          />
        </div>
      )}

      {/* 收纳提示胶囊(画布锚定,portal 到 body,不受节点容器裁剪) */}
      {collectToast && store && (
        <StackCollectToast
          store={store}
          node={node}
          label={collectToast.label}
          onRemove={handleUndoCollect}
          onDismissed={() => setCollectToast(null)}
        />
      )}

      {/* 隐藏文件选择(空态上传/活跃卡替换) */}
      <input
        ref={emptyFileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          void handleFilesPick(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={replaceFileInputRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          void handleReplacePick(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}