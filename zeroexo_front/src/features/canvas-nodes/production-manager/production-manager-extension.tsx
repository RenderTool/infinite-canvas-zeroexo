/**
 * production-manager-extension - 统筹节点扩展（Plan#29 主体系统 V3）
 *
 * 注册 'production-manager' 节点类型：一部剧的资产管理器（演员/场景/道具聚合）。
 * 与主体卡同一套尺寸契约（16:9 uniform 620×348）。
 * 胶囊「编辑」→ emit 'productionManager:fullscreen' → 节点视图打开 ProductionManagerModal。
 * 图标契约：胶囊工具图标统一走 CANVAS_NODE_ICONS 模块 Map（见 ../icons.ts），禁止内联 lucide。
 */
import type { NodeTypeExtension, NodeRendererProps, NodeRuntimeContract, NodeCapabilities, ToolDefinition } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import i18next from 'i18next';
import { CANVAS_NODE_ICONS } from '../icons.js';
import { ProductionManagerView } from './ProductionManagerView.js';
import { createProductionManagerDefaultData } from './production-manager-types.js';

const PM_COLOR = '#64748b'; // 低饱和石板色（不与 script/storyboard/workbench/subject 节点色重复，避免高对比色块）
const PM_DEFAULT_SIZE = { width: 620, height: 348 };
const PM_MIN_SIZE = { width: 220, height: 123 };

function createRuntime(): NodeRuntimeContract {
  return {
    definition: {
      schemaVersion: 1,
      size: {
        basis: { ...PM_DEFAULT_SIZE },
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

function getTools(): ToolDefinition[] {
  return [
    {
      // 2026-08-22 胶囊统一契约: 与剧本/分镜/出片完全一致(id/label/title/icon)
      id: 'edit',
      label: '编辑',
      title: '全屏编辑',
      icon: <CANVAS_NODE_ICONS.fullscreen size={14} />,
      group: 'basic',
      run: (node) => { nodeActionBus.emit('productionManager:fullscreen', { nodeId: node.id }); },
    },
  ];
}

export function createProductionManagerExtension(
  controller: ConnectionController | null,
): NodeTypeExtension {
  void controller;
  return {
    type: 'production-manager',
    displayName: i18next.t('canvasNodes.stage.productionManager'),
    category: '创作',
    color: PM_COLOR,
    defaultSize: { ...PM_DEFAULT_SIZE },
    minSize: PM_MIN_SIZE,
    resizable: true,
    lockAspectRatio: true,
    // 2026-08-22 布局契约: 剧管=分镜后置, 创建时默认右侧 + 垂直整理避让
    placement: {
      direction: 'right',
      gap: 96,
      avoidOverlap: true,
    },
    capabilities: { stackable: false, capabilities: ['production-manager'] } as NodeCapabilities,
    runtime: createRuntime(),
    viewContract: {
      selectionEffect: 'default',
      focusEffect: 'default',
      hoverEffect: 'default',
      connectionHoverEffect: 'default',
      useShellChrome: true,
    },
    getPins: () => [
      { id: 'input', name: 'Input', direction: 'input' as const },
      { id: 'output', name: 'Output', direction: 'output' as const },
    ],
    createDefaultData: () => createProductionManagerDefaultData(),
    getTools: () => getTools(),
    renderNode: (props: NodeRendererProps) => <ProductionManagerView {...props} connectionController={controller} />,
  };
}

export function createProductionManagerExtensions(
  controller: ConnectionController | null,
): NodeTypeExtension[] {
  return [createProductionManagerExtension(controller)];
}
