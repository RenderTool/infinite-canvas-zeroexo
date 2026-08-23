/**
 * ContentBeacon - 画布内容信标(征集#45:游戏任务指示点式远端指引)
 *
 * 用户平移到远离内容的空白区时,在画布四周(屏幕边缘内侧)显示脉动信标,
 * 指示内容区方向;点击平滑回到内容丰富区域。内容在视口内时自动隐藏。
 * 复用视口聚焦契约(聚焦系数 0.51 与右键「聚焦此节点」同源)。
 */

import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import { useGraph, useViewport } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { resolveNodeSize } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';

/** 信标距容器边缘的内边距 */
const EDGE_MARGIN = 28;
/** 内容包围盒外扩边距(世界坐标):略微越界不触发信标 */
const CONTENT_PAD = 120;

export function ContentBeacon({
  store,
  containerSize,
}: {
  store: ReactGraphStore;
  containerSize: { width: number; height: number };
}): React.ReactElement | null {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const graph = useGraph(store);
  const viewport = useViewport(store);

  // 内容包围盒(排除组壳与预览组,与聚焦策略同口径)
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of graph.nodes) {
    if (n.type === 'group') continue;
    const { width, height } = resolveNodeSize(n);
    const x = n.position?.x ?? 0;
    const y = n.position?.y ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + width > maxX) maxX = x + width;
    if (y + height > maxY) maxY = y + height;
  }
  if (!Number.isFinite(minX)) return null;

  // 视口矩形(世界坐标)
  const vw = containerSize.width / viewport.k;
  const vh = containerSize.height / viewport.k;
  const vx = -viewport.x / viewport.k;
  const vy = -viewport.y / viewport.k;
  const contentVisible =
    minX - CONTENT_PAD <= vx + vw &&
    maxX + CONTENT_PAD >= vx &&
    minY - CONTENT_PAD <= vy + vh &&
    maxY + CONTENT_PAD >= vy;
  if (contentVisible) return null;

  // 内容中心 → 屏幕边缘钳制(游戏任务指示点:贴四周,指向内容方向)
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const dx = cx - (vx + vw / 2);
  const dy = cy - (vy + vh / 2);
  const halfW = containerSize.width / 2 - EDGE_MARGIN - 64;
  const halfH = containerSize.height / 2 - EDGE_MARGIN - 22;
  const scale = Math.min(1, halfW / Math.max(Math.abs(dx), 1e-6), halfH / Math.max(Math.abs(dy), 1e-6));
  const sx = containerSize.width / 2 + dx * scale;
  const sy = containerSize.height / 2 + dy * scale;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  const handleClick = (): void => {
    store.focusOnBounds(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      containerSize,
      500,
      0.51,
    );
  };

  const elevated = theme.toolbar.panel;
  const textMain = theme.toolbar.text;

  return (
    <>
      <style>{`@keyframes ze-beacon-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(22,119,255,0.4); } 50% { box-shadow: 0 0 0 12px rgba(22,119,255,0); } }`}</style>
      <button
        type="button"
        onClick={handleClick}
        title={t('editor.backToContent')}
        style={{
          position: 'absolute',
          left: sx,
          top: sy,
          transform: 'translate(-50%, -50%)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 14px',
          borderRadius: 999,
          border: '1px solid rgba(22,119,255,0.6)',
          background: elevated,
          color: textMain,
          fontSize: 12,
          cursor: 'pointer',
          zIndex: 40,
          animation: 'ze-beacon-pulse 1.6s ease-out infinite',
          boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ display: 'inline-flex', transform: `rotate(${angle}deg)`, color: '#1677ff' }}>
          <Compass size={14} />
        </span>
        {t('editor.backToContent')}
      </button>
    </>
  );
}
