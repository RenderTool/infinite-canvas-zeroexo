/**
 * TextRenderer - 通用文本消息渲染器（内置 'text' 类型）
 *
 * 通用气泡布局：头像 + 名称 + 气泡（含轻量 Markdown：粗体/斜体/行内代码/链接）。
 * 通过 AgentThemeTokens 注入主题，不依赖任何业务主题系统。
 * 业务模块如需要专属排版，可注册自定义类型或覆盖 'text'。
 */

import { useState, useCallback, type CSSProperties, type ReactNode } from 'react';
import { Copy, Trash2, Check } from 'lucide-react';
import { Tooltip } from 'antd';
import type { MessageRendererProps } from '../types.js';
import { AgentAvatar } from '../components/AgentAvatar.js';

/** 仅允许 http/https/mailto 协议的链接,拒绝 javascript:/data: 等危险 scheme */
function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url, 'http://localhost');
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function parseInline(text: string, color: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[2] !== undefined) {
      nodes.push(<strong key={key++} style={{ fontWeight: 700 }}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      nodes.push(<em key={key++}>{match[3]}</em>);
    } else if (match[4] !== undefined) {
      nodes.push(
        <code key={key++} style={{
          padding: '1px 5px',
          borderRadius: 3,
          fontSize: '0.88em',
          background: 'rgba(128,128,128,0.15)',
          fontFamily: 'monospace',
        }}>
          {match[4]}
        </code>,
      );
    } else if (match[5] !== undefined && match[6] !== undefined) {
      const href = match[6];
      if (isSafeUrl(href)) {
        nodes.push(
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer"
            style={{ color, textDecoration: 'underline' }}>
            {match[5]}
          </a>,
        );
      } else {
        // 不安全 scheme 不渲染为可点击链接
        nodes.push(<span key={key++}>{match[5]}</span>);
      }
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function TypingIndicator({ accent }: { accent: string }): React.ReactElement {
  const dotStyle = (delay: number): CSSProperties => ({
    display: 'inline-block',
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: accent,
    opacity: 0.3,
    animation: `chatTypingBlink 1.4s ${delay}s infinite`,
  });
  return (
    <span style={{ display: 'inline-flex', gap: 3, marginLeft: 4, verticalAlign: 'middle' }}>
      {[0, 0.2, 0.4].map((delay, i) => (
        <span key={i} style={dotStyle(delay)} />
      ))}
    </span>
  );
}

export function TextRenderer({ message, theme, callbacks, loading, agentLabel, userLabel }: MessageRendererProps): React.ReactElement {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const isAgent = message.role === 'agent';
  const name = isAgent ? agentLabel ?? 'AI 助手' : userLabel ?? '你';

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.text ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [message.text]);

  const rowStyle: CSSProperties = {
    display: 'flex',
    gap: 10,
    width: '100%',
    flexDirection: isAgent ? 'row' : 'row-reverse',
  };

  const avatar: ReactNode = isAgent ? (
    <AgentAvatar accent={theme.accent} isDark={theme.isDark} size={36} online />
  ) : (
    <div style={{
      width: 36,
      height: 36,
      borderRadius: 10,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      background: theme.isDark ? `${theme.accent}18` : `${theme.accent}12`,
      border: `1px solid ${theme.isDark ? `${theme.accent}45` : `${theme.accent}35`}`,
      color: theme.accent,
      fontSize: 12,
      fontWeight: 700,
    }}>
      <span>{name.slice(0, 1)}</span>
    </div>
  );

  const bubbleStyle: CSSProperties = {
    padding: '9px 13px',
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    ...(isAgent
      ? {
          background: theme.cardBg,
          border: `1px solid ${theme.cardBorder}`,
          color: theme.labelColor,
          borderRadius: '4px 12px 12px 12px',
        }
      : {
          background: theme.isDark ? `${theme.accent}22` : `${theme.accent}12`,
          border: '1px solid transparent',
          color: theme.labelColor,
          borderRadius: '12px 4px 12px 12px',
        }),
  };

  return (
    <div
      style={rowStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {avatar}
      <div style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: isAgent ? 'flex-start' : 'flex-end',
      }}>
        <div style={{
          fontSize: 12,
          color: theme.mutedColor,
          marginBottom: 4,
          fontWeight: 600,
        }}>
          {name}
        </div>
        <div style={bubbleStyle}>
          {isAgent ? (
            <span>{parseInline(message.text ?? '', theme.labelColor)}</span>
          ) : (
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message.text}</span>
          )}
          {loading && <TypingIndicator accent={theme.accent} />}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '4px 0',
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.15s',
        }}>
          <Tooltip title="复制"><div onClick={handleCopy} style={actionBtnStyle(theme.mutedColor)}>
            {copied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
          </div></Tooltip>
          {callbacks.onDeleteMessage && (
            <Tooltip title="删除"><div onClick={() => callbacks.onDeleteMessage?.(message)} style={actionBtnStyle(theme.mutedColor)}>
              <Trash2 size={13} />
            </div></Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

const actionBtnStyle = (muted: string): CSSProperties => ({
  width: 26,
  height: 26,
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: muted,
});
