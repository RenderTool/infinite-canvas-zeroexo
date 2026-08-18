/**
 * AgentChatShell - 通用 Agent 聊天面板外壳（View 层）
 *
 * MVVM 中的 View：纯 UI 编排，不持有业务状态。
 * - Header：icon + title + tag + headerActions 插槽
 * - 消息列表：按 message.contentType 从注册表取渲染器分发（renderMessage）
 * - 输入栏：复用 AiInputBar（受控/非受控均可）
 * - 右侧步骤条：传入 steps 数据即显示（StepsSidebar）
 *
 * 业务模块只需提供：messages（数据）+ callbacks（行为）+ theme（主题 tokens）
 * + config（文案/规则），即"按需配置展示数据与规则"。
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Bot } from 'lucide-react';
import { Tag } from 'antd';
import type {
  AgentChatCallbacks,
  AgentChatConfig,
  AgentChatMessage,
  AgentThemeTokens,
  AgentStepGroup,
} from './types.js';
import { renderMessage } from './renderer-registry.js';
import { StepsSidebar } from './StepsSidebar.js';
import { AgentInputBar } from './components/AgentInputBar.js';

export interface AgentChatShellProps {
  /** 模块配置（文案/规则/标签） */
  config: AgentChatConfig;
  /** 消息流（contentType 驱动渲染） */
  messages: AgentChatMessage[];
  /** 主题 tokens（由调用方从自己的主题系统注入） */
  theme: AgentThemeTokens;
  /** 行为回调 */
  callbacks: AgentChatCallbacks;
  /** Header 右侧额外操作区（如重置/历史按钮） */
  headerActions?: ReactNode;
  /** 欢迎页内容（messages 为空时显示） */
  welcome?: ReactNode;
  /** 是否正在流式输出 */
  loading?: boolean;

  // ---- 输入栏（非受控：仅传 onSend 即可） ----
  onSend?: (text: string) => void;
  inputValue?: string;
  onInputChange?: (value: string) => void;

  // ---- 右侧步骤条（不传则不显示） ----
  steps?: {
    groups: AgentStepGroup[];
    confirmedKeys: string[];
    currentKey: string | null;
    rootTitle?: string;
    rootStatus?: string;
    onStepClick?: (groupKey: string) => void;
    onTruncate?: (groupKey: string) => void;
  };
  /** 步骤条位置（默认 right）。AgentPanel 等场景需要左侧导航时可传 'left' */
  stepsPosition?: 'left' | 'right';

  /** 底部完成状态横幅（可选） */
  completeBanner?: ReactNode;
}

export function AgentChatShell({
  config,
  messages,
  theme,
  callbacks,
  headerActions,
  welcome,
  loading = false,
  onSend,
  inputValue,
  onInputChange,
  steps,
  stepsPosition = 'right',
  completeBanner,
}: AgentChatShellProps): React.ReactElement {
  const [internalText, setInternalText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const inputText = inputValue ?? internalText;
  const handleInputChange = onInputChange ?? setInternalText;

  // 新消息自动滚动到底部
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    onSend?.(text);
    if (onInputChange === undefined) setInternalText('');
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle(theme)}>
        <div style={headerLeftStyle}>
          {config.icon ?? <Bot size={14} color={theme.accent} />}
          <span style={titleStyle(theme)}>{config.title}</span>
          {config.tag && (
            <Tag
              variant="filled"
              style={{
                margin: 0,
                fontSize: 10,
                lineHeight: '16px',
                height: 18,
                background: `${theme.accent}20`,
                border: 'none',
                color: theme.accent,
              }}
            >
              {config.tag}
            </Tag>
          )}
        </div>
        {headerActions && <div style={headerActionsStyle}>{headerActions}</div>}
      </div>

      {/* 主体：消息区 + 步骤条 */}
      <div style={chatBodyStyle}>
        {/* 左侧步骤条 */}
        {steps && stepsPosition === 'left' && (
          <StepsSidebar
            groups={steps.groups}
            confirmedKeys={steps.confirmedKeys}
            currentKey={steps.currentKey}
            theme={theme}
            rootTitle={steps.rootTitle}
            rootStatus={steps.rootStatus}
            onStepClick={steps.onStepClick}
            onTruncate={steps.onTruncate}
            position="left"
          />
        )}

        <div style={contentColumnStyle}>
          {welcome && messages.length === 0 ? (
            welcome
          ) : (
            <div ref={listRef} style={messageListStyle}>
              {messages.map((msg, idx) => {
                const isLastAgent = idx === messages.length - 1 && msg.role === 'agent';
                return (
                  <div key={msg.id ?? idx} style={messageRowWrapStyle}>
                    {renderMessage({
                      message: msg,
                      theme,
                      callbacks,
                      loading: loading && isLastAgent,
                      agentLabel: config.agentLabel,
                      userLabel: config.userLabel,
                    })}
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
          )}

          {completeBanner}

          {onSend && (
            <AgentInputBar
              value={inputText}
              onChange={handleInputChange}
              onSend={handleSend}
              accent={theme.accent}
              cardBorder={theme.cardBorder}
              placeholder={config.inputPlaceholder ?? '输入指令，回车发送…'}
              disabled={loading}
            />
          )}
        </div>

        {/* 右侧步骤条（默认） */}
        {steps && stepsPosition === 'right' && (
          <StepsSidebar
            groups={steps.groups}
            confirmedKeys={steps.confirmedKeys}
            currentKey={steps.currentKey}
            theme={theme}
            rootTitle={steps.rootTitle}
            rootStatus={steps.rootStatus}
            onStepClick={steps.onStepClick}
            onTruncate={steps.onTruncate}
          />
        )}
      </div>
    </div>
  );
}

// ===== 样式 =====

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
};

const headerStyle = (theme: AgentThemeTokens): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 16px',
  borderBottom: `1px solid ${theme.cardBorder}`,
  flexShrink: 0,
});

const headerLeftStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const titleStyle = (theme: AgentThemeTokens): CSSProperties => ({
  fontSize: 13,
  fontWeight: 600,
  color: theme.labelColor,
});

const headerActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const chatBodyStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
};

const contentColumnStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
};

const messageListStyle: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '12px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const messageRowWrapStyle: CSSProperties = {
  width: '100%',
  maxWidth: 800,
  margin: '0 auto',
  animation: 'messageFadeUp 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
};
