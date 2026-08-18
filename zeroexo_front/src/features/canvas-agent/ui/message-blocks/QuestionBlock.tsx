/**
 * QuestionBlock - 单问题快速选择壳
 *
 * 参考 tvc-agent (2).html 设计，100% 复刻样式：
 * - 选项卡片列表（poll-opt 风格）
 * - 进度条 + 百分比
 * - 自定义输入
 */

import { useState } from 'react';
import type { CanvasAgentMessage } from '../types.js';

export interface QuestionBlockProps {
  message: CanvasAgentMessage;
  onSelect?: (value: string) => void;
}

export function QuestionBlock({ message, onSelect }: QuestionBlockProps): React.ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const data = message.question;
  if (!data) return <></>;

  const isMulti = data.multi ?? false;
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const total = data.items.length;
  const answered = isMulti ? multiSelected.size : selected ? 1 : 0;

  const handleSelect = (value: string) => {
    if (isMulti) {
      setMultiSelected((prev) => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
    } else {
      setSelected(value);
      onSelect?.(value);
    }
  };

  const handleSubmit = () => {
    if (isMulti) {
      onSelect?.(Array.from(multiSelected).join(','));
    }
  };

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
      {data.guideText && (
        <div className="agent-section-label" style={{ margin: '0 0 8px' }}>
          {data.guideText}
        </div>
      )}

      {/* 选项列表 */}
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
                background: isActive ? 'rgba(99,102,241,0.06)' : '#0d1220',
                border: `1.5px solid ${isActive ? '#6366f1' : '#1e293b'}`,
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
                  borderRadius: isMulti ? 4 : '50%',
                  border: `2px solid ${isActive ? '#6366f1' : '#334155'}`,
                  background: isActive ? '#6366f1' : 'transparent',
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
                <span style={{ fontWeight: 500, color: isActive ? '#a5b4fc' : '#e2e8f0' }}>
                  {opt.label}
                </span>
                {opt.desc && (
                  <span style={{ display: 'block', fontSize: 10.5, color: '#64748b', marginTop: 2 }}>
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
                    background: '#312e81',
                    color: '#a5b4fc',
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

      {/* 其他想法输入 */}
      {showCustom && (
        <input
          type="text"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder="输入其他想法…"
          className="agent-form-input"
          style={{
            width: '100%',
            marginTop: 8,
            padding: '8px 11px',
            borderRadius: 7,
            background: '#0d1220',
            border: '1.5px solid #1e293b',
            color: '#e2e8f0',
            fontSize: 12.5,
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = '#6366f1'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = '#1e293b'; }}
        />
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
            color: '#64748b',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          其他想法…
        </button>
      )}

      {/* 底部 */}
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
                ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                : '#334155',
              color: answered > 0 ? '#fff' : '#64748b',
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