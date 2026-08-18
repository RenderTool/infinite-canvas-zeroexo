/**
 * ResourceMentionTextarea - 带 @ 资源引用的 textarea
 *
 * - 输入 @ 触发弹出面板(列出 active 资源引用)
 * - 键盘上下选择 + Enter 插入;Esc 关闭
 * - 插入格式:`${label} `(label 后加空格)
 * - overlay 层高亮 textarea 中的 label 文字(蓝色徽章)
 *
 * 事件隔离:onMouseDown/onPointerDown stopPropagation 避免触发画布拖拽。
 */

import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import type { ResourceReference } from '../resource-references.js';
import type { GenerationMode } from './prompt-panel.js';

export interface ResourceMentionTextareaProps {
  value: string;
  mode: GenerationMode;
  theme: ThemeConfig;
  references: ResourceReference[];
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

interface MentionState {
  start: number;
  query: string;
}

export function ResourceMentionTextarea({
  value,
  mode,
  theme,
  references,
  disabled = false,
  onChange,
  onSubmit,
}: ResourceMentionTextareaProps): React.ReactElement {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);

  // @ 触发后的候选列表(仅 active 引用,按 query 过滤)
  const candidates = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.trim().toLowerCase();
    const activeRefs = references.filter((r) => r.active);
    if (!query) return activeRefs;
    return activeRefs.filter((r) =>
      `${r.label} ${r.title} ${r.kind} ${r.text || ''}`.toLowerCase().includes(query),
    );
  }, [mention, references]);

  // 需要高亮的 label 集合(去重,长度降序避免短 label 误匹配)
  const activeLabels = useMemo(
    () => Array.from(new Set(references.filter((r) => r.active).map((r) => r.label))).sort((a, b) => b.length - a.length),
    [references],
  );

  const updateValue = (next: string, selectionStart?: number): void => {
    onChange(next);
    if (typeof selectionStart !== 'number') return;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(selectionStart, selectionStart);
    });
  };

  const closeMention = (): void => {
    setMention(null);
    setActiveIndex(0);
  };

  // 检测 @ 触发:正则匹配光标前的 `(@query)`
  const syncMention = (nextValue: string, cursor: number): void => {
    const prefix = nextValue.slice(0, cursor);
    const match = /(^|\s)@([^\s@]*)$/.exec(prefix);
    if (!match || !references.some((r) => r.active)) {
      closeMention();
      return;
    }
    const query = match[2] ?? '';
    setMention({ start: cursor - query.length - 1, query });
    setActiveIndex(0);
  };

  // 插入选中的引用:替换 @query → `${label} `
  const insertReference = (reference: ResourceReference): void => {
    if (!mention) return;
    const textarea = textareaRef.current;
    const end = textarea?.selectionStart ?? value.length;
    const insertText = `${reference.label} `;
    const next = `${value.slice(0, mention.start)}${insertText}${value.slice(end)}`;
    closeMention();
    updateValue(next, mention.start + insertText.length);
  };

  const syncOverlayScroll = (): void => {
    if (!overlayRef.current || !textareaRef.current) return;
    overlayRef.current.scrollTop = textareaRef.current.scrollTop;
    overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
  };

  const updateSelectionState = (): void => {
    const textarea = textareaRef.current;
    setHasSelection(Boolean(textarea && textarea.selectionStart !== textarea.selectionEnd));
  };

  const showOverlay = Boolean(activeLabels.length && !hasSelection);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // @ 弹出面板激活时的键盘交互
    if (mention && candidates.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMention();
        return;
      }
    }
    // Enter 提交(无 Shift,非输入法合成态)
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  };

  const placeholder = t(`prompt.placeholder${mode.charAt(0).toUpperCase()}${mode.slice(1)}`);

  const menu = mention && candidates.length && textareaRef.current ? (
    <MentionMenu
      textarea={textareaRef.current}
      references={candidates}
      activeIndex={Math.min(activeIndex, candidates.length - 1)}
      theme={theme}
      onSelect={insertReference}
    />
  ) : null;

  // textarea 样式(showOverlay 时文字透明,由 overlay 层渲染高亮)
  const mergedStyle: CSSProperties = {
    ...textareaBaseStyle(theme.node.contentBackground, theme.node.outlineColor, theme.toolbar.text),
    color: showOverlay ? 'transparent' : theme.toolbar.text,
    caretColor: theme.toolbar.text,
    ...(showOverlay ? { background: 'transparent' } : {}),
  };

  return (
    <div style={containerStyle}>
      {showOverlay ? (
        <div
          ref={overlayRef}
          style={{
            ...mergedStyle,
            color: theme.toolbar.text,
            pointerEvents: 'none',
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          <MentionHighlightText
            value={value || placeholder}
            labels={activeLabels}
            references={references}
            theme={theme}
            placeholder={!value}
          />
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        style={mergedStyle}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          syncMention(next, event.target.selectionStart);
          requestAnimationFrame(() => {
            syncOverlayScroll();
            updateSelectionState();
          });
        }}
        onSelect={() => updateSelectionState()}
        onKeyUp={() => updateSelectionState()}
        onPointerUp={() => updateSelectionState()}
        onKeyDown={handleKeyDown}
        onScroll={syncOverlayScroll}
        onBlur={() => {
          setHasSelection(false);
          window.setTimeout(closeMention, 120);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      />
      {menu}
    </div>
  );
}

// ===== 高亮文本(overlay 层) =====

function MentionHighlightText({
  value,
  labels,
  references,
  theme,
  placeholder,
}: {
  value: string;
  labels: string[];
  references: ResourceReference[];
  theme: ThemeConfig;
  placeholder: boolean;
}): React.ReactElement {
  if (placeholder) {
    return <span style={{ opacity: 0.45 }}>{value}</span>;
  }
  if (!labels.length) {
    return <>{value}</>;
  }
  const pattern = new RegExp(`(${labels.map(escapeRegExp).join('|')})`, 'g');
  const parts = value.split(pattern);
  return (
    <>
      {parts.map((part, index) =>
        labels.includes(part) ? (
          <span
            key={`mention-${index}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              margin: '0 1px',
              verticalAlign: 'middle',
              lineHeight: 'inherit',
              fontSize: 12,
            }}
          >
            {(() => {
              const ref = references.find((r) => r.label === part);
              if (ref?.kind === 'image' && ref.previewUrl) {
                return (
                  <img
                    src={ref.previewUrl}
                    alt=""
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 3,
                      objectFit: 'cover',
                      flexShrink: 0,
                    }}
                  />
                );
              }
              return null;
            })()}
            <span
              style={{
                padding: '0 4px',
                borderRadius: 4,
                background: `${theme.toolbar.accent}16`,
                color: theme.toolbar.accent,
                fontWeight: 500,
                boxShadow: `inset 0 0 0 1px ${theme.toolbar.accent}24`,
              }}
            >
              {part}
            </span>
          </span>
        ) : (
          <span key={`text-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

// ===== 弹出菜单 =====

function MentionMenu({
  textarea,
  references,
  activeIndex,
  theme,
  onSelect,
}: {
  textarea: HTMLTextAreaElement;
  references: ResourceReference[];
  activeIndex: number;
  theme: ThemeConfig;
  onSelect: (reference: ResourceReference) => void;
}): React.ReactElement {
  const selectedRef = useRef(false);
  const rect = textarea.getBoundingClientRect();
  const menuWidth = 256;
  const maxMenuHeight = 224;
  const gap = 6;
  const left = clamp(rect.left, 8, window.innerWidth - menuWidth - 8);
  const showAbove = rect.bottom + gap + maxMenuHeight > window.innerHeight && rect.top - gap - maxMenuHeight >= 0;
  const top = clamp(showAbove ? rect.top - gap - maxMenuHeight : rect.bottom + gap, 8, window.innerHeight - maxMenuHeight - 8);

  const stopInteraction = (event: ReactPointerEvent | ReactMouseEvent): void => {
    event.stopPropagation();
  };

  const selectReference = (reference: ResourceReference): void => {
    if (selectedRef.current) return;
    selectedRef.current = true;
    onSelect(reference);
  };

  return createPortal(
    <div
      data-resource-mention-menu="true"
      style={{
        position: 'fixed',
        left,
        top,
        width: menuWidth,
        maxHeight: maxMenuHeight,
        overflowY: 'auto',
        zIndex: 9999,
        padding: 4,
        borderRadius: 12,
        border: `1px solid ${theme.toolbar.border}`,
        background: theme.toolbar.panel,
        boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
        backdropFilter: 'blur(8px)',
        color: theme.toolbar.text,
      }}
      onPointerDown={stopInteraction}
      onMouseDown={stopInteraction}
      onClick={(event) => event.stopPropagation()}
    >
      {references.map((reference, index) => (
        <button
          key={reference.id}
          type="button"
          style={{
            display: 'flex',
            width: '100%',
            minWidth: 0,
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            borderRadius: 8,
            border: 'none',
            background: index === activeIndex ? `${theme.toolbar.accent}20` : 'transparent',
            color: index === activeIndex ? theme.toolbar.accent : theme.toolbar.text,
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: 12,
            transition: 'background 0.12s',
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            selectReference(reference);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            selectReference(reference);
          }}
        >
          <ReferencePreview reference={reference} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 600 }}>{reference.label}</span>
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.65 }}>
              {reference.text || reference.title}
            </span>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ===== 引用预览图标 =====

function ReferencePreview({ reference }: { reference: ResourceReference }): React.ReactElement {
  if (reference.kind === 'image' && reference.previewUrl) {
    return <img src={reference.previewUrl} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />;
  }
  if (reference.kind === 'video' && reference.previewUrl) {
    return <video src={reference.previewUrl} style={{ width: 32, height: 32, borderRadius: 6, background: '#000', objectFit: 'cover' }} muted preload="metadata" />;
  }
  const Icon = reference.kind === 'audio'
    ? (props: { size?: number }) => <svg xmlns="http://www.w3.org/2000/svg" width={props.size ?? 14} height={props.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>
    : reference.kind === 'video'
    ? (props: { size?: number }) => <svg xmlns="http://www.w3.org/2000/svg" width={props.size ?? 14} height={props.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z"/><path d="M7 21h10"/><rect width="20" height="14" x="2" y="3" rx="2"/></svg>
    : reference.kind === 'image' ? ImageIcon : FileText;
  return (
    <span style={{ width: 32, height: 32, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'rgba(128,128,128,0.15)' }}>
      <Icon size={14} />
    </span>
  );
}

// ===== 样式 =====

const containerStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  minHeight: 36,
};

const textareaBaseStyle = (background: string, border: string, color: string): CSSProperties => ({
  width: '100%',
  minHeight: 48,
  maxHeight: 120,
  resize: 'none',
  borderRadius: 12,
  border: `1px solid ${border}`,
  background,
  color,
  padding: '8px 12px',
  fontSize: 13,
  lineHeight: '20px',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
  overflow: 'auto',
});

// ===== 辅助函数 =====

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
