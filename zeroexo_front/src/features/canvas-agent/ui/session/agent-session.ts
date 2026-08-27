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
import { semanticOfTool, semanticOfCanvasOp } from '../think-stream/tool-semantics.js';
import type { TodoSnapshot } from '../types.js';

// ===== 会话级状态 =====

/** 当前项目 ID（由 AgentDock 挂载时注入） */
let currentProjectId: string | null = null;

export function setSessionProjectId(projectId: string | null): void {
  currentProjectId = projectId;
}

export function getSessionProjectId(): string | null {
  return currentProjectId;
}

/** 流式输出消息 ID（agent:message_delta 增量追加的目标，P0-1） */
let streamMsgId: string | null = null;

/** 协议交互回执前缀（R2 返工）：交互回合收尾时由 pause 标记设置，
 * 用户选择/确认回流时拼接到新消息头部，供 Agent 区分回执语义 */
let pendingReplyPrefix: string | null = null;

/** 工具调用 → 思考步骤索引映射（R2：失败兑底标记用） */
let toolStepIndex = new Map<string, number>();

/** 画布读取清单展示上限（超出截断） */
const CANVAS_LIST_MAX = 8;

/**
 * 工具结果 → 步骤详情文本（R2：展开步骤可看到"读了什么"，感知真实读取）。
 * canvas_get_state 渲染节点清单（超 N 个截断）；其他工具取 message/短 JSON。
 */
function summarizeToolResult(toolName: string, res: unknown): string {
  if (!res || typeof res !== 'object') {
    return typeof res === 'string' ? res.slice(0, 300) : '';
  }
  const r = res as Record<string, unknown>;
  if (toolName === 'canvas_get_state') {
    const summary = (r.summary ?? {}) as Record<string, unknown>;
    const nodes = Array.isArray(summary.nodes) ? (summary.nodes as Array<Record<string, unknown>>) : [];
    const lines = nodes.slice(0, CANVAS_LIST_MAX).map((n) => {
      const title = typeof n.title === 'string' && n.title ? ` "${n.title}"` : '';
      return `- [${String(n.type ?? 'node')}]${title} (${String(n.id ?? '').slice(0, 8)})`;
    });
    if (nodes.length > CANVAS_LIST_MAX) lines.push(`… 剩余 ${nodes.length - CANVAS_LIST_MAX} 个节点`);
    return `已读取 ${String(summary.nodeCount ?? nodes.length)} 个节点、${String(summary.edgeCount ?? 0)} 条连线\n${lines.join('\n')}`;
  }
  if (typeof r.message === 'string') return r.message.slice(0, 300);
  return JSON.stringify(res).slice(0, 300);
}

/**
 * 时间线步骤占位（R2 返工：时间线收敛到 ThinkStream 单一展示，Codex 式）。
 * 不再另生成 TimelineBlock 消息，避免与思考流步骤双展示。
 */
function upsertTimelineStep(_name: string, _kind: 'tool' | 'canvas', _settle?: 'done' | 'failed'): void {
  // no-op：trace 唯一来源 = thinking.steps（ThinkStream 渲染）
}

/**
 * 任务收尾时把执行 trace 快照在思考树中保留（Plan#43 B3）：
 * 不再创建 timeline 消息（归入 ThinkTree 渲染），
 * 思考数据保留在 store.thinking 中（active=false），
 * ThinkTree 在消息流尾部渲染完成态思考树。
 */
function commitTrace(_settle: 'done' | 'failed'): void {
  // Plan#43 B3：不再创建 timeline 消息，思考数据保留在 store 中
  // 由 ThinkTree 在消息流尾部渲染（完成态也保留）
  const s = useCanvasAgentStore.getState();
  s.setThinking({ active: false });
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
  /** 工具结果摘要（tool_result 回填，历史胶囊 Result 展开） */
  toolResult: string | null;
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

/** 通用带 JWT 的 JSON 请求（全局响应拦截器统一 { data: T } 包装，此处解包——
 * 与 AgentClient.send 同源铁律；未解包导致 conversationId=undefined → 会话消息从未落库，刷新全丢） */
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
  const json = (await res.json()) as { data?: T } & T;
  return (json?.data ?? json) as T;
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

/** 进度消息（R2 返工：伪百分比进度卡废弃，Codex 无此形态；真实进度由 todo_write 任务卡承载） */
function upsertProgress(_pct: number, _label?: string): void {
  // no-op：agent:progress 为迭代数折算的伪进度，展示即误导（开场"全部完成 100%"）
}

/** 进度消息收尾（同上废弃） */
function finishProgress(): void {
  // no-op
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
  // Plan#43 B3：新消息开始，清空上一轮的执行计划与思考树
  store.setCurrentPlan(null);
  store.setTodoSnapshot(null);
  store.setThinking({ active: true, text: '', steps: [], tools: [], startedAt: Date.now() });
  streamMsgId = null;
  toolStepIndex = new Map();

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
      onThinking: () => {
        // R2 返工：agent:step 静态文案（"Agent 开始思考..."等）不再写入思考文本，
        // 思考区只承载模型推理增量（thinking_delta），状态信息由状态行呈现（Codex 式）
        useCanvasAgentStore.getState().setThinking({ active: true });
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
        // R2 返工：修复绘制顺序——回复文本首次出现前，先提交已执行的子动作轨迹（读取画布等子行为永远在主回复之前）
        commitTrace('done');
        streamMsgId = `msg_stream_${Date.now()}`;
        s.addMessage({
          id: streamMsgId,
          role: 'agent',
          type: 'text',
          text: delta,
          timestamp: Date.now(),
        });
      },
      onToolCall: (toolName, args, toolCallId) => {
        // P0-3: todo_write 快照剥离为任务卡（PinnedTodoSlot 消费，不显示为工具胶囊）
        if (toolName === 'todo_write') {
          const snap = parseTodoSnapshot(args);
          if (snap) useCanvasAgentStore.getState().setTodoSnapshot(snap);
          return;
        }
        // R2-5: 工具名→用户语义（时间线/胶囊显示语义名，原始工具名收入 chip）
        const sem = semanticOfTool(toolName);
        upsertTimelineStep(sem.label, 'tool');
        const s = useCanvasAgentStore.getState();
        const idx = s.thinking.steps.length;
        if (idx > 0) {
          const prev = s.thinking.steps[idx - 1];
          s.updateThinkingStep(idx - 1, {
            status: 'done',
            ...(prev?.startedAt ? { dur: Date.now() - prev.startedAt } : {}),
          });
        }
        s.addThinkingStep({
          icon: sem.icon,
          name: sem.label,
          tool: toolName,
          status: 'running',
          startedAt: Date.now(),
          input: JSON.stringify(args).slice(0, 200),
        });
        // R2：记录 toolCallId → 步骤索引，供 tool_result 失败时标记兑底
        if (toolCallId) toolStepIndex.set(String(toolCallId), idx);
      },
      onResult: (data) => {
        // R2 失败兑底：工具返回 error/ok=false 时，对应步骤标红（而不是无反应）
        const d = data as { toolCallId?: string; toolName?: string; result?: { error?: string; ok?: boolean } } | null;
        const tcId = String(d?.toolCallId ?? '');
        const stepIdx = toolStepIndex.get(tcId);
        if (stepIdx === undefined) return;
        toolStepIndex.delete(tcId);
        const s = useCanvasAgentStore.getState();
        const res = d?.result;
        if (res && (res.error || res.ok === false)) {
          s.updateThinkingStep(stepIdx, {
            status: 'failed',
            result: String(res.error ?? '执行失败'),
          });
          return;
        }
        // R2：把读取/执行结果写入步骤详情（点开可见画布节点清单，感知真实读取）
        const detail = summarizeToolResult(d?.toolName ?? '', res);
        if (detail) s.updateThinkingStep(stepIdx, { result: detail });
        // R2：工具完成→下一段输出之间的空窗期给可见状态（避免"读了就没反应"）
        s.setPhase('thinking', '正在整理结果…');
      },
      onCanvasOp: (op, args) => {
        // P0-4: 画布操作追加进消息流时间线（R2-5 语义化）
        upsertTimelineStep(semanticOfCanvasOp(op), 'canvas');
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
        // R2 返工：交互卡发出即收尾（后端无状态回合）——快照已执行步骤到轨迹消息，清空底部常驻 trace
        commitTrace('done');
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
        commitTrace('done');
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
      onParamsRequest: (params) => {
        // R3-F1: 节点参数契约表单 → ParamsBlock（提交后作为新一轮消息回执）
        const s = useCanvasAgentStore.getState();
        commitTrace('done');
        s.addMessage({
          id: `msg_params_${Date.now()}`,
          role: 'agent',
          type: 'params',
          text: params.title,
          params: {
            nodeType: params.nodeType,
            title: params.title,
            fields: params.fields ?? [],
            presets: params.presets ?? [],
            noteLabel: params.noteLabel,
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
      // ---- 执行流程引擎事件（Plan#36 R2-5） ----
      onPhase: (phase, label) => {
        useCanvasAgentStore.getState().setPhase(phase, label);
      },
      onPlan: (plan) => {
        commitTrace('done');
        // Plan#43 B3：写入 currentPlan 驱动 PhaseTimeline
        useCanvasAgentStore.getState().setCurrentPlan({ ...plan, status: 'pending' });
        useCanvasAgentStore.getState().addMessage({
          id: `msg_plan_${Date.now()}`,
          role: 'agent',
          type: 'plan',
          text: plan.goal,
          planCard: { ...plan, status: 'pending' },
          timestamp: Date.now(),
        });
      },
      onUploadRequest: (upload) => {
        commitTrace('done');
        useCanvasAgentStore.getState().addMessage({
          id: `msg_upload_${Date.now()}`,
          role: 'agent',
          type: 'upload',
          text: upload.guideText ?? '',
          upload: { ...upload, status: 'pending' },
          timestamp: Date.now(),
        });
      },
      onBrief: (brief) => {
        useCanvasAgentStore.getState().addMessage({
          id: `msg_brief_${Date.now()}`,
          role: 'agent',
          type: 'brief',
          text: brief.summary,
          brief,
          timestamp: Date.now(),
        });
      },
      onError: (error) => {
        const s = useCanvasAgentStore.getState();
        streamMsgId = null;
        commitTrace('failed');
        s.addMessage({
          id: `msg_error_${Date.now()}`,
          role: 'agent',
          type: 'text',
          text: `⚠️ ${error}`,
          timestamp: Date.now(),
        });
        s.setIsGenerating(false);
      },
      onDone: (output) => {
        const s = useCanvasAgentStore.getState();
        s.setCurrentTaskId(null);
        // R2 返工：协议交互回合——记录回执前缀（用户选择/确认回流时拼接），不渲染空消息
        const outAny = output as { output?: unknown; pause?: string } | string | null;
        if (outAny && typeof outAny === 'object' && outAny.pause) {
          pendingReplyPrefix = String(outAny.pause);
        }
        const outputText = typeof outAny === 'string'
          ? outAny
          : outAny && typeof outAny === 'object' && typeof outAny.output === 'string'
            ? outAny.output
            : outAny && typeof outAny === 'object' && outAny.pause
              ? ''
              : outAny && typeof outAny === 'object'
                ? JSON.stringify(outAny, null, 2)
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
        commitTrace('done');
        finishProgress();
        s.setIsGenerating(false);
        s.setPhase(null);
      },
      onClose: () => {
        const s = useCanvasAgentStore.getState();
        streamMsgId = null;
        commitTrace('done');
        finishProgress();
        s.setIsGenerating(false);
        s.setPhase(null);
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

/** 停止当前生成（断开 SSE + 后端取消任务，Plan#36 R2-7） */
export function stopGenerating(): void {
  const s = useCanvasAgentStore.getState();
  const taskId = s.currentTaskId;
  agentClient.unsubscribe();
  // 后端取消：阻止 LLM 继续烧 token（端点已存在）；失败静默（任务可能已自然结束）
  if (taskId) {
    void agentClient.cancelTask(taskId).catch(() => undefined);
  }
  commitTrace('done');
  finishProgress();
  s.setCurrentTaskId(null);
  s.setIsGenerating(false);
  s.setPhase(null);
}

/**
 * 交互卡回执（R2 返工：无状态回合）：
 * 用户的选择/确认作为新一轮用户消息回流（拼协议语义前缀），
 * 上下文由历史注入衔接；不再依赖长等待 SSE 连接，根治断连后确认无响应。
 */
export async function sendAnswer(answer: string): Promise<boolean> {
  const text = answer.trim();
  if (!text) return false;
  const s = useCanvasAgentStore.getState();
  if (s.isGenerating) return false;
  const prefix = pendingReplyPrefix;
  pendingReplyPrefix = null;
  s.addMessage({
    id: `msg_user_reply_${Date.now()}`,
    role: 'user',
    type: 'text',
    text,
    timestamp: Date.now(),
  });
  void sendMessage(prefix ? `${prefix}: ${text}` : text);
  return true;
}
