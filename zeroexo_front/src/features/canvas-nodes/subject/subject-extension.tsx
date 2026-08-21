/**
 * subject-extension - 主体节点扩展（Plan#20 主体系统重设计 T8r + 堆叠同框架返工）
 *
 * 注册 'subject' 节点类型到画布系统。
 * 与 StackNode 同一套框架（用户拍板契约）：
 * - 16:9 等比缩放（lockAspectRatio + uniform，同堆叠 620×348）
 * - minSize 与 defaultSize 严格等比(220:123)，触底不破坏等比锁定
 * 胶囊菜单 getTools：详情按钮 → emit 'subject:openEditor' → 节点视图打开 SubjectEditorModal。
 * 在 app 层注册（与剧创节点同理）。
 */
import type { NodeTypeExtension, NodeRendererProps, NodeRuntimeContract, NodeCapabilities, ToolDefinition } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import { nodeActionBus, NODE_ICONS, SUBJECT_DEFAULT_SIZE, SUBJECT_MIN_SIZE } from '@zeroexo/plugin-nodes';
import { Merge } from 'lucide-react';
import i18next from 'i18next';
import { SubjectNodeView, createSubjectDefaultData } from './SubjectNodeView.js';

const SUBJECT_COLOR = '#a78bfa'; // 紫色系（与角色/场景/道具色板协调）

function createSubjectRuntime(): NodeRuntimeContract {
  return {
    definition: {
      schemaVersion: 1,
      size: {
        basis: { ...SUBJECT_DEFAULT_SIZE },
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

/** 主体节点胶囊菜单工具：详情（打开 SubjectEditorModal） */
function getSubjectTools(): ToolDefinition[] {
  return [
    {
      id: 'detail',
      label: '',
      title: i18next.t('subject.detail'),
      icon: <NODE_ICONS.subject size={14} />,
      group: 'basic',
      run: (node) => { nodeActionBus.emit('subject:openEditor', { nodeId: node.id }); },
    },
    {
      // Plan#20 T12a: 合并主体——全部镜头引用改写为目标卡，源卡删除（BatchCommand 可撤销）
      id: 'merge',
      label: '',
      title: i18next.t('subject.mergeSubject'),
      icon: <Merge size={14} />,
      group: 'basic',
      run: (node) => { nodeActionBus.emit('subject:mergeRequested', { nodeId: node.id }); },
    },
  ];
}

export function createSubjectExtension(
  controller: ConnectionController | null,
): NodeTypeExtension {
  return {
    type: 'subject',
    displayName: i18next.t('canvasNodes.stage.subject'),
    category: '创作',
    color: SUBJECT_COLOR,
    defaultSize: { ...SUBJECT_DEFAULT_SIZE },
    minSize: SUBJECT_MIN_SIZE,
    resizable: true,
    // 等比缩放锁:对齐堆叠(lockAspectRatio + uniform + GPU scale,16:9 恒等比)
    lockAspectRatio: true,
    capabilities: { stackable: false, capabilities: ['subject'] } as NodeCapabilities,
    runtime: createSubjectRuntime(),
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
    createDefaultData: () => createSubjectDefaultData(),
    getTools: () => getSubjectTools(),
    renderNode: (props: NodeRendererProps) => (
      <SubjectNodeView {...props} connectionController={controller} />
    ),
  };
}

/** 构建主体节点扩展列表（供 nodesPlugin.registerAll 注册） */
export function createSubjectExtensions(
  controller: ConnectionController | null,
): NodeTypeExtension[] {
  return [createSubjectExtension(controller)];
}
