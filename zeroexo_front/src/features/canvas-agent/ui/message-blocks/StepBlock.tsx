/**
 * StepBlock - step 接口契约 UI（Plan#33 D1/D2）
 *
 * 按需触发：资料足够可跳过；资料不足时展示引导提示(上传/引用画布节点收敛目标)。
 * 快捷选项点击直接提交；底部提供「执行/跳过」操作，提交后锁定防重复。
 * 回执通过 sendAnswer 提交到后端，恢复挂起的 Agent 执行循环。
 */

import { useState } from 'react';
import { Check, ChevronRight, Paperclip } from 'lucide-react';
import type { CanvasAgentMessage } from '../types.js';
import { sendAnswer } from '../session/agent-session.js';

export function StepBlock(props: { message: CanvasAgentMessage }): React.ReactElement {
  const { message } = props;
  const step = message.step;
  const [submitted, setSubmitted] = useState(false);

  if (!step) return <></>;
  const canSkip = !(step.required ?? false);
  const prompts = step.prompts ?? [];
  const suggestions = step.suggestions ?? [];

  const submit = (value: string) => {
    if (submitted) return;
    setSubmitted(true);
    void sendAnswer(value);
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
      {/* 头部：标题 + 必选/可跳过徽标 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 7,
            background: 'rgba(99,102,241,0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <ChevronRight size={13} color="#818cf8" />
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', flex: 1, minWidth: 0 }}>
          {step.title}
        </span>
        {step.required ? (
          <span
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 5,
              background: 'rgba(233,69,96,0.12)',
              color: '#f87171',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            必选
          </span>
        ) : (
          <span
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 5,
              background: 'rgba(100,116,139,0.12)',
              color: '#94a3b8',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            可跳过
          </span>
        )}
      </div>

      {/* 描述 */}
      {step.description && (
        <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6, marginBottom: 8 }}>
          {step.description}
        </div>
      )}

      {/* 引导提示（资料不足时） */}
      {prompts.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {prompts.map((p, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '6px 10px',
                margin: '4px 0',
                background: 'rgba(99,102,241,0.05)',
                border: '1px solid rgba(99,102,241,0.15)',
                borderRadius: 8,
                fontSize: 12,
                color: '#a5b4fc',
                lineHeight: 1.5,
              }}
            >
              <Paperclip size={12} style={{ marginTop: 2, flexShrink: 0 }} color="#818cf8" />
              <span>{p}</span>
            </div>
          ))}
        </div>
      )}

      {/* 快捷选项 */}
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {suggestions.map((s) => (
            <button
              key={s.value}
              type="button"
              disabled={submitted}
              onClick={() => submit(s.value)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 12px',
                border: '1.5px solid #334155',
                borderRadius: 8,
                background: 'transparent',
                color: '#cbd5e1',
                fontSize: 12,
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: submitted ? 'default' : 'pointer',
                opacity: submitted ? 0.5 : 1,
                transition: 'all 0.15s',
              }}
            >
              <Check size={11} color="#64748b" />
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* 底部操作 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
          marginTop: 4,
          paddingTop: 8,
          borderTop: '1px solid #1e293b',
        }}
      >
        {canSkip && (
          <button
            type="button"
            disabled={submitted}
            onClick={() => submit('跳过')}
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
              cursor: submitted ? 'default' : 'pointer',
              opacity: submitted ? 0.5 : 1,
            }}
          >
            跳过
          </button>
        )}
        <button
          type="button"
          disabled={submitted}
          onClick={() => submit('确认')}
          className="agent-btn-primary"
          style={{
            padding: '4px 14px',
            border: 'none',
            borderRadius: 7,
            background: submitted ? '#334155' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: submitted ? '#64748b' : '#fff',
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'inherit',
            cursor: submitted ? 'default' : 'pointer',
          }}
        >
          {submitted ? '已确认' : '执行'}
        </button>
      </div>
    </div>
  );
}
