/**
 * local-agent-bridge — 本地 Canvas Agent 连接桥（Plan#42 MCP S4）
 *
 * 连接本机 zeroexo_canvas_agent（HTTP/SSE 常驻进程）：
 * - SSE 接入 /events，收到 hello 后推送首帧画布快照
 * - 快照策略：工具执行后立即推 + 3s 采样指纹比对变更推（非盲轮询）
 * - 接收 tool_call → 映射到既有 executeCanvasOp 串行队列 → POST 回执行结果
 * - 只读模式拒绝一切工具调用（与 executeCanvasOp 纵深防护一致）
 *
 * 配置持久化在 localStorage（零后端依赖），页面刷新自动重连。
 */

import { getCanvasOpBridge, isAgentReadOnly, executeCanvasOp, type AgentCanvasOp } from './canvas-op-bridge.js';

const STORAGE_KEY = 'zeroexo.localAgent';
const POLL_INTERVAL_MS = 3000;
const CONTENT_PREVIEW_MAX = 240;

export type LocalAgentStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LocalAgentConfig {
  url: string;
  token: string;
  autoConnect: boolean;
}

interface ToolCallPayload {
  requestId: string;
  name: string;
  input: { ops?: Array<{ op: string; args: Record<string, unknown> }> };
}

// ===== 模块级连接状态 =====

let cfg: LocalAgentConfig | null = loadStoredConfig();
let eventSource: EventSource | null = null;
let clientId: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastFingerprint = '';
let status: LocalAgentStatus = 'disconnected';
let statusError = '';
const listeners = new Set<() => void>();

// useSyncExternalStore 快照必须引用稳定：仅在状态变更时重建
let cachedState: { status: LocalAgentStatus; error: string; config: LocalAgentConfig | null } = {
  status: 'disconnected',
  error: '',
  config: cfg,
};

function emit(): void {
  cachedState = { status, error: statusError, config: cfg };
  listeners.forEach((fn) => fn());
}

export function subscribeLocalAgent(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLocalAgentState(): { status: LocalAgentStatus; error: string; config: LocalAgentConfig | null } {
  return cachedState;
}

function loadStoredConfig(): LocalAgentConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalAgentConfig;
    if (typeof parsed.url === 'string' && typeof parsed.token === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

function storeConfig(): void {
  try {
    if (cfg) localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 隐私模式等场景静默 */
  }
}

// ===== 连接管理 =====

export function connectLocalAgent(url: string, token: string): void {
  disconnectLocalAgent(true);
  cfg = { url: normalizeUrl(url), token: token.trim(), autoConnect: true };
  storeConfig();
  openSse();
}

export function disconnectLocalAgent(silent = false): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  clientId = null;
  lastFingerprint = '';
  status = 'disconnected';
  statusError = '';
  if (cfg && !silent) {
    cfg = { ...cfg, autoConnect: false };
    storeConfig();
  }
  emit();
}

function normalizeUrl(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '');
}

function openSse(): void {
  if (!cfg) return;
  status = 'connecting';
  statusError = '';
  emit();
  const es = new EventSource(`${cfg.url}/events?token=${encodeURIComponent(cfg.token)}`);
  eventSource = es;

  es.addEventListener('hello', (ev) => {
    try {
      clientId = String((JSON.parse((ev as MessageEvent).data) as { clientId?: string }).clientId ?? '');
    } catch {
      clientId = null;
    }
    status = 'connected';
    statusError = '';
    emit();
    void pushSnapshot();
    if (!pollTimer) pollTimer = setInterval(() => void pushSnapshotIfChanged(), POLL_INTERVAL_MS);
  });
  es.addEventListener('tool_call', (ev) => {
    void handleToolCall(ev as MessageEvent);
  });
  es.onerror = () => {
    // EventSource 会自动重连；仅在彻底失败时提示
    if (es.readyState === EventSource.CLOSED) {
      status = 'error';
      statusError = '连接断开，请确认 Canvas Agent 进程仍在运行';
      emit();
    }
  };
}

/** 页面加载时自动重连（配置了 autoConnect） */
export function autoReconnectLocalAgent(): void {
  if (cfg?.autoConnect && cfg.url && cfg.token) openSse();
}

// ===== 快照构建与推送 =====

function buildSnapshot(): Record<string, unknown> | null {
  const bridge = getCanvasOpBridge();
  const store = bridge?.getStore();
  if (!bridge || !store) return null;
  const graph = store.getGraph();
  const viewport = store.getViewport();
  const selection = (store as unknown as { selection?: { selectedNodeIds?: Set<string> } }).selection;
  const nodes = (graph.nodes ?? []).map((n) => {
    const data = (n.data ?? {}) as Record<string, unknown>;
    const metadata: Record<string, unknown> = {};
    if (typeof data.content === 'string') {
      metadata.content = data.content.length > CONTENT_PREVIEW_MAX
        ? `${data.content.slice(0, CONTENT_PREVIEW_MAX / 2)}...（共 ${data.content.length} 字）`
        : data.content;
    }
    if (typeof data.status === 'string') metadata.status = data.status;
    if (Array.isArray(data.shots)) metadata.shotCount = data.shots.length;
    return {
      id: n.id,
      type: n.type,
      title: typeof data.title === 'string' ? data.title : undefined,
      position: n.position,
      size: n.size,
      metadata,
    };
  });
  const edges = ((graph as unknown as { edges?: Array<{ id: string; source: { nodeId: string }; target: { nodeId: string } }> }).edges ?? []).map((e) => ({
    id: e.id,
    sourceNodeId: e.source?.nodeId,
    targetNodeId: e.target?.nodeId,
  }));
  return {
    nodes,
    edges,
    selectedNodeIds: Array.from(selection?.selectedNodeIds ?? []),
    viewport: { x: viewport.x, y: viewport.y, k: viewport.k },
  };
}

async function pushSnapshot(): Promise<void> {
  if (!cfg || !clientId || status !== 'connected') return;
  const snapshot = buildSnapshot();
  if (!snapshot) return;
  lastFingerprint = JSON.stringify(snapshot.nodes) + JSON.stringify(snapshot.edges);
  try {
    await fetch(`${cfg.url}/canvas/state?clientId=${encodeURIComponent(clientId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeroexo-agent-token': cfg.token },
      body: JSON.stringify(snapshot),
    });
  } catch {
    /* 推送失败静默，下一采样周期补偿 */
  }
}

async function pushSnapshotIfChanged(): Promise<void> {
  if (status !== 'connected') return;
  const snapshot = buildSnapshot();
  if (!snapshot) return;
  const fp = JSON.stringify(snapshot.nodes) + JSON.stringify(snapshot.edges);
  if (fp === lastFingerprint) return;
  await pushSnapshot();
}

// ===== 工具调用执行 =====

async function handleToolCall(ev: MessageEvent): Promise<void> {
  if (!cfg) return;
  let payload: ToolCallPayload;
  try {
    payload = JSON.parse(ev.data) as ToolCallPayload;
  } catch {
    return;
  }
  const { requestId, input } = payload;
  const ops = Array.isArray(input?.ops) ? input.ops : [];

  try {
    if (isAgentReadOnly()) {
      throw new Error('当前为只读模式，画布操作被拒绝');
    }
    let executed = 0;
    let failed = 0;
    for (const op of ops) {
      if (!op || typeof op.op !== 'string') continue;
      const ok = await executeCanvasOp({ op: op.op, args: (op.args ?? {}) } as AgentCanvasOp);
      if (ok) executed += 1;
      else failed += 1;
    }
    // 执行完毕立即推最新快照，让 AI 立刻看到结果
    await pushSnapshot();
    await postResult(requestId, { result: { ok: true, executed, failed, message: `已执行 ${executed} 个画布操作${failed ? `，${failed} 个失败` : ''}` } });
  } catch (err) {
    await postResult(requestId, { error: (err as Error).message });
  }
}

async function postResult(requestId: string, body: { result?: unknown; error?: string }): Promise<void> {
  if (!cfg) return;
  try {
    await fetch(`${cfg.url}/canvas/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeroexo-agent-token': cfg.token },
      body: JSON.stringify({ requestId, ...body }),
    });
  } catch {
    /* 回传失败：Agent 侧 30s 超时兜底 */
  }
}
