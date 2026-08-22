/**
 * canvas-op-bridge - Agent 画布操作桥接层(Plan#33 D4)
 *
 * 将后端 Agent 产出的 canvasOps(workflow_chain / set_selection / focus / 命令类)
 * 桥接到编辑器命令队列与 store 真执行。
 *
 * 注入方式与 setSessionProjectId 一致:由 editor-page 在挂载 AgentDock 处调用
 * setCanvasOpBridge 注入访问器(经 ref 读取最新状态),agent-session 的
 * onCanvasOp 回调经 getCanvasOpBridge 取桥接层执行,未注入时回退文本展示。
 *
 * 职责:
 *   - workflow_chain: 展开两段式工作链(素材源副本列 → 产物空节点)
 *     产物节点为「空 media 节点」,由 NodeGenerateDock 三态语义承担生成器态
 *     (2026-08-22 tA5:生成器节点废弃,移除中间生成器段)
 *     落点由 resolveWorkflowChainPosition 计算(视口中心基准 + 避让 + 聚焦)
 *   - set_selection: 经 store.setSelection 选中节点
 *   - focus: 经 store.focusOnNode 聚焦节点
 *   - 其余(add_node/add_edge/update_node/...) 走 CanvasOpExecutor.executeOps
 */

import type { CommandQueue, NodeRecord, NodeTypeExtension } from '@zeroexo/core';
import { CanvasOpExecutor, type CanvasOp } from '@/pages/editor/editor-canvas/interactions/canvas-op-executor.js';
import {
  resolveWorkflowChainPosition,
  type Size2D,
  type Viewport,
} from '@/pages/editor/editor-canvas/interactions/workflow-chain-position.js';

// ===== 类型定义 =====

/** 工作链素材源(前端版,对齐后端 WorkflowChainSource) */
export interface WorkflowChainSourceLike {
  id: string;
  type: string;
  title?: string;
}

/** 工作链定义(前端版,对齐后端 WorkflowChainDefinition) */
export interface WorkflowChainDefinitionLike {
  sources: WorkflowChainSourceLike[];
  targetType: string;
  prompt: string;
  generatorTitle?: string;
  generatorParams?: Record<string, unknown>;
  productTitle?: string;
  productId?: string;
}

/** 桥接层所需的最小 store 面(避免强依赖 DefaultEditor 类型) */
export interface CanvasOpStore {
  getGraph(): { nodes: NodeRecord[] };
  getNode(id: string): NodeRecord | undefined;
  getViewport(): Viewport;
  focusOnBounds(
    bounds: { x: number; y: number; width: number; height: number },
    containerSize: Size2D,
    durationMs?: number,
    capsuleHeight?: number,
    paddingRatio?: number,
  ): void;
  focusOnNode(
    nodeId: string,
    containerSize: Size2D,
    nodeWidth?: number,
    nodeHeight?: number,
    durationMs?: number,
    capsuleHeight?: number,
  ): void;
  setSelection(selection: { selectedNodeIds: Set<string>; selectedEdgeIds: Set<string> }): void;
}

/** 桥接上下文(editor-page 注入,访问器惰性读取最新状态) */
export interface CanvasOpBridge {
  getCommandQueue(): CommandQueue | null;
  getStore(): CanvasOpStore | null;
  getContainerSize(): Size2D;
  getExtensions(): Map<string, NodeTypeExtension>;
}

/** 单条 Agent 画布操作(后端 CanvasOp 的松散形态) */
export interface AgentCanvasOp {
  op: string;
  args: Record<string, unknown>;
}

// ===== 模块级状态(仿 setSessionProjectId) =====

let activeBridge: CanvasOpBridge | null = null;

export function setCanvasOpBridge(bridge: CanvasOpBridge | null): void {
  activeBridge = bridge;
}

export function getCanvasOpBridge(): CanvasOpBridge | null {
  return activeBridge;
}

// ===== 工具 =====

/** 生成不与现有节点冲突的 id(冲突时追加 -2/-3...) */
function uniqueId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// ===== 工作执行链展开 =====

/**
 * 展开 workflow_chain: 素材源副本列 → 产物(空 media 节点),整链 batch 执行后聚焦。
 *
 * 两段式数据契约(2026-08-22 tA5 重构:生成器节点废弃):
 *   - 副本: 深拷贝源节点 data(参考素材内容随副本保留)
 *   - 产物: type=targetType, data 含 prompt/generationMode 等生成字段(空 content/storageKey),
 *     由 NodeGenerateDock 三态语义承担生成器态——选中即显示吸附生成面板,连入副本作为参考素材
 * 落点: resolveWorkflowChainPosition(视口中心基准 + 避让),整体包围盒 focusOnBounds。
 */
async function executeWorkflowChain(bridge: CanvasOpBridge, chain: WorkflowChainDefinitionLike): Promise<void> {
  const store = bridge.getStore();
  const queue = bridge.getCommandQueue();
  if (!store || !queue) return;

  const graph = store.getGraph();
  const extensions = bridge.getExtensions();
  const containerSize = bridge.getContainerSize();
  const viewport = store.getViewport();
  const existingIds = new Set<string>(graph.nodes.map((n) => n.id));

  // 1. 素材源副本:读取源节点实际数据/尺寸,副本 id 唯一化
  const copies = chain.sources.map((src) => {
    const node = graph.nodes.find((n) => n.id === src.id) ?? store.getNode(src.id);
    const copyId = uniqueId(`wf-copy-${src.id}`, existingIds);
    existingIds.add(copyId);
    return {
      sourceId: src.id,
      id: copyId,
      type: node?.type ?? src.type,
      title: node?.title ?? src.title,
      size: node?.size,
      data: { ...((node?.data ?? {}) as Record<string, unknown>) },
    };
  });

  // 2. 产物节点 id(唯一化)与尺寸(扩展表 defaultSize)
  const productType = chain.targetType;
  const productId = chain.productId && !existingIds.has(chain.productId)
    ? chain.productId
    : uniqueId(`wf-product-${productType}`, existingIds);
  existingIds.add(productId);

  const productSize = extensions.get(productType)?.defaultSize ?? { width: 200, height: 100 };

  // 3. 落点计算(两段式 + 整链避让)
  const positions = resolveWorkflowChainPosition({
    viewport,
    containerSize,
    sources: copies.map((c) => ({ id: c.id, type: c.type, title: c.title, size: c.size })),
    productSize,
    existingNodes: graph.nodes,
  });

  // 4. 构造两段式 canvasOps(副本列 → 产物空节点,含连线)
  const ops: CanvasOp[] = [];
  copies.forEach((c, index) => {
    const pos = positions.copies[index]!;
    ops.push({
      op: 'add_node',
      args: {
        id: c.id,
        type: c.type,
        position: pos.position,
        size: c.size,
        title: c.title ?? '',
        data: c.data,
      },
    });
    ops.push({
      op: 'add_edge',
      args: {
        source: { nodeId: c.id, pinId: 'output' },
        target: { nodeId: productId, pinId: 'input' },
      },
    });
  });
  ops.push({
    op: 'add_node',
    args: {
      id: productId,
      type: productType,
      position: positions.product.position,
      size: productSize,
      title: chain.productTitle ?? `${productType} 产物`,
      data: {
        // 空 media 节点 = 生成器态(NodeGenerateDock 读取以下字段预填/展示)
        prompt: chain.prompt ?? '',
        status: 'idle',
        generationMode: productType,
        referenceImages: [],
        channelId: '',
        model: '',
        params: chain.generatorParams ?? {},
        title: chain.productTitle ?? `${productType} 产物`,
      },
    },
  });

  // 5. 执行 + 聚焦(胶囊高度 51,与画布其余聚焦调用一致)
  const executor = new CanvasOpExecutor(queue);
  await executor.executeOps(ops);
  store.focusOnBounds(positions.bounds, containerSize, 400, 51);
}

// ===== 统一执行入口 =====

/**
 * 执行单条 Agent 画布操作。桥接层未注入时返回 false(调用方回退文本展示)。
 */
export async function executeCanvasOp(op: AgentCanvasOp): Promise<boolean> {
  const bridge = activeBridge;
  if (!bridge) return false;
  const store = bridge.getStore();
  const queue = bridge.getCommandQueue();
  if (!store || !queue) return false;

  switch (op.op) {
    case 'workflow_chain':
      await executeWorkflowChain(bridge, op.args as unknown as WorkflowChainDefinitionLike);
      return true;

    case 'set_selection': {
      const nodeIds = Array.isArray(op.args.nodeIds)
        ? (op.args.nodeIds as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      store.setSelection({ selectedNodeIds: new Set(nodeIds), selectedEdgeIds: new Set() });
      return true;
    }

    case 'focus': {
      const id = typeof op.args.id === 'string' ? op.args.id : '';
      if (!id) return true;
      const node = store.getNode(id);
      store.focusOnNode(
        id,
        bridge.getContainerSize(),
        node?.size?.width ?? 200,
        node?.size?.height ?? 200,
        400,
        51,
      );
      return true;
    }

    default: {
      const executor = new CanvasOpExecutor(queue);
      await executor.executeOps([op as unknown as CanvasOp]);
      return true;
    }
  }
}
