/**
 * TypingText - 打字机正文组件
 *
 * 源自 references/动效参考/ai/AIStreamingResponse.tailwind.jsx
 * 提取核心视觉：闪烁光标、字符逐字揭示、safeSlice 避免标签截断
 * 差异：受控组件，接收 text prop 增量更新
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAgentTheme } from '../context/theme-context.js';
import { StopCircle } from 'lucide-react';
import DOMPurify from 'dompurify';

export interface TypingTextProps {
  /** 完整文本内容（增量更新） */
  text: string;
  /** 是否正在流式输出 */
  streaming?: boolean;
  /** 停止生成回调 */
  onStop?: () => void;
  /** 是否显示 token 计数 */
  showTokens?: boolean;
}

/** 安全截断 HTML，不截断在标签中间 */
function safeSlice(html: string, count: number): string {
  let visible = 0;
  let i = 0;
  let inTag = false;
  while (i < html.length && visible < count) {
    if (html[i] === '<') inTag = true;
    if (!inTag) visible++;
    if (html[i] === '>') inTag = false;
    i++;
  }
  while (i < html.length && inTag) {
    if (html[i] === '>') { i++; break; }
    i++;
  }
  return html.slice(0, i);
}

function stripLen(html: string): number {
  return html.replace(/<[^>]*>/g, '').length;
}

export function TypingText({
  text,
  streaming = false,
  onStop,
  showTokens = true,
}: TypingTextProps): React.ReactElement {
  const t = useAgentTheme();
  const contentRef = useRef<HTMLDivElement>(null);
  const [displayLen, setDisplayLen] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tokens, setTokens] = useState(0);
  const [finished, setFinished] = useState(false);

  // 先整体消毒,再对安全 HTML 做 tag-aware 切片,防止用户/AI 内容注入 XSS
  const safeText = useMemo(() => DOMPurify.sanitize(text), [text]);
  const totalLen = stripLen(safeText);

  // 重置当文本变化
  useEffect(() => {
    setDisplayLen(0);
    setTokens(0);
    setFinished(false);
  }, [text]);

  // 流式打字效果
  useEffect(() => {
    if (!streaming || !text) {
      if (text && !streaming) {
        setDisplayLen(totalLen);
        setFinished(true);
      }
      return;
    }

    const chunk = 2 + Math.floor(Math.random() * 5);
    timerRef.current = setInterval(() => {
      setDisplayLen((prev) => {
        const next = prev + chunk;
        setTokens((t) => t + 1);
        if (next >= totalLen) {
          clearInterval(timerRef.current!);
          setFinished(true);
          return totalLen;
        }
        return next;
      });
    }, 45);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [streaming, text, totalLen]);

  // 显示完成时自动显示全部
  useEffect(() => {
    if (!streaming && text) {
      setDisplayLen(totalLen);
      setFinished(true);
    }
  }, [streaming, text, totalLen]);

  const containerStyle: CSSProperties = {
    fontSize: 13,
    lineHeight: 1.7,
    color: t.isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)',
    minHeight: 24,
    position: 'relative',
  };

  const displayed = safeSlice(safeText, displayLen);

  return (
    <div>
      <div ref={contentRef} style={containerStyle}>
        <span dangerouslySetInnerHTML={{ __html: displayed }} />
        {streaming && !finished && (
          <span className="agent-typing-cursor" />
        )}
      </div>

      {/* 底部工具栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 6,
          opacity: streaming || finished ? 1 : 0,
          transition: 'opacity 0.3s',
        }}
      >
        {showTokens && (
          <span
            style={{
              fontSize: 11,
              color: t.isDark ? '#475569' : '#94a3b8',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {tokens} tokens
          </span>
        )}

        {streaming && onStop && (
          <button
            type="button"
            onClick={onStop}
            style={stopBtnStyle(t)}
            title="停止生成"
          >
            <StopCircle size={14} />
            <span>停止</span>
          </button>
        )}
      </div>
    </div>
  );
}

const stopBtnStyle = (t: ReturnType<typeof useAgentTheme>): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 12px',
  borderRadius: 16,
  border: `1px solid ${t.border}`,
  background: 'transparent',
  color: t.textMuted,
  fontSize: 11.5,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'all 0.15s',
});