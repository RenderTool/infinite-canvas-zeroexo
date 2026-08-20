/**
 * 视口聚焦几何计算(纯函数,零依赖)
 *
 * 单一事实源: focusOnNode / focusOnBounds 共用此公式,
 * 禁止在调用方复制 targetK 计算(见经验 viewport-focus-contract.md)
 */

export interface FocusBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FocusContainerSize {
  width: number;
  height: number;
}

export interface FocusTarget {
  /** 视口左上角世界坐标 */
  x: number;
  y: number;
  /** 缩放系数 */
  k: number;
}

/**
 * 计算聚焦目标视口:节点中心对齐视口中心 + 最佳缩放(上限 2.0)
 * @param capsuleHeight 胶囊菜单高度(px),菜单在节点上方时计入总高
 * @param paddingRatio 聚焦缩放系数(0~1),越小节点周边留白越大(默认 0.82)
 */
export function computeFocusTarget(
  bounds: FocusBounds,
  containerSize: FocusContainerSize,
  capsuleHeight = 0,
  paddingRatio = 0.82,
): FocusTarget {
  // 缩放范围:包含胶囊菜单高度(菜单在节点上方,所以 totalH = height + capsuleHeight)
  const totalH = bounds.height + capsuleHeight;
  // 计算缩放:使 bounds 完整显示在视口内,保留 (1-paddingRatio) 边距;上限 2.0 防止小高度节点过度放大
  const k = Math.min(
    (containerSize.width / bounds.width) * paddingRatio,
    (containerSize.height / totalH) * paddingRatio,
    2.0,
  );
  const cx = containerSize.width / 2;
  const cy = containerSize.height / 2;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return { x: cx - centerX * k, y: cy - centerY * k, k };
}
