/**
 * plugin-layout 纯函数算法 barrel(18 项布局操作)
 *
 * 所有函数无副作用:输入节点数组 → 返回新位置/尺寸 Map(不改原数组)。
 *
 * 子模块:
 * - packing.ts: MaxRects 装箱(紧凑排列)
 * - arrange.ts: 排列入口(宫格/水平/垂直/树状/dagre/auto)+ NodeRecord 转换
 * - tree-layout.ts: 层级树状布局
 * - dagre-layout.ts: dagre 风格分层布局(Sugiyama)
 * - align-distribute.ts: 对齐(6) + 分布(2)
 * - size-sort.ts: 恢复基准尺寸 + 层级排序(4)
 */

export { toLayoutNode, arrangeNodes } from './arrange.js';
export { maxRectsPacking } from './packing.js';
export { tidyTreeLayout } from './tree-layout.js';
export { arrangeDagre } from './dagre-layout.js';
export { alignNodes, distributeNodes } from './align-distribute.js';
export { unifyNodeSizes, sortElements } from './size-sort.js';
