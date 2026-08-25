/**
 * canvas-session — 画布会话核心
 *
 * 职责：
 * - 管理浏览器 SSE 客户端（/events），分配 clientId，心跳保活
 * - 缓存浏览器上行的画布快照（POST /canvas/state），读工具直接命中缓存
 * - 工具调用转发：生成 requestId → SSE 下发 tool_call → 等待浏览器 POST /canvas/result（30s 超时）
 * - 便捷工具归一化：canvas_create_node 等在转发前展开为 canvas_apply_ops
 */

import crypto from 'node:crypto';
import type { ServerResponse } from 'node:http';

import { toolInputSchemas, toolNames, type ToolName } from './schemas.js';
import type { CanvasNode, CanvasSnapshot } from './types.js';

type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };

const TOOL_TIMEOUT_MS = 30_000;
/** 节点 metadata 内容摘要上限（读工具返回前二次截断，防 token 爆炸） */
const METADATA_PREVIEW_MAX = 240;

export function isToolName(name: unknown): name is ToolName {
  return typeof name === 'string' && (toolNames as readonly string[]).includes(name);
}

export class CanvasSession {
  private clients = new Map<string, ServerResponse>();
  private pending = new Map<string, PendingRequest>();
  private canvasState: CanvasSnapshot | null = null;

  health(): { ok: boolean; hasCanvas: boolean; clients: number } {
    return { ok: true, hasCanvas: Boolean(this.canvasState), clients: this.clients.size };
  }

  /** SSE 接入：分配 clientId，15s 心跳；断开时若为快照来源则清空状态 */
  openEvents(url: URL, res: ServerResponse): void {
    const clientId = url.searchParams.get('clientId') || crypto.randomUUID();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    this.clients.set(clientId, res);
    sendEvent(res, 'hello', { ok: true, clientId });
    const timer = setInterval(() => sendEvent(res, 'ping', { time: Date.now() }), 15_000);
    res.on('close', () => {
      clearInterval(timer);
      this.clients.delete(clientId);
      if (this.canvasState?.clientId === clientId) this.canvasState = null;
    });
  }

  /** 浏览器上行画布快照（变更触发 + 节流，非周期轮询） */
  updateState(body: unknown, clientId?: string): void {
    const obj = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    this.canvasState = { ...obj, clientId } as CanvasSnapshot;
  }

  /** 浏览器回传工具执行结果 */
  resolveResult(body: { requestId?: string; error?: string; result?: unknown }): void {
    const item = body.requestId ? this.pending.get(body.requestId) : null;
    if (!item || !body.requestId) return;
    this.pending.delete(body.requestId);
    if (body.error) item.reject(new Error(body.error));
    else item.resolve(body.result);
  }

  emitAll(type: string, payload: unknown): void {
    this.clients.forEach((client) => sendEvent(client, type, payload));
  }

  /** 工具调用入口：读工具命中快照缓存；写工具归一化后转发浏览器执行 */
  async callTool(name: unknown, rawInput: unknown): Promise<unknown> {
    if (!isToolName(name)) throw new Error(`未知工具：${String(name)}`);
    let tool: ToolName = name;
    let input = toolInputSchemas[tool].parse(rawInput ?? {}) as Record<string, unknown>;

    // ---- 读工具：直接命中快照缓存，不打扰浏览器 ----
    if (tool === 'canvas_get_state' || tool === 'canvas_get_selection') {
      if (!this.clients.size || !this.canvasState) throw new Error('当前没有已连接画布（请在 ZeroExo 画布的 Agent 面板连接本地 Canvas Agent）');
      if (tool === 'canvas_get_state') return compactCanvasState(this.canvasState);
      const ids = new Set(this.canvasState.selectedNodeIds || []);
      return { nodes: (this.canvasState.nodes || []).filter((n) => ids.has(n.id)).map(compactNode) };
    }

    // ---- 写工具：归一化为 canvas_apply_ops ----
    if (tool === 'canvas_create_node') {
      const d = input as { type: string; title?: string; content?: string; x?: number; y?: number; size?: { width: number; height: number }; data?: Record<string, unknown> };
      const data = { ...(d.data ?? {}) };
      if (typeof d.content === 'string' && d.content) data.content = d.content;
      input = {
        ops: [{
          op: 'add_node',
          args: {
            type: d.type,
            title: d.title,
            position: typeof d.x === 'number' || typeof d.y === 'number'
              ? { x: d.x ?? nextCanvasX(this.canvasState), y: d.y ?? 0 }
              : undefined,
            size: d.size,
            data,
          },
        }],
      };
      tool = 'canvas_apply_ops';
    }
    if (tool === 'canvas_create_text_nodes') {
      const d = input as { items: Array<{ text: string; title?: string; x?: number; y?: number }>; x?: number; y?: number; gap?: number; direction?: 'row' | 'column' };
      const baseX = Number(d.x ?? nextCanvasX(this.canvasState));
      const baseY = Number(d.y ?? 0);
      const gap = Number(d.gap ?? 40);
      input = {
        ops: d.items.map((item, index) => ({
          op: 'add_node',
          args: {
            type: 'text',
            title: item.title,
            position: {
              x: item.x ?? (d.direction === 'row' ? baseX + index * (340 + gap) : baseX),
              y: item.y ?? (d.direction === 'row' ? baseY : baseY + index * (240 + gap)),
            },
            data: { content: item.text || '' },
          },
        })),
      };
      tool = 'canvas_apply_ops';
    }
    if (tool === 'canvas_update_node') {
      const d = input as { id: string; title?: string; patch?: Record<string, unknown> };
      const patch = { ...(d.patch ?? {}) };
      if (typeof d.title === 'string') patch.title = d.title;
      input = { ops: [{ op: 'update_node', args: { id: d.id, patch } }] };
      tool = 'canvas_apply_ops';
    }
    if (tool === 'canvas_delete_nodes') {
      input = { ops: (input as { ids: string[] }).ids.map((id) => ({ op: 'remove_node', args: { id } })) };
      tool = 'canvas_apply_ops';
    }
    if (tool === 'canvas_connect_nodes') {
      const d = input as { connections: Array<{ fromNodeId: string; toNodeId: string }> };
      input = {
        ops: d.connections.map((c) => ({
          op: 'add_edge',
          args: {
            source: { nodeId: c.fromNodeId, pinId: 'output' },
            target: { nodeId: c.toNodeId, pinId: 'input' },
          },
        })),
      };
      tool = 'canvas_apply_ops';
    }
    if (tool === 'canvas_select_nodes') {
      input = { ops: [{ op: 'set_selection', args: { nodeIds: (input as { ids: string[] }).ids } }] };
      tool = 'canvas_apply_ops';
    }
    if (tool === 'canvas_focus_node') {
      input = { ops: [{ op: 'focus', args: { id: (input as { id: string }).id } }] };
      tool = 'canvas_apply_ops';
    }

    if (tool !== 'canvas_apply_ops') throw new Error(`未知工具：${tool}`);
    if (!this.clients.size) throw new Error('当前没有已连接画布（请在 ZeroExo 画布的 Agent 面板连接本地 Canvas Agent）');
    return await this.forwardToCanvas(tool, input);
  }

  /** 转发到浏览器并等待执行结果（30s 超时） */
  private async forwardToCanvas(name: ToolName, input: Record<string, unknown>): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const client = this.clients.get(this.canvasState?.clientId || '') || this.clients.values().next().value;
    if (!client) throw new Error('当前没有已连接画布');
    sendEvent(client, 'tool_call', { requestId, name, input });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('画布操作超时（30s 无响应，请确认网页处于前台）'));
      }, TOOL_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
    });
  }
}

function sendEvent(res: ServerResponse, type: string, payload: unknown): void {
  res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** 快照压缩：节点 metadata 长文本截断，防 AI 上下文爆炸 */
export function compactCanvasState(state: CanvasSnapshot): CanvasSnapshot {
  return {
    ...state,
    nodes: (state.nodes || []).map(compactNode),
  };
}

export function compactNode(node: CanvasNode): CanvasNode {
  const metadata = { ...(node.metadata || {}) };
  if (typeof metadata.content === 'string' && metadata.content.length > METADATA_PREVIEW_MAX) {
    metadata.content = `${metadata.content.slice(0, METADATA_PREVIEW_MAX / 2)}...（共 ${metadata.content.length} 字）`;
  }
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    position: node.position,
    size: node.size,
    metadata,
  };
}

/** 新节点缺省落点：画布最右侧 + 间距 */
export function nextCanvasX(state: CanvasSnapshot | null): number {
  const nodes = state?.nodes || [];
  if (!nodes.length) return 0;
  return Math.max(...nodes.map((n) => n.position.x + (n.size?.width ?? 200))) + 80;
}
