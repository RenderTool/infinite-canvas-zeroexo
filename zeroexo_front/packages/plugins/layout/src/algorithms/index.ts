/**
 * plugin-layout 纯函数算法 barrel(24 项布局操作)
 *
 * 所有函数无副作用:输入节点数组 → 返回新位置/尺寸 Map(不改原数组)。
 *
 * 子模块:
 * - packing.ts: MaxRects 装箱(紧凑排列)
 * - arrange.ts: 排列入口(10 模式)+ NodeRecord 转换
 * - tree-layout.ts: 层级树状布局
 * - dagre-layout.ts: dagre 分层布局(真实 dagre 库)
 * - smart-layout.ts: 智能复合布局(三阶段管线)
 * - force-layout.ts: 力导向布局
 * - radial-layout.ts: 径向布局
 * - align-distribute.ts: 对齐(6) + 分布(2)
 * - size-sort.ts: 恢复基准尺寸 + 层级排序(4)
 */

export { toLayoutNode, arrangeNodes } from './arrange.js';
export { maxRectsPacking } from './packing.js';
export { tidyTreeLayout } from './tree-layout.js';
export { arrangeDagre } from './dagre-layout.js';
export { smartLayout } from './smart-layout.js';
export { forceLayout } from './force-layout.js';
export { radialLayout } from './radial-layout.js';
export { alignNodes, distributeNodes } from './align-distribute.js';
export { unifyNodeSizes, sortElements } from './size-sort.js';