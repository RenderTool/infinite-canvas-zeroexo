/**
 * TextPreviewModal - 文本预览弹窗（MD/TEXT/HTML 切换查看）
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { X } from 'lucide-react';
import DOMPurify from 'dompurify';

interface TextPreviewModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  content: string;
}

export function TextPreviewModal({ open, onClose, title, content }: TextPreviewModalProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;
  const bgCard = isDark ? '#1a1715' : '#f5f2ec';

  const [viewMode, setViewMode] = useState<'text' | 'md' | 'html'>('text');

  const renderContent = () => {
    switch (viewMode) {
      case 'html':
        return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }} />;
      case 'md':
      case 'text':
      default:
        return (
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {content}
          </div>
        );
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={700}
      centered
      closable={false}
      destroyOnHidden
      styles={{ body: { padding: 0, overflow: 'hidden' } }}
    >
      <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", color: theme.toolbar.text }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: `1px solid ${border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
            <span style={{ fontSize: 11, color: textMuted }}>{t('scriptImport.charCount', { chars: content.length.toLocaleString() })}</span>
          </div>
          <button type="button" onClick={onClose}
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: 'none', background: 'transparent', color: textMuted, cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>

        {/* View mode tabs */}
        <div style={{
          display: 'flex', gap: 0, padding: '8px 20px 0',
          borderBottom: `1px solid ${border}`,
        }}>
          {(['text', 'md', 'html'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              style={{
                padding: '6px 16px', fontSize: 12, fontWeight: 500,
                border: 'none', background: 'transparent',
                color: viewMode === mode ? accent : textMuted,
                borderBottom: viewMode === mode ? `2px solid ${accent}` : '2px solid transparent',
                cursor: 'pointer', fontFamily: 'inherit',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}
            >
              {mode === 'text' ? t('scriptImport.textPreview') : mode === 'md' ? t('scriptImport.markdown') : t('scriptImport.html')}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{
          padding: '16px 20px', maxHeight: 400, overflow: 'auto',
          background: bgCard,
        }}>
          {renderContent()}
        </div>
      </div>
    </Modal>
  );
}