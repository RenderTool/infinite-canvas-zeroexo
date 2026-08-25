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
import { showAgentCursor } from './agent-cursor.js';
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
  /** 应用画布配置补丁（R2-3 set_config，白名单已在后端校验；未注入返回 false） */
  applyCanvasConfig?: (patch: Record<string, unknown>) => boolean;
  /** R3-A2：打开资产库弹窗（附件卡点击跳转；未注入返回 false） */
  openAssetLibrary?: () => boolean;
  /** Agent 批量操作结束后单次 flush Yjs 图推送（editor-page 注入） */
  onBatchEnd?: () => void;
}

/** 单条 Agent 画布操作(后端 CanvasOp 的松散形态) */
export interface AgentCanvasOp {
  op: string;
  args: Record<string, unknown>;
}

// ===== 模块级状态(仿 setSessionProjectId) =====

let activeBridge: CanvasOpBridge | null = null;

/**
 * 只读防护标志（2026-08-25 系统性只读防护）：只读模式下置 true，
 * executeCanvasOp 直接拒绝执行——即使 UI 层入口被隐藏，已打开的 Agent 会话/历史消息
 * 携带的 canvas_op 也不会落到画布（纵深拦截，editor-page 同步 isReadOnlyViewer）。
 */
let _agentReadOnly = false;
export function setAgentReadOnly(v: boolean): void { _agentReadOnly = v; }
export function isAgentReadOnly(): boolean { return _agentReadOnly; }

/**
 * Agent 批量执行标志：executeCanvasOp 执行期间为 true，
 * use-editor-state 的 pushYjs 检测到此标志后跳过昂贵的资源扫描(syncProjectResourcesToCloud)
 * 和 Yjs 图推送(pushGraph)，完成后单次 flush 补发。
 * 避免 Agent 连续 N 个操作触发 N 次全量资源扫描 + 图序列化导致画布卡顿。
 */
let _agentBatching = false;
export function isAgentBatching(): boolean { return _agentBatching; }

export function setCanvasOpBridge(bridge: CanvasOpBridge | null): void {
  activeBridge = bridge;
}

export function getCanvasOpBridge(): CanvasOpBridge | null {
  return activeBridge;
}

// ===== 工具 =====

/**
 * R3-D1: Agent 操作后脉冲光标 + 聚焦高亮。
 * Plan#42 0.4：锚点改世界坐标——覆盖层每帧按实时视口换算，
 * 聚焦视口动画期间光标全程贴节点飞行（「AI 带路」操纵感）。
 * 尺寸三级兜底：node.size > 扩展 defaultSize > 200（修聚焦尺寸不准）。
 */
function resolveNodeSizeFor(bridge: CanvasOpBridge, node: { type?: string; size?: { width: number; height: number } }): { width: number; height: number } {
  const ext = typeof node.type === 'string' ? bridge.getExtensions().get(node.type) : undefined;
  return {
    width: node.size?.width ?? ext?.defaultSize?.width ?? 200,
    height: node.size?.height ?? ext?.defaultSize?.height ?? 200,
  };
}

function pulseAgentCursor(
  bridge: CanvasOpBridge,
  opts: { nodeId?: string; bounds?: { x: number; y: number; width: number; height: number }; label: string },
): void {
  const store = bridge.getStore();
  if (!store) return;
  let bounds = opts.bounds ?? null;
  let wx: number | null = null;
  let wy: number | null = null;
  if (opts.nodeId) {
    const node = store.getNode(opts.nodeId);
    if (node) {
      const size = resolveNodeSizeFor(bridge, node);
      bounds = { x: node.position.x, y: node.position.y, width: size.width, height: size.height };
      wx = node.position.x + size.width / 2;
      wy = node.position.y + size.height / 2;
    }
  } else if (bounds) {
    wx = bounds.x + bounds.width / 2;
    wy = bounds.y + bounds.height / 2;
  }
  if (wx == null || wy == null) return;
  showAgentCursor({ worldX: wx, worldY: wy, bounds, label: opts.label, ts: Date.now() });
}
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
async function executeWorkflowChain(bridge: CanvasOpBridge, chain: WorkflowChainDefinitionLike): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const store = bridge.getStore();
  const queue = bridge.getCommandQueue();
  if (!store || !queue) return null;

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
  const executor = new CanvasOpExecutor(queue, { getDefaultSize: (t) => extensions.get(t)?.defaultSize });
  await executor.executeOps(ops);
  store.focusOnBounds(positions.bounds, containerSize, 400, 51);
  return positions.bounds;
}

// ===== 统一执行入口（串行队列 + 批量抑制窗口） =====
//
// 卡顿根因修复（2026-08-25 Plan#42 Phase 0）：
// SSE 的 onCanvasOp 事件逐条到达，旧实现每条 `void executeCanvasOp()` 并发 fire-and-forget，
// 每条独立包裹 _agentBatching 标志并在 finally 里 flush——N 个操作并发时：
//   ① 先完成的 op 会把 _agentBatching 置回 false，后续 op 的 pushYjs 不再被抑制；
//   ② onBatchEnd 被调用 N 次 → N 次全图序列化 + WS 广播；
//   ③ N 个命令并发写 store → N 轮 React 重渲染风暴。
// 修复：串行队列执行 + 队列生命周期级批量抑制（首个入队开标志，最后一个出队单次 flush）。

let opQueueChain: Promise<void> = Promise.resolve();
/** 当前已入队未完成的数量（>0 即处于批量抑制窗口） */
let queuedOps = 0;

/**
 * 执行单条 Agent 画布操作。桥接层未注入时返回 false(调用方回退文本展示)。
 * 多条操作自动排队串行执行，整批完成后单次 flush Yjs。
 */
export function executeCanvasOp(op: AgentCanvasOp): Promise<boolean> {
  queuedOps += 1;
  _agentBatching = true;
  const run = opQueueChain
    .then(() => executeCanvasOpNow(op))
    .catch(() => false);
  opQueueChain = run.then(() => undefined);
  return run.finally(() => {
    queuedOps -= 1;
    if (queuedOps <= 0) {
      queuedOps = 0;
      _agentBatching = false;
      // 单次 flush 最终 graph 状态到 Yjs（资源由 fullSync 定时器补推）
      activeBridge?.onBatchEnd?.();
    }
  });
}

async function executeCanvasOpNow(op: AgentCanvasOp): Promise<boolean> {
  // 只读早退（2026-08-25 系统性只读防护）：Agent 画布操作全部为写操作，viewer 一律拒绝
  if (_agentReadOnly) return false;
  const bridge = activeBridge;
  if (!bridge) return false;
  const store = bridge.getStore();
  const queue = bridge.getCommandQueue();
  if (!store || !queue) return false;

  switch (op.op) {
      case 'workflow_chain': {
        const bounds = await executeWorkflowChain(bridge, op.args as unknown as WorkflowChainDefinitionLike);
        if (bounds) pulseAgentCursor(bridge, { bounds, label: '工作链已就位' });
        return true;
      }

      case 'set_selection': {
        const nodeIds = Array.isArray(op.args.nodeIds)
          ? (op.args.nodeIds as unknown[]).filter((x): x is string => typeof x === 'string')
          : [];
        store.setSelection({ selectedNodeIds: new Set(nodeIds), selectedEdgeIds: new Set() });
        if (nodeIds[0]) pulseAgentCursor(bridge, { nodeId: nodeIds[0], label: '已选中' });
        return true;
      }

      case 'focus': {
        const id = typeof op.args.id === 'string' ? op.args.id : '';
        if (!id) return true;
        const node = store.getNode(id);
        // R3-A2: 引用节点已被删除时不执行聚焦，返回 false 供调用方友好提示
        if (!node) return false;
        // Plan#42 0.4：尺寸三级兜底（node.size > 扩展 defaultSize > 200），修聚焦缩放不准
        const size = resolveNodeSizeFor(bridge, node);
        store.focusOnNode(
          id,
          bridge.getContainerSize(),
          size.width,
          size.height,
          400,
          51,
        );
        pulseAgentCursor(bridge, { nodeId: id, label: '已定位' });
        return true;
      }

      case 'open_assets': {
        // R3-A2: 附件卡点击 → 打开资产库弹窗（editor-page 注入实现）
        if (!bridge.openAssetLibrary) return false;
        return bridge.openAssetLibrary();
      }

      case 'set_config': {
        // R2-3: 画布配置修改（主题色等），白名单后端已校验；未注入时回退文本展示
        const patch = (op.args.patch ?? {}) as Record<string, unknown>;
        if (!bridge.applyCanvasConfig) return false;
        return bridge.applyCanvasConfig(patch);
      }

      case 'start_storyboard_generate': {
        // R2-3: 分镜节点已由前序 add_node 创建；此处选中+聚焦引导用户在节点上启动既有生成链路
        const sbNodeId = typeof op.args.storyboardNodeId === 'string' ? op.args.storyboardNodeId : '';
        if (sbNodeId) {
          const sbNode = store.getNode(sbNodeId);
          if (sbNode) {
            const sbSize = resolveNodeSizeFor(bridge, sbNode);
            store.setSelection({ selectedNodeIds: new Set([sbNodeId]), selectedEdgeIds: new Set() });
            store.focusOnNode(
              sbNodeId,
              bridge.getContainerSize(),
              sbSize.width,
              sbSize.height,
              400,
              51,
            );
            pulseAgentCursor(bridge, { nodeId: sbNodeId, label: '分镜就绪' });
          }
        }
        return true;
      }

      default: {
        // 尺寸缺省按类型走扩展 defaultSize(剧本 720×520),与 UI 创建节点一致
        const executor = new CanvasOpExecutor(queue, { getDefaultSize: (t) => bridge.getExtensions().get(t)?.defaultSize });
        await executor.executeOps([op as unknown as CanvasOp]);
        // R3-D1: 结构操作（add/update/remove）后脉冲光标指向目标节点
        const targetId = typeof op.args.id === 'string' ? op.args.id : '';
        if (targetId && store.getNode(targetId)) {
          const label =
            op.op === 'add_node' ? '已创建节点'
            : op.op === 'remove_node' ? '已删除'
            : op.op === 'update_node' ? '已更新'
            : `已执行 ${op.op}`;
          pulseAgentCursor(bridge, { nodeId: targetId, label });
        }
        return true;
      }
  }
}
