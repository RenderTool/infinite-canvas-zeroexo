/**
 * CanvasOpExecutor - 统一画布操作执行器
 *
 * 将 CommandQueue 的命令封装为统一的 CanvasOp 操作描述，
 * 提供 executeOps 批量执行入口，替代直接调用 commandQueue.execute(new SomeCommand(...))。
 *
 * 支持的 op 类型:
 *   add_node, update_node, remove_node,
 *   add_edge, remove_edge,
 *   duplicate_node, resize_node, move_node,
 *   batch
 */

import {
  AddNodeCommand,
  AddEdgeCommand,
  RemoveEdgeCommand,
  RemoveNodeCommand,
  DuplicateNodeCommand,
  UpdateNodeDataCommand,
  ResizeNodeCommand,
  MoveNodeCommand,
  BatchCommand,
} from '@zeroexo/core';
import { allowAllCanvasSchema } from '@zeroexo/core';
import { plainTextToScriptHtml } from '@/features/canvas-nodes/script-editor/script-lines.js';
import type {
  CanvasOperationContext,
  CanvasOperationMetrics,
  CanvasOperationObserver,
  CanvasSchema,
  Command,
  CommandQueue,
} from '@zeroexo/core';

// ===== 操作类型定义 =====

export interface AddNodeOp {
  op: 'add_node';
  args: {
    id: string;
    type: string;
    position: { x: number; y: number };
    size?: { width: number; height: number };
    title?: string;
    data?: Record<string, unknown>;
  };
}

export interface UpdateNodeOp {
  op: 'update_node';
  args: {
    id: string;
    patch: Record<string, unknown>;
  };
}

export interface RemoveNodeOp {
  op: 'remove_node';
  args: {
    id: string;
  };
}

export interface AddEdgeOp {
  op: 'add_edge';
  args: {
    id?: string;
    source: { nodeId: string; pinId?: string };
    target: { nodeId: string; pinId?: string };
  };
}

export interface RemoveEdgeOp {
  op: 'remove_edge';
  args: {
    id: string;
  };
}

export interface DuplicateNodeOp {
  op: 'duplicate_node';
  args: {
    id: string;
  };
}

export interface ResizeNodeOp {
  op: 'resize_node';
  args: {
    id: string;
    oldRect: { x: number; y: number; width: number; height: number };
    newRect: { x: number; y: number; width: number; height: number };
  };
}

export interface MoveNodeOp {
  op: 'move_node';
  args: {
    id: string;
    delta: { x: number; y: number };
  };
}

export interface BatchOp {
  op: 'batch';
  args: {
    ops: CanvasOp[];
    label?: string;
  };
}

export type CanvasOp =
  | AddNodeOp
  | UpdateNodeOp
  | RemoveNodeOp
  | AddEdgeOp
  | RemoveEdgeOp
  | DuplicateNodeOp
  | ResizeNodeOp
  | MoveNodeOp
  | BatchOp;

export interface CanvasOpExecutorOptions {
  schema?: CanvasSchema;
  observer?: CanvasOperationObserver;
  defaultContext?: Partial<CanvasOperationContext>;
  /** 按类型解析节点默认尺寸(注入节点扩展 defaultSize;缺省回退 200×80) */
  getDefaultSize?: (type: string) => { width: number; height: number } | undefined;
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ===== 执行器 =====

export class CanvasOpExecutor {
  private readonly commandQueue: CommandQueue;
  private readonly schema: CanvasSchema;
  private readonly observer?: CanvasOperationObserver;
  private readonly defaultContext: Partial<CanvasOperationContext>;
  private readonly getDefaultSize?: (type: string) => { width: number; height: number } | undefined;

  constructor(commandQueue: CommandQueue, options: CanvasOpExecutorOptions = {}) {
    this.commandQueue = commandQueue;
    this.schema = options.schema ?? allowAllCanvasSchema;
    this.observer = options.observer;
    this.defaultContext = options.defaultContext ?? {};
    this.getDefaultSize = options.getDefaultSize;
  }

  /**
   * 批量执行一组 CanvasOp 操作
   * 如果操作数 > 1，自动包装为 BatchCommand 以支持撤销/重做
   */
  async executeOps(
    ops: CanvasOp[],
    context: Partial<CanvasOperationContext> = {},
  ): Promise<CanvasOperationMetrics> {
    const operationContext: CanvasOperationContext = {
      operationId: context.operationId ?? createId('canvas-op'),
      traceId: context.traceId ?? this.defaultContext.traceId ?? createId('trace'),
      actor: context.actor ?? this.defaultContext.actor ?? 'user',
      source: context.source ?? this.defaultContext.source,
      projectId: context.projectId ?? this.defaultContext.projectId,
      dryRun: context.dryRun ?? this.defaultContext.dryRun,
      idempotencyKey: context.idempotencyKey ?? this.defaultContext.idempotencyKey,
      parentOperationId: context.parentOperationId ?? this.defaultContext.parentOperationId,
    };
    const startedAt = Date.now();
    const before = this.commandQueue.getState();
    const baseMetrics: CanvasOperationMetrics = {
      operationId: operationContext.operationId,
      traceId: operationContext.traceId,
      actor: operationContext.actor,
      opCount: ops.length,
      commandCount: 0,
      nodeCountBefore: before.nodes.length,
      edgeCountBefore: before.edges.length,
      durationMs: 0,
      status: 'planned',
    };

    if (ops.length === 0) {
      const metrics = { ...baseMetrics, durationMs: Date.now() - startedAt };
      this.observer?.onPlan?.(metrics);
      return metrics;
    }

    if (ops.length === 1) {
      const validation = this.validateOp(ops[0]!);
      if (!validation.valid) return this.reject(baseMetrics, validation.reason ?? 'Validation failed', startedAt);
      const cmd = this.toCommand(ops[0]!);
      if (!cmd) return this.reject(baseMetrics, 'Unsupported canvas operation', startedAt);
      baseMetrics.commandCount = 1;
      this.observer?.onPlan?.({ ...baseMetrics });
      if (!operationContext.dryRun) this.commandQueue.execute(cmd);
      return this.complete(baseMetrics, operationContext.dryRun ? 'planned' : 'executed', startedAt);
    }

    // 批量操作：收集所有命令
    const cmds: Command[] = [];
    for (const op of ops) {
      const validation = this.validateOp(op);
      if (!validation.valid) return this.reject(baseMetrics, validation.reason ?? 'Validation failed', startedAt);
      const cmd = this.toCommand(op);
      if (cmd) cmds.push(cmd);
    }
    baseMetrics.commandCount = cmds.length;
    this.observer?.onPlan?.({ ...baseMetrics });
    if (cmds.length === 0) return this.reject(baseMetrics, 'No supported canvas operations', startedAt);
    if (!operationContext.dryRun) this.commandQueue.execute(new BatchCommand(cmds, 'canvas-op-batch'));
    return this.complete(baseMetrics, operationContext.dryRun ? 'planned' : 'executed', startedAt);
  }

  private validateOp(op: CanvasOp): { valid: boolean; reason?: string } {
    if (op.op === 'add_node') {
      const result = this.schema.validateNode?.({
        id: op.args.id,
        type: op.args.type,
        position: op.args.position,
        size: op.args.size,
        title: op.args.title,
        data: op.args.data,
      });
      return result?.valid === false
        ? { valid: false, reason: result.errors?.join('; ') ?? 'Node validation failed' }
        : { valid: true };
    }
    if (op.op === 'add_edge') {
      const decision = this.schema.validateConnection({
        source: { nodeId: op.args.source.nodeId, pinId: op.args.source.pinId ?? 'output' },
        target: { nodeId: op.args.target.nodeId, pinId: op.args.target.pinId ?? 'input' },
      });
      return decision.allowed ? { valid: true } : { valid: false, reason: decision.reason ?? 'Connection rejected' };
    }
    return { valid: true };
  }

  private complete(
    base: CanvasOperationMetrics,
    status: CanvasOperationMetrics['status'],
    startedAt: number,
  ): CanvasOperationMetrics {
    const after = this.commandQueue.getState();
    const metrics = {
      ...base,
      status,
      nodeCountAfter: after.nodes.length,
      edgeCountAfter: after.edges.length,
      durationMs: Date.now() - startedAt,
    };
    this.observer?.onComplete?.(metrics);
    return metrics;
  }

  private reject(base: CanvasOperationMetrics, error: string, startedAt: number): CanvasOperationMetrics {
    const metrics = { ...base, status: 'rejected' as const, error, durationMs: Date.now() - startedAt };
    this.observer?.onComplete?.(metrics);
    return metrics;
  }

  /**
   * Agent 纯文本 episodes 兑底：直建 episodes 但 content 为纯文本（无 HTML 标签）时，
   * 统一转结构化剧本 HTML，否则剧本节点按裸文本渲染版式崩坏（与纯文本 content 路径同源）
   */
  private normalizeScriptEpisodes(nodeData: Record<string, unknown>): Record<string, unknown> {
    if (!Array.isArray(nodeData.episodes)) return nodeData;
    const episodes = (nodeData.episodes as Array<Record<string, unknown>>).map((ep) =>
      typeof ep?.content === 'string' && ep.content.trim() && !/<\/?[a-z][\s\S]*>/i.test(ep.content)
        ? { ...ep, content: plainTextToScriptHtml(ep.content) }
        : ep,
    );
    return { ...nodeData, episodes };
  }

  /**
   * 将单个 CanvasOp 转换为 Command 实例
   */
  private toCommand(op: CanvasOp): Command | null {
    switch (op.op) {
      case 'add_node': {
        const { id, type, position, size, title, data } = op.args;
        // id 兜底:Agent 契约允许不传 id(禁止硬编码 ID,create_script/restore 等内部
        // 工具下发时 id 可能为 undefined)——缺省时前端生成,否则 graph 出现 id=undefined
        // 节点,渲染层 key=node.id 失效触发 React unique key 警告
        const nodeId = typeof id === 'string' && id.trim() ? id : createId('node');
        // Agent 剧本节点兜底:后端契约只传 data.content(纯文本),前端剧本节点标准格式为
        // episodes[](结构化剧本 HTML 列表)——执行端转换为第1集,避免生成"不是剧本格式"的节点
        let nodeData: Record<string, unknown> = data ?? {};
        if (type === 'script' && !Array.isArray(nodeData.episodes) && typeof nodeData.content === 'string' && nodeData.content.trim()) {
          nodeData = {
            ...nodeData,
            episodes: [{ id: 'ep-1', number: 1, title: '第1集', content: plainTextToScriptHtml(nodeData.content) }],
            activeEpisodeId: 'ep-1',
            status: 'ready',
          };
        }
        // 纯文本 episodes 兑底：Agent 直建 episodes 但 content 是纯文本时同样转结构化 HTML
        if (type === 'script') nodeData = this.normalizeScriptEpisodes(nodeData);
        return new AddNodeCommand({
          id: nodeId,
          type,
          // Agent op 可能未携带 position(契约缺省)——补默认位置,否则渲染层读 node.position 崩溃
          position: position ?? { x: 0, y: 0 },
          // 尺寸缺省按类型走扩展 defaultSize(剧本 720×520 等),未知类型回退 200×80
          size: size ?? this.getDefaultSize?.(type) ?? { width: 200, height: 80 },
          title: title ?? '',
          data: nodeData,
        });
      }

      case 'update_node': {
        const { id, patch } = op.args;
        // 剧本节点兜底(与 add_node 同构):先建空节点再写 content 的 Agent 流程,同样转为 episodes[]
        const dataPatch = (patch.data ?? {}) as Record<string, unknown> | undefined;
        if (dataPatch && typeof dataPatch.content === 'string' && dataPatch.content.trim() && !Array.isArray(dataPatch.episodes)) {
          const current = this.commandQueue.getState().nodes.find((n) => n.id === id);
          const currentData = (current?.data ?? {}) as Record<string, unknown>;
          if (current?.type === 'script' && !Array.isArray(currentData.episodes)) {
            patch.data = {
              ...dataPatch,
              episodes: [{ id: 'ep-1', number: 1, title: '第1集', content: plainTextToScriptHtml(dataPatch.content) }],
              activeEpisodeId: 'ep-1',
              status: 'ready',
            };
          }
        }
        // 纯文本 episodes 兑底（与 add_node 同源）：patch 直携 episodes 且 content 为纯文本时统一转换
        const finalDataPatch = (patch.data ?? {}) as Record<string, unknown> | undefined;
        if (finalDataPatch && Array.isArray(finalDataPatch.episodes)) {
          patch.data = this.normalizeScriptEpisodes(finalDataPatch);
        }
        return new UpdateNodeDataCommand(id, patch);
      }

      case 'remove_node': {
        return new RemoveNodeCommand(op.args.id);
      }

      case 'add_edge': {
        const { id, source, target } = op.args;
        const edgeId = id ?? createId('edge');
        return new AddEdgeCommand({
          id: edgeId,
          source: { nodeId: source.nodeId, pinId: source.pinId ?? 'output' },
          target: { nodeId: target.nodeId, pinId: target.pinId ?? 'input' },
        });
      }

      case 'remove_edge': {
        return new RemoveEdgeCommand(op.args.id);
      }

      case 'duplicate_node': {
        return new DuplicateNodeCommand(op.args.id);
      }

      case 'resize_node': {
        const { id, oldRect, newRect } = op.args;
        return new ResizeNodeCommand(id, oldRect, newRect);
      }

      case 'move_node': {
        const { id, delta } = op.args;
        return new MoveNodeCommand(id, delta);
      }

      case 'batch': {
        const subCmds: Command[] = [];
        for (const subOp of op.args.ops) {
          const cmd = this.toCommand(subOp);
          if (cmd) subCmds.push(cmd);
        }
        if (subCmds.length === 0) return null;
        return new BatchCommand(subCmds, op.args.label ?? 'canvas-op-batch');
      }

      default:
        return null;
    }
  }
}
