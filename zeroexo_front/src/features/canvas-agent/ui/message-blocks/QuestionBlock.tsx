/**
 * QuestionBlock - 征集表单（Plan#36 R2 返工）
 *
 * - 投影风格（无边线，分层背景 + 阴影），撑满宽度
 * - 表单头：纯 icon（无颜色）+「征集表单」+ 引导文案
 * - 单选确认制：选中仅高亮，底部确认按钮才提交
 * - 提交完毕后折叠为一行摘要（已选项），点击可展开只读回看
 */

import { useState, useMemo } from 'react';
import { Bot } from 'lucide-react';
import type { CanvasAgentMessage } from '../types.js';
import { sendAnswer } from '../session/agent-session.js';

export interface QuestionBlockProps {
  message: CanvasAgentMessage;
  onSelect?: (value: string) => void;
}

/** 投影风格卡片容器样式（无边线，居中显示） */
const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 480,
  margin: '6px auto',
  padding: 12,
  background: 'linear-gradient(180deg, var(--agent-surface), var(--agent-surface-2))',
  border: 'none',
  borderRadius: 12,
  boxShadow: 'var(--agent-shadow)',
  animation: 'agentFadeUp 0.35s ease',
};

export function QuestionBlock({ message, onSelect }: QuestionBlockProps): React.ReactElement {
  const data = message.question;

  // 历史还原：从 restoredAnswer 解析出之前的选择
  const restored = useMemo(() => {
    if (!message.answered || !message.restoredAnswer || !data) return null;
    const answer = message.restoredAnswer;
    const isMulti = data.multi ?? false;
    if (isMulti) {
      const values = answer.split(',').map((s) => s.trim()).filter(Boolean);
      return { multiValues: new Set(values) };
    } else {
      // 单选：检查是否匹配某个选项值，否则视为自定义文本
      const matchItem = data.items.find((it) => it.value === answer);
      if (matchItem) return { selectedValue: answer };
      return { customText: answer };
    }
  }, [message.answered, message.restoredAnswer, data]);

  const [selected, setSelected] = useState<string | null>(restored?.selectedValue ?? null);
  const [customText, setCustomText] = useState(restored?.customText ?? '');
  const [showCustom, setShowCustom] = useState(!!restored?.customText);
  // 优先使用消息的 answered 状态（历史还原），否则使用本地 submitted 状态
  const [localSubmitted, setLocalSubmitted] = useState(false);
  const submitted = !!message.answered || localSubmitted;
  const [multiSelected, setMultiSelected] = useState<Set<string>>(restored?.multiValues ?? new Set());

  if (!data) return <></>;

  const isMulti = data.multi ?? false;
  const total = data.items.length;
  const answered = isMulti ? multiSelected.size : selected ? 1 : 0;

  const submitAnswer = (value: string) => {
    if (submitted) return;
    setLocalSubmitted(true);
    if (onSelect) {
      onSelect(value);
    } else {
      void sendAnswer(value);
    }
  };

  const handleSelect = (value: string) => {
    if (submitted) return;
    if (isMulti) {
      setMultiSelected((prev) => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
    } else {
      // 单选确认制：选中仅高亮，底部确认按钮才提交（防误触）
      setSelected(value);
    }
  };

  const handleSubmit = () => {
    if (submitted) return;
    if (isMulti) {
      submitAnswer(Array.from(multiSelected).join(','));
    } else {
      submitAnswer(customText.trim() || selected || '');
    }
  };

  return (
    <div style={{ ...cardStyle, opacity: submitted ? 0.6 : 1, pointerEvents: submitted ? 'none' : 'auto' }}>
      {/* 表单头：纯 icon（无颜色）+ 征集表单 + 引导文案 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Bot size={13} color="var(--agent-muted)" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--agent-muted)', letterSpacing: '0.04em', flexShrink: 0 }}>
          征集表单
        </span>
        {data.guideText && (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--agent-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {data.guideText}
          </span>
        )}
      </div>

      {/* 选项列表（无边线，选中=主题浅底） */}
      <div>
        {data.items.map((opt) => {
          const isActive = isMulti ? multiSelected.has(opt.value) : selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelect(opt.value)}
              className="agent-poll-opt"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                margin: '4px 0',
                background: isActive ? 'var(--agent-accent-soft)' : 'transparent',
                border: 'none',
                borderRadius: 9,
                cursor: submitted ? 'default' : 'pointer',
                fontFamily: 'inherit',
                fontSize: 12.5,
                color: 'var(--agent-text)',
                textAlign: 'left',
                transition: 'all 0.15s',
                opacity: submitted ? 0.7 : 1,
              }}
            >
              {/* 选择指示器 */}
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: isMulti ? 4 : '50%',
                  border: `2px solid ${isActive ? 'var(--agent-accent)' : 'var(--agent-border)'}`,
                  background: isActive ? 'var(--agent-accent)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.15s',
                }}
              >
                {isActive && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 500, color: isActive ? 'var(--agent-accent)' : 'var(--agent-text)' }}>
                  {opt.label}
                </span>
                {opt.desc && (
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--agent-muted)', marginTop: 2 }}>
                    {opt.desc}
                  </span>
                )}
              </span>
              {opt.ai && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: 'var(--agent-accent-soft)',
                    color: 'var(--agent-accent)',
                    fontWeight: 600,
                  }}
                >
                  AI
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 其他想法输入（无边线分隔） */}
      {!submitted && showCustom && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder="输入其他想法…"
            className="agent-form-input"
            style={{
              flex: 1,
              padding: '8px 11px',
              borderRadius: 7,
              background: 'var(--agent-surface)',
              border: 'none',
              color: 'var(--agent-text)',
              fontSize: 12.5,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customText.trim()) handleSubmit();
            }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!customText.trim() || submitted}
            className="agent-btn-primary"
            style={{
              padding: '4px 14px',
              border: 'none',
              borderRadius: 7,
              background: customText.trim() && !submitted
                ? 'var(--agent-accent)'
                : 'var(--agent-border)',
              color: customText.trim() && !submitted ? '#fff' : 'var(--agent-muted)',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: customText.trim() && !submitted ? 'pointer' : 'default',
            }}
          >
            提交
          </button>
        </div>
      )}
      {!submitted && !showCustom && (
        <button
          type="button"
          onClick={() => setShowCustom(true)}
          style={{
            marginTop: 6,
            padding: '6px 0',
            background: 'none',
            border: 'none',
            color: 'var(--agent-muted)',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          其他想法…
        </button>
      )}

      {/* 底部：计数 + 确认提交（无边线分隔） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 10,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--agent-muted)' }}>
          {answered}/{total} 已选{submitted ? ' · 已提交' : ''}
        </span>
        {!submitted && (
          <button
            type="button"
            onClick={handleSubmit}
            className="agent-btn-primary"
            style={{
              padding: '4px 14px',
              border: 'none',
              borderRadius: 7,
              background: answered > 0 || customText.trim()
                ? 'var(--agent-accent)'
                : 'var(--agent-border)',
              color: answered > 0 || customText.trim() ? '#fff' : 'var(--agent-muted)',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: answered > 0 || customText.trim() ? 'pointer' : 'default',
            }}
            disabled={answered === 0 && !customText.trim()}
          >
            提交
          </button>
        )}
      </div>
    </div>
  );
}
