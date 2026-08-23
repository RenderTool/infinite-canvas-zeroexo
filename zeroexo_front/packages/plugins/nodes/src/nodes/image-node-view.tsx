/**
 * 图片载体节点视图 - 派生自 BaseNodeView + AIStateView
 *
 * 4 状态机(idle→loading→success/error),仅展示图片,不含生成逻辑。
 */

import { useProgressiveImage, buildBackendUrl } from '../utils/hydrate.js';

import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, Image } from 'lucide-react';
import type { NodeRendererProps, Pin } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { ImageNodeData } from '@zeroexo/plugin-ai-provider';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView, AIStateView, useHasIncomingEdges, nodeActionBus } from '../base-node-view.js';
import { replaceNodeImage } from '../utils/replace-node-image.js';

// ===== 引脚定义 =====
export function getImageNodePins(): Pin[] {
  return [
    { id: 'prompt', name: 'Prompt', direction: 'input' },
    { id: 'image', name: 'Image', direction: 'output' },
  ];
}

// ===== 空状态图标构建函数(需 theme 以使用主题色) =====
function imageEmptyIcon(titleColor: string): React.ReactNode {
  return <Image color={titleColor} size={22} strokeWidth={1.5} />;
}

// ===== 媒体容器样式 =====
const mediaContainerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  position: 'relative',
  boxSizing: 'border-box',
};

// ===== ImageNodeView =====

export interface ImageNodeViewProps extends NodeRendererProps {
  connectionController: ConnectionController | null;
  /** 画布图 store(用于上一个/下一个导航) */
  store?: ReactGraphStore | null;
  /** contentOnly 模式:跳过 BaseNodeView 外壳,仅渲染媒体内容(用于 StackNode 等容器) */
  contentOnly?: boolean;
}

export function ImageNodeView({
  node,
  pins,
  isSelected,
  isHovered,
  forceShowPins,
  updateNode,
  commandQueue,
  invK,
  connectionController,
  externalRenaming,
  onRenameFinish,
  store,
  contentOnly = false,
}: ImageNodeViewProps): React.ReactElement {
  const data = (node.data ?? {}) as Partial<ImageNodeData>;
  const status = data.status ?? 'idle';
  const { t } = useTranslation();
  const { theme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Phase VI.4: 渐进式加载 — 缩小时仅渲染缩略图,放大时加载原图
  // invK 由 NodeLayer 传入(1/viewport.k),用于判断画布缩放级别
  const hydratedContent = useProgressiveImage(data.storageKey, data.content ?? '', invK ?? 1);
  // 使用 hydratedContent 判断是否有内容,避免异步解析期间渲染 <img src=""> 导致浏览器跳转
  const hasContent = !!hydratedContent;
  // 生成器态判定:空节点(无内容)连入上游支持节点 → 生成器态(隐藏节点内上传按钮,避免"既是生成器又是资源器"二义态)
  const hasIncoming = useHasIncomingEdges(store, node.id, isSelected);
  const isGeneratorState = !hasContent && hasIncoming;
  // 后端缩略图 URL 404 时降级到 content(blob URL 或原图)
  const [imgSrc, setImgSrc] = useState(hydratedContent);
  useEffect(() => { setImgSrc(hydratedContent); }, [hydratedContent]);

  // 后端缩略图/预览图 404 时的降级链:
  //   当前 URL → data.content(blob/dataURL) → 后端原图 URL(full)
  //   均失败则不再循环(guard 防抖),避免无限重试
  const handleImgError = (): void => {
    if (data.content && imgSrc !== data.content) {
      setImgSrc(data.content);
      return;
    }
    const fullBackendUrl = buildBackendUrl(data.storageKey, 'full');
    if (fullBackendUrl && imgSrc !== fullBackendUrl) {
      setImgSrc(fullBackendUrl);
    }
  };

  // 节点颜色使用 theme.node.fill(所有类型共用)
  const nodeColor = theme.node.fill;

  // Bug3: 点击空状态触发文件选择器
  const handleReplaceClick = (): void => {
    fileInputRef.current?.click();
  };

  // 替换图片:统一使用 replaceNodeImage(通过 CommandQueue,支持撤销/重做,保持比例)
  const handleFileReplace = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) return;
    // 标题刷新为文件名(去掉扩展名)
    const fileName = file.name.replace(/\.[^.]+$/, '');
    updateNode({ title: fileName });
    await replaceNodeImage(commandQueue, node, file, {
      onStatusChange: () => {},
    });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) void handleFileReplace(file);
    e.target.value = '';
  };

  // Phase D2.8: 拖拽外部文件到节点上替换内容(阻止冒泡到画布避免创建新节点)
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    e.preventDefault();
    e.stopPropagation();
    void handleFileReplace(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // 问题5: 标题栏尺寸规格 — 优先用自然尺寸,回退到节点尺寸
  const titleSizeText = data.naturalWidth && data.naturalHeight
    ? `${data.naturalWidth} × ${data.naturalHeight}`
    : `${node.size?.width ?? 340} × ${node.size?.height ?? 240}`;
  // T10: 图标尺寸 CSS 连续化(与标题 fontSize 同源 --zx-invk),消除量化跨桶跳变
  const TITLE_ICON_CLAMP = 'clamp(9px, calc(13px * var(--zx-invk, 1)), 16px)';
  const titleIconEl = <ImageIcon size={16} style={{ width: TITLE_ICON_CLAMP, height: TITLE_ICON_CLAMP }} />;

  // contentOnly 模式:跳过 BaseNodeView 外壳,仅渲染媒体内容
  if (contentOnly) {
    return (
      <>
        <AIStateView
          status={status}
          errorDetails={data.errorDetails}
          errorType={data.errorType}
          accentColor={nodeColor}
          emptyIcon={imageEmptyIcon(theme.toolbar.textMuted)}
          hasContent={hasContent}
          onReplace={handleReplaceClick}
          // contentOnly 内嵌卡:替换入口归容器(StackNode MainReplaceButton)管理
          isSelected={false}
          replaceBtnPosition="left"
          backgroundColor={nodeColor}
          taskLabel={(data.taskLabel as string) ?? undefined}
          skeleton="media" skeletonKind="image"
        >
          <div
            style={{ ...mediaContainerStyle, background: 'transparent' }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <img
              src={imgSrc}
              draggable={false}
              onError={handleImgError}
              style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', display: 'block' }}
            />
          </div>
        </AIStateView>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />
      </>
    );
  }

  return (
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={node.title ?? data.title ?? t('nodes.imageTitle')}
      color={nodeColor}
      connectionController={connectionController}
      forceShowPins={forceShowPins}
      contentPadding={0}
      invK={invK}
      titleIcon={titleIconEl}
      titleSize={titleSizeText}
      updateNode={updateNode}
      externalRenaming={externalRenaming}
      onRenameFinish={onRenameFinish}
      store={store}
    >
      <AIStateView
        status={status}
        errorDetails={data.errorDetails}
        errorType={data.errorType}
        accentColor={nodeColor}
        emptyIcon={imageEmptyIcon(theme.toolbar.textMuted)}
        hasContent={hasContent}
        onReplace={handleReplaceClick}
        isSelected={isSelected}
        showReplaceButton={isSelected && !isGeneratorState}
        replaceBtnPosition="left"
        backgroundColor={nodeColor}
        taskLabel={(data.taskLabel as string) ?? undefined}
        skeleton="media" skeletonKind="image"
        onRetry={() => nodeActionBus.emit('retry', { nodeId: node.id })}
        onCancel={() => nodeActionBus.emit('cancel', { nodeId: node.id })}
      >
        <div
          style={{ ...mediaContainerStyle, background: 'transparent' }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <img
            src={imgSrc}
            draggable={false}
            onError={handleImgError}
            style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', display: 'block' }}
          />
        </div>
      </AIStateView>
      {/* Bug3: 隐藏文件选择器(空状态点击触发) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
    </BaseNodeView>
  );
}
