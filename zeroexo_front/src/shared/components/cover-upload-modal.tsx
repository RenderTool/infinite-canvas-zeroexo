/**
 * CoverUploadModal - 项目封面上传弹窗
 *
 * 参考: references/动效参考/封面.jsx
 * - 支持 JPG/PNG 格式, 限制 5MB
 * - 保持 16:9 比例预览
 * - 入场动画: scale(0.96) → scale(1) bouncy 曲线
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, X } from 'lucide-react';
import { Modal, Button, App } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { useAuthImageUrl } from '@/shared/hooks/use-auth-image.js';

export interface CoverUploadModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => void;
  initialCover?: string;
}

export function CoverUploadModal({
  open,
  onCancel,
  onConfirm,
  initialCover,
}: CoverUploadModalProps): React.ReactElement {
  const { theme } = useTheme();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(() => initialCover ? (getResourceUrl(initialCover, 'full') ?? initialCover) : null);
  // 后端私有封面不拼接 token,经 useAuthImageUrl 认证(fetch + Authorization header → blob URL)
  const authPreviewUrl = useAuthImageUrl(previewUrl ?? undefined);

  /** 将 storageKey 转成可显示 URL(不拼接 token) */
  const resolveCover = useCallback((key: string | null | undefined): string | null => {
    if (!key) return null;
    return getResourceUrl(key, 'full') ?? key;
  }, []);

  // initialCover 变化时更新 previewUrl，确保不同项目打开弹窗时显示正确封面
  useEffect(() => {
    setPreviewUrl(resolveCover(initialCover));
  }, [initialCover, resolveCover]);

  // 弹窗关闭时清理 blob URL，避免内存泄漏
  useEffect(() => {
    if (!open) {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(resolveCover(initialCover));
      fileRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCover]);

  const triggerUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      message.error(t('coverUpload.unsupportedFormat'));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      message.error(t('coverUpload.sizeExceeded'));
      return;
    }

    fileRef.current = file;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  }, [message, t]);

  const removeCover = useCallback(() => {
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    fileRef.current = null;
    setPreviewUrl(null);
  }, [previewUrl]);

  const handleConfirm = useCallback(() => {
    if (!fileRef.current) {
      message.error(t('coverUpload.pleaseUpload'));
      return;
    }
    onConfirm(fileRef.current);
  }, [onConfirm, message, t]);

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      centered
      destroyOnHidden
      width={720}
      title={
        <span style={{ fontWeight: 600, fontSize: 16, color: theme.toolbar.text }}>
          {t('coverUpload.title')}
        </span>
      }
      footer={[
        <Button
          key="cancel"
          onClick={onCancel}
          style={{
            background: 'transparent',
            borderColor: theme.toolbar.border,
            color: theme.toolbar.text,
          }}
        >
          {t('common.cancel')}
        </Button>,
        <Button
          key="confirm"
          type="primary"
          onClick={handleConfirm}
          disabled={!previewUrl}
          style={{
            background: theme.toolbar.accent,
            borderColor: theme.toolbar.accent,
            color: '#ffffff',
          }}
        >
          {t('coverUpload.saveCover')}
        </Button>,
      ]}
      styles={{
        body: { padding: 0 },
        mask: { background: 'transparent' },
        container: {
          background: theme.canvas.background,
          border: `1px solid ${theme.toolbar.border}`,
          borderRadius: 12,
          boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.4)' : '0 8px 32px rgba(0,0,0,0.12)',
        } as CSSProperties,
        header: {
          marginBottom: 0,
          padding: '16px 20px',
          borderBottom: `1px solid ${theme.toolbar.border}`,
        },
        footer: {
          padding: '12px 20px',
          borderTop: `1px solid ${theme.toolbar.border}`,
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 12,
        },
      }}
    >
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 上传交互区 */}
        <div
          onClick={triggerUpload}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            border: `2px dashed ${previewUrl ? theme.toolbar.border : theme.toolbar.accent}`,
            borderRadius: 12,
            cursor: 'pointer',
            background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
            transition: 'border-color 0.2s',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <Upload size={20} style={{ marginBottom: 8, color: theme.toolbar.textMuted }} />
          <p style={{ fontSize: 13, fontWeight: 500, color: theme.toolbar.text, margin: 0 }}>
            {t('coverUpload.dragHint')}
          </p>
          <p style={{ fontSize: 12, marginTop: 4, color: theme.toolbar.textMuted, margin: '4px 0 0' }}>
            {t('coverUpload.formatHint')}
          </p>
          <p style={{ fontSize: 11, marginTop: 2, color: theme.toolbar.textMuted, opacity: 0.6, margin: '2px 0 0' }}>
            {t('coverUpload.compressHint')}
          </p>
        </div>

        {/* 预览区 */}
        {previewUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '16 / 9',
                borderRadius: 8,
                overflow: 'hidden',
                border: `1px solid ${theme.toolbar.border}`,
              }}
            >
              <img
                src={authPreviewUrl ?? previewUrl ?? ''}
                alt="封面预览"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <button
                type="button"
                onClick={removeCover}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  width: 32,
                  height: 32,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  borderRadius: 6,
                  background: 'rgba(0,0,0,0.4)',
                  color: '#fff',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.6)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; }}
                aria-label={t('coverUpload.removeCover')}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}