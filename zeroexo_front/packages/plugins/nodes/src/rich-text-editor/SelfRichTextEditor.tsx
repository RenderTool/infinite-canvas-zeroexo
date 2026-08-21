/**
 * SelfRichTextEditor - 自研富文本编辑器（文本节点专用）
 *
 * 基于原生 contentEditable + document.execCommand 实现,不依赖 Quill。
 * 数据格式:value / onChange 均为 HTML 字符串。
 *
 * 样式要点:
 * - Toolbar 背景透明(与节点外壳保持一致,不出现多余底色区块)
 * - 节点内部不使用任何 border-radius(节点外壳自身已有圆角,内部再圆角易产生重复视觉)
 * - 字体颜色使用输入型拾色器(type=color),高亮保留色块面板
 * - 字体/字号等可编辑区默认不换行,保证文本连续可读性
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import { SimpleSelect } from '@/shared/components/index.js';
import { TEXT_MAX_LENGTH } from '@/shared/constants/text-limits.js';

/**
 * 安全净化 HTML（修复 F2.2 XSS）。零依赖实现：
 * - 移除 <script>/<style>/<iframe>/<object>/<embed> 等危险标签
 * - 移除所有 on* 事件属性
 * - 移除 javascript:/data: 等危险 URI（仅放行 http(s)/mailto/相对/锚点）
 * 注意：本函数用于屏蔽来自协作同步/导入/网络等不受信来源的恶意 HTML，
 * 不影响用户通过工具栏正常产生的富文本。
 */
const DANGEROUS_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE']);

function sanitizeHtml(dirty: string): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return dirty;
  const doc = new DOMParser().parseFromString(dirty, 'text/html');

  const walk = (node: Element): void => {
    // 移除危险标签
    Array.from(node.querySelectorAll('*')).forEach((el) => {
      if (DANGEROUS_TAGS.has(el.tagName)) {
        el.remove();
      }
    });
    // 移除事件属性与危险 URI
    Array.from(node.getElementsByTagName('*')).forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const val = attr.value.trim().toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
        } else if (
          (name === 'href' || name === 'src' || name === 'xlink:href') &&
          (val.startsWith('javascript:') || val.startsWith('data:') || val.startsWith('vbscript:'))
        ) {
          el.removeAttribute(attr.name);
        }
      });
    });
  };

  walk(doc.body);
  return doc.body.innerHTML;
}

export interface SelfRichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  isDark?: boolean;
  /** 隐藏工具栏(由外部 NodeCapsuleToolbar 提供) */
  hideToolbar?: boolean;
  /** Escape 退出编辑回调 */
  onEscape?: () => void;
  /** 文本超过上限被截断时的提示回调(防恶意超大文本拖垮协作同步) */
  onLimitExceeded?: () => void;
}

const HEADER_OPTIONS = [
  { label: '正文', tag: 'div' },
  { label: 'H1', tag: 'h1' },
  { label: 'H2', tag: 'h2' },
  { label: 'H3', tag: 'h3' },
  { label: 'H4', tag: 'h4' },
  { label: 'H5', tag: 'h5' },
  { label: 'H6', tag: 'h6' },
];
const HIGHLIGHT_COLORS = ['#ffd54f', '#a5d6a7'];

export function SelfRichTextEditor({
  value,
  onChange,
  placeholder = '在此开始编辑...',
  isDark: _isDark,
  hideToolbar = false,
  onEscape,
  onLimitExceeded,
}: SelfRichTextEditorProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = _isDark ?? theme.mode === 'dark';
  const editorRef = useRef<HTMLDivElement | null>(null);
  const textColorPickerRef = useRef<HTMLInputElement | null>(null);
  const [textColor, setTextColor] = useState('#1f2937');
  // 高亮面板展开状态(点击按钮后展开到 toolbar 第二行,不再 inline 塞色块)
  const [highlightOpen, setHighlightOpen] = useState(false);

  // 粘贴钳制:防恶意超大文本进入(协作同步 CRDT 合并/广播/落库放大风险)
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const el = editorRef.current;
    if (!el) return;
    const pasteText = e.clipboardData.getData('text');
    const current = (el.innerText ?? '').length;
    if (current + pasteText.length > TEXT_MAX_LENGTH) {
      e.preventDefault();
      const allowed = Math.max(0, TEXT_MAX_LENGTH - current);
      if (allowed > 0) document.execCommand('insertText', false, pasteText.slice(0, allowed));
      onLimitExceeded?.();
    }
  }, [onLimitExceeded]);

  // 输入兑底钳制(防 IME/拖拽等绕过粘贴事件)
  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const text = el.innerText ?? '';
    if (text.length > TEXT_MAX_LENGTH) {
      el.innerText = text.slice(0, TEXT_MAX_LENGTH);
      onLimitExceeded?.();
    }
    onChange(el.innerHTML ?? '');
  }, [onChange, onLimitExceeded]);

  useEffect(() => {
    const el = editorRef.current;
    if (el && el.innerHTML !== value) {
      // 净化后再写入，防止来自导入/协作同步的恶意 HTML 造成 XSS
      el.innerHTML = sanitizeHtml(value);
    }
    // eslint-disable-line react-hooks/exhaustive-deps
  }, []);

  const restoreSelection = useCallback((): void => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
  }, []);

  const exec = useCallback((cmd: string, v?: string): void => {
    restoreSelection();
    document.execCommand(cmd, false, v);
    onChange(editorRef.current?.innerHTML ?? '');
  }, [onChange, restoreSelection]);

  const handleHeader = useCallback((tag: string): void => { exec('formatBlock', tag); }, [exec]);
  const handleHighlight = useCallback((c: string): void => { exec('hiliteColor', c); }, [exec]);
  const handleTextColor = useCallback((c: string): void => {
    setTextColor(c);
    exec('foreColor', c);
  }, [exec]);

  const baseTextColor = isDark ? '#e5e7eb' : '#1f2937';

  // 统一的工具按钮样式(无圆角,无额外背景,透明)
  const toolbarBtnStyle = (): CSSProperties => ({
    width: 26,
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 0,
    background: 'transparent',
    color: isDark ? '#e5e7eb' : '#374151',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  });

  const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';

  return (
    <div
      className="zxe-rt-wrap"
      data-theme={isDark ? 'dark' : 'light'}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}
    >
      {/* 工具栏:背景透明,不出现多余底色条;所有内部控件零圆角
          - hideToolbar 时由外部 NodeCapsuleToolbar 提供工具栏 */}
      {!hideToolbar ? (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
          padding: '4px 6px',
          borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
          background: 'transparent',
        }}
      >
        {/* 标题选择 */}
        <SimpleSelect
          placeholder="标题"
          minWidth={64}
          stopPropagation
          fixed
          options={HEADER_OPTIONS.map((h) => ({ value: h.tag, label: h.label }))}
          onChange={(tag) => handleHeader(tag)}
        />

        <button
          style={toolbarBtnStyle()}
          title="加粗"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('bold')}
        >B</button>
        <button
          style={{ ...toolbarBtnStyle(), fontStyle: 'italic' }}
          title="斜体"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('italic')}
        >I</button>
        <button
          style={{ ...toolbarBtnStyle(), textDecoration: 'underline' }}
          title="下划线"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('underline')}
        >U</button>

        {/* 分割线 */}
        <div style={{ width: 1, height: 18, background: isDark ? '#4b5563' : '#d1d5db', margin: '0 2px' }} />

        {/* 字体颜色拾色器(仅按钮, 不展开预设色块面板, 直接弹出系统拾色器) */}
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <button
            title={`文字颜色:${textColor}（点击打开拾色器）`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const inp = textColorPickerRef.current;
              if (!inp) return;
              inp.value = textColor.startsWith('#') ? textColor : '#1f2937';
              try { inp.click(); } catch { /* noop */ }
            }}
            style={{
              ...toolbarBtnStyle(),
              width: 30,
              padding: 0,
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <span style={{ color: textColor, fontWeight: 700, lineHeight: 1 }}>A</span>
            <span style={{
              width: 18,
              height: 3,
              background: textColor,
              display: 'block',
            }} />
          </button>
          {/* 隐藏的拾色器(固定在视口外,避免影响布局) —— 用于可靠触发系统拾色面板 */}
          <input
            ref={textColorPickerRef}
            type="color"
            tabIndex={-1}
            onChange={(e) => handleTextColor(e.target.value)}
            style={{
              position: 'fixed',
              left: -9999,
              top: -9999,
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: 'none',
              border: 0,
              padding: 0,
              margin: 0,
            }}
          />
        </div>

        {/* 高亮按钮:点击后在 toolbar 面板展开色块(不再占第一行) */}
        <button
          title={`高亮 ${highlightOpen ? '· 已展开面板' : '· 点击展开色块'}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setHighlightOpen((v) => !v)}
          style={{
            ...toolbarBtnStyle(),
            width: 30,
            padding: 0,
            flexDirection: 'column',
            gap: 2,
            background: highlightOpen ? hoverBg : 'transparent',
          }}
        >
          <span style={{
            fontWeight: 700,
            lineHeight: 1,
            padding: '0 2px',
            background: HIGHLIGHT_COLORS[0],
            color: '#111',
          }}>H</span>
          <span style={{
            width: 18,
            height: 3,
            background: HIGHLIGHT_COLORS[1],
            display: 'block',
          }} />
        </button>

        {/* 分割线 */}
        <div style={{ width: 1, height: 18, background: isDark ? '#4b5563' : '#d1d5db', margin: '0 2px' }} />

        {/* 占位 flex item: 把 清除格式 推到末尾,视觉更好 */}
        <div style={{ flex: 1 }} />

        <button
          style={toolbarBtnStyle()}
          title="清除格式"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('removeFormat')}
        >✕</button>

        {/* 高亮面板(第二行):仅在点击高亮按钮后展开,直接在 toolbar 区域展开而不占主行 */}
        {highlightOpen ? (
          <div
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 2px 2px',
              borderTop: `1px dashed ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
            }}
          >
            <span style={{
              fontSize: 11,
              color: isDark ? '#9ca3af' : '#6b7280',
              paddingRight: 4,
              userSelect: 'none',
            }}>高亮</span>
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                title={`高亮 ${c}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleHighlight(c)}
                style={{
                  width: 20,
                  height: 20,
                  padding: 0,
                  borderRadius: 0,
                  border: `1px solid ${isDark ? '#6b7280' : '#9ca3af'}`,
                  background: c,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              />
            ))}
            <button
              title="清除高亮"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleHighlight('transparent')}
              style={{
                width: 28,
                height: 20,
                padding: 0,
                borderRadius: 0,
                border: `1px solid ${isDark ? '#6b7280' : '#9ca3af'}`,
                background: 'transparent',
                color: isDark ? '#9ca3af' : '#6b7280',
                fontSize: 10,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >清除</button>
          </div>
        ) : null}
      </div>
      ) : null}

      {/* 可编辑区: 零圆角,与节点外壳一致
          - 编辑态(点击/激活内容区)阻止 pointerdown 冒泡,避免误触发节点拖拽
          - 工具栏允许拖拽冒泡(从工具栏可拖动节点),编辑区不允许 */}
      <div
        ref={editorRef}
        className="zxe-content-editable nodrag nopan nowheel"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onPaste={handlePaste}
        onInput={handleInput}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
            onEscape?.();
          }
        }}
        onPointerDown={(e) => {
          // 进入内容编辑模式:阻止冒泡,不触发节点拖拽/画布平移
          // 允许用户后续通过工具栏/节点外壳/标题拖动整个节点
          e.stopPropagation();
        }}
        onWheel={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          minHeight: 0,
          height: '100%',
          overflow: 'auto',
          padding: '8px 10px',
          outline: 'none',
          color: baseTextColor,
          fontSize: 14,
          lineHeight: 1.6,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
          borderRadius: 0,
          background: 'transparent',
        }}
      />
      <style>{`
        .zxe-content-editable[data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: ${isDark ? '#6b7280' : '#9ca3af'};
          pointer-events: none;
        }
        .zxe-content-editable h1 { font-size: 2em; margin: 0.4em 0; }
        .zxe-content-editable h2 { font-size: 1.5em; margin: 0.4em 0; }
        .zxe-content-editable h3 { font-size: 1.25em; margin: 0.4em 0; }
        .zxe-content-editable h4 { font-size: 1.1em; margin: 0.4em 0; }
        .zxe-content-editable h5 { font-size: 1em; margin: 0.4em 0; }
        .zxe-content-editable h6 { font-size: 0.9em; margin: 0.4em 0; }
        /* 内嵌字体声明,使 execCommand fontName 生效 */
        [style*="font-family: SimSun"], [face="SimSun"] { font-family: 'SimSun', serif !important; }
        [style*="font-family: SimHei"], [face="SimHei"] { font-family: 'SimHei', 'Microsoft YaHei', sans-serif !important; }
        [style*="font-family: MicrosoftYaHei"], [face="MicrosoftYaHei"] { font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif !important; }
        [style*="font-family: KaiTi"], [face="KaiTi"] { font-family: 'KaiTi', 'STKaiti', serif !important; }
        [style*="font-family: CourierNew"], [face="CourierNew"] { font-family: 'Courier New', Courier, monospace !important; }
      `}</style>
    </div>
  );
}
