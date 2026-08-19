/**
 * ZeroExo Core - 零依赖核心层
 *
 * 只包含:
 * - GraphModel(数据模型)
 * - EventBus(事件总线)
 * - CommandQueue(命令队列)
 * - PluginHost(插件管理器)
 * - Extensions(扩展点契约)
 * - createEditor(编辑器工厂)
 *
 * 不依赖任何运行时库,可在任意 JS 环境运行。
 */

// ===== 数据模型 =====
export type { GraphModel, NodeRecord, EdgeRecord, Viewport, SceneNode } from './model/types.js';
export type { Point, Rect, Bounds } from './model/geometry.js';

// ===== 事件总线 =====
export { EventBus } from './bus/event-bus.js';
export type { EventHandler, EventContext, Unsubscribe, Cancelable } from './bus/event-bus.js';
export * as Events from './bus/events.js';
// 同时直接导出事件常量,方便插件按需 import
export {
  GraphEvents,
  ViewportEvents,
  SelectionEvents,
  InteractionEvents,
  CommandEvents,
} from './bus/events.js';

// ===== 命令队列 =====
export { CommandQueue } from './command/command-queue.js';
export type { Command, CommandContext, MergeStrategy } from './command/command-queue.js';

// ===== 插件管理器 =====
export { PluginHost } from './plugin/plugin-host.js';
export type { Plugin, PluginContext, PluginOptions } from './plugin/plugin-host.js';

// ===== 扩展点契约 =====
export type {
  NodeTypeExtension,
  NodeRenderer,
  NodeRendererProps,
  PropertiesRenderer,
  PropertiesRendererProps,
  SerializerExtension,
  Pin,
  ToolDefinition,
  ToolMenuItem,
  ToolContext,
} from './extensions/types.js';

// ===== 尺寸契约统一解析(Plan#11: 节点契约自维护,全入口读契约禁硬编码) =====
export {
  FALLBACK_NODE_SIZE,
  MEDIA_MIN_HEIGHT,
  RESIZE_MIN_FALLBACK_SIZE,
  resolveNodeSize,
  resolveBaseWidth,
  resolveMinHeight,
} from './extensions/size-contract.js';

// ===== 节点视图契约(MVVM) =====
export type { NodeViewContract } from './node-view-contract.js';
export type {
  CanvasActor,
  CanvasOperationContext,
  CanvasOperationMetrics,
  CanvasOperationObserver,
  NodeCapabilities,
  NodeDefinition,
  NodeElementMeasureContract,
  NodeMotionContract,
  NodeRuntimeContext,
  NodeRuntimeContract,
  NodeScaleContract,
  NodeScaleMode,
  NodeSelectionMode,
  NodeSizeBasis,
  NodeStateStyle,
  NodeVisualContract,
  OverlayContract,
} from './node-runtime-contract.js';
export type {
  CanvasSchema,
  ConnectionContext,
  ConnectionDecision,
  NodeAction,
  NodeActionContext,
} from './canvas-schema.js';
export { allowAllCanvasSchema } from './canvas-schema.js';

// ===== 编辑器入口 =====
export { createEditor } from './editor.js';
export type { Editor, EditorOptions } from './editor.js';

// ===== 内置命令 =====
export {
  AddNodeCommand,
  RemoveNodeCommand,
  MoveNodeCommand,
  MoveNodesCommand,
  AddEdgeCommand,
  RemoveEdgeCommand,
  UpdateNodeDataCommand,
  UpdateNodeTitleCommand,
  BatchCommand,
  ResizeNodeCommand,
  DuplicateNodeCommand,
} from './command/builtins.js';

// ===== 空间索引 =====
export { GridSpatialIndex } from './spatial/grid-spatial-index.js';
export type { NodeSizeResolver } from './spatial/grid-spatial-index.js';
