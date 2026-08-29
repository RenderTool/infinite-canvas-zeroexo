/**
 * DockContent - Agent Dock 内容区（T5：对话 + 协作聊天 + 成员 三页签）
 *
 * 布局：
 * - 头部：会话切换（下拉列表 + 新建）+ 页签（对话/聊天/成员）
 * - 对话页签：ThinkStream（思考态）+ 消息列表（MessageRenderer）+ ComposerInput
 * - 聊天页签：协作实时聊天（CollaborationChat，复用协作面板组件）
 * - 成员页签：在线成员列表 + 房主可禁言/移出（由 CollaborationPanel 迁移）
 *
 * 挂载时自动恢复最近会话历史（刷新后历史恢复）。
 * 页签状态提升到 canvas-agent store（dockTab），TopBar 协作聊天按钮可直接切到聊天页签。
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, LogOut, MessageSquare, Plus, Sparkles, Trash2, Users, Volume2, VolumeX, Bot, User, X, Search } from 'lucide-react';
import { Button, App as AntdApp } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useCanvasAgentStore } from './store.js';
import { ThinkTree } from './think-stream/ThinkTree.js';
import { PhaseTimeline, derivePhases } from './think-stream/PhaseTimeline.js';
import { MessageRenderer } from './message-blocks/MessageRenderer.js';
import { ComposerInput } from './composer/ComposerInput.js';
import { PinnedTodoSlot } from './PinnedTodoSlot.js';
import { CopyButton } from './message-blocks/CopyButton.js';
import {
  loadConversations,
  loadConversationMessages,
  deleteConversation,
  type ConversationSummary,
  type ConversationMessageDto,
} from './session/agent-session.js';
import type {
  AttachmentCard,
  CanvasAgentMessage,
  CanvasAgentMessageType,
  QuestionData,
  StepData,
  AgentPlanData,
  UploadCardData,
  ParamsRequestData,
  BriefCardData,
  ThinkingState,
  TodoSnapshot,
} from './types.js';
import { CollaborationChat } from '@/features/collaboration/collaboration-chat.js';
import { useReadOnly } from '@/shared/readonly-context.js';
import { LocalAgentConnector } from './LocalAgentConnector.js';
import { useCollaborationStore } from '@/features/collaboration/use-collaboration-store.js';
import {
  listMembers,
  kickMember,
  muteMember,
  unmuteMember,
} from '@/features/collaboration/collaboration-api.js';
import type { CollaborationMember } from '@/features/collaboration/collaboration-types.js';
import { semanticOfTool } from './think-stream/tool-semantics.js';

/**
 * 交互工具名 → 消息类型映射
 */
const INTERACTION_TOOL_TYPE_MAP: Record<string, string> = {
  request_question: 'question',
  request_step: 'step',
  request_params: 'params',
  request_upload: 'upload',
  plan_present: 'plan',
  emit_brief: 'brief',
};

/** 剥离用户回执消息的协议前缀（如 `[用户选择]: xxx` → `xxx`） */
function stripReplyPrefix(text: string): string {
  return text.replace(/^\[[^\]]+\]:\s*/, '');
}

/**
 * 后端消息 → store 消息（跳过记忆压缩摘要等 system 消息）
 * R3 FIX-2：解析 [附件清单:JSON] 标记还原附件卡；同时剥离清单标记与附件预览正文段，
 * 禁止历史加载把附件展开成纯文本。
 */
function dtoToStoreMessage(dto: ConversationMessageDto): CanvasAgentMessage | null {
  const ts = Date.parse(dto.createdAt) || Date.now();
  if (dto.role === 'user') {
    // R2 返工：后端落库的用户消息是 { prompt } 结构序列化，恢复时提取原文，不再显示裸 JSON
    let text = dto.content;
    try {
      const parsed = JSON.parse(dto.content) as { prompt?: unknown };
      if (parsed && typeof parsed.prompt === 'string') text = parsed.prompt;
    } catch {
      /* 非 JSON 保持原文 */
    }
    // R3 FIX-2：还原附件卡（清单标记在 prompt 最前，JSON 以 }] 结尾）
    let attachments: AttachmentCard[] | undefined;
    const manifestMatch = text.match(/^\[附件清单:(\{[\s\S]*?\})\](?:\n|$)/);
    if (manifestMatch) {
      try {
        const manifest = JSON.parse(manifestMatch[1]!) as { files?: AttachmentCard[] };
        if (Array.isArray(manifest.files) && manifest.files.length > 0) {
          attachments = manifest.files;
        }
      } catch {
        /* 清单损坏则忽略，保留原文 */
      }
      if (attachments) {
        // 剥离标记行
        text = text.slice(manifestMatch[0].length);
        // 剥离附件预览正文段（用户多次强调：附件绝不展开进聊天）。
        // 2026-08-25 修复：旧正则强依赖「（原文共 N 字…）」尾巴，非截断附件无此尾巴 → 剥离失效 → 预览全文平铺进气泡。
        // 改为结构性宽剥离：预览段从「[附件 …内容预览]」起，到下一个附件标记/「@ 引用」行/文末为止，不依赖任何尾部格式。
        // 按行结构性剥离（不依赖尾部格式；预览段 = 从「[附件 …内容预览]」标记行到下一个结构化标记行）
        const stripped: string[] = [];
        let inPreview = false;
        for (const ln of text.split('\n')) {
          if (/^\[附件 .*内容预览\]\s*$/.test(ln)) { inPreview = true; continue; }
          if (/^\[附件 .*非文本文件，按需处理）\]\s*$/.test(ln)) { continue; }
          if (inPreview && ln.trimStart().startsWith('[')) inPreview = false;
          if (!inPreview) stripped.push(ln);
        }
        text = stripped.join('\n').trim();
      }
    }
    return {
      id: dto.id,
      role: 'user' as const,
      type: 'text' as const,
      text,
      attachments,
      timestamp: ts,
    };
  }
  if (dto.role === 'system') {
    // 记忆压缩摘要等系统消息不渲染为普通消息
    return null;
  }
  // 检测交互工具消息（后端存储为 role=assistant + toolName + toolArguments）
  if (dto.toolName && INTERACTION_TOOL_TYPE_MAP[dto.toolName]) {
    const msgType = INTERACTION_TOOL_TYPE_MAP[dto.toolName] as CanvasAgentMessageType;
    let parsedData: unknown;
    try {
      if (dto.toolArguments) {
        parsedData = JSON.parse(dto.toolArguments);
      }
    } catch {
      /* 解析失败则 data 为 undefined */
    }
    
    const baseMessage: CanvasAgentMessage = {
      id: dto.id,
      role: 'agent' as const,
      type: msgType,
      text: dto.content,
      timestamp: ts,
      answered: false,
    };
    
    // 根据类型设置对应的数据字段
    if (parsedData && typeof parsedData === 'object') {
      // 转换数据结构以匹配前端期望的类型
      if (msgType === 'question') {
        baseMessage.question = parsedData as QuestionData;
      } else if (msgType === 'step') {
        baseMessage.step = parsedData as StepData;
      } else if (msgType === 'plan') {
        baseMessage.planCard = parsedData as AgentPlanData;
      } else if (msgType === 'upload') {
        baseMessage.upload = { ...(parsedData as UploadCardData), status: 'pending' };
      } else if (msgType === 'params') {
        baseMessage.params = parsedData as ParamsRequestData;
        baseMessage.paramsAnswered = false;
      } else if (msgType === 'brief') {
        baseMessage.brief = parsedData as BriefCardData;
      }
    }
    
    return baseMessage;
  }
  // 普通工具调用消息（后端存 role=assistant + toolName + toolArguments + toolResult）：
  // 忠实还原为单步骤胶囊（timeline 消息，StepCapsule 与聊天时同一视觉体系），
  // 禁止显示为 content 纯文本（此前 bug：全部回退成"调用工具 xxx"文本）
  if (dto.toolName) {
    const sem = semanticOfTool(dto.toolName);
    let parsedArgs: unknown;
    try {
      if (dto.toolArguments) parsedArgs = JSON.parse(dto.toolArguments);
    } catch {
      /* 解析失败则 input 省略 */
    }
    const input =
      parsedArgs && typeof parsedArgs === 'object'
        ? JSON.stringify(parsedArgs).slice(0, 200)
        : undefined;
    return {
      id: dto.id,
      role: 'agent' as const,
      type: 'timeline' as const,
      text: '执行轨迹',
      timeline: {
        steps: [
          {
            id: dto.id,
            name: sem.label,
            kind: 'tool' as const,
            status: 'done' as const,
            input,
            result: dto.toolResult ?? undefined,
          },
        ],
      },
      timestamp: ts,
    };
  }
  return {
    id: dto.id,
    role: 'agent' as const,
    type: 'text' as const,
    text: dto.content,
    timestamp: ts,
  };
}

/** 消息时间戳 → HH:MM */
function formatMsgTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * 历史去重（2026-08-25 修复“历史加载重复两次自己说的话”）：
 * 相邻内容完全一致的 agent 文本消息合并保留一条，
 * 防御落库双写 / 重复事件 / 异常重试导致的历史重复。
 */
function dedupeLoadedMessages(msgs: CanvasAgentMessage[]): CanvasAgentMessage[] {
  const out: CanvasAgentMessage[] = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.role === 'agent' &&
      prev.type === 'text' &&
      m.type === 'text' &&
      prev.text === m.text
    ) {
      continue;
    }
    out.push(m);
  }
  return out;
}

export interface DockContentProps {
  projectId?: string;
}

type DockTab = 'chat' | 'collab' | 'members';

/** 消息流切片窗口参数（Plan#43 B8，征集#72）：默认渲染最近 N 回合，上滑分批加载更早回合 */
const TURN_WINDOW = 24;
const TURN_LOAD_STEP = 12;
const EMPTY_STEPS: ThinkingState['steps'] = [];

/**
 * TurnBlock - 回合渲染块（memo，长会话性能关键，Plan#43 B8）
 *
 * 流式更新时只有末回合 props 变化（尾消息/思考/计划），历史回合 props 稳定 → 跳过重渲染。
 * 保持 R2 回合归组的紧凑对话流：一组一个角色头 + 尾部整块复制。
 */
const TurnBlock = memo(function TurnBlock({
  group,
  showThinking,
  showPhase,
  thinkingText,
  thinkingSteps,
  thinkingStartedAt,
  currentPlan,
  todoSnapshot,
}: {
  group: CanvasAgentMessage[];
  showThinking: boolean;
  showPhase: boolean;
  /** 仅末回合（showThinking/showPhase）传真实值，其余传稳定空值保证 memo 命中 */
  thinkingText: string;
  thinkingSteps: ThinkingState['steps'];
  thinkingStartedAt?: number;
  currentPlan: AgentPlanData | null;
  todoSnapshot: TodoSnapshot | null;
}): React.ReactElement {
  const isAgent = group[0]!.role === 'agent';
  // 整块复制内容：回合内全部文本/MD 消息拼接
  const turnText = group
    .filter((m) => m.type === 'text' || m.type === 'md')
    .map((m) => m.text ?? '')
    .filter(Boolean)
    .join('\n\n');
  return (
    <div>
      {group.map((m, mIdx) => {
        const isFirst = mIdx === 0;
        return (
          <div key={m.id} className={`msg ${m.role === 'user' ? 'user' : 'assistant'}`}>
            {isFirst && (
              <div className="role">
                {isAgent && (
                  <span className="agent-avatar">
                    <Bot size={16} />
                  </span>
                )}
                <span>{m.role === 'user' ? '你' : 'Agent'}</span>
                <span className="msg-time">{formatMsgTime(m.timestamp)}</span>
              </div>
            )}
            {/* Plan#43 修订（2026-08-25 实测反馈）：完成态思考树/计划流挂在角色行之后、正文结论之前（原挂角色头之前，视觉上出现在头像上方） */}
            {isFirst && showThinking ? (
              <ThinkTree
                steps={thinkingSteps}
                thinkingText={thinkingText}
                active={false}
                startedAt={thinkingStartedAt}
                defaultCollapsed
              />
            ) : null}
            {isFirst && showPhase && currentPlan ? (
              <PhaseTimeline
                plan={currentPlan}
                phases={derivePhases(currentPlan, todoSnapshot)}
              />
            ) : null}
            {m.role === 'user' ? (
              /* R4：用户消息 = 气泡 + 最右侧头像（仅回合首条带头像，与角色行一致） */
              <div className="user-main">
                <div className="user-text">{m.text}</div>
                {isFirst && (
                  <span className="user-avatar">
                    <User size={16} />
                  </span>
                )}
              </div>
            ) : (
              <div className="ai-body">
                <MessageRenderer message={m} />
              </div>
            )}
          </div>
        );
      })}
      {/* R2：回合结束后整块复制（GPT 式，一组只有一个复制钮） */}
      {isAgent && turnText && (
        <div className="msg-actions">
          <CopyButton getText={() => turnText} />
        </div>
      )}
    </div>
  );
});

export function DockContent({ projectId }: DockContentProps): React.ReactElement {
  const readOnly = useReadOnly();
  const messages = useCanvasAgentStore((s) => s.messages);
  const isGenerating = useCanvasAgentStore((s) => s.isGenerating);
  // 思考流文本:思考块随流增长时保持滚动到底部
  const thinkingText = useCanvasAgentStore((s) => s.thinking.text);
  const activeConversationId = useCanvasAgentStore((s) => s.activeConversationId);
  // Plan#43 B3：执行计划与快照（PhaseTimeline 驱动）
  const currentPlan = useCanvasAgentStore((s) => s.currentPlan);
  const todoSnapshot = useCanvasAgentStore((s) => s.todoSnapshot);
  const thinking = useCanvasAgentStore((s) => s.thinking);
  const phaseLabel = useCanvasAgentStore((s) => s.phaseLabel);
  // 实时思考树可见：生成中且已有思考内容（文本或步骤）→ 常驻动效，绝不静止
  const liveThinkingVisible =
    isGenerating &&
    thinking.active &&
    (thinking.text.trim().length > 0 || thinking.steps.length > 0);
  // 页签状态提升到 store:TopBar 协作聊天按钮可直接切到 collab
  const tab = useCanvasAgentStore((s) => s.dockTab);
  const setTab = useCanvasAgentStore((s) => s.setDockTab);
  const collabStore = useCollaborationStore();
  const { t } = useTranslation();
  // antd 静态 API（message/Modal.confirm）不走 ConfigProvider 上下文，不适配明暗主题；
  // 项目惯例：一律用 App.useApp() 实例（继承 AntdThemeProvider 的 dark/light 算法）
  const { message, modal } = AntdApp.useApp();
  const themeCfg = useTheme();
  const scrollRef = useRef<HTMLDivElement>(null);

  // ===== Plan#43 B8 消息流切片窗口（虚拟化轻量版，征集#72：长会话卡顿根除） =====
  // R2 返工：按回合归组（useMemo + 旧引用复用：回合内容未变则保持同一数组引用 → TurnBlock memo 命中）
  const prevGroupsRef = useRef<CanvasAgentMessage[][]>([]);
  const groups = useMemo(() => {
    const gs: CanvasAgentMessage[][] = [];
    for (const m of messages) {
      const last = gs[gs.length - 1];
      if (last && last[0]!.role === m.role) last.push(m);
      else gs.push([m]);
    }
    const prev = prevGroupsRef.current;
    const reused = gs.map((g, i) => {
      const p = prev[i];
      return p && p.length === g.length && p[0] === g[0] && p[p.length - 1] === g[g.length - 1] ? p : g;
    });
    prevGroupsRef.current = reused;
    return reused;
  }, [messages]);

  // windowStart = -1 → 贴底（只渲染最近 TURN_WINDOW 回合）；切换会话重置回贴底
  const [windowStart, setWindowStart] = useState(-1);
  useEffect(() => { setWindowStart(-1); }, [activeConversationId]);
  const effWindowStart = windowStart < 0
    ? Math.max(0, groups.length - TURN_WINDOW)
    : Math.min(windowStart, groups.length);
  const effWindowStartRef = useRef(effWindowStart);
  effWindowStartRef.current = effWindowStart;
  const visibleGroups = groups.slice(effWindowStart);

  // 上滑近顶（<80px）分批加载更早回合；贴底/自动滚底时 scrollTop 大，不会误触发
  const handleConversationScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.scrollTop > 80) return;
    setWindowStart((w) => {
      const cur = w < 0 ? effWindowStartRef.current : w;
      if (cur <= 0) return w;
      return Math.max(0, cur - TURN_LOAD_STEP);
    });
  }, []);

  // prepend 后的滚动位置补偿：新内容插入顶部时，可视内容保持原位（不跳）
  const convMetricsRef = useRef({ start: -1, height: 0 });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = convMetricsRef.current;
    if (prev.start > effWindowStart && prev.height > 0) {
      el.scrollTop += el.scrollHeight - prev.height;
    }
    convMetricsRef.current = { start: effWindowStart, height: el.scrollHeight };
  });

  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [convOpen, setConvOpen] = useState(false);
  /** 头部容器 ref（会话切换按钮 + 历史会话下拉面板都在其中，用于点击外部收起判定） */
  const headerRef = useRef<HTMLDivElement>(null);
  // 征集 #96:历史会话下拉——点击头部以外区域自动收起(捕获阶段监听,避免被内部点击冒泡干扰)
  useEffect(() => {
    if (!convOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (headerRef.current?.contains(e.target as Node)) return;
      setConvOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [convOpen]);
  /** 历史会话搜索关键词（标题/最后消息预览模糊匹配） */
  const [convQuery, setConvQuery] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  // 未读消息数（collab 聊天页签红点；切到该页签清零）
  const unreadMessages = useCollaborationStore((s) => s.unreadMessages);
  // 新成员加入提醒数（members 页签红点；切到该页签清零）
  const newMemberCount = useCollaborationStore((s) => s.newMemberCount);
  // 对话页签未读提醒数（Agent 回复完成且不在对话页签时 +1；切到该页签清零）
  const agentUnread = useCanvasAgentStore((s) => s.agentUnread);
  const clearAgentUnread = useCanvasAgentStore((s) => s.clearAgentUnread);

  // 兜底清零：正在对话/聊天/成员页签时新事件到达（红点+1 已发生）立即归零，避免页签已激活仍残留红点
  useEffect(() => {
    if (tab === 'chat' && agentUnread > 0) clearAgentUnread();
    if (tab === 'collab' && unreadMessages > 0) collabStore.clearUnreadMessages();
    if (tab === 'members' && newMemberCount > 0) collabStore.clearNewMemberCount();
  }, [tab, agentUnread, unreadMessages, newMemberCount, clearAgentUnread, collabStore]);

  // 挂载：恢复最近会话历史 + 加载会话列表
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await loadConversations();
        if (cancelled) return;
        setConvs(list);
        const store = useCanvasAgentStore.getState();
        if (store.activeConversationId || store.messages.length > 0) return;
        if (list.length === 0) return;
        const target = projectId
          ? list.find((c) => c.projectId === projectId) ?? list[0]
          : list[0];
        if (!target) return;
        store.setActiveConversationId(target.id);
        const msgs = await loadConversationMessages(target.id);
        if (cancelled) return;
        store.clearMessages();
        // 先全部转为 store 消息，再在数组上标记 answered，最后一次性写入 store
        // 避免组件在 answered=false 时初始化本地状态（useState 只取初始值）
        const converted: CanvasAgentMessage[] = [];
        for (let i = 0; i < msgs.length; i++) {
          const m = dtoToStoreMessage(msgs[i]!);
          if (m) converted.push(m);
        }
        // 标记交互消息的 answered 状态（下一条为用户消息则视为已回答）
        for (let i = 0; i < converted.length; i++) {
          const cur = converted[i]!;
          if (cur.type === 'question' || cur.type === 'clarify' || cur.type === 'step' || cur.type === 'plan' || cur.type === 'upload' || cur.type === 'params' || cur.type === 'brief' || cur.type === 'text') {
            const next = converted[i + 1];
            if (next && next.role === 'user') {
              cur.answered = true;
              if (cur.type === 'params') cur.paramsAnswered = true;
              // 从用户消息中提取答案原文，用于历史还原选择状态
              if (next.text) cur.restoredAnswer = stripReplyPrefix(next.text);
            }
          }
        }
        store.batchSetMessages(dedupeLoadedMessages(converted));
      } catch {
        // 未登录/无会话时静默，保持空态欢迎页
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ===== 成员管理(房主权限,由协作面板迁移) =====
  const collabRoom = collabStore.room;
  const collabMembers = collabStore.members;
  const isRoomOwner = collabRoom?.isOwner ?? false;

  const refreshMembers = async () => {
    if (!collabRoom) return;
    try {
      const list = await listMembers(collabRoom.canvasId);
      collabStore.setMembers(list);
    } catch { /* 静默 */ }
  };

  const handleToggleMute = async (member: CollaborationMember) => {
    if (!collabRoom) return;
    setBusyUserId(member.userId);
    try {
      const muted = member.sessions.some((s) => s.status === 'muted');
      if (muted) {
        await unmuteMember(collabRoom.canvasId, member.userId);
        message.success(t('collab.memberUnmutedSuccess'));
      } else {
        await muteMember(collabRoom.canvasId, member.userId);
        message.success(t('collab.memberMutedSuccess'));
      }
      await refreshMembers();
    } catch {
      // 操作失败保持列表现状
    } finally {
      setBusyUserId(null);
    }
  };

  const handleKick = async (member: CollaborationMember) => {
    if (!collabRoom) return;
    setBusyUserId(member.userId);
    try {
      await kickMember(collabRoom.canvasId, member.userId);
      await refreshMembers();
      message.success(t('collab.memberKicked'));
    } catch {
      message.error(t('collab.kickFailed'));
    } finally {
      setBusyUserId(null);
    }
  };

  // 解禁成员（封禁入口已移除：移出=移出，被移出成员不留在列表，重进须重新申请/走邀请）

  // 自动滚动到底部（仅对话 Tab）
  useEffect(() => {
    if (tab !== 'chat') return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, isGenerating, thinkingText, tab]);

  /** 切换会话 */
  const handleSwitchConversation = async (id: string): Promise<void> => {
    const store = useCanvasAgentStore.getState();
    if (store.isGenerating) return;
    setConvOpen(false);
    setConvQuery('');
    store.setActiveConversationId(id);
    store.clearMessages();
    try {
      const msgs = await loadConversationMessages(id);
      // 先全部转为 store 消息，再在数组上标记 answered，最后一次性写入 store
      const converted: CanvasAgentMessage[] = [];
      for (let i = 0; i < msgs.length; i++) {
        const m = dtoToStoreMessage(msgs[i]!);
        if (m) converted.push(m);
      }
      // 标记交互消息的 answered 状态
      for (let i = 0; i < converted.length; i++) {
        const cur = converted[i]!;
        if (cur.type === 'question' || cur.type === 'clarify' || cur.type === 'step' || cur.type === 'plan' || cur.type === 'upload' || cur.type === 'params' || cur.type === 'brief' || cur.type === 'text') {
          const next = converted[i + 1];
          if (next && next.role === 'user') {
            cur.answered = true;
            if (cur.type === 'params') cur.paramsAnswered = true;
            if (next.text) cur.restoredAnswer = stripReplyPrefix(next.text);
          }
        }
      }
      store.batchSetMessages(dedupeLoadedMessages(converted));
    } catch {
      // 历史加载失败时保持空会话
    }
  };

  /** 新建会话（懒创建：不立即落库，首条消息发送时由 ensureConversation 创建，
   * 避免每点一次新建就堆积一条空会话） */
  const handleNewConversation = (): void => {
    const store = useCanvasAgentStore.getState();
    if (store.isGenerating) return;
    setConvOpen(false);
    setTab('chat');
    // 当前已是空会话（未落库且无消息）→ 无需重复新建
    if (!store.activeConversationId && store.messages.length === 0) return;
    store.setActiveConversationId(null);
    store.clearMessages();
  };

  // 懒创建会话落库后刷新列表：首条消息发送后后端才创建会话，
  // activeConversationId 不在列表中时静默重拉，保证下拉列表与会话标题同步
  useEffect(() => {
    if (!activeConversationId) return;
    if (convs.some((c) => c.id === activeConversationId)) return;
    let cancelled = false;
    void loadConversations()
      .then((list) => {
        if (!cancelled) setConvs(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeConversationId, convs]);

  /** 删除会话（先确认，防误触；确认后级联删除消息） */
  const handleDeleteConversation = async (id: string): Promise<void> => {
    const store = useCanvasAgentStore.getState();
    const target = convs.find((c) => c.id === id);
    const msgCount = target?._count?.messages ?? 0;
    modal.confirm({
      title: '删除该会话？',
      content: target
        ? `「${target.title ?? '画布 Agent 对话'}」共 ${msgCount} 条消息，删除后不可恢复。`
        : '删除后历史消息不可恢复。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        try {
          await deleteConversation(id);
        } catch {
          message.error('删除会话失败');
          return;
        }
        setConvs((prev) => prev.filter((c) => c.id !== id));
        if (store.activeConversationId === id) {
          store.setActiveConversationId(null);
          store.clearMessages();
        }
      },
    });
  };

  const currentTitle = convs.find((c) => c.id === activeConversationId)?.title
    ?? (messages.length > 0 ? '画布 Agent 对话' : '新对话');

  // 历史会话搜索：标题 + 最后消息预览模糊匹配（不区分大小写）
  const filteredConvs = (() => {
    const q = convQuery.trim().toLowerCase();
    if (!q) return convs;
    return convs.filter((c) => {
      const title = (c.title ?? '').toLowerCase();
      const preview = (c.messages?.[0]?.content ?? '').toLowerCase();
      return title.includes(q) || preview.includes(q);
    });
  })();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--agent-bg)',
      }}
    >
      {/* ===== 头部：会话 + Tab ===== */}
      <div
        ref={headerRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          // 征集 #96:分割线与剧本编辑器同款(原 --agent-border 过重)
          borderBottom: '1px solid var(--agent-divider)',
          background: 'var(--agent-panel)',
          position: 'relative',
          flexShrink: 0,
          zIndex: 20,
        }}
      >
        {/* 会话切换（征集 #96：与下方渠道下拉同款——无边框、透明底、hover 灰底） */}
        <button
          type="button"
          onClick={() => setConvOpen((v) => !v)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 26,
            padding: '0 6px',
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            color: 'var(--agent-text)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            maxWidth: 170,
            flexShrink: 0,
            transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--agent-surface-2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          title="切换会话"
        >
          <MessageSquare size={12} style={{ flexShrink: 0 }} />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentTitle}
          </span>
          <ChevronDown
            size={11}
            style={{
              flexShrink: 0,
              transform: convOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s',
            }}
          />
        </button>

        {/* 新建会话（懒创建：首条消息发送时才落库） */}
        <button
          type="button"
          onClick={handleNewConversation}
          title="新建会话"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            // 征集 #96:改圆形按钮并缩小(原 26×26 方角带边框)
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            color: 'var(--agent-muted)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--agent-surface-2)';
            e.currentTarget.style.color = 'var(--agent-text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--agent-muted)';
          }}
        >
          <Plus size={12} />
        </button>

        {/* Tab 切换 */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            marginLeft: 'auto',
            padding: 2,
            borderRadius: 8,
            background: 'var(--agent-surface-2)',
            border: '1px solid var(--agent-border)',
          }}
        >
          {(['chat', 'collab', 'members'] as DockTab[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setTab(k);
                // 切到对话/聊天页签 = 已读；切到成员页签 = 已看到新成员
                if (k === 'chat') clearAgentUnread();
                if (k === 'collab') collabStore.clearUnreadMessages();
                if (k === 'members') collabStore.clearNewMemberCount();
              }}
              style={{
                position: 'relative',
                padding: '3px 10px',
                borderRadius: 6,
                border: 'none',
                background: tab === k ? 'var(--agent-accent)' : 'transparent',
                color: tab === k ? '#fff' : 'var(--agent-muted)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {k === 'chat' ? '对话' : k === 'collab' ? '聊天' : '成员'}
              {/* 红点冒泡：右上角未读徽标（对话回复/聊天消息/新成员） */}
              {(k === 'chat' && agentUnread > 0) ||
              (k === 'collab' && unreadMessages > 0) ||
              (k === 'members' && newMemberCount > 0) ? (
                <span
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -6,
                    minWidth: 16,
                    height: 16,
                    padding: '0 4px',
                    borderRadius: 8,
                    background: '#f5222d',
                    color: '#fff',
                    fontSize: 10,
                    lineHeight: '16px',
                    fontWeight: 700,
                    textAlign: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  {k === 'chat'
                    ? agentUnread > 99
                      ? '99+'
                      : agentUnread
                    : k === 'collab'
                      ? unreadMessages > 99
                        ? '99+'
                        : unreadMessages
                      : newMemberCount > 99
                        ? '99+'
                        : newMemberCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* 关闭面板(符合用户习惯;重新打开走顶部 Agent 按钮) */}
        <button
          type="button"
          onClick={() => useCanvasAgentStore.getState().setDockOpen(false)}
          title="关闭面板"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 7,
            border: 'none',
            background: 'transparent',
            color: 'var(--agent-muted)',
            cursor: 'pointer',
            flexShrink: 0,
            marginLeft: 2,
          }}
        >
          <X size={14} />
        </button>

        {/* 会话下拉列表 */}
        {convOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 14,
              right: 14,
              zIndex: 40,
              background: 'var(--agent-bg)',
              border: '1px solid var(--agent-border)',
              borderRadius: 10,
              boxShadow: 'var(--agent-shadow)',
              maxHeight: 320,
              overflowY: 'auto',
              padding: 6,
              marginTop: 4,
            }}
          >
            {/* 搜索框：历史会话按标题/预览过滤 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px',
                marginBottom: 4,
                borderRadius: 7,
                background: 'var(--agent-surface-2)',
              }}
            >
              <Search size={12} style={{ color: 'var(--agent-muted)', flexShrink: 0 }} />
              <input
                type="text"
                value={convQuery}
                onChange={(e) => setConvQuery(e.target.value)}
                placeholder="搜索历史会话…"
                autoFocus
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontSize: 12,
                  color: 'var(--agent-text)',
                  fontFamily: 'inherit',
                }}
              />
              {convQuery && (
                <button
                  type="button"
                  onClick={() => setConvQuery('')}
                  title="清空搜索"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--agent-muted)',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'inline-flex',
                    flexShrink: 0,
                  }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
            {filteredConvs.length === 0 && (
              <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--agent-muted)' }}>
                {convs.length === 0 ? '暂无历史会话，点击 + 新建' : '未找到匹配的会话'}
              </div>
            )}
            {filteredConvs.map((c) => (
              <div
                key={c.id}
                onClick={() => void handleSwitchConversation(c.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: c.id === activeConversationId ? 'var(--agent-accent-soft)' : 'transparent',
                  border: c.id === activeConversationId ? '1px solid var(--agent-accent)' : '1px solid transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: 'var(--agent-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.title ?? '画布 Agent 对话'}
                  </div>
                  {c.messages?.[0] && (
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--agent-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginTop: 2,
                      }}
                    >
                      {c.messages[0].content.slice(0, 60)}
                    </div>
                  )}
                </div>
                {c._count?.messages != null && (
                  <span style={{ fontSize: 10.5, color: 'var(--agent-muted)', flexShrink: 0 }}>
                    {c._count.messages} 条
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteConversation(c.id);
                  }}
                  title="删除会话"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--agent-muted)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== 内容区 ===== */}
      {tab === 'chat' ? (
        <div className="conversation" ref={scrollRef} onScroll={handleConversationScroll}>
          {messages.length === 0 ? (
            <div className="welcome-wrap">
              <div className="welcome-icon">
                <Sparkles size={24} color="#fff" />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--agent-text)', marginBottom: 4 }}>
                ZeroExo Agent
              </div>
              <div style={{ fontSize: 12, color: 'var(--agent-muted)', lineHeight: 1.6, marginBottom: 16 }}>
                描述你的需求，Agent 会调用工具在画布上执行任务。
                <br />
                例如：「生成一段 15 秒的 TVC 广告」
              </div>
            </div>
          ) : (
            // R2 返工：按回合归组渲染——一组一个角色头，回合结束后整块复制（不是每小块一个复制钮）
            // Plan#43 B8：切片窗口渲染（默认最近 TURN_WINDOW 回合，上滑分批加载）+ TurnBlock memo（流式期只重渲染末回合）
            <>
              {effWindowStart > 0 && (
                <div style={{ textAlign: 'center', padding: '2px 0 6px', fontSize: 11, color: 'var(--agent-muted)', userSelect: 'none' }}>
                  上滑加载更早消息…
                </div>
              )}
              {visibleGroups.map((group, idx) => {
                const groupIdx = effWindowStart + idx;
                const isAgent = group[0]!.role === 'agent';
                // Plan#43：思考树/PhaseTimeline 只挂在最后一个 agent 回合前（当前活跃或刚完成的一轮）
                // 实时思考树（active）不在此渲染——统一挂在消息流尾部（见下方 GeneratingIndicator），
                // 否则生成中若最后一条是用户消息/无 agent group 时思考树无处挂载 → 界面静止
                const isLastGroup = groupIdx === groups.length - 1;
                const showThinking = isAgent && isLastGroup && !thinking.active && (thinking.text.length > 0 || thinking.steps.length > 0);
                const showPhase = isAgent && isLastGroup && !!currentPlan && !!todoSnapshot;
                return (
                  <TurnBlock
                    key={group[0]!.id}
                    group={group}
                    showThinking={showThinking}
                    showPhase={showPhase}
                    thinkingText={showThinking ? thinking.text : ''}
                    thinkingSteps={showThinking ? thinking.steps : EMPTY_STEPS}
                    thinkingStartedAt={showThinking ? thinking.startedAt : undefined}
                    currentPlan={showPhase ? currentPlan : null}
                    todoSnapshot={showPhase ? todoSnapshot : null}
                  />
                );
              })}
            </>
          )}

          {/* ===== 生成中常驻动效（Plan#43：任何生成过程都不允许静态，后端无增量事件时也必须有可见动效） ===== */}
          {isGenerating && liveThinkingVisible ? (
            <ThinkTree
              steps={thinking.steps}
              thinkingText={thinking.text}
              active
              startedAt={thinking.startedAt}
              statusText={phaseLabel ?? undefined}
              defaultCollapsed={false}
            />
          ) : null}
          {isGenerating && !liveThinkingVisible && (
            <GeneratingIndicator phaseLabel={phaseLabel} />
          )}
        </div>
      ) : tab === 'collab' ? (
        /* ===== 协作聊天 Tab ===== */
        <div style={{ flex: 1, minHeight: 0, padding: '8px 12px 12px', display: 'flex', flexDirection: 'column' }}>
          {!collabRoom ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                color: 'var(--agent-muted)',
                fontSize: 12,
                textAlign: 'center',
                padding: '24px 12px',
                lineHeight: 1.7,
              }}
            >
              <Users size={18} style={{ opacity: 0.6 }} />
              <span>未加入协作房间，点击顶部「协作」按钮创建或加入后，即可与协作者实时聊天。</span>
            </div>
          ) : (
            <CollaborationChat theme={themeCfg.theme} height="100%" />
          )}
        </div>
      ) : (
        /* ===== 成员 Tab ===== */
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px 12px' }}>
          {!collabRoom ? (
            <div style={{ textAlign: 'center', color: 'var(--agent-muted)', fontSize: 12, padding: '24px 12px', lineHeight: 1.7 }}>
              未加入协作房间，暂无成员信息。
            </div>
          ) : collabMembers.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--agent-muted)', fontSize: 12, padding: '24px 12px' }}>
              {t('collab.noMembers')}
            </div>
          ) : (
            collabMembers.map((member) => {
              const online = member.sessions.some((s) => s.status === 'online');
              const muted = member.sessions.some((s) => s.status === 'muted');
              return (
                <div
                  key={member.userId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 4px',
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      flexShrink: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--agent-text)',
                      background: 'var(--agent-surface-2)',
                      border: `2px solid ${online ? '#52c41a' : 'var(--agent-border)'}`,
                    }}
                  >
                    {member.isSelf ? (member.nickname || '我').charAt(0) : (member.nickname || '?').charAt(0)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--agent-text)',
                          lineHeight: 1.2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {member.nickname || t('collab.unnamed')}
                      </span>
                      {member.isSelf && (
                        <span style={{ fontSize: 10, color: 'var(--agent-muted)' }}>({t('collab.self')})</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--agent-muted)', lineHeight: 1.4 }}>
                      {t(`collab.role.${member.role}`)}
                      {muted ? ` · ${t('collab.memberMuted')}` : online ? ` · ${t('collab.status.online')}` : ''}
                    </div>
                  </div>
                  {isRoomOwner && !member.isSelf && (
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      <Button
                        size="small"
                        type="text"
                        icon={muted ? <Volume2 size={13} /> : <VolumeX size={13} />}
                        onClick={() => void handleToggleMute(member)}
                        loading={busyUserId === member.userId}
                        title={muted ? t('collab.unmute') : t('collab.mute')}
                        style={{ color: 'var(--agent-muted)' }}
                      />
                      <Button
                        size="small"
                        type="text"
                        // 移出图标: LogOut(而非盾牌)——盾牌是封禁语义,移出≠封禁,避免误导
                        icon={<LogOut size={13} />}
                        onClick={() => void handleKick(member)}
                        loading={busyUserId === member.userId}
                        title={t('collab.kick')}
                        style={{ color: 'var(--agent-muted)' }}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ===== 输入区（仅对话 Tab；只读隐藏 2026-08-25 系统性只读防护：Agent 执行画布写操作，viewer 不可用） ===== */}
      {tab === 'chat' && readOnly && (
        <div
          style={{
            padding: '10px 12px',
            fontSize: 12,
            lineHeight: '18px',
            color: 'var(--agent-muted)',
            background: 'var(--agent-bg-soft, rgba(127,127,127,0.08))',
            borderTop: '1px solid var(--agent-border)',
            textAlign: 'center',
          }}
        >
          {t('agentPanel.readOnlyHint')}
        </div>
      )}
      {tab === 'chat' && !readOnly && <PinnedTodoSlot />}
      {tab === 'chat' && !readOnly && <LocalAgentConnector />}
      {tab === 'chat' && !readOnly && <ComposerInput />}
    </div>
  );
}

/**
 * GeneratingIndicator - 生成中常驻动效指示器（Plan#43）
 *
 * 用户多次强调"任何生成中都要有动效，绝不允许静态/疑似卡死"。
 * 该组件在后端无增量事件（thinking_delta/message_delta 缺席）时兜底：
 * 三颗呼吸脉冲点 + 阶段文案 + 微光骨架行，永不静止。
 */
function GeneratingIndicator({ phaseLabel }: { phaseLabel: string | null }): React.ReactElement {
  const phaseText = phaseLabel || '正在生成…';
  return (
    <div
      style={{
        width: '100%',
        padding: '14px 4px 6px',
        animation: 'agentFadeUp 0.3s ease',
      }}
    >
      {/* 头部：脉冲点 + 阶段文案 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="agent-dots">
          <span className="agent-dots-i" />
          <span className="agent-dots-i" />
          <span className="agent-dots-i" />
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--agent-muted)',
            animation: 'agentFadeUp 0.4s ease',
          }}
        >
          {phaseText}
        </span>
      </div>
      {/* 微光骨架行：模拟流式输出 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {['92%', '84%', '96%', '55%'].map((w, i) => (
          <div
            key={i}
            className="agent-shimmer"
            style={{
              width: w,
              height: 13,
              borderRadius: 6,
              animationDelay: `${i * 0.14}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
