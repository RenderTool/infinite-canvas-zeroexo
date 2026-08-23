/**
 * ParamsBlock - 节点参数契约表单（R3 F1）
 *
 * 渲染 request_params 协议（agent:params_request → params 消息）：
 * - 自动方案卡（presets）：点击一键填入字段值（「自动」给几套方案）
 * - 标准参数选项表单（fields）：select / text / number / boolean 四类字段
 * - 备注输入框（noteLabel）：进一步修改提示
 *
 * 提交流程：格式化答案 JSON → sendAnswer 作为新一轮消息回流
 * （对齐 QuestionBlock 回执机制，R2 无状态回合）；提交后折叠为摘要行。
 */

import { useState } from 'react';
import { Settings2, Wand2, ChevronRight } from 'lucide-react';
import type { CanvasAgentMessage } from '../types.js';
import { useCanvasAgentStore } from '../store.js';
import { sendAnswer } from '../session/agent-session.js';

/** 投影风格卡片容器样式（无边线，对齐 QuestionBlock） */
const cardStyle: React.CSSProperties = {
  width: '100%',
  margin: '6px 0',
  padding: 12,
  background: 'linear-gradient(180deg, var(--agent-surface), var(--agent-surface-2))',
  border: 'none',
  borderRadius: 12,
  boxShadow: 'var(--agent-shadow)',
  animation: 'agentFadeUp 0.35s ease',
};

/** 字段值状态（key → 值） */
type FieldValues = Record<string, string | number | boolean>;

export function ParamsBlock(props: { message: CanvasAgentMessage }): React.ReactElement {
  const { message } = props;
  const data = message.params;
  const updateMessage = useCanvasAgentStore((s) => s.updateMessage);
  const [values, setValues] = useState<FieldValues>(() => {
    const init: FieldValues = {};
    for (const f of data?.fields ?? []) {
      if (f.default !== undefined) init[f.key] = f.default;
    }
    return init;
  });
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [folded, setFolded] = useState(false);

  if (!data) return <></>;

  const answered = message.paramsAnswered === true || submitted;
  const fields = data.fields ?? [];
  const presets = data.presets ?? [];
  const filledCount = Object.keys(values).length;

  const setField = (key: string, value: string | number | boolean) => {
    if (answered) return;
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  /** 点击「自动」方案：一键填入字段值 */
  const applyPreset = (name: string, presetValues: FieldValues) => {
    if (answered) return;
    setValues((prev) => ({ ...prev, ...presetValues }));
    setActivePreset((prev) => (prev === name ? null : name));
  };

  const handleSubmit = () => {
    if (answered) return;
    setSubmitted(true);
    setFolded(true);
    const payload: Record<string, unknown> = {
      nodeType: data.nodeType,
      values,
    };
    if (activePreset) payload.preset = activePreset;
    if (note.trim()) payload.note = note.trim();
    updateMessage(message.id, { paramsAnswered: true });
    void sendAnswer(`参数表单确认: ${JSON.stringify(payload)}`);
  };

  // ===== 折叠摘要行（提交后，对齐 QuestionBlock R2） =====
  if (folded && answered) {
    const summary = activePreset
      ? `${activePreset}${note.trim() ? ' · 备注已附' : ''}`
      : `${filledCount} 项参数${note.trim() ? ' · 备注已附' : ''}`;
    return (
      <button
        type="button"
        onClick={() => setFolded(false)}
        style={{
          ...cardStyle,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <Settings2 size={13} color="var(--agent-muted)" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--agent-muted)', flexShrink: 0 }}>
          参数表单
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            color: 'var(--agent-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          已提交：{summary || '—'}
        </span>
        <ChevronRight size={12} color="var(--agent-muted)" style={{ flexShrink: 0 }} />
      </button>
    );
  }

  return (
    <div style={cardStyle}>
      {/* 表单头：icon + 参数表单 + 标题 + 节点类型徽标 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Settings2 size={13} color="var(--agent-muted)" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--agent-muted)', letterSpacing: '0.04em', flexShrink: 0 }}>
          参数表单
        </span>
        {data.title && (
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
            {data.title}
          </span>
        )}
        {data.nodeType && (
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 4,
              background: 'var(--agent-accent-soft)',
              color: 'var(--agent-accent)',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {data.nodeType}
          </span>
        )}
      </div>

      {/* 自动方案区（点击一键填入） */}
      {presets.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, color: 'var(--agent-muted)', marginBottom: 5, fontWeight: 600 }}>
            自动方案（点击填入）
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {presets.map((p) => {
              const isActive = activePreset === p.name;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => applyPreset(p.name, p.values)}
                  disabled={answered}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 10px',
                    border: 'none',
                    borderRadius: 8,
                    background: isActive ? 'var(--agent-accent)' : 'var(--agent-surface)',
                    color: isActive ? '#fff' : 'var(--agent-text)',
                    fontSize: 11.5,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    cursor: answered ? 'default' : 'pointer',
                    opacity: answered ? 0.6 : 1,
                    transition: 'all 0.15s',
                    boxShadow: isActive ? 'none' : 'var(--agent-shadow)',
                  }}
                  title={p.desc}
                >
                  <Wand2 size={11} style={{ flexShrink: 0 }} />
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 标准参数选项表单 */}
      {fields.length > 0 && (
        <div>
          {fields.map((f) => (
            <div key={f.key} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11.5, color: 'var(--agent-text)', marginBottom: 4, fontWeight: 500 }}>
                {f.label}
                {f.desc && (
                  <span style={{ fontSize: 10, color: 'var(--agent-muted)', marginLeft: 6, fontWeight: 400 }}>
                    {f.desc}
                  </span>
                )}
              </div>
              {f.type === 'select' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {(f.options ?? []).map((opt) => {
                    const isActive = String(values[f.key]) === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setField(f.key, opt.value)}
                        disabled={answered}
                        style={{
                          padding: '4px 10px',
                          border: 'none',
                          borderRadius: 7,
                          background: isActive ? 'var(--agent-accent)' : 'var(--agent-surface)',
                          color: isActive ? '#fff' : 'var(--agent-text)',
                          fontSize: 11.5,
                          fontWeight: 500,
                          fontFamily: 'inherit',
                          cursor: answered ? 'default' : 'pointer',
                          opacity: answered ? 0.6 : 1,
                          transition: 'all 0.15s',
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {f.type === 'text' && (
                <input
                  type="text"
                  value={String(values[f.key] ?? '')}
                  onChange={(e) => setField(f.key, e.target.value)}
                  disabled={answered}
                  placeholder={`输入${f.label}…`}
                  className="agent-form-input"
                  style={{
                    width: '100%',
                    padding: '7px 11px',
                    borderRadius: 7,
                    background: 'var(--agent-surface)',
                    border: 'none',
                    color: 'var(--agent-text)',
                    fontSize: 12.5,
                    fontFamily: 'inherit',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              )}
              {f.type === 'number' && (
                <input
                  type="number"
                  value={values[f.key] === undefined ? '' : String(values[f.key])}
                  onChange={(e) => setField(f.key, Number(e.target.value))}
                  disabled={answered}
                  className="agent-form-input"
                  style={{
                    width: '100%',
                    padding: '7px 11px',
                    borderRadius: 7,
                    background: 'var(--agent-surface)',
                    border: 'none',
                    color: 'var(--agent-text)',
                    fontSize: 12.5,
                    fontFamily: 'inherit',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              )}
              {f.type === 'boolean' && (
                <button
                  type="button"
                  onClick={() => setField(f.key, !Boolean(values[f.key]))}
                  disabled={answered}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 10px',
                    border: 'none',
                    borderRadius: 7,
                    background: Boolean(values[f.key]) ? 'var(--agent-accent-soft)' : 'var(--agent-surface)',
                    color: 'var(--agent-text)',
                    fontSize: 11.5,
                    fontFamily: 'inherit',
                    cursor: answered ? 'default' : 'pointer',
                    opacity: answered ? 0.6 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 14,
                      borderRadius: 7,
                      background: Boolean(values[f.key]) ? 'var(--agent-accent)' : 'var(--agent-border)',
                      position: 'relative',
                      transition: 'all 0.15s',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: 2,
                        left: Boolean(values[f.key]) ? 14 : 2,
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: '#fff',
                        transition: 'left 0.15s',
                      }}
                    />
                  </span>
                  {Boolean(values[f.key]) ? '开启' : '关闭'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 备注/进一步修改提示 */}
      <div style={{ marginTop: 6 }}>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={answered}
          placeholder={data.noteLabel ?? '备注 / 进一步修改提示…'}
          className="agent-form-input"
          style={{
            width: '100%',
            padding: '7px 11px',
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
            if (e.key === 'Enter' && (filledCount > 0 || fields.length === 0)) handleSubmit();
          }}
        />
      </div>

      {/* 底部：计数 + 确认提交（无边线分隔，对齐 QuestionBlock） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 10,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--agent-muted)' }}>
          {filledCount}/{fields.length} 项已填{answered ? ' · 已提交' : ''}
        </span>
        {!answered && (
          <button
            type="button"
            onClick={handleSubmit}
            className="agent-btn-primary"
            style={{
              padding: '4px 14px',
              border: 'none',
              borderRadius: 7,
              background: fields.length === 0 || filledCount > 0
                ? 'var(--agent-accent)'
                : 'var(--agent-border)',
              color: fields.length === 0 || filledCount > 0 ? '#fff' : 'var(--agent-muted)',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: fields.length === 0 || filledCount > 0 ? 'pointer' : 'default',
            }}
            disabled={fields.length > 0 && filledCount === 0}
          >
            提交
          </button>
        )}
      </div>
    </div>
  );
}
