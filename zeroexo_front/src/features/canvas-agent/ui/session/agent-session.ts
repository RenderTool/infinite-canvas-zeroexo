/**
 * session/agent-session.ts — Agent 真连层（T4）
 *
 * 连接后端统一 Agent API（POST /api/agents/execute + SSE stream），
 * 将后端 SSE 事件映射到 canvas-agent store，
 * 替代 simulation/simulator.ts 的纯前端 mock 流程。
 *
 * 事件映射（对齐 AgentClient 的 8 种基础事件）：
 *   agent:thinking  → think-stream 思考态文本
 *   agent:tool_call → think-stream 工具步骤胶囊
 *   agent:result    → 由 agent:done 统一输出（result 仅暂存）
 *   agent:canvas_op → 消息流文本（画布操作描述）
 *   agent:progress  → 消息流进度消息（ProgressBlock）
 *   agent:error     → 消息流错误文本
 *   agent:done      → 消息流最终结果
 *
 * 会话约定：首次发送前自动创建 AgentConversation（带 projectId），
 * 之后所有任务携带 conversationId，刷新后可从后端恢复历史。
 */

import { agentClient, type AgentClientCallbacks } from '@/features/agent-panel/AgentClient.js';
import { getToken } from '@/services/api-client.js';
import { useCanvasAgentStore } from '../store.js';
import type { ProgressData, ProgressStep } from '../types.js';

// ===== 会话级状态 =====

/** 当前项目 ID（由 AgentDock 挂载时注入） */
let currentProjectId: string | null = null;

export function setSessionProjectId(projectId: string | null): void {
  currentProjectId = projectId;
}

export function getSessionProjectId(): string | null {
  return currentProjectId;
}

/** 当前任务进度消息 ID（用于增量更新 ProgressBlock） */
let progressMsgId: string | null = null;

/** 当前任务进度步骤缓存（key → step） */
let progressSteps = new Map<string, ProgressStep>();

// ===== DTO =====

/** 会话摘要（GET /api/agents/conversations items） */
export interface ConversationSummary {
  id: string;
  title: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
  messages?: { content: string; role: string; createdAt: string }[];
}

/** 会话消息（GET /api/agents/conversations/:id/messages items） */
export interface ConversationMessageDto {
  id: string;
  role: string;
  content: string;
  taskId: string | null;
  toolName: string | null;
  toolArguments: string | null;
  createdAt: string;
}

/** 任务 DTO（GET /api/agents/tasks items） */
export interface AgentTaskDto {
  id: string;
  taskType: string;
  input: unknown;
  output: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error: string | null;
  conversationId: string | null;
  projectId: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ===== API 封装 =====

/** 通用带 JWT 的 JSON 请求 */
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`[${res.status}] ${errText.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ===== 会话管理 =====

/** 确保有活动会话：无则创建并写入 store */
export async function ensureConversation(projectId?: string): Promise<string> {
  const store = useCanvasAgentStore.getState();
  if (store.activeConversationId) return store.activeConversationId;

  const conv = await createConversation(projectId);
  store.setActiveConversationId(conv.id);
  return conv.id;
}

/** 显式创建新会话并切换（多会话 UI） */
export async function createConversation(projectId?: string): Promise<ConversationSummary> {
  const conv = await api<ConversationSummary>('/api/agents/conversations', {
    method: 'POST',
    body: JSON.stringify({
      title: '画布 Agent 对话',
      projectId: projectId ?? currentProjectId ?? undefined,
    }),
  });
  return conv;
}

/** 删除会话（级联消息） */
export async function deleteConversation(conversationId: string): Promise<void> {
  await api(`/api/agents/conversations/${conversationId}`, { method: 'DELETE' });
}

/** 加载任务列表（按最近创建排序） */
export async function loadTasks(opts: { projectId?: string; limit?: number } = {}): Promise<AgentTaskDto[]> {
  const params = new URLSearchParams();
  params.set('limit', String(opts.limit ?? 20));
  if (opts.projectId ?? currentProjectId) {
    params.set('projectId', opts.projectId ?? currentProjectId!);
  }
  const res = await api<{ items: AgentTaskDto[] }>(`/api/agents/tasks?${params.toString()}`);
  return res.items ?? [];
}

/** 加载会话列表（按最近活动排序） */
export async function loadConversations(limit = 50): Promise<ConversationSummary[]> {
  const res = await api<{ items: ConversationSummary[] }>(
    `/api/agents/conversations?limit=${limit}`,
  );
  return res.items ?? [];
}

/** 加载会话历史消息（正序） */
export async function loadConversationMessages(conversationId: string): Promise<ConversationMessageDto[]> {
  const res = await api<{ items: ConversationMessageDto[] }>(
    `/api/agents/conversations/${conversationId}/messages?limit=200`,
  );
  return res.items ?? [];
}

// ===== 进度消息 =====

/** 增量更新/创建 ProgressBlock 消息 */
function upsertProgress(pct: number, label?: string): void {
  const store = useCanvasAgentStore.getState();
  const key = label ?? `步骤 ${progressSteps.size + 1}`;

  const existing = progressSteps.get(key);
  progressSteps.set(key, {
    key,
    label: key,
    status: 'running',
    progress: pct,
    ...(existing ? { duration: existing.duration } : {}),
  });

  const data: ProgressData = {
    steps: [...progressSteps.values()],
    totalProgress: pct,
    totalCost: 0,
    currentStep: label ?? null,
  };

  if (progressMsgId) {
    store.updateMessage(progressMsgId, { progress: data });
  } else {
    progressMsgId = `msg_progress_${Date.now()}`;
    store.addMessage({
      id: progressMsgId,
      role: 'agent',
      type: 'progress',
      text: '任务执行中…',
      progress: data,
      timestamp: Date.now(),
    });
  }
}

/** 进度消息收尾：标记全部完成 */
function finishProgress(): void {
  if (!progressMsgId) return;
  const store = useCanvasAgentStore.getState();
  const msg = store.messages.find((m) => m.id === progressMsgId);
  if (!msg?.progress) return;
  store.updateMessage(progressMsgId, {
    progress: {
      ...msg.progress,
      totalProgress: 100,
      currentStep: null,
      steps: msg.progress.steps.map((s) => ({ ...s, status: 'completed', progress: 100 })),
    },
  });
  progressMsgId = null;
  progressSteps.clear();
}

// ===== 核心：发送消息 =====

/**
 * 发送用户消息到后端 Agent 并订阅 SSE 事件流。
 * 用户消息由调用方（ComposerInput）先写入 store，本函数只负责后端链路。
 */
export async function sendMessage(
  text: string,
  opts?: { taskType?: string; projectId?: string },
): Promise<void> {
  const cleanText = text.trim();
  const store = useCanvasAgentStore.getState();
  if (!cleanText || store.isGenerating) return;

  store.setIsGenerating(true);
  store.setThinking({ active: true, text: '正在连接 Agent…' });
  progressMsgId = null;
  progressSteps.clear();

  try {
    // 1. 确保会话（首次自动创建，后续复用）
    const conversationId = await ensureConversation(opts?.projectId);

    // 2. 提交任务（输入结构 { prompt }，与 canvas_agent 技能对齐）
    const { taskId } = await agentClient.send(opts?.taskType ?? 'canvas_agent', { prompt: cleanText }, {
      conversationId,
      projectId: opts?.projectId ?? currentProjectId ?? undefined,
    });

    // 3. 订阅 SSE 事件流 → store
    const callbacks: AgentClientCallbacks = {
      onThinking: (message) => {
        const s = useCanvasAgentStore.getState();
        s.setThinking({ active: true });
        if (message) {
          s.appendThinkingText(s.thinking.text ? `\n${message}` : message);
        }
      },
      onToolCall: (toolName, args) => {
        const s = useCanvasAgentStore.getState();
        const idx = s.thinking.steps.length;
        if (idx > 0) s.updateThinkingStep(idx - 1, { status: 'done' });
        s.addThinkingStep({
          icon: 'tool',
          name: toolName,
          status: 'running',
          input: JSON.stringify(args).slice(0, 200),
        });
      },
      onResult: () => {
        // 最终输出由 agent:done 统一写入，避免重复消息
      },
      onCanvasOp: (op, args) => {
        useCanvasAgentStore.getState().addMessage({
          id: `msg_canvas_${Date.now()}`,
          role: 'agent',
          type: 'text',
          text: `画布操作：${op}${args && JSON.stringify(args) !== '{}' ? ` ${JSON.stringify(args).slice(0, 120)}` : ''}`,
          timestamp: Date.now(),
        });
      },
      onProgress: (pct, msg) => upsertProgress(pct, msg),
      onError: (error) => {
        const s = useCanvasAgentStore.getState();
        s.addMessage({
          id: `msg_error_${Date.now()}`,
          role: 'agent',
          type: 'text',
          text: `⚠️ ${error}`,
          timestamp: Date.now(),
        });
        s.setIsGenerating(false);
        s.setThinking({ active: false });
      },
      onDone: (output) => {
        const s = useCanvasAgentStore.getState();
        const outputText = typeof output === 'string'
          ? output
          : output && typeof output === 'object'
            ? JSON.stringify(output, null, 2)
            : '';
        if (outputText) {
          s.addMessage({
            id: `msg_result_${Date.now()}`,
            role: 'agent',
            type: 'text',
            text: outputText,
            timestamp: Date.now(),
          });
        }
        finishProgress();
        s.setIsGenerating(false);
        s.setThinking({ active: false });
      },
      onClose: () => {
        const s = useCanvasAgentStore.getState();
        finishProgress();
        s.setIsGenerating(false);
      },
    };

    agentClient.subscribe(taskId, callbacks);
  } catch (err) {
    const s = useCanvasAgentStore.getState();
    s.addMessage({
      id: `msg_error_${Date.now()}`,
      role: 'agent',
      type: 'text',
      text: `⚠️ ${err instanceof Error ? err.message : '未知错误'}`,
      timestamp: Date.now(),
    });
    s.setIsGenerating(false);
    s.setThinking({ active: false });
  }
}

/** 停止当前生成（断开 SSE） */
export function stopGenerating(): void {
  agentClient.unsubscribe();
  const s = useCanvasAgentStore.getState();
  finishProgress();
  s.setIsGenerating(false);
  s.setThinking({ active: false });
}
