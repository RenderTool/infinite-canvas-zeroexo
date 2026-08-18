/**
 * ClarifyBlock - 问题澄清面板
 *
 * 参考 tvc-agent (2).html 设计，100% 复刻样式：
 * - 选项卡片列表（poll-opt 风格）
 * - 单选/多选/文本输入
 * - 进度指示
 */

import { useState, useMemo } from 'react';
import type { CanvasAgentMessage, ClarifyAnswer } from '../types.js';
import { getSimulationResume } from '../store.js';

export function ClarifyBlock(props: { message: CanvasAgentMessage }): React.ReactElement {
  const { message } = props;
  const items = message.clarifyItems ?? [];

  // 答案状态
  const [answers, setAnswers] = useState<Record<string, {
    itemId: string;
    values?: string[];
    text?: string;
    skipped?: boolean;
  }>>({});
  const [submitting, setSubmitting] = useState(false);

  const total = items.length;
  const answered = useMemo(
    () => items.filter((item) => {
      const a = answers[item.itemId];
      if (!a) return false;
      if (a.skipped) return true;
      if (item.kind === 'text') return (a.text ?? '').trim().length > 0;
      if (item.kind === 'single' || item.kind === 'multi') return (a.values ?? []).length > 0;
      return false;
    }).length,
    [items, answers],
  );

  const handleSelect = (itemId: string, value: string) => {
    setAnswers((prev) => {
      const item = items.find((i) => i.itemId === itemId);
      if (!item) return prev;
      const current = prev[itemId] ?? { itemId, values: [] };
      if (item.kind === 'single') {
        return { ...prev, [itemId]: { ...current, values: [value] } };
      }
      // multi
      const vals = current.values ?? [];
      const next = vals.includes(value)
        ? vals.filter((v) => v !== value)
        : [...vals, value];
      return { ...prev, [itemId]: { ...current, values: next } };
    });
  };

  const handleTextChange = (itemId: string, text: string) => {
    setAnswers((prev) => ({
      ...prev,
      [itemId]: { itemId, text },
    }));
  };

  const handleSkip = (itemId: string) => {
    setAnswers((prev) => ({
      ...prev,
      [itemId]: { itemId, skipped: true },
    }));
  };

  const handleSubmit = () => {
    setSubmitting(true);
    const resume = getSimulationResume();
    if (resume) {
      const answerList: ClarifyAnswer[] = items.map((item) => {
        const a = answers[item.itemId];
        if (!a || a.skipped) return { itemId: item.itemId, value: [] };
        if (item.kind === 'text') return { itemId: item.itemId, value: a.text ?? '' };
        return { itemId: item.itemId, value: a.values ?? [] };
      });
      resume(answerList);
    }
  };

  const handleSkipAll = () => {
    setSubmitting(true);
    const resume = getSimulationResume();
    if (resume) {
      resume(items.map((item) => ({ itemId: item.itemId, value: [] })));
    }
  };

  if (items.length === 0) return <></>;

  return (
    <div
      style={{
        width: '100%',
        margin: '6px 0',
        padding: 12,
        background: '#0d1220',
        border: '1px solid #1e293b',
        borderRadius: 10,
        animation: 'agentFadeUp 0.35s ease',
      }}
    >
      {/* 引导文案 */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1', marginBottom: 10 }}>
        {message.text || '开始前需要确认几件事'}
      </div>

      {/* 选项列表 */}
      {items.map((item) => {
        const a = answers[item.itemId];
        if (a?.skipped) return null;

        return (
          <div key={item.itemId} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 500 }}>
              {item.question}
              {item.required && <span style={{ color: '#f87171', marginLeft: 4 }}>*</span>}
            </div>

            {/* 文本输入 */}
            {item.kind === 'text' && (
              <div style={{ position: 'relative' }}>
                <textarea
                  value={a?.text ?? ''}
                  onChange={(e) => handleTextChange(item.itemId, e.target.value)}
                  placeholder="输入…"
                  className="agent-form-textarea"
                  style={{
                    width: '100%',
                    padding: '8px 11px',
                    borderRadius: 7,
                    background: '#0d1220',
                    border: '1.5px solid #1e293b',
                    color: '#e2e8f0',
                    fontSize: 12.5,
                    fontFamily: 'inherit',
                    outline: 'none',
                    resize: 'vertical',
                    minHeight: 48,
                    lineHeight: 1.5,
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#6366f1'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#1e293b'; }}
                />
              </div>
            )}

            {/* 单选/多选选项 */}
            {(item.kind === 'single' || item.kind === 'multi') && item.options && (
              <div>
                {item.options.map((opt) => {
                  const isSelected = (a?.values ?? []).includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleSelect(item.itemId, opt.value)}
                      className="agent-poll-opt"
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '9px 12px',
                        margin: '4px 0',
                        background: '#0d1220',
                        border: `1.5px solid ${isSelected ? '#6366f1' : '#1e293b'}`,
                        borderRadius: 9,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 12.5,
                        color: '#cbd5e1',
                        textAlign: 'left',
                        transition: 'all 0.15s',
                      }}
                    >
                      {/* 选择指示器 */}
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: item.kind === 'multi' ? 4 : '50%',
                          border: `2px solid ${isSelected ? '#6366f1' : '#334155'}`,
                          background: isSelected ? '#6366f1' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'all 0.15s',
                        }}
                      >
                        {isSelected && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </span>
                      <span style={{ flex: 1 }}>
                        <span style={{ fontWeight: 500, color: isSelected ? '#a5b4fc' : '#e2e8f0' }}>
                          {opt.label}
                        </span>
                        {opt.desc && (
                          <span style={{ display: 'block', fontSize: 10.5, color: '#64748b', marginTop: 2 }}>
                            {opt.desc}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 非必填可跳过 */}
            {!item.required && !a?.skipped && (
              <button
                type="button"
                onClick={() => handleSkip(item.itemId)}
                style={{
                  marginTop: 4,
                  padding: '2px 8px',
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                跳过
              </button>
            )}
          </div>
        );
      })}

      {/* 底部操作栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 10,
          paddingTop: 8,
          borderTop: '1px solid #1e293b',
        }}
      >
        <span style={{ fontSize: 11, color: '#64748b' }}>
          {answered}/{total} 已填
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={handleSkipAll}
            className="agent-btn-secondary"
            style={{
              padding: '4px 12px',
              border: '1.5px solid #334155',
              borderRadius: 7,
              background: 'transparent',
              color: '#94a3b8',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            跳过全部
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="agent-btn-primary"
            style={{
              padding: '4px 14px',
              border: 'none',
              borderRadius: 7,
              background: answered > 0
                ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                : '#334155',
              color: answered > 0 ? '#fff' : '#64748b',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: answered > 0 ? 'pointer' : 'default',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            提交
          </button>
        </div>
      </div>
    </div>
  );
}