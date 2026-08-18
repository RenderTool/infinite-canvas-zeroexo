/**
 * NodeViewContract - 节点视图契约
 *
 * 目标:外观与数据分离(MVVM)。节点视图原则上可派生出任意外观,
 * 仅需对接画布必要能力,通过本契约声明边界与状态视觉归属。
 *
 * - 'default':由 NodeShell 统一渲染状态效果(选中红框/连线悬停蓝框/hover 阴影/标题栏)
 * - 'custom' :NodeShell 跳过该状态效果,由节点视图自行绘制
 *
 * 契约挂在 NodeTypeExtension.viewContract,按节点类型生效。
 */

import type { NodeRecord } from './model/types.js';

export interface NodeViewContract {
  /**
   * 参与自动排布/碰撞/框选命中的边界(相对节点 position 的世界坐标尺寸)。
   * 省略时画布使用 node.size。外观与排布边界不一致的节点(如引脚外扩/标题外挂)应提供。
   */
  getBounds?: (node: NodeRecord) => { width: number; height: number };
  /** 选中视觉:默认 NodeShell outline;custom 时视图自绘 */
  selectionEffect?: 'default' | 'custom';
  /** focus(双击聚焦)视觉,同上 */
  focusEffect?: 'default' | 'custom';
  /** hover 视觉,同上 */
  hoverEffect?: 'default' | 'custom';
  /** 连线拖拽悬停视觉(蓝色指示),同上 */
  connectionHoverEffect?: 'default' | 'custom';
  /** 是否由 NodeShell 提供标题栏等铬件(默认 true 保留;false 时节点全自绘) */
  useShellChrome?: boolean;
}
