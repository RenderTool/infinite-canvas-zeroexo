/**
 * PromptViewer - 统一提示词查看器
 *
 * 使用 PromptCreatePage 框架统一渲染所有提示词视图：
 * - 私有提示词：promptId 模式，可编辑
 * - 公共提示词：readOnly 模式，只读查看，支持收藏副本
 */
import { App, Modal } from 'antd';
import { FileText, X } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';
import { PromptCreatePage, type PublicPromptInitialData } from '@/features/asset-library/index.js';
import { useCallback, useState } from 'react';

export interface PublicPromptViewItem {
  id: string;
  title: string;
  content: string;
  contentEn?: string;
  contentJa?: string;
  category: string;
  tags: string[];
  images: { storageKey: string; width?: number; height?: number; alt?: string }[];
  source: string;
  sourceId?: string;
  sourceName?: string;
  sourceUrl?: string;
  license?: string;
}

export interface PromptViewerProps {
  promptId?: string;
  publicItem?: PublicPromptViewItem;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  /** 标题变化回调（用于外部 Modal 同步标题） */
  onTitleChange?: (title: string) => void;
}

export function PromptViewer({
  promptId,
  publicItem,
  open,
  onClose,
  onSaved,
  onTitleChange,
}: PromptViewerProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';

  // 胶囊标签文字（和 AssetDetailViewer 的 kindLabel 同款逻辑）
  const kindLabel = t('asset.kindPrompt', 'Prompt');
  const titleText = publicItem?.title || kindLabel;

  // ===================== 派生样式 =====================
  const modalBodyStyle: React.CSSProperties = {
    padding: 0,
    background: theme.toolbar.background,
    borderRadius: 14,
    height: 'calc(100vh - 120px)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  // 关闭按钮 hover 底色
  const closeHoverBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';

  // ===================== 编辑脏态关闭拦截 =====================
  const [editDirty, setEditDirty] = useState(false);

  const { modal } = App.useApp();

  const handleRequestClose = useCallback(() => {
    if (editDirty) {
      modal.confirm({
        title: t('promptViewer.discardUnsavedTitle'),
        content: t('promptViewer.discardUnsavedContent'),
        okText: t('promptViewer.discardAndExit'),
        cancelText: t('promptViewer.continueEditing'),
        okButtonProps: { danger: true },
        centered: true,
        onOk: onClose,
      });
      return;
    }
    onClose();
  }, [editDirty, onClose, t]);

  // ===================== 边界情况 =====================
  if (!open) return <></>;
  if (!promptId && !publicItem) return <></>;

  // ===================== 公共提示词：初始数据 =====================
  const initialData: PublicPromptInitialData | undefined = publicItem
    ? {
        title: publicItem.title,
        content: publicItem.content,
        category: publicItem.category,
        tags: publicItem.tags ?? [],
        images: (publicItem.images ?? []).map((img) => ({ storageKey: img.storageKey })),
        contentEn: publicItem.contentEn,
        contentJa: publicItem.contentJa,
      }
    : undefined;

  // ===================== 渲染 =====================
  return (
    <Modal
      open={open}
      onCancel={handleRequestClose}
      footer={null}
      width="calc(100vw - 48px)"
      style={{ maxWidth: 1200 }}
      centered
      destroyOnHidden
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 9999,
            background: `${theme.toolbar.accent}20`,
            color: theme.toolbar.accent,
            fontWeight: 600,
            flexShrink: 0,
          }}>
            <FileText size={10} />
            {kindLabel}
          </span>
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: theme.toolbar.text,
            opacity: 0.92,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}>
            {titleText}
          </span>
        </div>
      }
      closeIcon={
        <span
          onClick={handleRequestClose}
          onMouseEnter={(e) => { e.currentTarget.style.background = closeHoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            cursor: 'pointer',
            color: 'inherit',
            transition: 'background 0.15s',
          }}
        >
          <X size={14} />
        </span>
      }
      styles={{
        mask: { background: 'transparent' },
        header: {
          marginBottom: 0,
          paddingBottom: 10,
          borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
        },
        body: modalBodyStyle,
        container: {
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: isDark
            ? '0 24px 80px rgba(0,0,0,0.5)'
            : '0 24px 64px rgba(28,25,23,0.18)',
        },
      } as React.ComponentProps<typeof Modal>['styles']}
    >
      {/* 弹窗内按钮 hover/active 过渡（pm-btn 主按钮） */}
      <style>{`
        .pm-btn {
          transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .pm-btn:hover:not(:disabled) {
          filter: brightness(1.06);
          transform: translateY(-1px);
        }
        .pm-btn:active:not(:disabled) {
          transform: translateY(0) scale(0.98);
        }
      `}</style>
      {/* ===== 编辑器主体 — flex 撑满（底部栏由 PromptCreatePage 统一渲染） ===== */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {promptId ? (
          <PromptCreatePage
            modal
            hideTitle
            promptId={promptId}
            onSaved={onSaved ?? onClose}
            onDeleted={onClose}
            onTitleChange={onTitleChange}
            onDirtyChange={setEditDirty}
          />
        ) : (
          <PromptCreatePage
            modal
            hideTitle
            readOnly
            initialData={initialData!}
            onSaved={onClose}
            publicMeta={publicItem ? {
              license: publicItem.license,
              source: publicItem.source,
              sourceName: publicItem.sourceName,
              sourceUrl: publicItem.sourceUrl,
            } : undefined}
          />
        )}
      </div>
    </Modal>
  );
}