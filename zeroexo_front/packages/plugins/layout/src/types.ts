/**
 * plugin-layout 类型定义
 *
 * 18 项布局操作的模式枚举 + 统一 LayoutNode 接口。
 * LayoutNode 与 NodeRecord 解耦:纯函数只依赖 {id, x, y, width, height}。
 */

// ===== 模式枚举(18 项) =====

/** 排列(6): 宫格 / 水平 / 垂直 / 树状 / dagre / auto(统一布局:有连线→组织图,无连线→宫格) */
export type ArrangeMode = 'grid' | 'horizontal' | 'vertical' | 'tree' | 'dagre' | 'auto';

/** 对齐(6): 左 / 水平居中 / 右 / 顶 / 垂直居中 / 底 */
export type AlignMode = 'left' | 'hCenter' | 'right' | 'top' | 'vCenter' | 'bottom';

/** 分布(2): 水平等距 / 垂直等距 */
export type DistributeMode = 'horizontal' | 'vertical';

/** 尺寸统一: 恢复基准尺寸(每个节点恢复到其 defaultSize,lockAspectRatio 节点保持宽高比) */
export type UnifySizeMode = 'baseline';

/** 层级排序(4): 上移 / 下移 / 置顶 / 置底 */
export type SortDirection = 'bringToFront' | 'sendToBack' | 'moveUp' | 'moveDown';

// ===== 统一布局节点 =====

/** 布局运算用的节点(与 NodeRecord 解耦) */
export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 节点类型(用于基准尺寸查找) */
  type?: string;
  /** 节点类型的默认尺寸(基准值) */
  defaultSize?: { width: number; height: number };
  /** 是否锁定宽高比(图片/视频) */
  lockAspectRatio?: boolean;
  /** 是否允许 resize */
  resizable?: boolean;
}

/** 位置变更结果(排列/对齐/分布) */
export type PositionResult = Map<string, { x: number; y: number }>;

/** 尺寸变更结果(尺寸统一) */
export type SizeResult = Map<string, { x: number; y: number; width: number; height: number }>;

/** 排列间距(像素) */
export const ARRANGE_GAP = 24;
