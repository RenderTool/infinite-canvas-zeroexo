/**
 * ParamsBlock - 节点参数契约表单（R3 F1；2026-08-23 对齐 admin ParameterDef）
 *
 * 渲染 request_params 协议（agent:params_request → params 消息）：
 * - 自动方案卡（presets）：点击一键填入字段值（「自动」给几套方案）
 * - 标准参数选项表单（fields）：六类型渲染器，对齐 admin 参数模板解析规则——
 *   enum（≤5 项 radio 胶囊 / >5 项或 display=select 下拉，labels/valueTooltips 支持）
 *   / number（min/max/step）/ boolean（开关）/ size（宽×高联动 + 锁定比例 + AUTO 提示）
 *   / string（多行文本）/ images（参考图列表）
 * - 备注输入框（noteLabel）：进一步修改提示
 *
 * 2026-08-23 修订（用户反馈：透明 + 无法删除 + 未复刻 admin 解析规则）：
 * - 控件背景不透明化（surface-2 + 边框），下拉面板纯色 --agent-bg
 * - radio 胶囊点击已选中项可取消；下拉带清除按钮（allowClear）
 * - 兼容旧协议：type select→enum、text→string，key→name，options→values/labels
 *
 * 提交流程：格式化答案 JSON → sendAnswer 作为新一轮消息回流
 * （对齐 QuestionBlock 回执机制，R2 无状态回合）；提交后折叠为摘要行。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings2, Wand2, ChevronRight, ChevronDown, X, Link, Unlink, Paperclip } from 'lucide-react';
import type { CanvasAgentMessage, ParamFieldData } from '../types.js';
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
type FieldValues = Record<string, any>;

/** 输入类控件统一样式（不透明化：surface-2 + 边框，2026-08-23） */
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 11px',
  borderRadius: 7,
  background: 'var(--agent-surface-2)',
  border: '1px solid var(--agent-border)',
  color: 'var(--agent-text)',
  fontSize: 12.5,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
};

/** 兼容旧协议：select→enum、text→string；key→name；options→values/labels（2026-08-23） */
function normalizeField(raw: ParamFieldData): ParamFieldData {
  const base: ParamFieldData = {
    name: raw.name ?? (raw as any).key ?? '',
    label: raw.label,
    type: raw.type === 'select' ? 'enum' : raw.type === 'text' ? 'string' : raw.type,
    default: raw.default,
    tooltip: raw.tooltip,
    placeholder: raw.placeholder,
    required: raw.required,
    min: raw.min,
    max: raw.max,
    step: raw.step,
    maxCount: raw.maxCount,
    desc: raw.desc,
  };
  if (raw.type === 'select' || raw.type === 'enum') {
    const values = raw.values ?? raw.options?.map((o) => o.value) ?? [];
    const labels = raw.labels ?? Object.fromEntries((raw.options ?? []).map((o) => [o.value, o.label]));
    return { ...base, type: 'enum', values, labels, display: raw.display, valueTooltips: raw.valueTooltips };
  }
  return base;
}

/** 枚举显示名：labels 优先，缺省首字母大写（对齐 admin getEnumLabel） */
function enumLabel(f: ParamFieldData, v: string): string {
  if (f.labels?.[v]) return f.labels[v];
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/** enum 展示形式：display 指定优先，缺省 ≤5 项 radio、>5 项 select（对齐 admin getEnumDisplay） */
function enumDisplay(f: ParamFieldData): 'radio' | 'select' {
  if (f.display === 'radio' || f.display === 'select') return f.display;
  return (f.values?.length ?? 0) <= 5 ? 'radio' : 'select';
}

/** 字段是否已填（enum/number/string=非空；size=宽高>0；images=列表非空） */
function isFieldFilled(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') {
    const s = v as { width?: number; height?: number };
    return (s.width ?? 0) > 0 && (s.height ?? 0) > 0;
  }
  return true;
}

/** 文件大小格式化 */
function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 宽高 → 最简宽高比字符串（如 16:9） */
function formatRatio(w: number, h: number): string {
  if (w <= 0 || h <= 0) return '';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(Math.round(w), Math.round(h));
  return `${Math.round(w / d)}:${Math.round(h / d)}`;
}

// ===== enum 下拉渲染器（>5 项 / display=select；portal 纯色面板 + 清除按钮） =====

function EnumSelect({
  field,
  value,
  onChange,
  disabled,
}: {
  field: ParamFieldData;
  value: unknown;
  onChange: (v: string | undefined) => void;
  disabled: boolean;
}): React.ReactElement {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const handleOpen = () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    setOpen(true);
  };

  // 点击外部 / 滚动关闭（面板经 portal 挂 body，滚动错位即关闭）
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        const panels = document.querySelectorAll('[data-params-select-panel]');
        let inside = false;
        panels.forEach((p) => {
          if (p.contains(e.target as Node)) inside = true;
        });
        if (!inside) setOpen(false);
      }
    };
    const onScroll = () => setOpen(false);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const options = field.values ?? [];
  const current = value !== undefined && value !== '' ? options.find((v) => String(v) === String(value)) : undefined;

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 11px',
          borderRadius: 7,
          background: 'var(--agent-surface-2)',
          border: `1px solid ${open ? 'var(--agent-accent)' : 'var(--agent-border)'}`,
          color: 'var(--agent-text)',
          fontSize: 12.5,
          fontFamily: 'inherit',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          boxSizing: 'border-box',
          transition: 'border-color 0.15s',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
          {current !== undefined ? enumLabel(field, current) : '请选择…'}
        </span>
        {current !== undefined && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onChange(undefined);
            }}
            title="清除选择"
            style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, color: 'var(--agent-muted)', cursor: 'pointer', padding: 2, borderRadius: 4 }}
          >
            <X size={11} />
          </span>
        )}
        <ChevronDown size={12} style={{ opacity: 0.6, flexShrink: 0 }} />
      </button>
      {open && pos && createPortal(
        <div
          data-params-select-panel="true"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: 1000,
            background: 'var(--agent-bg)',
            border: '1px solid var(--agent-border)',
            borderRadius: 8,
            boxShadow: 'var(--agent-shadow)',
            padding: 4,
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {options.map((opt) => {
            const isSelected = String(value) === String(opt);
            return (
              <div
                key={opt}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                title={field.valueTooltips?.[opt]}
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                  borderRadius: 5,
                  color: 'var(--agent-text)',
                  background: isSelected ? 'var(--agent-accent-soft)' : 'transparent',
                  fontWeight: isSelected ? 600 : 400,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'var(--agent-surface-2)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                {enumLabel(field, opt)}
              </div>
            );
          })}
          {options.length === 0 && (
            <div style={{ padding: '6px 10px', fontSize: 11.5, color: 'var(--agent-muted)' }}>无可用选项</div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

// ===== size 渲染器（宽×高双输入 + 锁定比例 + AUTO 提示；对齐 admin SizeRenderer 简化版） =====

function SizeField({
  field,
  value,
  allValues,
  onChange,
  disabled,
}: {
  field: ParamFieldData;
  value: unknown;
  allValues: FieldValues;
  onChange: (name: string, v: unknown) => void;
  disabled: boolean;
}): React.ReactElement {
  const [locked, setLocked] = useState(false);
  const isAuto = allValues['aspectRatio'] === 'auto';
  const size = value && typeof value === 'object' ? (value as { width?: number; height?: number }) : {};
  const w = size.width ?? 1024;
  const h = size.height ?? 1024;
  const ratio = w > 0 && h > 0 ? w / h : 1;

  const setSize = (next: { width: number; height: number }) => onChange(field.name, next);
  const handleW = (raw: string) => {
    const width = Number(raw) || 0;
    if (locked && width > 0 && h > 0) setSize({ width, height: Math.round(width / ratio) });
    else setSize({ width, height: h });
  };
  const handleH = (raw: string) => {
    const height = Number(raw) || 0;
    if (locked && height > 0 && w > 0) setSize({ width: Math.round(height * ratio), height });
    else setSize({ width: w, height });
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          value={String(w)}
          disabled={disabled || isAuto}
          onChange={(e) => handleW(e.target.value)}
          placeholder="宽度"
          style={{ ...inputStyle, width: '42%', minWidth: 0 }}
        />
        <button
          type="button"
          onClick={() => setLocked(!locked)}
          disabled={disabled}
          title={locked ? '取消锁定宽高比' : '锁定宽高比'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            flexShrink: 0,
            borderRadius: 5,
            border: '1px solid var(--agent-border)',
            background: locked ? 'var(--agent-accent-soft)' : 'var(--agent-surface-2)',
            color: locked ? 'var(--agent-accent)' : 'var(--agent-muted)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {locked ? <Link size={12} /> : <Unlink size={12} />}
        </button>
        <input
          type="number"
          value={String(h)}
          disabled={disabled || isAuto}
          onChange={(e) => handleH(e.target.value)}
          placeholder="高度"
          style={{ ...inputStyle, width: '42%', minWidth: 0 }}
        />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--agent-muted)', marginTop: 3 }}>
        {isAuto
          ? 'AUTO 模式下由分辨率档位和宽高比自动计算尺寸'
          : `宽 ${w} × 高 ${h}${w > 0 && h > 0 ? ` · ${formatRatio(w, h)}` : ''}`}
      </div>
    </div>
  );
}

// ===== images 渲染器（参考图列表；对齐 admin ImagesRenderer 简化版：元数据随答案提交） =====

function ImagesField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: ParamFieldData;
  value: unknown;
  onChange: (name: string, v: unknown) => void;
  disabled: boolean;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const maxCount = field.maxCount ?? 4;
  const files = Array.isArray(value) ? (value as Array<{ name: string; size?: number; type?: string }>) : [];

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (disabled || picked.length === 0) return;
    const next = [...files];
    for (const f of picked) {
      if (next.length >= maxCount) break;
      next.push({ name: f.name, size: f.size, type: f.type });
    }
    onChange(field.name, next);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || files.length >= maxCount}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 11px',
          borderRadius: 7,
          border: '1px dashed var(--agent-border)',
          background: 'var(--agent-surface-2)',
          color: 'var(--agent-text)',
          fontSize: 11.5,
          fontFamily: 'inherit',
          cursor: disabled || files.length >= maxCount ? 'default' : 'pointer',
          opacity: disabled || files.length >= maxCount ? 0.6 : 1,
        }}
      >
        <Paperclip size={12} />
        选择参考图（最多 {maxCount} 张）
      </button>
      <input ref={inputRef} type="file" accept="image/*" multiple={maxCount > 1} hidden onChange={handlePick} />
      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 9px',
                borderRadius: 6,
                background: 'var(--agent-surface-2)',
                border: '1px solid var(--agent-border)',
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: 'var(--agent-text)' }}>
                {f.name}
              </span>
              <span style={{ fontSize: 10, color: 'var(--agent-muted)', flexShrink: 0 }}>{formatSize(f.size ?? 0)}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(field.name, files.filter((_, j) => j !== i))}
                  title="移除"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: 2,
                    borderRadius: 4,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--agent-muted)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== 主组件 =====

export function ParamsBlock(props: { message: CanvasAgentMessage }): React.ReactElement {
  const { message } = props;
  const data = message.params;
  const updateMessage = useCanvasAgentStore((s) => s.updateMessage);
  const [values, setValues] = useState<FieldValues>(() => {
    const init: FieldValues = {};
    for (const f of data?.fields ?? []) {
      if (f.default !== undefined) init[f.name ?? (f as any).key] = f.default;
    }
    return init;
  });
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [folded, setFolded] = useState(false);

  const fields = useMemo(() => (data?.fields ?? []).map(normalizeField), [data?.fields]);

  if (!data) return <></>;

  const answered = message.paramsAnswered === true || submitted;
  const presets = data.presets ?? [];
  const filledCount = fields.filter((f) => isFieldFilled(values[f.name])).length;
  const missingRequired = fields.some((f) => f.required && !isFieldFilled(values[f.name]));

  const setField = (key: string, value: unknown) => {
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
                    border: '1px solid var(--agent-border)',
                    borderRadius: 8,
                    background: isActive ? 'var(--agent-accent)' : 'var(--agent-surface-2)',
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

      {/* 标准参数选项表单（六类型渲染器，对齐 admin ParameterDef） */}
      {fields.length > 0 && (
        <div>
          {fields.map((f) => {
            const val = values[f.name];
            const disabled = answered;
            return (
              <div key={f.name} style={{ marginBottom: 9 }}>
                <div style={{ fontSize: 11.5, color: 'var(--agent-text)', marginBottom: 4, fontWeight: 500 }}>
                  {f.label}
                  {f.desc && (
                    <span style={{ fontSize: 10, color: 'var(--agent-muted)', marginLeft: 6, fontWeight: 400 }}>
                      {f.desc}
                    </span>
                  )}
                  {f.required && <span style={{ color: 'var(--agent-danger)', marginLeft: 3 }}>*</span>}
                </div>

                {f.type === 'enum' && enumDisplay(f) === 'radio' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {(f.values ?? []).map((opt) => {
                      const isActive = String(val) === String(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setField(f.name, isActive ? undefined : opt)}
                          disabled={disabled}
                          title={f.valueTooltips?.[opt]}
                          style={{
                            padding: '4px 10px',
                            border: `1px solid ${isActive ? 'var(--agent-accent)' : 'var(--agent-border)'}`,
                            borderRadius: 7,
                            background: isActive ? 'var(--agent-accent)' : 'var(--agent-surface-2)',
                            color: isActive ? '#fff' : 'var(--agent-text)',
                            fontSize: 11.5,
                            fontWeight: isActive ? 600 : 500,
                            fontFamily: 'inherit',
                            cursor: disabled ? 'default' : 'pointer',
                            opacity: disabled ? 0.6 : 1,
                            transition: 'all 0.15s',
                          }}
                        >
                          {enumLabel(f, opt)}
                        </button>
                      );
                    })}
                  </div>
                )}

                {f.type === 'enum' && enumDisplay(f) === 'select' && (
                  <EnumSelect field={f} value={val} disabled={disabled} onChange={(v) => setField(f.name, v)} />
                )}

                {f.type === 'number' && (
                  <input
                    type="number"
                    value={val === undefined ? '' : String(val)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      let next = Number.isNaN(n) ? '' : n;
                      if (typeof next === 'number') {
                        if (f.min !== undefined && next < f.min) next = f.min;
                        if (f.max !== undefined && next > f.max) next = f.max;
                      }
                      setField(f.name, next);
                    }}
                    disabled={disabled}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    placeholder={f.placeholder ?? `输入${f.label}…`}
                    style={inputStyle}
                  />
                )}

                {f.type === 'boolean' && (
                  <button
                    type="button"
                    onClick={() => setField(f.name, !Boolean(val))}
                    disabled={disabled}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 10px',
                      border: '1px solid var(--agent-border)',
                      borderRadius: 7,
                      background: Boolean(val) ? 'var(--agent-accent-soft)' : 'var(--agent-surface-2)',
                      color: 'var(--agent-text)',
                      fontSize: 11.5,
                      fontFamily: 'inherit',
                      cursor: disabled ? 'default' : 'pointer',
                      opacity: disabled ? 0.6 : 1,
                    }}
                  >
                    <span
                      style={{
                        width: 26,
                        height: 14,
                        borderRadius: 7,
                        background: Boolean(val) ? 'var(--agent-accent)' : 'var(--agent-border)',
                        position: 'relative',
                        transition: 'all 0.15s',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          top: 2,
                          left: Boolean(val) ? 14 : 2,
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: '#fff',
                          transition: 'left 0.15s',
                        }}
                      />
                    </span>
                    {Boolean(val) ? '开启' : '关闭'}
                  </button>
                )}

                {f.type === 'size' && (
                  <SizeField field={f} value={val} allValues={values} disabled={disabled} onChange={(v) => setField(f.name, v)} />
                )}

                {f.type === 'string' && (
                  <textarea
                    value={val === undefined ? '' : String(val)}
                    onChange={(e) => setField(f.name, e.target.value)}
                    disabled={disabled}
                    placeholder={f.placeholder ?? `输入${f.label}…`}
                    rows={2}
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 46 }}
                  />
                )}

                {f.type === 'images' && (
                  <ImagesField field={f} value={val} disabled={disabled} onChange={(v) => setField(f.name, v)} />
                )}

                {!['enum', 'number', 'boolean', 'size', 'string', 'images'].includes(f.type) && (
                  <input
                    type="text"
                    value={val === undefined ? '' : String(val)}
                    onChange={(e) => setField(f.name, e.target.value)}
                    disabled={disabled}
                    placeholder={f.placeholder ?? `输入${f.label}…`}
                    style={inputStyle}
                  />
                )}
              </div>
            );
          })}
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
          style={inputStyle}
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
          {missingRequired ? ' · 有必填项未填' : ''}
        </span>
        {!answered && (
          <button
            type="button"
            onClick={handleSubmit}
            style={{
              padding: '4px 14px',
              border: 'none',
              borderRadius: 7,
              background: fields.length === 0 || (filledCount > 0 && !missingRequired)
                ? 'var(--agent-accent)'
                : 'var(--agent-border)',
              color: fields.length === 0 || (filledCount > 0 && !missingRequired) ? '#fff' : 'var(--agent-muted)',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: fields.length === 0 || (filledCount > 0 && !missingRequired) ? 'pointer' : 'default',
            }}
            disabled={fields.length > 0 && (filledCount === 0 || missingRequired)}
          >
            提交
          </button>
        )}
      </div>
    </div>
  );
}
