/**
 * @zeroexo/plugin-layout - 布局插件
 *
 * 19 项布局操作:排列(4)/ 对齐(6)/ 分布(2)/ 尺寸统一(3)/ 层级排序(4)。
 *
 * 用法:
 *   import { LayoutPlugin } from '@zeroexo/plugin-layout';
 *   const layout = new LayoutPlugin();
 *   editor.plugins.install(layout);
 *   layout.getController().arrangeSelection('grid');
 */

// 类型
export type {
  AlignMode,
  ArrangeMode,
  DistributeMode,
  LayoutNode,
  PositionResult,
  SizeResult,
  SortDirection,
  UnifySizeMode,
} from './types.js';
export { ARRANGE_GAP } from './types.js';

// 纯函数
export {
  alignNodes,
  arrangeDagre,
  arrangeNodes,
  distributeNodes,
  sortElements,
  toLayoutNode,
  unifyNodeSizes,
} from './algorithms/index.js';

// 插件
export { LayoutPlugin } from './layout-plugin.js';
export type { LayoutController, NodeSizeMeta } from './layout-plugin.js';
