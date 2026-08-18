/**
 * CommentLayer - 冒泡评论层(屏幕坐标,不随画布缩放)
 *
 * 设计(UE5 tooltip pin 风格):
 * - 渲染在 Viewport_ 内但无 scale transform,使用屏幕坐标
 * - 文字尺寸恒定(不随 viewport.k 缩放),任何缩放级别都清晰可读
 * - 视口裁剪:仅渲染可见区域内的评论(CULL_MARGIN 余量)
 * - 每个 bubble 是 memo 组件,位置变化时仅更新 style
 *
 * 从 comment-box 插件迁入 nodes 插件:评论是节点本身的功能(UE蓝图气泡),
 * 与节点类型系统正交的覆盖层,归入 nodes 插件统一管理。
 */

import React, { memo } from 'react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useGraph, useViewport } from '@zeroexo/plugin-render-react';

/** 视口裁剪余量(屏幕像素)bubble 距容器边缘此距离内仍渲染 */
const CULL_MARGIN = 120;

/** bubble 底部距节点顶部的垂直间距(屏幕像素) */
const BUBBLE_OFFSET_Y = -6;

export interface CommentLayerProps {
  store: ReactGraphStore;
  /** 评论可见性开关(false 时不渲染任何 bubble) */
  enabled: boolean;
  /** 容器尺寸(用于视口裁剪) */
  containerSize: { width: number; height: number };
}

interface VisibleBubble {
  nodeId: string;
  text: string;
  screenX: number;
  screenY: number;
}

export const CommentLayer = memo(function CommentLayer({
  store,
  enabled,
  containerSize,
}: CommentLayerProps): React.ReactElement | null {
  const graph = useGraph(store);
  const viewport = useViewport(store);

  if (!enabled) return null;

  // 收集有评论的节点 + 计算屏幕坐标 + 视口裁剪
  const { k, x: vpX, y: vpY } = viewport;
  const bubbles: VisibleBubble[] = [];
  for (const node of graph.nodes) {
    if (node.type === 'group') continue; // 组不显示评论 bubble
    const data = node.data as { comment?: string } | undefined;
    const text = data?.comment?.trim();
    if (!text) continue;
    // size 解析与 NodeLayer 一致:node.size 优先,回退 ext.defaultSize(此处简化用 200x100)
    const size = node.size ?? { width: 200, height: 100 };
    // 节点顶部中心(世界坐标)→ 屏幕坐标
    const screenX = (node.position.x + size.width / 2) * k + vpX;
    const screenY = node.position.y * k + vpY + BUBBLE_OFFSET_Y;
    // 裁剪:屏幕坐标在容器 + 余量范围内
    if (
      screenX < -CULL_MARGIN ||
      screenX > containerSize.width + CULL_MARGIN ||
      screenY < -CULL_MARGIN ||
      screenY > containerSize.height + CULL_MARGIN
    ) {
      continue;
    }
    bubbles.push({ nodeId: node.id, text, screenX, screenY });
  }

  if (bubbles.length === 0) return null;

  return (
    <div
      data-canvas-comment-layer
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {bubbles.map((b) => (
        <CommentBubble
          key={b.nodeId}
          text={b.text}
          screenX={b.screenX}
          screenY={b.screenY}
        />
      ))}
    </div>
  );
});

/** 单个评论 bubble(memo:位置变化时仅更新 style,内容不变跳过 reconciliation) */
const CommentBubble = memo(
  function CommentBubble({
    text,
    screenX,
    screenY,
  }: {
    text: string;
    screenX: number;
    screenY: number;
  }) {
    return (
      <div
        data-comment-bubble
        style={{
          position: 'absolute',
          left: screenX,
          top: screenY,
          // 水平居中 + 底部对齐节点顶部(向上展开)
          transform: 'translate(-50%, -100%)',
          maxWidth: 260,
          padding: '4px 8px',
          backgroundColor: 'rgba(30, 40, 60, 0.92)',
          border: '1px solid rgba(100, 180, 255, 0.45)',
          borderRadius: 6,
          color: '#e0e8f0',
          fontSize: 11,
          lineHeight: 1.4,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {/* 引脚尖角(指向节点) */}
        <div
          style={{
            position: 'absolute',
            bottom: -5,
            left: '50%',
            transform: 'translateX(-50%) rotate(45deg)',
            width: 8,
            height: 8,
            backgroundColor: 'rgba(30, 40, 60, 0.92)',
            borderRight: '1px solid rgba(100, 180, 255, 0.45)',
            borderBottom: '1px solid rgba(100, 180, 255, 0.45)',
          }}
        />
        {text}
      </div>
    );
  },
  (prev, next) =>
    prev.text === next.text &&
    prev.screenX === next.screenX &&
    prev.screenY === next.screenY,
);
