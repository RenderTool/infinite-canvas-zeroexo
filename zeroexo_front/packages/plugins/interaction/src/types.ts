/**
 * interaction 插件类型定义
 *
 * 公开类型(经 controller.ts / index.ts barrel 导出):
 * - InteractionMode / ResizeHandleType / MarqueeController
 * - 拖拽钩子: DragEndHook / ExpandDragIdsHook / DragStartHook / DragMoveHook
 * - InteractionTransient(瞬态状态,教育提示等 UI 订阅)
 * - HelperLine / HelperLinesCallback / ResizeConfig / ResizeConfigAccessor
 *
 * 内部类型: DragType / DragState / NO_DRAG(拖拽状态机载体)
 */

/** 拖拽类型 */
export type DragType = 'none' | 'node' | 'pan' | 'marquee' | 'resize';

/** 交互模式(选择/拖拽) */
export type InteractionMode = 'select' | 'pan';

/** Resize handle 类型(8 角点:4 角 + 4 边中点) */
export type ResizeHandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** 框选控制器接口(由 selection 插件注入,避免硬依赖) */
export interface MarqueeController {
  beginMarquee: (worldX: number, worldY: number) => void;
  updateMarquee: (worldX: number, worldY: number) => void;
  endMarquee: (additive: boolean) => Set<string>;
  cancelMarquee: () => void;
}

/**
 * 拖拽结束钩子(由 group 插件注入,用于拖拽结束时的组归属判定)。
 * - nodeIds: 本次拖拽的节点 id 列表
 * - shiftKey: 拖拽起始时是否按住 Shift(用于"Shift+拖拽移出组")
 * - hasMoved: 是否真的发生了移动(非纯点击)
 */
export type DragEndHook = (
  nodeIds: string[],
  shiftKey: boolean,
  hasMoved: boolean,
) => void;

/**
 * 拖拽集扩展钩子(由 group 插件注入)。
 * 拖拽开始时调用,传入原始选中 id,返回扩展后的 id 集(含组子孙)。
 * 用于"移动父组时 BFS 同步所有子孙组与节点"。
 */
export type ExpandDragIdsHook = (nodeIds: string[]) => string[];

/**
 * 拖拽开始钩子(由 group 插件注入,用于 Shift+拖拽临时脱离)。
 * - nodeIds: 本次拖拽的节点 id 列表(已扩展)
 * - shiftKey: 拖拽起始时是否按住 Shift
 * Shift 按下时,group 插件可标记这些节点为"临时脱离",使组 bounds 实时排除它们。
 */
export type DragStartHook = (nodeIds: string[], shiftKey: boolean) => void;

/**
 * 拖拽移动钩子(由 group 插件注入,拖拽 move 时持续回调)。
 * - nodeIds: 本次拖拽的节点 id 列表(已扩展)
 * 用于拖拽中实时计算悬停目标组(如"拖入组自动吸附"提示)。
 */
export type DragMoveHook = (nodeIds: string[]) => void;

/** 瞬态交互状态(供教育提示等 UI 订阅) */
export interface InteractionTransient {
  /** Space 键按住(select 模式下临时平移) */
  spacePressed: boolean;
  /** 是否正在拖拽节点 */
  draggingNode: boolean;
  /** 是否正在 Shift+框选(追加选择) */
  marqueeAdditive: boolean;
  /** 是否正在 resize 缩放节点 */
  resizing: boolean;
}

// ===== Helper Lines(对齐辅助线) =====

/** 一条对齐辅助线(世界坐标) */
export interface HelperLine {
  type: 'horizontal' | 'vertical';
  /** 线在世界坐标系中的位置(水平线的 y, 垂直线的 x) */
  position: number;
  /** 线段在世界坐标系中的起始位置 */
  start: number;
  /** 线段在世界坐标系中的结束位置 */
  end: number;
}

/** Helper Lines 更新回调(拖拽中传入当前对齐线,结束传入空数组) */
export type HelperLinesCallback = (lines: HelperLine[]) => void;

/** Resize 配置(从 NodeTypeExtension 派生) */
export interface ResizeConfig {
  resizable: boolean;
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
  lockAspectRatio?: boolean;
  /** 节点默认尺寸(从 ext.defaultSize,用于未 resize 过的节点起始 rect) */
  defaultSize?: { width: number; height: number };
}

/** Resize 配置访问器(由 app 注入,从 extensions 获取节点 resize 配置) */
export type ResizeConfigAccessor = (nodeId: string) => ResizeConfig | null;

// ===== 拖拽状态机载体(内部) =====

export interface DragState {
  type: DragType;
  /** 拖拽的节点 id 列表(支持多选拖拽) */
  nodeIds: string[];
  /** 各节点起始世界坐标 */
  startPositions: Map<string, { x: number; y: number }>;
  /** 鼠标起始屏幕坐标 */
  startClientX: number;
  startClientY: number;
  /** 视口起始状态(平移用) */
  startViewportX: number;
  startViewportY: number;
  /** 上一次的世界坐标偏移(用于计算增量) */
  lastWorldDx: number;
  lastWorldDy: number;
  /** 是否已移动(用于区分点击和拖拽) */
  hasMoved: boolean;
  /** 是否追加选择(Shift 键) */
  additive: boolean;
  /** 拖拽起始时是否按住 Shift(用于 group 插件的"Shift+拖拽移出组") */
  shiftKey: boolean;
  // ===== resize 专属 =====
  /** resize 的目标节点 id */
  resizeNodeId?: string;
  /** resize 的 handle 类型 */
  resizeHandle?: ResizeHandleType;
  /** resize 起始时的 rect(世界坐标 x/y/width/height) */
  resizeStartRect?: { x: number; y: number; width: number; height: number };
  /** resize 的初始 oldRect(用于命令的 oldRect,合并时保留第一条) */
  resizeOldRect?: { x: number; y: number; width: number; height: number };
  /** resize 配置 */
  resizeConfig?: ResizeConfig;
}

export const NO_DRAG: DragState = {
  type: 'none',
  nodeIds: [],
  startPositions: new Map(),
  startClientX: 0,
  startClientY: 0,
  startViewportX: 0,
  startViewportY: 0,
  lastWorldDx: 0,
  lastWorldDy: 0,
  hasMoved: false,
  additive: false,
  shiftKey: false,
};
