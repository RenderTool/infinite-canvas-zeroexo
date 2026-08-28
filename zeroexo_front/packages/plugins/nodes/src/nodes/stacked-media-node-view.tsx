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
import { NODE_ICONS } from '../icons.js';
import { uploadImage, uploadMediaFile } from '@zeroexo/plugin-persistence';
import type { EdgeRecord, NodeRecord, NodeRendererProps } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView, nodeActionBus } from '../base-node-view.js';
import { IMAGE_DEFAULT_SIZE, STACKED_MEDIA_DEFAULT_SIZE } from '../utils/node-contracts.js';
import { activateStackCard, appendCards, collectCard, dismissCollected, mergeStacks, replaceCardContent, updateCardData } from './stacked-media-model.js';
import { MainReplaceButton, StackBottomNav, StackMediaContent } from './stacked-media-presentation.js';
import { StackDetailsModal } from './stack-details-modal.js';
import {
  parseStackedMediaData,
  type StackCard,
} from './stacked-media-types.js';

export interface StackedMediaNodeViewProps extends NodeRendererProps {
  connectionController: ConnectionController | null;
  /** 画布图 store(订阅入边渲染连线预览行) */
  store?: ReactGraphStore | null;
}

/** 收纳撤销快照(仅保留最近一次可撤销;视觉提示由 editor-page message 承载,不在此渲染) */
interface CollectSnapshot {
  sourceNode: NodeRecord;
  edge: EdgeRecord;
  cardId: string;
  prevActiveIndex: number;
  prevCards: StackCard[];
}

// ===== 布局常量 =====

/** 堆叠总高读扩展契约(620×404),导航栏固定高 56,展示区 = 总高 - 导航高 */
const STACK_NAVIGATION_HEIGHT = 56;
const STACK_DISPLAY_HEIGHT = STACKED_MEDIA_DEFAULT_SIZE.height - STACK_NAVIGATION_HEIGHT;

/** 切换动画时长 */
const SWITCH_ANIM_MS = 340;

/** 卡片切换动画:方向感知滑动 + 淡入淡出 + 阴影层次(重做,原 rotateY 3D 翻页方案用户未认可)
 * 仅 transform/opacity/box-shadow 参与动画,不触发全画布重排 */
const STACK_SWITCH_CSS = `
@keyframes ze-stack-card-in {
  from { transform: translateX(var(--ze-slide-from, 14%)) scale(0.985); opacity: 0.25; box-shadow: 0 16px 40px rgba(0,0,0,0.28); }
  to { transform: translateX(0) scale(1); opacity: 1; box-shadow: 0 0 0 rgba(0,0,0,0); }
}
@keyframes ze-stack-card-out {
  from { transform: translateX(0) scale(1); opacity: 1; }
  to { transform: translateX(var(--ze-slide-to, -10%)) scale(0.97); opacity: 0; }
}
`;

/** prefers-reduced-motion：减少动画用户不参与翻页动效（降级为直接切换） */
const IS_REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const hasCards = data.cards.length > 0;
  // 派生状态必须在所有 effect 之前声明，避免 effect 依赖数组读取 TDZ 变量。
  const activeCard = hasCards ? data.cards[activeIndex] ?? null : null;
  /** 切换动画期间保留前一张卡片作为鬼影层。 */
  const [isAnimating, setIsAnimating] = useState(false);
  /** 切换方向(1=下一张/从右入,-1=上一张/从左入)与切换序号(驱动 keyframes 重播) */
  const [switchDir, setSwitchDir] = useState<1 | -1>(1);
  const [switchEpoch, setSwitchEpoch] = useState(0);
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
      if (sourceNode && ['image', 'video', 'audio', 'text', 'stacked-media'].includes(sourceNode.type)) {
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

  /** 开始切换动画(期间视频渲染静帧缩略图;减少动画用户直接切换) */
  const [previousCard, setPreviousCard] = useState<StackCard | null>(null);

  const beginSwitchAnimation = useCallback((dir: 1 | -1) => {
    if (IS_REDUCED_MOTION) return;
    setPreviousCard(activeCard);
    setSwitchDir(dir);
    setSwitchEpoch((e) => e + 1);
    setIsAnimating(true);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = setTimeout(() => setIsAnimating(false), SWITCH_ANIM_MS);
  }, [activeCard]);

  const handlePrev = useCallback(() => {
    if (activeIndex > 0) {
      beginSwitchAnimation(-1);
      const nextIndex = activeIndex - 1;
      if (commandQueue) {
        commandQueue.execute(activateStackCard(node, data, nextIndex).command);
      } else {
        updateNode({ data: { ...data, activeIndex: nextIndex } });
      }
      setActiveIndex(nextIndex);
    }
  }, [activeIndex, beginSwitchAnimation, commandQueue, data, node, updateNode]);

  const handleNext = useCallback(() => {
    if (activeIndex < data.cards.length - 1) {
      beginSwitchAnimation(1);
      const nextIndex = activeIndex + 1;
      if (commandQueue) {
        commandQueue.execute(activateStackCard(node, data, nextIndex).command);
      } else {
        updateNode({ data: { ...data, activeIndex: nextIndex } });
      }
      setActiveIndex(nextIndex);
    }
  }, [activeIndex, beginSwitchAnimation, commandQueue, data, node, updateNode]);

  const handleJump = useCallback((index: number) => {
    if (index === activeIndex) return;
    beginSwitchAnimation(index > activeIndex ? 1 : -1);
    if (commandQueue) {
      commandQueue.execute(activateStackCard(node, data, index).command);
    } else {
      updateNode({ data: { ...data, activeIndex: index } });
    }
    setActiveIndex(index);
  }, [activeIndex, beginSwitchAnimation, commandQueue, data, node, updateNode]);

  // ===== 详情面板(Plan#20 验收反馈 #2):胶囊菜单「详情」→ 打开全部卡片网格,>5 卡断层兜底 =====
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    const unsub = nodeActionBus.on('stack:openDetails', (event) => {
      if (event.nodeId === node.id) setDetailsOpen(true);
    });
    return unsub;
  }, [node.id]);

  // ===== 收纳:连线预览 → 卡片(删边 + 删源节点 + 追加卡片,自动执行 + message「移出」可撤销) =====
  const handleCollect = useCallback((edge: EdgeRecord, sourceNode: NodeRecord) => {
    if (!commandQueue) return;
    if (sourceNode.type === 'stacked-media' && store) {
      const result = mergeStacks(node, data, sourceNode, edge, store.getGraph());
      commandQueue.execute(result.command);
      setActiveIndex(result.activeIndex);
      setCollectToast(null);
      // 提示通道统一(征集#9 验收):与批量堆叠同走 editor-page message;合并场景无单卡撤销
      nodeActionBus.emit('stackCollected', {
        nodeId: node.id,
        title: sourceNode.title || sourceNode.type,
        merged: true,
      });
      return;
    }
    const result = collectCard(node.id, data, sourceNode, edge);
    commandQueue.execute(result.command);
    setActiveIndex(result.cards.length - 1);
    // 撤销快照(仅保留最近一次可撤销)
    setCollectToast({
      sourceNode,
      edge,
      cardId: result.cardId,
      prevActiveIndex: data.activeIndex,
      prevCards: data.cards,
    });
    // 提示通道统一(征集#9 验收):以胶囊菜单的 message 形式为主,「移出」按钮回发 undo 事件由本视图撤销
    nodeActionBus.emit('stackCollected', {
      nodeId: node.id,
      title: sourceNode.title || sourceNode.type,
      merged: false,
    });
  }, [commandQueue, data.cards, data.activeIndex, node.id]);

  // 用 ref 保存 handleCollect 供入边 effect 使用(避免 stale closure)
  const handleCollectRef = useRef(handleCollect);
  handleCollectRef.current = handleCollect;

  // ===== 收纳提示「移出」回执:editor-page message 按钮 → 本视图执行撤销(与胶囊 eject 同语义) =====
  const handleUndoCollect = useCallback(() => {
    if (!collectToast || !commandQueue) return;
    const { sourceNode, cardId } = collectToast;
    const result = dismissCollected(node.id, data.cards, data.activeIndex, cardId, sourceNode);
    commandQueue.execute(result.command);
    setActiveIndex(result.activeIndex);
  }, [collectToast, commandQueue, node.id, data.cards, data.activeIndex]);

  const handleUndoCollectRef = useRef(handleUndoCollect);
  handleUndoCollectRef.current = handleUndoCollect;
  useEffect(() => {
    const unsubscribe = nodeActionBus.on('stackUndoCollect', (event) => {
      if (event.nodeId !== node.id) return;
      handleUndoCollectRef.current();
    });
    return unsubscribe;
  }, [node.id]);

  // ===== 文本卡片编辑落盘(失焦时单次写入,不逐键污染命令历史) =====
  const handleTextCommit = useCallback((cardId: string, html: string) => {
    if (!commandQueue) return;
    const result = updateCardData(node.id, data.cards, cardId, { content: html });
    commandQueue.execute(result.command);
  }, [commandQueue, node.id, data.cards]);

  // ===== 舞台容器实测尺寸:内容随容器走,resize/降档时不挤压上方内容 =====
  const stageRef = useRef<HTMLDivElement>(null);
  // 初始占位 = 扩展契约宽 - 容器左右 padding(ResizeObserver 首帧后即实测纠正)
  const [stageSize, setStageSize] = useState({ width: STACKED_MEDIA_DEFAULT_SIZE.width - 32, height: STACK_DISPLAY_HEIGHT });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setStageSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasCards]);

  // ===== T9: 文本卡活跃时自动 uniform 不锁等比 =====
  // StackNode 恒 lockAspectRatio + GPU scale，文本卡被整体栅格化缩放会模糊且不重排。
  // 活跃卡为文本时置位 data.scaleOverride='real'：渲染层强制真实尺寸(文本重排)，
  // resize 同步解锁等比(对齐 text 节点自由宽高语义)；切回媒体卡时清除恢复 GPU 等比。
  // 直接 updateNode 落 data(不入命令历史，与 B1 文本落盘同策略，避免切换卡污染撤销栈)。
  // 依赖数组仅含 wantsRealSize:上层 updateNode 是每渲染新建的内联箭头,若入依赖
  // 则「effect 写入 → node.data 新引用 → 重渲染 → effect 重跑」形成无限循环
  // (用户验收反馈 Maximum update depth exceeded);条件内部读 node.data 均为最新值。
  const wantsRealSize = activeCard?.sourceType === 'text';
  useEffect(() => {
    const dataRec = (node.data ?? {}) as Record<string, unknown>;
    const hasOverride = dataRec.scaleOverride === 'real';
    if (wantsRealSize && !hasOverride) {
      updateNode({ data: { ...dataRec, scaleOverride: 'real' } });
    } else if (!wantsRealSize && hasOverride) {
      const next = { ...dataRec };
      delete next.scaleOverride;
      updateNode({ data: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsRealSize]);

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
        size: node.size ?? { ...IMAGE_DEFAULT_SIZE },
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
        size: node.size ?? { ...IMAGE_DEFAULT_SIZE },
      };
    }
    if (file.type.startsWith('audio/')) {
      // 音频卡(征集#9 增强拍板):资源浏览器语义,图片/视频卡均可替换为音频
      const media = await uploadMediaFile(file, 'audio');
      return {
        id: genId('card'),
        sourceType: 'audio',
        data: {
          content: media.url,
          storageKey: media.storageKey,
          status: 'success',
          durationMs: media.durationMs,
          mimeType: media.mimeType,
        },
        title: fileName,
        size: node.size ?? { ...IMAGE_DEFAULT_SIZE },
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
      // 统一走 model:追加卡片 + 跳到本次上传的第一张,保持视图不含数据变换规则
      const result = appendCards(node.id, data.cards, newCards);
      commandQueue.execute(result.command);
      setActiveIndex(result.activeIndex);
    }
    setUploading(false);
  }, [commandQueue, uploading, fileToCard, data.cards, node.id]);

  // T10: 图标尺寸 CSS 连续化(clamp 等价原 max/min 钳制但随 --zx-invk 连续,消除跨桶跳变)
  const TITLE_ICON_CLAMP = 'clamp(8px, calc(11px * var(--zx-invk, 1)), 14px)';
  const titleIcon = <NODE_ICONS.stack size={16} style={{ width: TITLE_ICON_CLAMP, height: TITLE_ICON_CLAMP }} />;

  /** 替换活跃卡片内容(主图区替换按钮) */
  const handleReplacePick = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !commandQueue || uploading || !activeCard) return;
    setUploading(true);
    try {
      const card = await fileToCard(file);
      if (card) {
        const result = replaceCardContent(node.id, data.cards, activeIndex, card);
        commandQueue.execute(result.command);
        // 跨类型替换提示(征集#9 增强拍板):类型变更对用户透明,经 nodeActionBus 通知 editor-page 显示 message
        if (activeCard.sourceType !== card.sourceType) {
          nodeActionBus.emit('stackReplaceTypeChanged', { nodeId: node.id, type: card.sourceType });
        }
      }
    } catch (err) {
      console.warn('[StackNode] 替换失败:', file.name, err);
    }
    setUploading(false);
  }, [commandQueue, uploading, activeCard, fileToCard, data.cards, activeIndex, node.id]);

  // ===== 内容区 =====
  const isDark = theme.mode === 'dark';
  // 内容区表面:NodeTokens 无 contentBackground token,按明暗主题分支取中性表面色(修复暗色主题空态白底)
  const contentSurface = isDark ? '#161616' : '#ffffff';
  // 替换/上传文件过滤:活跃卡为视频时优先视频类型,空态/图片卡优先图片;
  // 均允许跨类型替换(资源浏览器语义,征集#9 增强拍板:放开音频)
  const replaceAccept = activeCard?.sourceType === 'video' ? 'video/*,image/*,audio/*' : 'image/*,video/*,audio/*';
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
      // 空态背景与有卡态主图区一致,消除"合入后发灰";明暗主题适配
      background: contentSurface,
      border: 0,
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <NODE_ICONS.stack size={22} strokeWidth={1.5} />
      {/* 空态文案:对齐图片节点 AIStateView 空态(图标+小字描述),
          上传入口统一为左上角纯 icon 按钮(MainReplaceButton 选中显示) */}
      <span style={{ fontSize: 11, opacity: 0.7 }}>{uploading ? '上传中…' : '上传图片或视频'}</span>
      <MainReplaceButton onClick={() => emptyFileInputRef.current?.click()} visible={isSelected} />
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
        ref={stageRef}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          borderRadius: 8,
          border: 0,
          background: contentSurface,
        }}
      >
        <style>{STACK_SWITCH_CSS}</style>
        {activeCard && (
          <div
            key={`active-${activeCard.id}-${switchEpoch}`}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              // 方向感知滑动入场:key 变化触发 keyframes 重播,仅 transform/opacity 动画
              animation: switchEpoch > 0
                ? `ze-stack-card-in ${SWITCH_ANIM_MS}ms cubic-bezier(0.22,1,0.36,1)`
                : undefined,
              ['--ze-slide-from' as string]: `${switchDir * 14}%`,
            } as React.CSSProperties}
          >
            <StackMediaContent card={activeCard} width={stageSize.width} height={stageSize.height} isDark={isDark} onTextCommit={handleTextCommit} invK={invK} isSelected={isSelected} isHovered={isHovered} />
          </div>
        )}
        {isAnimating && previousCard && (
          <div
            aria-hidden="true"
            key={`ghost-${previousCard.id}-${switchEpoch}`}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 1,
              pointerEvents: 'none',
              // 旧卡片向反方向滑出并淡出(forwards 保持终态直到卸载)
              animation: `ze-stack-card-out ${SWITCH_ANIM_MS}ms cubic-bezier(0.22,1,0.36,1) forwards`,
              ['--ze-slide-to' as string]: `${-switchDir * 10}%`,
            } as React.CSSProperties}
          >
            <StackMediaContent card={previousCard} width={stageSize.width} height={stageSize.height} isDark={isDark} onTextCommit={handleTextCommit} invK={invK} isSelected={isSelected} isHovered={isHovered} />
          </div>
        )}
      </div>
      {/* 活跃卡替换按钮(节点激活时显示/未激活隐藏,对齐胶囊工具栏选中显示语义;hover 仅微调透明度) */}
      <MainReplaceButton onClick={() => replaceFileInputRef.current?.click()} visible={isSelected} />
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

      {/* 导航栏始终占位,空堆叠也保持完整舞台结构。 */}
      <div
        style={{
          flexShrink: 0,
          height: STACK_NAVIGATION_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          padding: '0 4px',
        }}
      >
        <StackBottomNav
          cards={data.cards}
          activeIndex={activeIndex}
          onJump={handleJump}
          onPrev={handlePrev}
          onNext={handleNext}
        />
      </div>

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
        accept={replaceAccept}
        hidden
        onChange={(e) => {
          void handleReplacePick(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 详情面板:全部卡片网格(与主体编辑器同框架,antd Modal 壳) */}
      {detailsOpen && (
        <StackDetailsModal
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          cards={data.cards}
          activeIndex={activeIndex}
          onJump={handleJump}
        />
      )}
    </div>
  );
}
