/**
 * Graph 数据模型类型定义
 *
 * Phase 6 扩展: NodeRecord 新增可选 group 层级字段(SceneNode 统一类型),
 * Group 与普通 Node 共用同一类型,通过 type==='group' 区分。
 * 所有扩展字段均为可选,不破坏 Phase 1-5 现有代码。
 */

import type { Rect } from './geometry.js';

/** 节点记录 - 框架不关心内容,只记录位置和类型 */
export interface NodeRecord {
  id: string;
  type: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  data?: unknown;
  // ===== Phase 6: group 层级系统扩展(SceneNode 统一类型) =====
  /** 父组 id,根级为 null(唯一层级来源,严禁循环引用) */
  parentId?: string | null;
  /** 子节点/子组 id 列表(group 节点用,普通节点为空数组或 undefined) */
  childrenIds?: string[];
  /** group 包围盒(世界坐标 { x, y, width, height }) */
  bounds?: Rect;
  /** 包围盒脏标记(需重算) */
  boundsDirty?: boolean;
  /** 渲染层级(group 固定 -10,渲染于普通节点之下) */
  zIndex?: number;
  /** 显示标题(group 名称或节点标题) */
  title?: string;
  /** 兄弟排序(同一父级下的 DFS 遍历顺序) */
  siblingOrder?: number;
  /** 逻辑索引(越外层越小,用于框选提升计算) */
  logicalIndex?: number;
  /** 隐藏(不渲染,不参与命中) */
  hidden?: boolean;
  /** 锁定(不可编辑,不可拖拽) */
  locked?: boolean;
  /** group 背景色(支持 rgba 含 A 通道;普通节点也可用,等效于 nodeColor 但优先级更高) */
  backgroundColor?: string;
  /** 圆角(世界坐标像素;group 默认 8,普通节点默认 8) */
  borderRadius?: number;
  /** 外轮廓颜色(支持 rgba 透明;undefined 用默认:group 蓝/红选中,节点 #0f3460/#e94560) */
  outlineColor?: string;
  /** 外轮廓厚度(世界坐标像素;undefined 用默认:group 2,节点 1/2 选中) */
  outlineWidth?: number;
  /** 外轮廓偏移(世界坐标像素;正值向外扩,负值向内缩;undefined 用 0) */
  outlineOffset?: number;
  /** 不透明度(0-1;undefined 用 1;仅由外层容器应用一次,内层不重复) */
  opacity?: number;
  // ===== 节点外观扩展(普通节点 + 组通用) =====
  /** 标题栏背景色(支持 rgba 含 A 通道;undefined 用默认) */
  titleBackgroundColor?: string;
  /** 内容区背景色(支持 rgba 含 A 通道;undefined 用默认) */
  contentBackgroundColor?: string;
  /** 节点边框/主题色(支持 rgba;undefined 用 ext.color) */
  nodeColor?: string;
  /** 明暗主题('light'|'dark';undefined 用默认 dark) */
  theme?: 'light' | 'dark';
  // ===== Pin 节点级统一覆盖(优先级高于 pin.color/shape/size) =====
  /** 统一 Pin 颜色(支持 rgba;undefined 时 pin.color/dataType 决定) */
  pinColor?: string;
  /** 统一 Pin 形状('circle'|'square';undefined 用 'circle') */
  pinShape?: 'circle' | 'square';
  /** 统一 Pin 尺寸(像素;undefined 用 12) */
  pinSize?: number;
}

/**
 * SceneNode - 场景节点统一类型(Group 与 Node 共用)
 *
 * 沿用源项目设计: Canvas = Scene Graph, Group = Container Node(type='group'),
 * parentId 是唯一层级来源, bounds 带脏标记缓存。
 * 在 ZeroExo 中 SceneNode 是 NodeRecord 的类型别名(扩展字段均为可选)。
 */
export type SceneNode = NodeRecord;

/** 边记录 - 连接两个节点的引脚(UE5: Pin) */
export interface EdgeRecord {
  id: string;
  source: { nodeId: string; pinId?: string };
  target: { nodeId: string; pinId?: string };
  data?: unknown;
}

/** 视口状态 */
export interface Viewport {
  x: number;
  y: number;
  k: number;
}

/** 图模型 - 核心数据结构 */
export interface GraphModel {
  nodes: NodeRecord[];
  edges: EdgeRecord[];
  viewport: Viewport;
  metadata: Record<string, unknown>;
}
