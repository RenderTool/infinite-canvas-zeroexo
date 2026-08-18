/**
 * 扩展点契约类型定义
 */

import type { NodeRecord } from '../model/types.js';
import type { CommandQueue } from '../command/command-queue.js';
import type { EventBus } from '../bus/event-bus.js';
import type { NodeViewContract } from '../node-view-contract.js';

/** 引脚定义(UE5 风格命名: Pin) */
export interface Pin {
  id: string;
  name: string;
  direction: 'input' | 'output';
  color?: string;
  dataType?: string;
  /** 形状('circle'|'square';undefined 用 'circle') */
  shape?: 'circle' | 'square';
  /** 尺寸(像素;undefined 用 12) */
  size?: number;
}

/** 节点渲染器属性 */
export interface NodeRendererProps {
  node: NodeRecord;
  pins: Pin[];
  isSelected: boolean;
  isHovered: boolean;
  updateNode: (patch: Partial<NodeRecord>) => void;
  /** 命令队列(用于提交命令,如 ResizeNodeCommand,支持撤销/重做) */
  commandQueue?: CommandQueue;
  /** 1/viewport.k(画布缩放的倒数),用于标题栏等元素的屏幕恒定尺寸反缩放 */
  invK?: number;
  /** 强制显示所有引脚(连线拖拽期间所有节点Pin可见) */
  forceShowPins?: boolean;
  /** 外部触发重命名(由工具栏按钮触发) */
  externalRenaming?: boolean;
  /** 重命名完成/取消回调 */
  onRenameFinish?: () => void;
  /** 节点缩放比例(与 defaultSize 的比值,如 2 表示宽高各放大 2 倍) */
  pinScaleX?: number;
  pinScaleY?: number;
}

/** 节点渲染器(业务方提供) */
export type NodeRenderer = (props: NodeRendererProps) => unknown;

/** 属性面板渲染器属性 */
export interface PropertiesRendererProps {
  node: NodeRecord;
  updateNode: (patch: Partial<NodeRecord>) => void;
}

/** 属性面板渲染器 */
export type PropertiesRenderer = (props: PropertiesRendererProps) => unknown;

// ===== 节点工具集(Phase 7.2) =====

/**
 * 工具上下文 - 注入给 ToolDefinition 的业务能力。
 *
 * 设计原则:工具定义只描述 UI(label/icon/active),业务逻辑通过 ctx 注入。
 * 工具通过 commandQueue 提交命令(支持撤销),通过 eventBus 发布事件,
 * 通过 getSelectedNodeIds 感知选区,通过 openEditor 打开编辑器。
 *
 * core 层定义此接口,渲染层(render-react)提供具体实现并注入给工具。
 */
export interface ToolContext {
  /** 命令队列(提交命令 + getState() 读取画布) */
  commandQueue: CommandQueue;
  /** 事件总线(发布/订阅事件) */
  eventBus: EventBus;
  /** 获取当前选中节点 id 集合 */
  getSelectedNodeIds(): Set<string>;
  /** 打开节点编辑器/属性面板(可选,由渲染层注入) */
  openEditor?(node: NodeRecord): void;
  /** 打开图片编辑对话框(按 type 指定具体编辑器:crop/split/upscale/maskEdit/angle/superResolve/view/info/saveAsset/reversePrompt/replace) */
  openImageDialog?(node: NodeRecord, type: string): void;
}

/**
 * 工具栏工具定义(数据驱动 + 策略模式)。
 *
 * 每个工具是一个纯数据 + 函数对象:
 * - id/label/title/icon/danger 描述 UI 外观
 * - active/visible 控制状态与可见性(可基于 node 动态计算)
 * - run 是执行函数(策略实现,通过 ctx 访问业务能力)
 *
 * icon 为 unknown 类型(core 不依赖 React),约定为:
 * - string: icon name(渲染层用 icon font/svg 渲染)
 * - 其他: 由渲染层断言为 ReactNode 直接渲染
 *
 * 设计特点:
 * - 统一接口(所有节点类型共用,非仅 image)
 * - 注册表分发(NodeTypeExtension.getTools,非条件展开硬编码)
 * - core 纯逻辑(icon 用 unknown 解耦 React,与 NodeRenderer 模式一致)
 */
export interface ToolDefinition {
  /** 工具唯一 id(同节点类型内唯一) */
  id: string;
  /** 工具栏标签(可静态可动态) */
  label: string | ((node: NodeRecord, ctx: ToolContext) => string);
  /** 鼠标悬浮提示(可静态可动态) */
  title: string | ((node: NodeRecord, ctx: ToolContext) => string);
  /** 图标(unknown 由渲染层解释;string 视为 icon name,其他视为 ReactNode) */
  icon: unknown | ((node: NodeRecord, ctx: ToolContext) => unknown);
  /** 是否处于激活态(高亮显示;如"锁比例"工具的按下状态) */
  active?: (node: NodeRecord, ctx: ToolContext) => boolean;
  /** 是否可见(条件显示;如 image 无内容时隐藏"裁剪") */
  visible?: (node: NodeRecord, ctx: ToolContext) => boolean;
  /** 是否为危险操作(红色高亮;如删除) */
  danger?: boolean;
  /** 是否为主要操作(填充强调色背景;如"生成分镜") */
  primary?: boolean;
  /** 工具分组(可选,用于 Detail 面板按组渲染;如 "基础" / "编辑" / "AI") */
  group?: string;
  /** 执行函数(策略实现,通过 ctx 访问业务能力) */
  run: (node: NodeRecord, ctx: ToolContext) => void;
  /** 下拉菜单项(可选;存在时渲染为下拉按钮而非普通按钮) */
  menu?: (node: NodeRecord, ctx: ToolContext) => ToolMenuItem[];
}

/** 工具下拉菜单项 */
export interface ToolMenuItem {
  key: string;
  label?: string;
  icon?: unknown;
  divider?: boolean;
  disabled?: boolean;
  /** 点击该菜单项时执行(替代 ToolDefinition.run) */
  run?: (node: NodeRecord, ctx: ToolContext) => void;
}

/** 节点类型扩展契约 */
export interface NodeTypeExtension {
  type: string;
  displayName: string;
  category: string;
  color: string;
  icon?: string;

  getPins?(node: NodeRecord): Pin[];
  renderNode?: NodeRenderer;
  renderProperties?: PropertiesRenderer;
  createDefaultData?(): unknown;
  defaultSize?: { width: number; height: number };
  validate?(node: NodeRecord): { valid: boolean; errors?: string[] };

  /** 是否允许 resize(默认 false,需显式启用) */
  resizable?: boolean;
  /** 最小尺寸约束 */
  minSize?: { width: number; height: number };
  /** 最大尺寸约束 */
  maxSize?: { width: number; height: number };
  /** 是否锁定宽高比(图片/视频节点通常为 true) */
  lockAspectRatio?: boolean;

  /**
   * 特化外观节点(如气泡音频节点/资源浏览器节点)。
   *
   * 特化节点不参与全局外观配置与尺寸计算操作(基准尺寸恢复等),
   * 但仍参与 LOD 降级与位置类操作(排列/对齐/分布)。
   * 其外观由节点视图自行特化渲染,忽略 NodeDefaults 全局默认。
   */
  specialAppearance?: boolean;

  /**
   * 节点视图契约(可选,MVVM)。
   *
   * 声明该类型节点的排布边界与各状态视觉的渲染归属:
   * - 省略时全部走 'default'(NodeShell 统一渲染,存量节点零改动)
   * - 状态设为 'custom' 时 NodeShell 跳过默认效果,由节点视图自绘
   */
  viewContract?: NodeViewContract;

  /**
   * 连线约束钩子(可选)。允许节点类型自定义连线规则。
   *
   * 调用时机:ConnectionController.validate 在通过默认规则(自连/方向/重复)后调用。
   * 调用方向:始终以 output → input 语义调用,source 为输出端,target 为输入端。
   * 双端钩子:源节点和目标节点的 canConnect 都会被调用(若不同),任一拒绝即拒绝。
   *
   * 典型用途:
   * - image 节点 out 只能连 image dataType 的 in
   * - 数据流节点禁止某些 dataType 组合
   * - 业务节点限制最大输入连接数
   *
   * @returns
   *   - `{ valid: false, reason }` 拒绝连线
   *   - `{ valid: true }` 显式允许(仍会调用对端钩子)
   *   - `void/undefined` 中立(继续后续校验)
   */
  canConnect?(
    source: { nodeId: string; pinId: string; direction: 'input' | 'output' },
    target: { nodeId: string; pinId: string; direction: 'input' | 'output' },
  ): { valid: boolean; reason?: string } | void;

  /**
   * 节点悬浮工具栏工具集(可选,Phase 7.2)。
   *
   * 返回该节点类型的工具定义数组,由渲染层 NodeHoverToolbar 组件调用。
   * 工具定义只描述 UI(label/icon/active),业务逻辑通过 ToolContext 注入。
   *
   * 设计原则:
   * - 注册表模式:每种节点类型注册自己的工具集,新增类型零侵入
   * - 策略模式:每个工具的 run 是独立策略,通过 ctx 访问业务能力
   * - 数据驱动:工具定义是纯数据 + 函数,可序列化(除 icon 外)
   *
   * 典型用途:
   * - image 节点:裁剪/放大/超分/反推提示词 等图片编辑工具
   * - video 节点:裁剪/拼接/转码 等视频编辑工具(后续扩展)
   * - text 节点:编辑文本/生图/字号调整
   * - 通用工具:info/delete/download(所有类型共用,由渲染层注入)
   */
  getTools?(node: NodeRecord, ctx: ToolContext): ToolDefinition[];
}

/** 序列化器扩展 */
export interface SerializerExtension {
  type: string;
  serialize(node: NodeRecord): unknown;
  deserialize(data: unknown): NodeRecord;
}
