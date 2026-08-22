/**
 * 剧创节点扩展(剧本/分镜/出片)
 *
 * 在 app 层注册到 nodes 插件(阶段页位于 app `src/`,不能在插件包内引用)。
 * 使用 PluginNodesPlugin.registerAll 一次性注册三类型。
 */

import type { NodeTypeExtension, NodeRendererProps, ToolDefinition, NodeRuntimeContract, NodeCapabilities } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import i18next from 'i18next';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { CANVAS_NODE_ICONS } from './icons.js';
import {
  CREATION_DEFAULT_SIZE,
  CREATION_MIN_SIZE,
  CREATION_PINS,
} from './creation-node-types.js';
import type { CreationNodeType } from './creation-node-types.js';
import { CreationNodeView } from './creation-node-view.js';

/** 各剧创节点展示名 i18n key */
export const CREATION_NAME_KEY: Record<CreationNodeType, string> = {
  script: 'canvasNodes.stage.script',
  storyboard: 'canvasNodes.stage.storyboard',
  workbench: 'canvasNodes.stage.workbench',
};

/** 各剧创节点主题色 */
const CREATION_COLOR: Record<CreationNodeType, string> = {
  script: '#f59e0b',
  storyboard: '#8b5cf6',
  workbench: '#06b6d4',
};

/** 各剧创节点能力声明(不参与堆叠,不参与媒体计算) */
const CREATION_CAPABILITIES: Record<CreationNodeType, NodeCapabilities> = {
  script: { stackable: false, capabilities: ['script'] },
  storyboard: { stackable: false, capabilities: ['storyboard'] },
  workbench: { stackable: false, capabilities: ['workbench'] },
};

/** 构建剧创节点 runtime contract(uniform 契约 + 标准 NodeShell 外观)
 * Plan#1 T3(验收修正): free→uniform 契约迁移,但**不声明 lockAspectRatio**——
 * 用户要求 script/storyboard/workbench 保持自由宽高 resize(内部列表重排不变形);
 * 非等比尺寸 isUniformScale=false 自动回退真实尺寸渲染 */
function createCreationRuntime(defaultSize: { width: number; height: number }): NodeRuntimeContract {
  return {
    definition: {
      schemaVersion: 1,
      size: {
        basis: { ...defaultSize },
        mode: 'uniform',
        preserveAspectRatio: false,
      },
      visual: {
        appearance: 'shell',
        selectionMode: 'runtime',
      },
    },
  };
}

// ===== 剧本节点工具(通过 nodeActionBus 广播,script-editor-sheet 订阅) =====

function getScriptTools(): ToolDefinition[] {
  return [
    {
      id: 'edit',
      label: '编辑',
      title: '全屏编辑',
      icon: <CANVAS_NODE_ICONS.fullscreen size={14} />,
      group: 'basic',
      run: (node) => { nodeActionBus.emit('script:edit', { nodeId: node.id }); },
    },
    {
      id: 'import',
      label: '导入',
      title: '导入剧本',
      icon: <CANVAS_NODE_ICONS.import size={14} />,
      group: 'basic',
      run: (node) => { nodeActionBus.emit('script:import', { nodeId: node.id }); },
    },
    {
      id: 'read',
      label: '阅读',
      title: '全屏翻阅',
      icon: <CANVAS_NODE_ICONS.read size={14} />,
      group: 'basic',
      run: (node) => { nodeActionBus.emit('script:read', { nodeId: node.id }); },
    },
    {
      id: 'generateStoryboard',
      label: '分镜',
      title: '根据当前剧本生成分镜节点并自动连线',
      icon: <CANVAS_NODE_ICONS.generateStoryboard size={14} />,
      group: 'edit',
      primary: true,
      // Plan#20 T0(征集#13): 不再硬编码 mode:'template'——改 emit 请求事件,
      // 由 script-editor-sheet 按 isSample 分流(范文→模板分镜 / 真实剧本→选集 Modal 走 AI 链路)
      run: (node) => { nodeActionBus.emit('script:requestGenerateStoryboard', { nodeId: node.id }); },
    },
  ];
}

// ===== 分镜节点工具(通过 nodeActionBus 广播,storyboard-sheet 订阅) =====

function getStoryboardTools(): ToolDefinition[] {
  return [
    {
      id: 'edit',
      label: '编辑',
      title: '全屏编辑',
      icon: <CANVAS_NODE_ICONS.fullscreen size={14} />,
      group: 'basic',
      run: (node) => { nodeActionBus.emit('storyboard:fullscreen', { nodeId: node.id }); },
    },
    {
      id: 'regenerate',
      label: '重新生成',
      title: 'AI 生成当前集分镜',
      icon: <CANVAS_NODE_ICONS.regenerate size={14} />,
      group: 'edit',
      // 2026-08-21 BUG 修复: 传入 activeEpisodeId; 有分镜内容时弹出确认弹窗
      run: (node) => {
        const data = (node.data ?? {}) as Record<string, unknown>;
        const episodeId = (data.activeEpisodeId as string) ?? '';
        const shotsByEpisode = data.shotsByEpisode as Record<string, unknown> | undefined;
        const shots = data.shots as unknown[] | undefined;
        // 检查当前集是否有分镜内容
        const hasShots = episodeId
          ? Array.isArray(shotsByEpisode?.[episodeId]) && (shotsByEpisode[episodeId] as unknown[]).length > 0
          : Array.isArray(shots) && shots.length > 0;
        if (hasShots) {
          // 已有内容 → 弹出确认弹窗(由 storyboard-sheet 监听处理)
          nodeActionBus.emit('storyboard:requestRegenerate', { nodeId: node.id, episodeId: episodeId || undefined });
        } else {
          // 无内容 → 直接生成
          nodeActionBus.emit('storyboard:regenerateEpisode', { nodeId: node.id, episodeId: episodeId || undefined });
        }
      },
    },
    {
      id: 'production',
      label: '剧管',
      title: '生成/关联剧中管理(角色·场景·道具)',
      icon: <CANVAS_NODE_ICONS.production size={14} />,
      group: 'edit',
      // 2026-08-21 架构修正: 剧管=分镜后置工序, 仅分镜时也可主动生成/关联剧管
      run: (node) => { nodeActionBus.emit('storyboard:manageProduction', { nodeId: node.id }); },
    },
  ];
}

// ===== 出片节点工具(通过 nodeActionBus 广播,workbench-sheet 订阅) =====

function getWorkbenchTools(): ToolDefinition[] {
  return [
    {
      id: 'edit',
      label: '编辑',
      title: '全屏编辑',
      icon: <CANVAS_NODE_ICONS.play size={14} />,
      group: 'basic',
      run: (node) => { nodeActionBus.emit('workbench:fullscreen', { nodeId: node.id }); },
    },
    {
      id: 'regenerate',
      label: '重新生成',
      title: '重新检测上游分镜并同步',
      icon: <CANVAS_NODE_ICONS.regenerate size={14} />,
      group: 'edit',
      run: (node) => { nodeActionBus.emit('workbench:resync', { nodeId: node.id }); },
    },
  ];
}

function createCreationExtension(
  kind: CreationNodeType,
  controller: ConnectionController | null,
  nameKey: string,
  getStore: () => ReactGraphStore | null,
): NodeTypeExtension {
  // 分镜节点允许剧本 + 生成器节点连入 input pin(Plan#33 A7: 剧本不强制,生成器可直连分镜)
  // 出片节点仅允许分镜/统筹/主体节点连入 input pin
  const canConnect: NodeTypeExtension['canConnect'] =
    kind === 'storyboard'
      ? (source, target) => {
          if (target.direction !== 'input') return;
          const store = getStore();
          if (!store) return;
          const graph = store.getGraph();
          const sourceNode = graph.nodes.find((n) => n.id === source.nodeId);
          if (sourceNode && !['script', 'generator'].includes(sourceNode.type)) {
            return { valid: false, reason: '分镜节点支持关联剧本或生成器节点' };
          }
        }
      : kind === 'workbench'
        ? (source, target) => {
            if (target.direction !== 'input') return;
            const store = getStore();
            if (!store) return;
            const graph = store.getGraph();
            const sourceNode = graph.nodes.find((n) => n.id === source.nodeId);
            if (sourceNode && !['storyboard', 'production-manager'].includes(sourceNode.type)) {
              return { valid: false, reason: '出片节点仅支持关联分镜/剧管节点' };
            }
          }
        : undefined;

  return {
    type: kind,
    displayName: i18next.t(nameKey),
    category: '创作',
    color: CREATION_COLOR[kind],
    defaultSize: CREATION_DEFAULT_SIZE[kind],
    minSize: CREATION_MIN_SIZE[kind],
    resizable: true,
    // 2026-08-22 布局契约: 创建新节点的默认排序参数(统一走 resolvePlacement, 禁硬编码偏移)
    placement: {
      direction: 'right',
      gap: 96,
      avoidOverlap: true,
    },
    // P5 契约接入:声明领域能力(不参与堆叠)与运行时缩放/外观契约
    capabilities: CREATION_CAPABILITIES[kind],
    runtime: createCreationRuntime(CREATION_DEFAULT_SIZE[kind]),
    // 标准 NodeShell 状态渲染,排布边界即 node.size
    viewContract: {
      selectionEffect: 'default',
      focusEffect: 'default',
      hoverEffect: 'default',
      connectionHoverEffect: 'default',
      useShellChrome: true,
    },
    getPins: () => CREATION_PINS[kind],
    canConnect,
    getTools: kind === 'script' ? () => getScriptTools() : kind === 'storyboard' ? () => getStoryboardTools() : kind === 'workbench' ? () => getWorkbenchTools() : undefined,
    createDefaultData: () => ({
      title: '',
      status: 'idle',
      content: kind === 'script' ? '' : undefined,
      shots: kind === 'storyboard' ? [] : undefined,
      entities: kind === 'storyboard' ? [] : undefined,
    }),
    renderNode: (props: NodeRendererProps) => (
      <CreationNodeView
        {...props}
        connectionController={controller}
        kind={kind}
      />
    ),
  };
}

/** 构建三个剧创节点扩展列表(供 nodesPlugin.registerAll 注册) */
export function createCreationExtensions(
  controller: ConnectionController | null,
  getStore?: () => ReactGraphStore | null,
): NodeTypeExtension[] {
  return (['script', 'storyboard', 'workbench'] as CreationNodeType[]).map((kind) =>
    createCreationExtension(kind, controller, CREATION_NAME_KEY[kind], getStore ?? (() => null)),
  );
}