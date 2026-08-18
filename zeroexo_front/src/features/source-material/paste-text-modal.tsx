/**
 * PasteTextModal - 粘贴文本弹窗
 *
 * 允许用户粘贴文本内容后自动检测结构。
 * TextArea 最大 10MB 限制，实时显示字符数统计。
 */
import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import { Modal, Input } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';

/** 10MB 约等于 10,485,760 字符（UTF-8 编码下） */
const MAX_CHARS = 10_485_760;

export interface PasteTextModalProps {
  open: boolean;
  onConfirm: (text: string) => void;
  onCancel: () => void;
}

export function PasteTextModal({
  open,
  onConfirm,
  onCancel,
}: PasteTextModalProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  const [text, setText] = useState('');
  const [charCount, setCharCount] = useState(0);
  const [exceeded, setExceeded] = useState(false);

  // 每次打开弹窗时重置状态
  useEffect(() => {
    if (open) {
      setText('');
      setCharCount(0);
      setExceeded(false);
    }
  }, [open]);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const count = value.length;
      setText(value);
      setCharCount(count);
      setExceeded(count > MAX_CHARS);
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    if (text.trim().length === 0 || exceeded) return;
    onConfirm(text);
  }, [text, exceeded, onConfirm]);

  // ── 主题色 ──
  const bg = theme.toolbar.background;
  const textColor = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;
  const accent = theme.toolbar.accent;
  const bgHeader = isDark ? '#1f1f1f' : '#fafaf7';

  // ── 样式 ──
  const contentStyle: CSSProperties = {
    background: bg,
    padding: 0,
    overflow: 'hidden',
    borderRadius: 16,
    border: `1px solid ${border}`,
  };
  const modalBodyStyle: CSSProperties = { padding: 0, display: 'flex', flexDirection: 'column' };
  const maskStyle: CSSProperties = {
    background: 'transparent',
  };
  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 24px',
    borderBottom: `1px solid ${border}`,
    background: bgHeader,
  };
  const closeBtnStyle: CSSProperties = {
    width: 32,
    height: 32,
    border: 'none',
    borderRadius: 8,
    background: 'transparent',
    color: textMuted,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
    fontSize: 18,
  };
  const textareaWrapperStyle: CSSProperties = {
    padding: '20px 24px',
  };
  const charCountStyle: CSSProperties = {
    padding: '0 24px 4px',
    fontSize: 12,
    color: exceeded ? theme.toolbar.danger : textMuted,
    textAlign: 'right',
  };
  const footerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    padding: '14px 24px',
    borderTop: `1px solid ${border}`,
    background: bgHeader,
  };
  const btnBase: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 20px',
    border: 'none',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'inherit',
  };
  const primaryBtn: CSSProperties = { ...btnBase, background: accent, color: '#fff' };
  const ghostBtn: CSSProperties = {
    ...btnBase,
    border: `1px solid ${border}`,
    background: 'transparent',
    color: textMuted,
  };
  const disabledBtn: CSSProperties = { ...primaryBtn, opacity: 0.5, cursor: 'not-allowed' };

  const canConfirm = text.trim().length > 0 && !exceeded;

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      centered
      width={560}
      footer={null}
      destroyOnHidden
      closeIcon={null}
      styles={{ container: contentStyle, body: modalBodyStyle, mask: maskStyle }}
    >
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ fontSize: 16, fontWeight: 600, color: textColor, letterSpacing: '0.3px' }}>
          粘贴文本
        </div>
        <button
          type="button"
          style={closeBtnStyle}
          onClick={onCancel}
          aria-label="关闭"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
            e.currentTarget.style.color = textColor;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = textMuted;
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* TextArea */}
      <div style={textareaWrapperStyle}>
        <Input.TextArea
          value={text}
          onChange={handleTextChange}
          placeholder="在此粘贴文本内容..."
          autoSize={{ minRows: 10, maxRows: 20 }}
          style={{
            fontSize: 13,
            lineHeight: 1.7,
            fontFamily: 'inherit',
            borderRadius: 10,
            resize: 'vertical',
            border: `1px solid ${exceeded ? theme.toolbar.danger : border}`,
            background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            color: textColor,
          }}
        />
      </div>

      {/* 字符数统计 */}
      <div style={charCountStyle}>
        {exceeded
          ? `文本超出 10MB 限制（${charCount.toLocaleString()} / ${MAX_CHARS.toLocaleString()} chars）`
          : `${charCount.toLocaleString()} / ${MAX_CHARS.toLocaleString()} chars`}
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <button type="button" style={ghostBtn} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          style={canConfirm ? primaryBtn : disabledBtn}
          onClick={handleConfirm}
          disabled={!canConfirm}
        >
          检测并导入
        </button>
      </div>
    </Modal>
  );
}