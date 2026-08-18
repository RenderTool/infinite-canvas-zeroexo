/**
 * @zeroexo/plugin-minimap
 * 缩略图插件(Canvas 渲染)
 *
 * 提供:
 * - MinimapPlugin: 插件类(无状态, 仅占位; 实际渲染由 MinimapView 组件完成)
 * - MinimapView: React 组件, Canvas 渲染 + 视口框拖拽 + 节点密度采样
 *
 * 软依赖:
 * - node-registry: 用于获取节点颜色和默认尺寸(未安装时用 type 哈希颜色)
 * - render-react: ReactGraphStore 类型(实际 store 实例由 demo 传入)
 *
 * 用法:
 * ```tsx
 * <MinimapView
 *   store={store}
 *   registry={registryPlugin}
 *   viewportSize={{ width, height }}
 *   onViewportChange={(vp) => store.setViewport(vp)}
 * />
 * ```
 */

import type { Plugin } from '@zeroexo/core';

// React 组件
export { MinimapView } from './minimap-view.js';
export type { MinimapViewProps } from './minimap-view.js';

// ===== 插件类 =====

export class MinimapPlugin implements Plugin {
  id = 'minimap';
  /**
   * 软依赖: node-registry(节点颜色/尺寸) + render-react(store 类型)
   * 不在 dependencies 中声明, 允许独立使用(未装 registry 时降级为哈希颜色)
   */
  dependencies?: string[];

  install(): void {
    // MinimapView 是纯组件, 无需插件侧状态
  }
  activate(): void {}
  deactivate(): void {}
  uninstall(): void {}
}
