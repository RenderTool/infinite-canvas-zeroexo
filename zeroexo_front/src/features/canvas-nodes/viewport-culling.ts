/**
 * viewport-culling.ts - 画布视口裁剪工具
 *
 * 提供 shouldRenderFullNode 函数判断节点是否在视口内，
 * 视口外节点仅渲染轻量占位 div，使用 RAF 节流优化性能。
 */

/** 视口变换 */
export interface ViewportTransform {
  x: number;
  y: number;
  k: number;
}

/** 节点基础尺寸 */
export interface NodeRect {
  position: { x: number; y: number };
  width: number;
  height: number;
}

/** 视口外节点占位高度 */
const PLACEHOLDER_HEIGHT = 32;

/**
 * 判断节点是否在视口内（含 padding 缓冲）。
 * 视口外节点 → 仅渲染轻量占位 div。
 *
 * @param node - 节点位置和尺寸
 * @param viewport - 当前视口变换
 * @param containerWidth - 容器宽度(px)
 * @param containerHeight - 容器高度(px)
 * @param padding - 视口外缓冲区域(px,世界坐标),默认 280
 * @returns true=需完整渲染, false=可用占位
 */
export function shouldRenderFullNode(
  node: NodeRect,
  viewport: ViewportTransform,
  containerWidth: number,
  containerHeight: number,
  padding = 280,
): boolean {
  if (containerWidth <= 0 || containerHeight <= 0) return true;

  // 计算视口边界(世界坐标)
  const viewLeft = -viewport.x / viewport.k - padding;
  const viewTop = -viewport.y / viewport.k - padding;
  const viewRight = viewLeft + containerWidth / viewport.k + padding * 2;
  const viewBottom = viewTop + containerHeight / viewport.k + padding * 2;

  // 节点在世界坐标中的边界
  const nodeLeft = node.position.x;
  const nodeTop = node.position.y;
  const nodeRight = nodeLeft + node.width;
  const nodeBottom = nodeTop + node.height;

  // 矩形相交检测
  const isVisible =
    nodeRight > viewLeft &&
    nodeLeft < viewRight &&
    nodeBottom > viewTop &&
    nodeTop < viewBottom;

  return isVisible;
}

/**
 * RAF 节流包装器。
 * 在 requestAnimationFrame 循环中执行回调，避免高频触发。
 * 返回 cleanup 函数供组件卸载时取消。
 */
export function createRafThrottle(
  callback: () => void,
): { schedule: () => void; cancel: () => void } {
  let rafId: number | null = null;
  let isScheduled = false;

  const schedule = (): void => {
    if (isScheduled) return;
    isScheduled = true;
    rafId = requestAnimationFrame(() => {
      isScheduled = false;
      rafId = null;
      callback();
    });
  };

  const cancel = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    isScheduled = false;
  };

  return { schedule, cancel };
}

/**
 * 生成视口外节点的轻量占位 div 样式。
 * 占位 div 仅包含最小 DOM 结构，保持布局稳定。
 */
export function getPlaceholderStyle(
  node: NodeRect,
  viewport: ViewportTransform,
): React.CSSProperties {
  return {
    position: 'absolute',
    left: node.position.x,
    top: node.position.y,
    width: node.width,
    height: PLACEHOLDER_HEIGHT,
    opacity: 0.15,
    background: 'rgba(128, 128, 128, 0.3)',
    borderRadius: 4,
    pointerEvents: 'none',
    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
    transformOrigin: '0 0',
  };
}

/** 默认导出 */
export default {
  shouldRenderFullNode,
  createRafThrottle,
  getPlaceholderStyle,
};