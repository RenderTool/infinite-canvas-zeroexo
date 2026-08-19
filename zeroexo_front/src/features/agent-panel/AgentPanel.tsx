/**
 * AgentPanel - 全局浮动 AI 助手面板
 *
 * 基于统一的 AgentChatShell 框架（与剧本助手 / 分镜助手共用），保证视觉与
 * 行为一致：
 *   - 左侧：5 个项目阶段（立项 / 剧本 / 分镜 / 出片 / 剪辑）作为步骤条
 *   - 主区：与当前阶段对应的聊天消息流（沿用 AgentChatShell 的 TextRenderer 等渲染器）
 *   - 底部：统一的 AgentInputBar
 *
 * 已连接后端 Agent 架构：
 *   - 通过 AgentClient.send() 提交任务到 /api/agents/execute
 *   - 通过 AgentClient.subscribe() 订阅 SSE 事件流
 *   - 根据 phase 映射到对应的 agentType（project_setup/script_writer 等）
 *   - 每个 phase 维护独立的 conversationId，实现多轮对话上下文延续
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { PanelRightClose, PanelLeftClose } from 'lucide-react';
import { Tooltip } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import {
  AgentChatShell,
  type AgentChatConfig,
  type AgentChatMessage,
  type AgentStepGroup,
  type AgentOptionItem,
  type AgentThemeTokens,
} from '@/features/agent-chat/index.js';
import { PHASE_AGENT_ROLES, getAgentTypeByPhase, type PhaseAgentRole } from './types.js';
import { agentClient, type AgentClientCallbacks } from './AgentClient.js';
import { useTranslation } from 'react-i18next';

const PANEL_WIDTH = 560;

export interface AgentPanelProps {
  open: boolean;
  onClose: () => void;
  /** 当前活跃的阶段（用于同步角色 / 左侧步骤条） */
  activePhase: string;
  /** 阶段变更回调（点击左侧步骤条时触发，可选） */
  onActivePhaseChange?: (phase: string) => void;
  /** 当前项目 ID（用于后端 Agent 加载项目上下文） */
  projectId?: string;
}

export function AgentPanel({
  open,
  onClose,
  activePhase,
  onActivePhaseChange,
  projectId,
}: AgentPanelProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;

  // 当前选中的阶段（默认同步 activePhase）
  const [selectedPhase, setSelectedPhase] = useState<string>(activePhase);
  // 按阶段存储的消息
  const [phaseMessages, setPhaseMessages] = useState<Record<string, AgentChatMessage[]>>({});
  // 输入文本
  const [inputText, setInputText] = useState('');
  // 是否正在生成
  const [thinking, setThinking] = useState(false);

  // 每个 phase 的 conversationId（用于多轮对话上下文）
  const conversationIdsRef = useRef<Record<string, string>>({});
  // 当前正在生成的消息 ID（用于流式更新）
  const pendingMsgIdRef = useRef<string | null>(null);

  // 同步 activePhase（父组件控制）
  useEffect(() => {
    setSelectedPhase(activePhase);
  }, [activePhase]);

  // 清理：面板关闭或组件卸载时断开 SSE 连接
  useEffect(() => {
    if (!open) {
      agentClient.unsubscribe();
      setThinking(false);
      pendingMsgIdRef.current = null;
    }
    return () => {
      agentClient.unsubscribe();
    };
  }, [open]);

  // 主题 tokens
  const agentTheme: AgentThemeTokens = useMemo(() => ({
    accent,
    isDark,
    labelColor: theme.toolbar.text,
    mutedColor: theme.toolbar.textMuted,
    cardBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
    cardBorder: border,
  }), [accent, isDark, theme.toolbar.text, theme.toolbar.textMuted, border]);

  const currentRole: PhaseAgentRole | undefined = PHASE_AGENT_ROLES.find((r) => r.key === selectedPhase);
  const currentMessages = phaseMessages[selectedPhase] || [];

  // 预设项目模板（与剧本助手 / 分镜助手共享视觉语言）
  const projectTemplates: AgentOptionItem[] = useMemo(() => [
    { value: 'tvc', label: t('agentPanel.templateTvcLabel'), desc: t('agentPanel.templateTvcDesc') },
    { value: 'short-video', label: t('agentPanel.templateShortVideoLabel'), desc: t('agentPanel.templateShortVideoDesc') },
    { value: 'documentary', label: t('agentPanel.templateDocumentaryLabel'), desc: t('agentPanel.templateDocumentaryDesc') },
    { value: 'animation', label: t('agentPanel.templateAnimationLabel'), desc: t('agentPanel.templateAnimationDesc') },
    { value: 'product', label: t('agentPanel.templateProductLabel'), desc: t('agentPanel.templateProductDesc') },
    { value: 'vlog', label: t('agentPanel.templateVlogLabel'), desc: t('agentPanel.templateVlogDesc') },
  ], [t]);

  // 更新指定 phase 的消息列表
  const updatePhaseMessages = useCallback((phase: string, updater: (prev: AgentChatMessage[]) => AgentChatMessage[]) => {
    setPhaseMessages((prev) => ({
      ...prev,
      [phase]: updater(prev[phase] || []),
    }));
  }, []);

  // 初始化欢迎消息 + 模板选项
  useEffect(() => {
    if (open && currentRole && !phaseMessages[selectedPhase]) {
      const welcomeMsg: AgentChatMessage = {
        id: 'welcome',
        role: 'agent',
        contentType: 'text',
        text: currentRole.welcomeMessage,
        timestamp: Date.now(),
      };
      const templateMsg: AgentChatMessage = {
        id: 'templates',
        role: 'agent',
        contentType: 'options',
        guideText: t('agentPanel.guideText'),
        options: { items: projectTemplates },
        timestamp: Date.now() + 1,
      };
      setPhaseMessages((prev) => ({
        ...prev,
        [selectedPhase]: [welcomeMsg, templateMsg],
      }));
    }
  }, [open, selectedPhase, currentRole, phaseMessages, projectTemplates, t]);

  // ===== 核心：通过 AgentClient 发送消息 =====
  const sendToAgent = useCallback(async (userText: string) => {
    const cleanText = userText.trim();
    if (!cleanText || thinking) return;

    const agentType = getAgentTypeByPhase(selectedPhase);
    const conversationId = conversationIdsRef.current[selectedPhase];
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pendingMsgIdRef.current = msgId;

    // 1. 添加用户消息
    const userMsg: AgentChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      contentType: 'text',
      text: cleanText,
      timestamp: Date.now(),
    };
    updatePhaseMessages(selectedPhase, (prev) => [...prev, userMsg]);

    // 2. 添加 AI 思考中消息（占位）
    const thinkingMsg: AgentChatMessage = {
      id: msgId,
      role: 'agent',
      contentType: 'thinking',
      text: t('agentPanel.thinking'),
      meta: { title: t('agentPanel.thinkingTitle', { role: currentRole?.role ?? 'AI' }) },
      timestamp: Date.now(),
    };
    updatePhaseMessages(selectedPhase, (prev) => [...prev, thinkingMsg]);
    setThinking(true);
    setInputText('');

    try {
      // 3. 提交任务到后端
      const { taskId } = await agentClient.send(agentType, cleanText, {
        conversationId,
        projectId,
      });

      // 4. 订阅 SSE 事件流
      const callbacks: AgentClientCallbacks = {
        onThinking: (message: string) => {
          // 更新思考消息内容
          updatePhaseMessages(selectedPhase, (prev) =>
            prev.map((m) => m.id === msgId ? { ...m, text: message } : m)
          );
        },
        onToolCall: (toolName: string, args: unknown) => {
          // 工具调用作为思考详情追加
          const toolMsg: AgentChatMessage = {
            id: `tool_${Date.now()}`,
            role: 'agent',
            contentType: 'text',
            text: `${t('agentPanel.toolCall', { toolName })}\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``,
            timestamp: Date.now(),
          };
          updatePhaseMessages(selectedPhase, (prev) => [...prev, toolMsg]);
        },
        onResult: (result: unknown) => {
          // 更新最终结果为 text 消息
          const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          updatePhaseMessages(selectedPhase, (prev) =>
            prev.map((m) => m.id === msgId ? {
              ...m,
              contentType: 'text',
              text: resultText,
            } : m)
          );
        },
        onProgress: (progress: number, message?: string) => {
          // 更新进度
          updatePhaseMessages(selectedPhase, (prev) =>
            prev.map((m) => m.id === msgId ? {
              ...m,
              meta: { ...(m.meta ?? {}), progress, progressText: message },
            } : m)
          );
        },
        onError: (error: string) => {
          // 错误消息
          updatePhaseMessages(selectedPhase, (prev) =>
            prev.map((m) => m.id === msgId ? {
              ...m,
              contentType: 'text',
              text: `${t('agentPanel.errorOccurred')}\n\n${error}`,
              meta: { ...(m.meta ?? {}), error: true },
            } : m)
          );
          setThinking(false);
          pendingMsgIdRef.current = null;
        },
        onDone: (output: unknown) => {
          // 保存新的 conversationId（从 output 或 taskId）
          conversationIdsRef.current[selectedPhase] = taskId;

          // 如果 output 有结构化数据，更新消息
          if (output && typeof output === 'object') {
            const out = output as Record<string, unknown>;
            const outputText = typeof out.output === 'string' ? out.output : JSON.stringify(out, null, 2);
            updatePhaseMessages(selectedPhase, (prev) =>
              prev.map((m) => m.id === msgId ? {
                ...m,
                contentType: 'text',
                text: outputText || m.text,
              } : m)
            );
          }

          setThinking(false);
          pendingMsgIdRef.current = null;
        },
        onClose: () => {
          setThinking(false);
          pendingMsgIdRef.current = null;
        },
      };

      agentClient.subscribe(taskId, callbacks);
    } catch (err) {
      // 提交任务失败
      const errorMsg = err instanceof Error ? err.message : t('agentPanel.unknownError');
      updatePhaseMessages(selectedPhase, (prev) =>
        prev.map((m) => m.id === msgId ? {
          ...m,
          contentType: 'text',
          text: `${t('agentPanel.submitFailed')}\n\n${errorMsg}`,
          meta: { ...(m.meta ?? {}), error: true },
        } : m)
      );
      setThinking(false);
      pendingMsgIdRef.current = null;
    }
  }, [selectedPhase, thinking, currentRole, projectId, updatePhaseMessages, t]);

  // 处理模板选择
  const handleTemplateSelect = useCallback((_stepKey: string | undefined, _value: string, label: string) => {
    if (thinking) return;
    sendToAgent(t('agentPanel.templateSend', { label }));
  }, [thinking, sendToAgent, t]);

  // 发送消息
  const handleSend = useCallback((text: string) => {
    sendToAgent(text);
  }, [sendToAgent]);

  // 点击左侧步骤条切换
  const handleStepClick = useCallback((groupKey: string) => {
    setSelectedPhase(groupKey);
    onActivePhaseChange?.(groupKey);
  }, [onActivePhaseChange]);

  // ===== 步骤条（5 个项目阶段）=====
  const stepGroups: AgentStepGroup[] = useMemo(() => [{
    key: 'phases',
    label: t('agentPanel.stepGroupLabel'),
    description: t('agentPanel.stepGroupDesc'),
    steps: PHASE_AGENT_ROLES.map((p) => ({
      key: p.key,
      label: p.label,
      desc: p.role,
    })),
  }], [t]);

  // ===== 模块配置 =====
  const config: AgentChatConfig = useMemo(() => ({
    moduleId: 'agent-panel',
    title: currentRole?.label ?? 'Agent',
    tag: currentRole?.role ?? t('agentPanel.assistant'),
    agentLabel: currentRole?.role ?? t('agentPanel.assistant'),
    userLabel: t('agentPanel.userLabel'),
    inputPlaceholder: t('agentPanel.inputPlaceholder', { role: currentRole?.role ?? t('agentPanel.assistant') }),
  }), [currentRole, t]);

  if (!open) return null;

  return (
    <>
      {/* 注入框架需要的 keyframes（与剧本助手共享） */}
      <style>{`
        @keyframes messageFadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes chatTypingBlink {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>

      <div style={overlayStyle}>
        <div style={panelStyle(theme)}>
          {/* 收起按钮（贴在顶部左侧,与右上角关闭按钮对称） */}
          <Tooltip title={t('agentPanel.collapsePanel')}>
            <button
              type="button"
              onClick={onClose}
              style={{ ...closeBtnStyle, left: 8, right: 'auto' }}
            >
              <PanelLeftClose size={16} />
            </button>
          </Tooltip>
          {/* 关闭按钮（贴在右上角） */}
          <Tooltip title={t('agentPanel.closePanel')}>
            <button
              type="button"
              onClick={onClose}
              style={closeBtnStyle}
            >
              <PanelRightClose size={16} />
            </button>
            </Tooltip>

          {/* 沿用 AgentChatShell 框架，左侧步骤条（项目阶段） */}
          <AgentChatShell
            config={config}
            theme={agentTheme}
            messages={currentMessages}
            callbacks={{
              onSelectOption: handleTemplateSelect,
              onMultiConfirmOption: () => {},
              onArticleClick: () => {},
              onDeleteMessage: (m) => {
                setPhaseMessages((prev) => ({
                  ...prev,
                  [selectedPhase]: (prev[selectedPhase] || []).filter((x) => x !== m),
                }));
              },
            }}
            steps={{
              groups: stepGroups,
              confirmedKeys: [],
              currentKey: selectedPhase,
              rootTitle: 'Agent',
              rootStatus: currentRole?.label ?? t('agentPanel.online'),
              onStepClick: handleStepClick,
            }}
            stepsPosition="left"
            loading={thinking}
            onSend={handleSend}
            inputValue={inputText}
            onInputChange={setInputText}
          />
        </div>
      </div>
    </>
  );
}

// ===== 样式 =====

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1050,
  background: 'rgba(0,0,0,0.18)',
  display: 'flex',
  justifyContent: 'flex-end',
  animation: 'fadeIn 0.2s',
};

function panelStyle(theme: ReturnType<typeof useTheme>['theme']): React.CSSProperties {
  return {
    position: 'relative',
    width: PANEL_WIDTH,
    maxWidth: '100vw',
    height: '100%',
    background: theme.mode === 'dark' ? '#1c1c1c' : '#ffffff',
    borderLeft: `1px solid ${theme.toolbar.border}`,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: theme.mode === 'dark' ? '-4px 0 24px rgba(0,0,0,0.4)' : '-4px 0 24px rgba(0,0,0,0.08)',
    animation: 'slideInRight 0.3s ease-out',
    overflow: 'hidden',
  };
}

const closeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  zIndex: 10,
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: 'inherit',
  opacity: 0.5,
  transition: 'opacity 0.15s',
};
