/**
 * @zeroexo/preset-default - 默认编辑器预设
 *
 * 一行启动完整编辑器:组合所有官方插件 + 装配控制器 + 注册快捷键。
 *
 * 用法:
 *   const editor = createDefaultEditor({ container: el });
 *   // 使用 editor.store / editor.plugins / editor.core
 *   editor.cleanup();  // 卸载
 *
 * options 控制可选插件(minimap/persistence/keyboard)。
 * 核心插件(render/interaction/selection/history/nodes/group)始终安装。
 */

import { createEditor } from '@zeroexo/core';
import type { Editor, NodeRecord } from '@zeroexo/core';
import { RenderReactPlugin } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { InteractionPlugin } from '@zeroexo/plugin-interaction';
import { ConnectionPlugin } from '@zeroexo/plugin-connection';
import { HistoryPlugin } from '@zeroexo/plugin-history';
import { SelectionPlugin } from '@zeroexo/plugin-selection';
import { NodeRegistryPlugin } from '@zeroexo/plugin-node-registry';
import { MinimapPlugin } from '@zeroexo/plugin-minimap';
import { KeyboardPlugin } from '@zeroexo/plugin-keyboard';
import { PersistencePlugin } from '@zeroexo/plugin-persistence';
import { StubProvider } from '@zeroexo/plugin-ai-provider';
import type { AIProvider } from '@zeroexo/plugin-ai-provider';
import { PluginNodesPlugin } from '@zeroexo/plugin-nodes';
import { GroupPlugin } from '@zeroexo/plugin-group';
import { LayoutPlugin } from '@zeroexo/plugin-layout';
import { registerStandardShortcuts } from './shortcuts.js';

// 剪贴板复用 API(供右键菜单等 UI 入口调用,与快捷键同源;逻辑全部在 shortcuts.ts,此处纯转发)
export {
  hasClipboardContent,
  pasteClipboard,
  duplicateSubtree,
  pasteFromClipboard,
  collectSubtreeIds,
  filterTopLevelIds,
} from './shortcuts.js';

// ===== 类型 =====

export interface DefaultEditorOptions {
  /** 画布容器元素(用于 interaction/connection 坐标转换修正) */
  container: HTMLElement;
  /** 持久化 storageKey(默认 'zeroexo:default') */
  storageKey?: string;
  /** 启用小地图(默认 true) */
  enableMinimap?: boolean;
  /** 启用持久化(默认 true) */
  enablePersistence?: boolean;
  /** 启用键盘快捷键 + 标准快捷键注册(默认 true) */
  enableKeyboard?: boolean;
  /** 调试模式(默认 false,开启时 console.warn 插件安装信息) */
  debug?: boolean;
  /**
   * AI Provider 实例(P3.4)
   * 不传则使用 StubProvider(所有 generate 调用抛错)。
   * app 层注入 ProxyProvider 通过后端 /api/ai/generate 调用 AI 服务。
   */
  aiProvider?: AIProvider;
}

export interface DefaultEditor {
  /** 编辑器核心(Editor) */
  core: Editor;
  /** React 状态存储 */
  store: ReactGraphStore;
  /** 所有插件实例引用(用于 UI 获取 controller) */
  plugins: {
    renderReact: RenderReactPlugin;
    interaction: InteractionPlugin;
    connection: ConnectionPlugin;
    selection: SelectionPlugin;
    history: HistoryPlugin;
    keyboard?: KeyboardPlugin;
    minimap?: MinimapPlugin;
    persistence?: PersistencePlugin;
    nodes: PluginNodesPlugin;
    group: GroupPlugin;
    layout: LayoutPlugin;
    /** AI Provider 实例(P3.4: app 层注入的 ProxyProvider 或默认 StubProvider) */
    aiProvider: AIProvider;
  };
  /** 卸载所有插件(注销快捷键 + 逆序 uninstall) */
  cleanup: () => void;
}

// ===== 主函数 =====

export function createDefaultEditor(options: DefaultEditorOptions): DefaultEditor {
  const {
    container,
    storageKey = 'zeroexo:default',
    enableMinimap = true,
    enablePersistence = true,
    enableKeyboard = true,
    debug = false,
    aiProvider,
  } = options;

  // ===== 1. 创建编辑器核心(空图,由调用方按需填充) =====
  const editor = createEditor();

  // ===== 2. 实例化所有官方插件 =====
  const renderReact = new RenderReactPlugin();
  const interaction = new InteractionPlugin();
  const selection = new SelectionPlugin();
  const history = new HistoryPlugin();
  const nodes = new PluginNodesPlugin();
  const group = new GroupPlugin();
  const layout = new LayoutPlugin();

  // 可选插件
  const keyboard = enableKeyboard ? new KeyboardPlugin() : undefined;
  const minimap = enableMinimap ? new MinimapPlugin() : undefined;
  const persistence = enablePersistence
    ? new PersistencePlugin({ storageKey })
    : undefined;

  // 内部依赖插件(安装但不暴露,nodes 依赖 node-registry + connection)
  const connection = new ConnectionPlugin();
  const nodeRegistry = new NodeRegistryPlugin();
  // P3.4: 优先使用 app 注入的 AI Provider,回退 StubProvider
  const aiProviderInstance = aiProvider ?? new StubProvider();

  // ===== 3. 批量安装(PluginHost 自动拓扑排序: 依赖在前,被依赖在后) =====
  const pluginsToInstall = [
    renderReact,
    interaction,
    connection,
    history,
    selection,
    nodeRegistry,
    keyboard,
    minimap,
    persistence,
    aiProviderInstance,
    nodes,
    group,
    layout,
  ].filter((p): p is NonNullable<typeof p> => p !== undefined);

  if (debug) {
    // eslint-disable-next-line no-console
    console.warn('[preset-default] Installing plugins:', pluginsToInstall.map((p) => p.id));
  }

  editor.plugins.installAll(pluginsToInstall);

  // ===== 4. 控制器装配 =====
  const store = renderReact.getStore();
  const commandQueue = editor.commandQueue;

  // 注入容器(用于 interaction/connection 坐标转换修正)
  interaction.setContainer(container);
  connection.setContainer(container);

  const interactionController = interaction.getController();
  const selectionController = selection.getController();

  // 注入框选控制器到 interaction(解耦: interaction 不硬依赖 selection 包)
  interactionController.setMarqueeController(selectionController);

  // 节点尺寸访问器: node.size 优先(已 resize 过的用实际尺寸),回退 ext.defaultSize
  const getNodeSize = (node: NodeRecord): { width: number; height: number } => {
    return node.size ?? nodes.get(node.type)?.defaultSize ?? { width: 200, height: 80 };
  };
  group.getController().setNodeSizeAccessor(getNodeSize);

  // 注入 resize 配置访问器到 InteractionController
  interactionController.setResizeConfigAccessor((nodeId) => {
    const node = store.getGraph().nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const ext = nodes.get(node.type);
    if (!ext || !ext.resizable) return null;
    // freeResize 数据属性可覆盖扩展的 lockAspectRatio(用户通过工具栏切换锁比例)
    // T9: scaleOverride='real'(StackNode 文本卡活跃)同样解锁等比——文本查看期间自由宽高重排
    const nodeData = node.data as { freeResize?: boolean; scaleOverride?: string } | null;
    const lockAspectRatio = ext.lockAspectRatio && !nodeData?.freeResize && nodeData?.scaleOverride !== 'real';
    return {
      resizable: true,
      minSize: ext.minSize,
      maxSize: ext.maxSize,
      lockAspectRatio,
      defaultSize: ext.defaultSize,
    };
  });

  // 注入节点锁定访问器到 InteractionController + ConnectionController
  // 生成中(status === 'loading')节点禁止移动/缩放/连线
  const nodeLocked = (nodeId: string): boolean => {
    const node = store.getGraph().nodes.find((n) => n.id === nodeId);
    return (node?.data as Record<string, unknown> | undefined)?.status === 'loading';
  };
  interactionController.setNodeLockedAccessor(nodeLocked);
  connection.getController().setNodeLockedAccessor(nodeLocked);

  // ===== 5. 注册键盘快捷键 =====
  let standardShortcutsCleanup: (() => void) | undefined;
  let groupShortcutsCleanup: (() => void) | undefined;
  if (keyboard) {
    // 顺序:先注册标准快捷键,再注册 group 快捷键(group 在后 → 逆序优先 → 解决 Delete/Escape 冲突)
    standardShortcutsCleanup = registerStandardShortcuts(keyboard, {
      store,
      commandQueue,
      history,
      groupCtrl: group.getController(),
    });
    groupShortcutsCleanup = keyboard.registerShortcuts(group.getShortcutEntries());
  }

  // ===== 6. 构建 cleanup 函数 =====
  // 先注销快捷键,再按安装逆序卸载插件(被依赖方先卸载,避免依赖保护报错)
  const pluginUnloadOrder = [
    'layout',
    'group',
    'nodes',
    'ai-provider',
    'persistence',
    'keyboard',
    'minimap',
    'node-registry',
    'selection',
    'history',
    'connection',
    'interaction',
    'render-react',
  ];
  const cleanup = (): void => {
    standardShortcutsCleanup?.();
    groupShortcutsCleanup?.();
    for (const id of pluginUnloadOrder) {
      try {
        editor.plugins.uninstall(id);
      } catch {
        // 依赖保护: 逆序卸载不会触发,此处静默以保证 cleanup 不中断
      }
    }
  };

  return {
    core: editor,
    store,
    plugins: {
      renderReact,
      interaction,
      connection,
      selection,
      history,
      keyboard,
      minimap,
      persistence,
      nodes,
      group,
      layout,
      aiProvider: aiProviderInstance,
    },
    cleanup,
  };
}
