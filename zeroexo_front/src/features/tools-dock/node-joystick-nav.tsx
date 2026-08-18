/**
 * NodeJoystickNav - 方向键式节点导航
 *
 * 从胶囊工具栏导航按钮弹出，显示当前节点周围的 4 方向最近节点。
 * 每个方向按钮展示节点名称/类型图标，点击即可导航。
 * 相比旧版拖拽摇杆，本方案交互更直观、反馈更清晰。
 *
 * 算法：分别在上/下/左/右 4 个扇区中找到最近节点，纯空间匹配，不依赖连线关系。
 */

import React, { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraph } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { NodeRecord } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { Z_INDEX } from '@/shared/constants/z-index.js';

export interface NodeJoystickNavProps {
  /** 触发按钮的屏幕坐标（用于定位 overlay 中心） */
  anchorX: number;
  anchorY: number;
  store: ReactGraphStore;
  nodeId: string;
  onClose: () => void;
}

/** 方向定义 */
const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
type Direction = (typeof DIRECTIONS)[number];

/** 每个方向对应的角度范围（弧度），以中心角表示 */
const DIRECTION_ANGLES: Record<Direction, number> = {
  up: -Math.PI / 2,     // 上：-90°
  down: Math.PI / 2,    // 下：90°
  left: Math.PI,        // 左：180°
  right: 0,             // 右：0°
};

/** 扇区角度阈值（弧度），每个方向覆盖 ±45° */
const SECTOR_HALF = Math.PI / 4;

/** 方向对应的图标 */
const DIRECTION_ICONS: Record<Direction, React.ReactNode> = {
  up: <ArrowUp size={18} />,
  down: <ArrowDown size={18} />,
  left: <ArrowLeft size={18} />,
  right: <ArrowRight size={18} />,
};

/** 节点类型 → 显示名称(取前 4 字) */
function getNodeTypeLabel(type: string, t: (key: string) => string): string {
  switch (type) {
    case 'image': return t('nodeJoystickNav.typeImage');
    case 'video': return t('nodeJoystickNav.typeVideo');
    case 'text': return t('nodeJoystickNav.typeText');
    case 'stacked-media': return t('nodeJoystickNav.typeStacked');
    case 'generator': return t('nodeJoystickNav.typeGenerator');
    default: return type;
  }
}

/**
 * 在指定方向上找到最近的节点
 * 纯函数，O(n) 遍历
 */
function findNearestInDirection(
  currentNode: NodeRecord,
  allNodes: NodeRecord[],
  direction: Direction,
): { id: string; node: NodeRecord; dist: number } | null {
  const cx = currentNode.position.x + (currentNode.size?.width ?? 200) / 2;
  const cy = currentNode.position.y + (currentNode.size?.height ?? 100) / 2;
  const targetAngle = DIRECTION_ANGLES[direction];

  let best: { id: string; node: NodeRecord; dist: number } | null = null;

  for (const n of allNodes) {
    if (n.id === currentNode.id || n.type === 'group') continue;
    const nx = n.position.x + (n.size?.width ?? 200) / 2;
    const ny = n.position.y + (n.size?.height ?? 100) / 2;
    const dx = nx - cx;
    const dy = ny - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) continue;

    const angle = Math.atan2(dy, dx);
    let angleDiff = Math.abs(angle - targetAngle);
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

    if (angleDiff < SECTOR_HALF) {
      if (!best || dist < best.dist) {
        best = { id: n.id, node: n, dist };
      }
    }
  }
  return best;
}

export function NodeJoystickNav({
  anchorX, anchorY, store, nodeId, onClose,
}: NodeJoystickNavProps): React.ReactElement {
  const { theme, mode } = useTheme();
  const { t } = useTranslation();
  const graph = useGraph(store);

  const currentNode = graph.nodes.find((n: NodeRecord) => n.id === nodeId);

  // 预计算 4 方向上的最近节点
  const directionTargets = useMemo(() => {
    if (!currentNode) return null;
    const result: Record<Direction, { id: string; node: NodeRecord; dist: number } | null> = {
      up: null, down: null, left: null, right: null,
    };
    for (const dir of DIRECTIONS) {
      result[dir] = findNearestInDirection(currentNode, graph.nodes, dir);
    }
    return result;
  }, [currentNode, graph.nodes]);

  const handleNavigate = (targetId: string) => {
    nodeActionBus.emit('navigate', { nodeId: targetId });
    onClose();
  };

  const accent = theme.toolbar.accent ?? '#e94560';
  const borderColor = theme.toolbar.border ?? 'rgba(0,0,0,0.1)';
  const textColor = theme.toolbar.text ?? (mode === 'dark' ? '#e5e5e5' : '#333');
  const mutedColor = theme.toolbar.textMuted ?? (mode === 'dark' ? '#888' : '#999');
  const isDark = mode === 'dark';

  // 方向按钮样式生成
  const btnBase: CSSProperties = {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 12,
    border: `1px solid ${borderColor}`,
    background: isDark ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.9)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    cursor: 'pointer',
    pointerEvents: 'auto',
    transition: 'all 0.15s cubic-bezier(0.22,1,0.36,1)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    padding: '4px 2px',
    color: textColor,
    zIndex: Z_INDEX.DROPDOWN + 1,
  };

  // 遮罩点击关闭
  const onMaskPointerDown = (e: React.PointerEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const maskStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: Z_INDEX.DROPDOWN,
    background: 'transparent',
  };

  // 中心提示
  const centerLabel = currentNode?.title
    ? currentNode.title.length > 6
      ? currentNode.title.slice(0, 6) + '...'
      : currentNode.title
    : t('nodeJoystickNav.currentNode');

  return (
    <>
      {/* 透明遮罩 */}
      <div style={maskStyle} onPointerDown={onMaskPointerDown} />

      {/* 4 方向按钮，以 anchor 为中心排列 */}
      <div
        style={{
          position: 'fixed',
          left: anchorX,
          top: anchorY,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          zIndex: Z_INDEX.DROPDOWN,
        }}
      >
        {/* 上 */}
        <div
          style={{ ...btnBase, left: '50%', top: -80, transform: 'translateX(-50%)' }}
          onClick={() => {
            const t = directionTargets?.up;
            if (t) handleNavigate(t.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseEnter={(e) => {
            if (directionTargets?.up) {
              e.currentTarget.style.borderColor = accent;
              e.currentTarget.style.boxShadow = `0 4px 16px ${accent}44`;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = borderColor;
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
          }}
          title={directionTargets?.up?.node.title ?? t('nodeJoystickNav.noNode')}
        >
          <span style={{ color: directionTargets?.up ? accent : mutedColor, display: 'flex', alignItems: 'center' }}>
            {DIRECTION_ICONS.up}
          </span>
          <span style={{ fontSize: 10, lineHeight: '14px', color: directionTargets?.up ? textColor : mutedColor, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {directionTargets?.up
              ? (directionTargets.up.node.title || getNodeTypeLabel(directionTargets.up.node.type, t))
              : t('nodeJoystickNav.noNode')}
          </span>
        </div>

        {/* 下 */}
        <div
          style={{ ...btnBase, left: '50%', top: 80, transform: 'translateX(-50%)' }}
          onClick={() => {
            const t = directionTargets?.down;
            if (t) handleNavigate(t.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseEnter={(e) => {
            if (directionTargets?.down) {
              e.currentTarget.style.borderColor = accent;
              e.currentTarget.style.boxShadow = `0 4px 16px ${accent}44`;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = borderColor;
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
          }}
          title={directionTargets?.down?.node.title ?? t('nodeJoystickNav.noNode')}
        >
          <span style={{ color: directionTargets?.down ? accent : mutedColor, display: 'flex', alignItems: 'center' }}>
            {DIRECTION_ICONS.down}
          </span>
          <span style={{ fontSize: 10, lineHeight: '14px', color: directionTargets?.down ? textColor : mutedColor, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {directionTargets?.down
              ? (directionTargets.down.node.title || getNodeTypeLabel(directionTargets.down.node.type, t))
              : t('nodeJoystickNav.noNode')}
          </span>
        </div>

        {/* 左 */}
        <div
          style={{ ...btnBase, left: -80, top: '50%', transform: 'translateY(-50%)' }}
          onClick={() => {
            const t = directionTargets?.left;
            if (t) handleNavigate(t.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseEnter={(e) => {
            if (directionTargets?.left) {
              e.currentTarget.style.borderColor = accent;
              e.currentTarget.style.boxShadow = `0 4px 16px ${accent}44`;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = borderColor;
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
          }}
          title={directionTargets?.left?.node.title ?? t('nodeJoystickNav.noNode')}
        >
          <span style={{ color: directionTargets?.left ? accent : mutedColor, display: 'flex', alignItems: 'center' }}>
            {DIRECTION_ICONS.left}
          </span>
          <span style={{ fontSize: 10, lineHeight: '14px', color: directionTargets?.left ? textColor : mutedColor, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {directionTargets?.left
              ? (directionTargets.left.node.title || getNodeTypeLabel(directionTargets.left.node.type, t))
              : t('nodeJoystickNav.noNode')}
          </span>
        </div>

        {/* 右 */}
        <div
          style={{ ...btnBase, left: 80, top: '50%', transform: 'translateY(-50%)' }}
          onClick={() => {
            const t = directionTargets?.right;
            if (t) handleNavigate(t.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseEnter={(e) => {
            if (directionTargets?.right) {
              e.currentTarget.style.borderColor = accent;
              e.currentTarget.style.boxShadow = `0 4px 16px ${accent}44`;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = borderColor;
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
          }}
          title={directionTargets?.right?.node.title ?? t('nodeJoystickNav.noNode')}
        >
          <span style={{ color: directionTargets?.right ? accent : mutedColor, display: 'flex', alignItems: 'center' }}>
            {DIRECTION_ICONS.right}
          </span>
          <span style={{ fontSize: 10, lineHeight: '14px', color: directionTargets?.right ? textColor : mutedColor, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {directionTargets?.right
              ? (directionTargets.right.node.title || getNodeTypeLabel(directionTargets.right.node.type, t))
              : t('nodeJoystickNav.noNode')}
          </span>
        </div>

        {/* 中心圆点 — 当前节点指示 */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: isDark ? 'rgba(40,40,40,0.9)' : 'rgba(255,255,255,0.95)',
            border: `2px solid ${accent}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 0 0 4px ${accent}22`,
            pointerEvents: 'none',
            position: 'relative',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
          title={centerLabel}
        >
          <span style={{ fontSize: 9, fontWeight: 700, color: accent, textAlign: 'center', lineHeight: '10px' }}>
            {currentNode ? getNodeTypeLabel(currentNode.type, t).slice(0, 2) : '?'}
          </span>
        </div>
      </div>
    </>
  );
}