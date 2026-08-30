/**
 * CanvasTabContentBoundary — 画布页签内容事件隔离边界（Plan#53 Phase 0.5 / C14）
 *
 * ## 问题（用户实测：页签内右键/拖动/滚轮导致画布响应）
 *
 * Plan#50 的页签架构：节点组件（剧本/分镜/工作台）通过 `createPortal` 把编辑器
 * 渲染到 `editor-page` 的页签内容层（contentHost）。
 *
 * 但 **React 合成事件沿虚拟树（而非 DOM 树）冒泡**（经验 #27）：
 * - portal 内容的 DOM 虽然在 contentHost 内（画布容器之外，原生事件不会冒泡到画布）；
 * - 但 portal 组件在 **React 树**中仍挂载在节点组件内 → 节点组件在画布子树内
 *   → `contextmenu / pointer* / wheel` 沿虚拟树冒泡至画布容器的
 *   `onCanvasContextMenu` / `onCanvasPointerDown` / `onCanvasWheel` → 画布误响应。
 *
 * 此外 `use-editor-state.ts` 的 `pointermove/pointerup` 挂在 **window**（原生冒泡），
 * 页签内拖动同样会触发画布的 onPointerMove。
 *
 * ## 修复
 *
 * 在 **portal 内容的最外层**阻断冒泡。
 *
 * ⚠️ 铁律（经验 #27 第 1 条）：**必须冒泡阶段阻断，禁用 capture 阶段**——
 *    `onPointerDownCapture` 会让事件到不了 target，页签内部交互全部失效。
 *
 * ## 为什么用 `display: contents`
 *
 * 不生成布局盒子 → 对子元素的 `position: absolute` / `height: 100%` 零影响
 * （子元素的包含块仍为 contentHost，它本身是 `position:absolute; inset:0`）。
 * DOM 节点依然存在 → 事件冒泡与 React 合成事件正常工作。
 *
 * ## 安全性
 *
 * `e.stopPropagation()` 只阻断**冒泡阶段**；项目内所有「点击外部关闭」监听
 * （`node-create-menu` / `dropdown` / `settings-popover-shell` 等）均注册在
 * **capture 阶段**（第三个参数 `true`），早于本边界执行，不受影响。
 */

import { memo, type CSSProperties, type ReactNode } from 'react';

export interface CanvasTabContentBoundaryProps {
  children: ReactNode;
  /** 覆盖样式（一般不需要；默认 display:contents 不产生布局影响） */
  style?: CSSProperties;
}

/** 不生成布局盒子，仅作为 React 事件边界存在 */
const boundaryStyle: CSSProperties = { display: 'contents' };

export const CanvasTabContentBoundary = memo(function CanvasTabContentBoundary({
  children,
  style,
}: CanvasTabContentBoundaryProps): React.ReactElement {
  return (
    <div
      data-canvas-tab-boundary=""
      style={style ? { ...boundaryStyle, ...style } : boundaryStyle}
      // ===== 冒泡阶段阻断（严禁改用 *Capture，否则页签内部交互全部失效）=====
      // contextmenu：画布右键菜单（用户实测的穿透主因）
      onContextMenu={(e) => e.stopPropagation()}
      // pointer 三件套：画布平移 / 框选 / 节点拖拽
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      // wheel：画布缩放（use-editor-state 挂在容器，此处一并防御）
      onWheel={(e) => e.stopPropagation()}
      // 触屏：移动端画布缩放 / 平移
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
});
