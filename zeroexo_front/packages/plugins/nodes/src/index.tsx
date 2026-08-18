/**
 * @zeroexo/plugin-nodes - 统一业务节点集
 *
 * 合并 5 种业务节点(text/config/ai.image/ai.video/ai.audio)为单包,
 * 采用 BaseNodeView 基类 + 派生视图架构(类似 C++ 派生类模式)。
 *
 * 架构:
 * - BaseNodeView: 所有节点的外壳(NodeShell 包裹 + 引脚布局 + 引脚拖拽回调)
 * - AIStateView: AI 生成节点的 4 状态机(idle/loading/error/success)
 * - 各派生视图: 提供内容区,通过 BaseNodeView 渲染引脚
 *
 * 引脚回调:
 *   NodeRendererProps 不含引脚事件回调。插件 install 时获取 ConnectionController,
 *   通过闭包传入各 renderNode,BaseNodeView 用 controller + node.id 构造引脚回调。
 *
 * AI 生成闭包:
 *   install 时从 context 获取 AIProvider,构造 generate 函数传给 AI 节点渲染器。
 *   generate 仅封装 provider 调用,状态管理由组件 handleGenerate 处理。
 */

import type { Plugin, PluginContext, NodeTypeExtension, NodeRendererProps, ToolDefinition, ToolContext } from '@zeroexo/core';
import type { NodeRecord } from '@zeroexo/core';
import type { NodeRegistryPlugin } from '@zeroexo/plugin-node-registry';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import { ConnectionPlugin } from '@zeroexo/plugin-connection';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import i18next from 'i18next';
import type {
  TextNodeData,
  ImageNodeData,
  VideoNodeData,
  AudioNodeData,
} from '@zeroexo/plugin-ai-provider';

// 基类组件
export { BaseNodeView, AIStateView, createPinHandlers, nodeActionBus } from './base-node-view.js';
export type { BaseNodeViewProps, AIStateViewProps, PinHandlers, NodeActionEvent } from './base-node-view.js';

// 冒泡评论层(从 comment-box 插件迁入,评论是节点本身的功能)
export { CommentLayer } from './comment-layer.js';
export type { CommentLayerProps } from './comment-layer.js';

// 节点工具定义(供 NodeTypeExtension.getTools 使用)
import { getTextTools, getImageTools, getVideoTools, getAudioTools } from './node-tools.js';

// 工具函数 — storageKey → blob URL 重建
export { useHydratedContent, useProgressiveImage, buildBackendUrl } from './utils/hydrate.js';

// 资产节点工厂 — 拖拽/上传/粘贴时创建节点实例
export { createAssetNode } from './asset-node-factory.js';

// 图片替换 — 上传文件 → 替换节点图片(支持撤销/重做)
export { replaceNodeImage } from './utils/replace-node-image.js';
export { convertToStack, createStackNode } from './node-tools.js';

// 视图组件 import(供 extension factory 使用)
import { TextNodeView, getTextNodePins } from './nodes/text-node-view.js';
import { GeneratorNodeView, getGeneratorNodePins } from './nodes/generator-node-view.js';
import { ImageNodeView, getImageNodePins } from './nodes/image-node-view.js';
import { VideoNodeView, getVideoNodePins } from './nodes/video-node-view.js';
import { AudioNodeView, getAudioNodePins } from './nodes/audio-node-view.js';
import { AiPlaceholderNodeView } from './nodes/ai-placeholder-node-view.js';
import type { AiPlaceholderNodeData } from './nodes/ai-placeholder-node-view.js';
import { StackedMediaNodeView } from './nodes/stacked-media-node-view.js';
import { getStackedMediaPins } from './nodes/stacked-media-pins.js';
import { createStackedMediaDefaultData, parseStackedMediaData } from './nodes/stacked-media-types.js';
import { ejectCard } from './nodes/stacked-media-model.js';

// 派生节点视图(重导出本地 import,避免 Vite 中同时 import + export from 的绑定问题)
export {
  TextNodeView, getTextNodePins,
  GeneratorNodeView, getGeneratorNodePins,
  ImageNodeView, getImageNodePins,
  VideoNodeView, getVideoNodePins,
  AudioNodeView, getAudioNodePins,
  AiPlaceholderNodeView,
  StackedMediaNodeView, getStackedMediaPins,
};
export type { AiPlaceholderNodeData } from './nodes/ai-placeholder-node-view.js';
export { StaggerGridRipple } from './components/StaggerGridRipple.js';

// 文字节点数据工厂(纯文本,无富文本)
function createTextDefaultData(): TextNodeData {
  return { content: '', prompt: '', status: 'idle' };
}
function createGeneratorDefaultData(): Record<string, unknown> {
  return {
    prompt: '',
    status: 'idle',
    generationMode: 'image',
    referenceImages: [],
    channelId: '',
    model: '',
  };
}
function createImageDefaultData(): ImageNodeData {
  return { prompt: '', content: '', status: 'idle' };
}
function createVideoDefaultData(): VideoNodeData {
  return { prompt: '', content: '', status: 'idle' };
}
function createAudioDefaultData(): AudioNodeData {
  return { prompt: '', content: '', status: 'idle' };
}
function createAiPlaceholderDefaultData(): AiPlaceholderNodeData {
  return { status: 'generating', generationType: 'image', targetNodeType: 'image' };
}

// ===== 节点类型常量 =====
const NODE_TYPES = {
  text: 'text',
  generator: 'generator',
  image: 'image',
  video: 'video',
  audio: 'audio',
  aiPlaceholder: 'ai-placeholder',
  stackedMedia: 'stacked-media',
} as const;

// ===== 扩展定义工厂 =====

function createTextExtension(controller: ConnectionController | null, store: ReactGraphStore | null): NodeTypeExtension {
  return {
    type: NODE_TYPES.text,
    displayName: i18next.t('nodes.textTitle'),
    category: 'Basic',
    color: '#6b7280',
    defaultSize: { width: 620, height: 348 },
    resizable: true,
    getPins: () => getTextNodePins(),
    createDefaultData: createTextDefaultData,
    getTools: () => getTextTools(),
    renderNode: (props: NodeRendererProps) => (
      <TextNodeView {...props} connectionController={controller} store={store ?? undefined} />
    ),
  };
}

function createGeneratorExtension(controller: ConnectionController | null, store: ReactGraphStore | null): NodeTypeExtension {
  return {
    type: NODE_TYPES.generator,
    displayName: i18next.t('nodes.generatorTitle'),
    category: 'Generator',
    color: '#8b5cf6',
    defaultSize: { width: 620, height: 348 },
    resizable: false,
    getPins: () => getGeneratorNodePins(),
    createDefaultData: createGeneratorDefaultData,
    renderNode: (props: NodeRendererProps) => (
      <GeneratorNodeView {...props} connectionController={controller} store={store} />
    ),
  };
}

function createImageExtension(
  controller: ConnectionController | null,
  store: ReactGraphStore | null,
): NodeTypeExtension {
  return {
    type: NODE_TYPES.image,
    displayName: i18next.t('nodes.imageTitle'),
    category: 'Media',
    color: '#9b59b6',
    defaultSize: { width: 620, height: 348 },
    resizable: true,
    lockAspectRatio: true,
    minSize: { width: 80, height: 80 },
    getPins: () => getImageNodePins(),
    createDefaultData: createImageDefaultData,
    getTools: () => getImageTools(),
    renderNode: (props: NodeRendererProps) => (
      <ImageNodeView {...props} connectionController={controller} store={store ?? undefined} />
    ),
  };
}

function createVideoExtension(
  controller: ConnectionController | null,
  store: ReactGraphStore | null,
): NodeTypeExtension {
  return {
    type: NODE_TYPES.video,
    displayName: i18next.t('nodes.videoTitle'),
    category: 'Media',
    color: '#3b82f6',
    defaultSize: { width: 620, height: 348 },
    resizable: true,
    lockAspectRatio: true,
    minSize: { width: 80, height: 80 },
    getPins: () => getVideoNodePins(),
    createDefaultData: createVideoDefaultData,
    getTools: () => getVideoTools(),
    renderNode: (props: NodeRendererProps) => (
      <VideoNodeView {...props} connectionController={controller} store={store ?? undefined} />
    ),
  };
}

function createAudioExtension(
  controller: ConnectionController | null,
  store: ReactGraphStore | null,
): NodeTypeExtension {
  return {
    type: NODE_TYPES.audio,
    displayName: i18next.t('nodes.audioTitle'),
    category: 'Media',
    color: '#10b981',
    // 气泡比例(特化外观:不参与全局外观配置与尺寸统一)
    defaultSize: { width: 360, height: 96 },
    resizable: false,
    specialAppearance: true,
    getPins: () => getAudioNodePins(),
    createDefaultData: createAudioDefaultData,
    getTools: () => getAudioTools(),
    renderNode: (props: NodeRendererProps) => (
      <AudioNodeView {...props} connectionController={controller} store={store ?? undefined} />
    ),
  };
}

/** AI 占位节点扩展 - 不显示在节点菜单中,仅用于 AI 生成任务占位 */
function createAiPlaceholderExtension(controller: ConnectionController | null, store: ReactGraphStore | null): NodeTypeExtension {
  return {
    type: NODE_TYPES.aiPlaceholder,
    displayName: 'AI 生成中',
    category: '_hidden',
    color: '#8b5cf6',
    // 尺寸:网格179×101 + 四周8px留白 = 195×117
    defaultSize: { width: 195, height: 117 },
    resizable: false,
    getPins: () => [],
    createDefaultData: createAiPlaceholderDefaultData,
    getTools: () => [],
    renderNode: (props: NodeRendererProps) => (
      <AiPlaceholderNodeView {...props} connectionController={controller} store={store ?? undefined} />
    ),
  };
}

/** StackNode 资源浏览器扩展 - 支持图片/视频节点连线收纳(特化外观通用节点) */
function createStackedMediaExtension(controller: ConnectionController | null, store: ReactGraphStore | null): NodeTypeExtension {
  return {
    type: NODE_TYPES.stackedMedia,
    displayName: i18next.t('nodes.stackedMediaTitle'),
    // Basic 分类:可拖拽/菜单创建的通用节点(多选堆叠入口已移除)
    category: 'Basic',
    color: '#f59e0b',
    // 基准尺寸与 image/video 节点一致
    defaultSize: { width: 620, height: 348 },
    resizable: false,
    specialAppearance: true,
    getPins: () => getStackedMediaPins(),
    createDefaultData: createStackedMediaDefaultData,
    // 节点视图契约(MVVM 试点):默认走 NodeShell 状态渲染,声明排布边界
    viewContract: {
      selectionEffect: 'default',
      connectionHoverEffect: 'default',
      hoverEffect: 'default',
    },
    // 纵深防御:作为 input 端时仅接受 image/video 源
    // (既有类型兼容矩阵已排除其余类型,不存在"未识别"态)
    canConnect: (source, target) => {
      if (!store) return;
      const tgtNode = store.getNode(target.nodeId);
      if (!tgtNode || tgtNode.type !== NODE_TYPES.stackedMedia) return;
      const srcNode = store.getNode(source.nodeId);
      if (srcNode && srcNode.type !== 'image' && srcNode.type !== 'video') {
        return { valid: false, reason: i18next.t('nodes.stackOnlyAcceptsMedia') };
      }
    },
    getTools: (node: NodeRecord, ctx: ToolContext): ToolDefinition[] => {
      const data = parseStackedMediaData(node.data as Record<string, unknown> | undefined);
      const activeCard = data.cards[data.activeIndex];
      const tools: ToolDefinition[] = [];

      // 根据活跃卡片类型注入原始工具(排除"堆叠"自身)
      if (activeCard) {
        const sourceTools = activeCard.sourceType === 'video' ? getVideoTools() : getImageTools();
        for (const t of sourceTools) {
          if (t.id === 'createStackNode') continue; // 排除"堆叠"自身
          tools.push(t);
        }
      }

      // 移出按钮(仅 StackNode 显示;label 与 node-tools.tsx 其余工具一致,硬编码中文)
      tools.push({
        id: 'eject',
        label: '移出',
        title: '移出为独立节点',
        icon: 'x-circle',
        danger: true,
        visible: () => data.cards.length > 0,
        run: () => {
          if (data.cards.length === 0) return;
          const result = ejectCard(ctx.commandQueue, node, data, data.activeIndex);
          if (result) ctx.commandQueue.execute(result.command);
        },
      });

      return tools;
    },
    renderNode: (props: NodeRendererProps) => (
      <StackedMediaNodeView {...props} connectionController={controller} store={store ?? undefined} />
    ),
  };
}

// ===== 主插件 =====

/**
 * PluginNodesPlugin - 统一业务节点插件 + 节点注册入口
 *
 * 一个插件注册全部 5 种业务节点类型(text/config/ai.image/ai.video/ai.audio)。
 * 替代原先 5 个独立插件包,符合"节点集"而非"独立插件"的设计理念。
 *
 * 同时作为 app 注册自定义节点的统一入口:对外暴露 register/registerAll/get/all/
 * search 等代理方法(代理到底层 NodeRegistryPlugin),app 无需直接持有 registry。
 *
 * 依赖:
 * - node-registry: 必需,底层注册中心(由本插件代理)
 * - connection: 必需,提供引脚拖拽连线能力
 * - ai-provider: 可选,未安装时 AI 节点仍可渲染但生成会报错
 */
export class PluginNodesPlugin implements Plugin {
  id = 'nodes';
  dependencies = ['node-registry', 'connection'];

  private registeredTypes: string[] = [];
  /** 底层注册中心引用(install 时从 context 获取并缓存) */
  private registry?: NodeRegistryPlugin;

  install(context: PluginContext): void {
    const registry = context.getPlugin<NodeRegistryPlugin>('node-registry');
    if (!registry) {
      throw new Error('PluginNodesPlugin requires NodeRegistryPlugin to be installed first');
    }
    this.registry = registry;

    // 获取连线控制器(引脚拖拽连线)
    const connectionPlugin = context.getPlugin<ConnectionPlugin>('connection');
    const controller = connectionPlugin?.getController() ?? null;

    // Bug9: 获取 store(用于 GeneratorNodeView 订阅 graph 变化自动刷新引用计数)
    const renderReactPlugin = context.getPlugin<Plugin & { getStore(): ReactGraphStore }>('render-react');
    const store = renderReactPlugin?.getStore() ?? null;

    // 创建并注册全部 7 种节点扩展
    const extensions: NodeTypeExtension[] = [
      createTextExtension(controller, store),
      createGeneratorExtension(controller, store),
      createImageExtension(controller, store),
      createVideoExtension(controller, store),
      createAudioExtension(controller, store),
      createAiPlaceholderExtension(controller, store),
      createStackedMediaExtension(controller, store),
    ];

    for (const ext of extensions) {
      registry.register(ext, this.id);
      this.registeredTypes.push(ext.type);
    }
  }

  uninstall(context: PluginContext): void {
    const registry = context.getPlugin<NodeRegistryPlugin>('node-registry');
    for (const type of this.registeredTypes) {
      registry?.unregister(type);
    }
    this.registeredTypes = [];
    this.registry = undefined;
  }

  // ===== 注册中心代理(app 统一入口)=====

  /** 获取底层注册中心(install 后可用) */
  getRegistry(): NodeRegistryPlugin {
    if (!this.registry) {
      throw new Error('PluginNodesPlugin not installed: call editor.install(plugin) first');
    }
    return this.registry;
  }

  /** 注册节点类型(代理到底层 registry) */
  register(definition: NodeTypeExtension, registeredBy = 'app'): void {
    this.getRegistry().register(definition, registeredBy);
  }

  /** 批量注册节点类型(代理到底层 registry) */
  registerAll(definitions: NodeTypeExtension[], registeredBy = 'app'): void {
    this.getRegistry().registerAll(definitions, registeredBy);
  }

  /** 按 type 获取定义(代理) */
  get(type: string): NodeTypeExtension | undefined {
    return this.getRegistry().get(type);
  }

  /** 获取所有已注册定义(代理) */
  all(): NodeTypeExtension[] {
    return this.getRegistry().all();
  }

  /** 模糊搜索节点类型(代理,用于右键菜单节点选择器) */
  search(query: string, limit = 20): ReturnType<NodeRegistryPlugin['search']> {
    return this.getRegistry().search(query, limit);
  }

  /** 获取所有 type 字符串(代理) */
  types(): string[] {
    return this.getRegistry().types();
  }

  /** 按分类获取(代理) */
  byCategory(category: string): NodeTypeExtension[] {
    return this.getRegistry().byCategory(category);
  }

  /** 获取所有分类名(代理) */
  categories(): string[] {
    return this.getRegistry().categories();
  }

  /** 构建分类树(代理) */
  categoryTree(): ReturnType<NodeRegistryPlugin['categoryTree']> {
    return this.getRegistry().categoryTree();
  }

  /** 已注册数量(代理) */
  size(): number {
    return this.getRegistry().size();
  }

  /** 判断类型是否已注册(代理) */
  has(type: string): boolean {
    return this.getRegistry().has(type);
  }
}
