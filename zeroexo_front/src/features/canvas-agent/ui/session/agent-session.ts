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
import { executeCanvasOp } from '../canvas-op-bridge.js';
import type { ProgressData, ProgressStep, TodoSnapshot } from '../types.js';

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

/** 流式输出消息 ID（agent:message_delta 增量追加的目标，P0-1） */
let streamMsgId: string | null = null;

/** 执行时间线消息 ID（P0-4 工具调用时间线 upsert 目标） */
let timelineMsgId: string | null = null;

/**
 * 时间线步骤 upsert（P0-4）：
 * - 新事件（settle 为空）：前序 running 置 done，追加新 running 条目
 * - 收尾（settle=done/failed）：全部 running 条目置为该状态
 */
function upsertTimelineStep(name: string, kind: 'tool' | 'canvas', settle?: 'done' | 'failed'): void {
  const s = useCanvasAgentStore.getState();
  const now = Date.now();

  if (timelineMsgId) {
    const msg = s.messages.find((m) => m.id === timelineMsgId);
    if (msg?.timeline) {
      let steps = msg.timeline.steps.map((st) =>
        st.status === 'running' && !settle ? { ...st, status: 'done' as const } : st,
      );
      if (settle) {
        steps = steps.map((st) =>
          st.status === 'running' ? { ...st, status: settle } : st,
        );
      } else {
        steps.push({ id: `ts_${now}_${steps.length}`, name, kind, status: 'running' });
      }
      s.updateMessage(timelineMsgId, { timeline: { steps } });
      return;
    }
    timelineMsgId = null;
  }
  if (settle) return;
  timelineMsgId = `msg_timeline_${now}`;
  s.addMessage({
    id: timelineMsgId,
    role: 'agent',
    type: 'timeline',
    text: '执行时间线',
    timeline: { steps: [{ id: `ts_${now}_0`, name, kind, status: 'running' }] },
    timestamp: now,
  });
}

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

/** 解析 todo_write 工具参数为快照（容错：字符串/对象、非法项过滤） */
function parseTodoSnapshot(args: unknown): TodoSnapshot | null {
  let raw = args;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const rawItems = (raw as { items?: unknown }).items;
  if (!Array.isArray(rawItems)) return null;

  const validStatus = new Set(['queued', 'running', 'completed', 'failed']);
  const items = rawItems
    .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
    .filter((it) => typeof (it as { id?: unknown }).id === 'string')
    .map((it) => ({
      id: (it as { id: string }).id,
      label: String((it as { label?: unknown }).label ?? (it as { id: string }).id),
      status: validStatus.has(String((it as { status?: unknown }).status))
        ? (String((it as { status?: unknown }).status) as TodoSnapshot['items'][0]['status'])
        : 'queued',
    }));

  return {
    title: typeof (raw as { title?: unknown }).title === 'string'
      ? (raw as { title: string }).title
      : undefined,
    items,
  };
}

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
  streamMsgId = null;
  timelineMsgId = null;

  try {
    // 1. 确保会话（首次自动创建，后续复用）
    const conversationId = await ensureConversation(opts?.projectId);

    // 2. 提交任务（输入结构 { prompt }，与 canvas_agent 技能对齐）
    const { taskId } = await agentClient.send(opts?.taskType ?? 'canvas_agent', { prompt: cleanText }, {
      conversationId,
      projectId: opts?.projectId ?? currentProjectId ?? undefined,
    });
    // 记录当前任务 ID：协议事件(step/question)回执需要
    store.setCurrentTaskId(taskId);

    // 3. 订阅 SSE 事件流 → store
    const callbacks: AgentClientCallbacks = {
      onThinking: (message) => {
        const s = useCanvasAgentStore.getState();
        s.setThinking({ active: true });
        if (message) {
          s.appendThinkingText(s.thinking.text ? `\n${message}` : message);
        }
      },
      // P0-1: 思考流式增量(直接追加,不换行)
      onThinkingDelta: (delta) => {
        useCanvasAgentStore.getState().appendThinkingText(delta);
      },
      // P0-1: 文本流式增量(创建/追加到生成中的最终消息)
      onMessageDelta: (delta) => {
        const s = useCanvasAgentStore.getState();
        if (streamMsgId) {
          const existing = s.messages.find((m) => m.id === streamMsgId);
          if (existing) {
            s.updateMessage(streamMsgId, { text: (existing.text ?? '') + delta });
            return;
          }
          streamMsgId = null;
        }
        streamMsgId = `msg_stream_${Date.now()}`;
        s.addMessage({
          id: streamMsgId,
          role: 'agent',
          type: 'text',
          text: delta,
          timestamp: Date.now(),
        });
      },
      onToolCall: (toolName, args) => {
        // P0-3: todo_write 快照剥离为任务卡（PinnedTodoSlot 消费，不显示为工具胶囊）
        if (toolName === 'todo_write') {
          const snap = parseTodoSnapshot(args);
          if (snap) useCanvasAgentStore.getState().setTodoSnapshot(snap);
          return;
        }
        // P0-4: 工具调用追加进消息流时间线
        upsertTimelineStep(toolName, 'tool');
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
        // P0-4: 画布操作追加进消息流时间线
        upsertTimelineStep(`画布操作：${op}`, 'canvas');
        // Plan#33 D4:优先桥接真执行(workflow_chain 展开/选中/聚焦/命令),
        // 桥接层未注入(非画布页)时回退文本展示
        void executeCanvasOp({ op, args: (args ?? {}) as Record<string, unknown> }).then((executed) => {
          if (!executed) {
            useCanvasAgentStore.getState().addMessage({
              id: `msg_canvas_${Date.now()}`,
              role: 'agent',
              type: 'text',
              text: `画布操作：${op}${args && JSON.stringify(args) !== '{}' ? ` ${JSON.stringify(args).slice(0, 120)}` : ''}`,
              timestamp: Date.now(),
            });
          }
        });
      },
      onProgress: (pct, msg) => upsertProgress(pct, msg),
      // ---- 契约交互事件(Plan#33 D1/D2) ----
      onStepRequest: (step) => {
        const s = useCanvasAgentStore.getState();
        // 协议交互期间暂停思考展示,聚焦步骤确认
        s.setThinking({ active: false });
        s.addMessage({
          id: `msg_step_${Date.now()}`,
          role: 'agent',
          type: 'step',
          text: step.title,
          step,
          timestamp: Date.now(),
        });
      },
      onQuestionRequest: (question) => {
        const s = useCanvasAgentStore.getState();
        s.setThinking({ active: false });
        s.addMessage({
          id: `msg_question_${Date.now()}`,
          role: 'agent',
          type: 'question',
          text: question.guideText,
          question: {
            guideText: question.guideText,
            multi: question.multi,
            items: (question.items ?? []).map((it) => ({
              value: it.value,
              label: it.label,
              desc: it.desc,
              ai: it.ai,
              checked: it.checked,
            })),
          },
          timestamp: Date.now(),
        });
      },
      onMd: (md) => {
        useCanvasAgentStore.getState().addMessage({
          id: `msg_md_${Date.now()}`,
          role: 'agent',
          type: 'md',
          text: md,
          timestamp: Date.now(),
        });
      },
      onError: (error) => {
        const s = useCanvasAgentStore.getState();
        streamMsgId = null;
        upsertTimelineStep('', 'tool', 'failed');
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
        s.setCurrentTaskId(null);
        const outputText = typeof output === 'string'
          ? output
          : output && typeof output === 'object'
            ? JSON.stringify(output, null, 2)
            : '';
        // 流式输出已逐块渲染时不再重复整块追加(P0-1); 回退渠道(无增量)时才整块写入
        if (outputText && !streamMsgId) {
          s.addMessage({
            id: `msg_result_${Date.now()}`,
            role: 'agent',
            type: 'text',
            text: outputText,
            timestamp: Date.now(),
          });
        }
        streamMsgId = null;
        upsertTimelineStep('', 'tool', 'done');
        finishProgress();
        s.setIsGenerating(false);
        s.setThinking({ active: false });
      },
      onClose: () => {
        const s = useCanvasAgentStore.getState();
        streamMsgId = null;
        upsertTimelineStep('', 'tool', 'done');
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
  s.setCurrentTaskId(null);
  s.setIsGenerating(false);
  s.setThinking({ active: false });
}

/**
 * 协议事件回执(Plan#33 D1/D2): 将用户对 step/question 的回答提交到后端,
 * 恢复挂起的 Agent 执行循环。taskId 取自 store 当前任务。
 * 任务已结束或 taskId 缺失时静默失败(不中断 UI)。
 */
export async function sendAnswer(answer: string): Promise<boolean> {
  const taskId = useCanvasAgentStore.getState().currentTaskId;
  if (!taskId) return false;
  try {
    return await agentClient.answer(taskId, answer);
  } catch (err) {
    const s = useCanvasAgentStore.getState();
    s.addMessage({
      id: `msg_error_${Date.now()}`,
      role: 'agent',
      type: 'text',
      text: `⚠️ 回执提交失败：${err instanceof Error ? err.message : '未知错误'}`,
      timestamp: Date.now(),
    });
    return false;
  }
}
