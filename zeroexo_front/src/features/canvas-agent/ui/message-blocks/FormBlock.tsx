/**
 * FormBlock - 内联澄清表单（Plan#36 P0-2）
 *
 * 渲染消息正文中 `<question-form>` artifact 解析出的表单：
 * - 单选（默认）：点击选项立即提交
 * - 多选（multi="true"）：勾选后点提交
 * - 自定义输入兜底（"其他想法"）
 *
 * 提交流程：formatFormAnswers → 追加用户消息 → sendMessage 作为新轮次回流
 * （答案作为下一条用户消息回到 Agent 会话，对齐 open-design question-form）。
 */

import { useState, useMemo } from 'react';
import type { QuestionData } from '../types.js';
import { formatFormAnswers } from './form-utils.js';
import { sendMessage } from '../session/agent-session.js';
import { useCanvasAgentStore } from '../store.js';

export interface FormBlockProps {
  form: QuestionData;
  /** 历史消息还原时，父消息已回答则表单只读 */
  answered?: boolean;
  /** 历史还原：从后续用户消息中解析出的答案原文 */
  restoredAnswer?: string;
}

export function FormBlock({ form, answered: initialAnswered, restoredAnswer }: FormBlockProps): React.ReactElement {
  // 历史还原：从 restoredAnswer 解析出之前的选择
  // 格式："回答：选项A、选项B" 或 "guideText\n回答：选项A"
  const restored = useMemo(() => {
    if (!initialAnswered || !restoredAnswer) return null;
    const match = restoredAnswer.match(/回答：(.+)/s);
    if (!match) return null;
    const answerText = match[1]!.trim();
    const values = answerText.split('、').map((s) => s.trim()).filter(Boolean);
    const isMulti = form.multi ?? false;
    if (isMulti) {
      // 多选：匹配选项值
      const matchedValues = new Set<string>();
      for (const v of values) {
        const item = form.items.find((it) => it.value === v || it.label === v);
        if (item) matchedValues.add(item.value);
      }
      return { multiValues: matchedValues };
    } else {
      // 单选：第一个值
      const v = values[0];
      if (!v) return null;
      const item = form.items.find((it) => it.value === v || it.label === v);
      if (item) return { selectedValue: item.value };
      return { customText: v };
    }
  }, [initialAnswered, restoredAnswer, form]);

  const [selected, setSelected] = useState<string | null>(restored?.selectedValue ?? null);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(restored?.multiValues ?? new Set());
  const [customText, setCustomText] = useState(restored?.customText ?? '');
  const [showCustom, setShowCustom] = useState(!!restored?.customText);
  const [submitted, setSubmitted] = useState(initialAnswered ?? false);

  const isMulti = form.multi ?? false;
  const total = form.items.length;
  const answered = isMulti ? multiSelected.size : selected ? 1 : 0;

  /** 提交答案：回流为新轮次用户消息（sendMessage 内部有 isGenerating 防重入） */
  const submitAnswer = (answers: string[]) => {
    if (submitted) return;
    const answerText = formatFormAnswers(form, answers);
    if (!answerText) return;
    setSubmitted(true);

    const s = useCanvasAgentStore.getState();
    s.addMessage({
      id: `msg_user_form_${Date.now()}`,
      role: 'user',
      type: 'text',
      text: answerText,
      timestamp: Date.now(),
    });
    void sendMessage(answerText);
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
      setSelected(value);
      submitAnswer([value]);
    }
  };

  const handleSubmit = () => {
    if (submitted) return;
    const answers = isMulti
      ? Array.from(multiSelected)
      : customText.trim()
        ? [customText.trim()]
        : selected
          ? [selected]
          : [];
    if (answers.length === 0) return;
    submitAnswer(answers);
  };

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 480,
        margin: '6px auto',
        padding: 12,
        background: 'linear-gradient(180deg, var(--agent-surface), var(--agent-surface-2))', /* R2：投影风格，无边线 */
        border: 'none',
        borderRadius: 12,
        boxShadow: 'var(--agent-shadow)',
        animation: 'agentFadeUp 0.35s ease',
        opacity: submitted ? 0.55 : 1,
        pointerEvents: submitted ? 'none' : 'auto',
        transition: 'opacity 0.2s',
      }}
    >
      {form.guideText && (
        <div className="agent-section-label" style={{ margin: '0 0 8px' }}>
          {form.guideText}
        </div>
      )}

      <div>
        {form.items.map((opt) => {
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
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 12.5,
                color: 'var(--agent-text)',
                textAlign: 'left',
                transition: 'all 0.15s',
              }}
            >
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

      {showCustom && (
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
              border: '1.5px solid var(--agent-border)',
              color: 'var(--agent-text)',
              fontSize: 12.5,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--agent-accent)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--agent-border)';
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
      {!showCustom && (
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

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 10,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--agent-muted)' }}>
          {answered}/{total} 已选
        </span>
        {isMulti && (
          <button
            type="button"
            onClick={handleSubmit}
            className="agent-btn-primary"
            style={{
              padding: '4px 14px',
              border: 'none',
              borderRadius: 7,
              background: answered > 0
                ? 'var(--agent-accent)'
                : 'var(--agent-border)',
              color: answered > 0 ? '#fff' : 'var(--agent-muted)',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: answered > 0 ? 'pointer' : 'default',
            }}
            disabled={answered === 0}
          >
            提交
          </button>
        )}
      </div>
    </div>
  );
}
