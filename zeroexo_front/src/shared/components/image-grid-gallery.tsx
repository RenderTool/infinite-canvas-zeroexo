/**
 * ImageGridGallery - 通用网格图库组件（Plan#20 主体系统重设计 T5r）
 *
 * 统一服务：主体详情（每状态图库）/ 堆叠节点详情 / 资产浏览器。
 *
 * 能力：
 * - 网格缩略图展示（与资产库卡片视觉一致）
 * - 导入图片（内置上传：进度条 + blob 本地预览 + 落库 storageKey）
 * - 删除 / 设为封面（cover 角标）
 * - 点击大图预览（内置 lightbox，复用 image-viewer pan/zoom）
 *
 * 设计原则：presentational + 自包含上传；theme token 化，双主题自适应。
 */
import { memo, useCallback, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload as UploadIcon, X, Star, Loader2, Image as ImageIcon } from 'lucide-react';
import { App as AntdApp } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { AuthorizedImage } from '@/shared/components/authorized-media.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { ImageViewerStage, ZoomToolbar, useImagePanZoom } from '@/shared/components/image-viewer.js';

export interface ImageGridGalleryProps {
  /** 图片 storageKey 列表 */
  imageKeys: string[];
  /** 封面 storageKey（null 表示未设置） */
  coverKey?: string | null;
  /** 图片集合变更（增删后回写） */
  onImageKeysChange: (keys: string[]) => void;
  /** 设为封面回调（可选；不提供则隐藏"设封面"按钮） */
  onSetCover?: (storageKey: string) => void;
  /** 只读模式（隐藏导入/删除/设封面） */
  readOnly?: boolean;
  /** 空态提示文案 */
  emptyHint?: string;
  /** 网格列数（默认 auto-fill 自适应） */
  tileMinSize?: number;
}

export const ImageGridGallery = memo(function ImageGridGallery({
  imageKeys,
  coverKey,
  onImageKeysChange,
  onSetCover,
  readOnly = false,
  emptyHint,
  tileMinSize = 96,
}: ImageGridGalleryProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const { message: antdMessage } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();

  // 上传进度表：localId → progress
  const [uploading, setUploading] = useState<Record<string, number>>({});
  // 本地预览表：storageKey → blob/dataUrl（上传后立即显示，直到后端缩略图可用）
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idCounter = useRef(0);

  // 大图预览
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  // hover 中的图（显示操作层）
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const textMuted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const tileBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';

  const resolveSrc = useCallback(
    (key: string): string | undefined => {
      return localPreviews[key] ?? getResourceUrl(key, 'thumb');
    },
    [localPreviews],
  );

  // 导入图片
  const handleImport = useCallback(
    async (file: File) => {
      if (!isAuthenticated) {
        antdMessage.warning(t('subjectCreate.loginRequired'));
        return;
      }
      const localId = `up_${++idCounter.current}`;
      setUploading((prev) => ({ ...prev, [localId]: 0 }));
      try {
        const uploaded = await uploadAsset(file, (loaded, total) => {
          const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
          setUploading((prev) => ({ ...prev, [localId]: pct }));
        });
        const data = uploaded.data as { kind?: string; storageKey?: string; dataUrl?: string; url?: string };
        const storageKey = data.storageKey ?? '';
        const preview = data.kind === 'image' ? data.dataUrl : undefined;
        if (storageKey) {
          if (preview) setLocalPreviews((prev) => ({ ...prev, [storageKey]: preview }));
          onImageKeysChange([...imageKeys, storageKey]);
        }
      } catch (err) {
        antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
      } finally {
        setUploading((prev) => {
          const next = { ...prev };
          delete next[localId];
          return next;
        });
      }
    },
    [isAuthenticated, antdMessage, t, imageKeys, onImageKeysChange],
  );

  const handleRemove = useCallback(
    (key: string) => {
      onImageKeysChange(imageKeys.filter((k) => k !== key));
    },
    [imageKeys, onImageKeysChange],
  );

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${tileMinSize}px, 1fr))`,
    gap: 8,
  };

  return (
    <>
      <div style={gridStyle}>
        {/* 已有图片 */}
        {imageKeys.map((key) => {
          const src = resolveSrc(key);
          const isCover = coverKey === key;
          return (
            <div
              key={key}
              style={tileStyle(tileBg, border, isCover, accent)}
              onClick={() => setPreviewKey(key)}
              onMouseEnter={() => setHoveredKey(key)}
              onMouseLeave={() => setHoveredKey((k) => (k === key ? null : k))}
            >
              {src ? (
                <AuthorizedImage
                  src={src}
                  alt=""
                  draggable={false}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, display: 'block' }}
                  onError={(e) => { e.currentTarget.style.opacity = '0.3'; }}
                />
              ) : (
                <div style={tilePlaceholderStyle(textMuted)}>
                  <ImageIcon size={18} />
                </div>
              )}
              {/* 封面角标 */}
              {isCover && (
                <span style={coverBadgeStyle(accent)} title={t('subject.coverImage')}>
                  <Star size={10} fill="#fff" />
                </span>
              )}
              {/* hover 操作层 */}
              {!readOnly && (
                <div style={{ ...hoverOverlayStyle, opacity: hoveredKey === key ? 1 : 0 }} onClick={(e) => e.stopPropagation()}>
                  {onSetCover && !isCover && (
                    <button type="button" style={tileActionBtnStyle} title={t('subject.setAsCover')}
                      onClick={() => onSetCover(key)}>
                      <Star size={12} />
                    </button>
                  )}
                  <button type="button" style={{ ...tileActionBtnStyle, background: 'rgba(220,38,38,0.9)' }}
                    title={t('common.delete')} onClick={() => handleRemove(key)}>
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* 上传中的进度块 */}
        {Object.entries(uploading).map(([localId, pct]) => (
          <div key={localId} style={tileStyle(tileBg, border, false, accent)}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, width: '100%', height: '100%' }}>
              <Loader2 size={16} style={{ color: accent, animation: 'zeroexo-spin 1s linear infinite' }} />
              <span style={{ fontSize: 10, color: textMuted }}>{pct}%</span>
            </div>
          </div>
        ))}

        {/* 导入按钮 */}
        {!readOnly && (
          <button
            type="button"
            style={addTileStyle(border, textMuted)}
            onClick={() => fileInputRef.current?.click()}
            title={t('subject.importImage')}
          >
            <UploadIcon size={16} />
          </button>
        )}
      </div>

      {/* 空态提示 */}
      {imageKeys.length === 0 && Object.keys(uploading).length === 0 && emptyHint && (
        <div style={{ fontSize: 11, color: textMuted, marginTop: 8 }}>{emptyHint}</div>
      )}

      {/* 隐藏文件输入 */}
      {!readOnly && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = e.target.files;
            if (files) Array.from(files).forEach((f) => void handleImport(f));
            e.target.value = '';
          }}
        />
      )}

      {/* 大图预览 lightbox */}
      {previewKey && (
        <GalleryLightbox
          src={resolveSrc(previewKey) ?? previewKey}
          onClose={() => setPreviewKey(null)}
        />
      )}
    </>
  );
});

// ===== 大图预览（复用统一图片查看框架） =====

function GalleryLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const panZoom = useImagePanZoom();
  const { theme } = useTheme();
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 40000,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div style={{ width: '80vw', height: '80vh' }} onClick={(e) => e.stopPropagation()}>
        <ImageViewerStage
          src={src}
          panZoom={panZoom}
          containerStyle={{ background: 'transparent', borderRadius: 8 }}
        >
          <div style={{ position: 'absolute', left: 12, top: 12 }}>
            <ZoomToolbar panZoom={panZoom} orientation="horizontal" />
          </div>
        </ImageViewerStage>
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{ position: 'absolute', top: 20, right: 24, background: 'rgba(255,255,255,0.15)', border: 'none', color: theme.toolbar.text, borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
      >
        <X size={18} />
      </button>
    </div>
  );
}

// ===== 样式（无边线风格：背景分层 + 阴影，遵循 DESIGN.md） =====

function tileStyle(bg: string, _border: string, isCover: boolean, accent: string): CSSProperties {
  return {
    position: 'relative',
    aspectRatio: '1 / 1',
    borderRadius: 8,
    background: bg,
    boxShadow: isCover ? `0 0 0 2px ${accent}` : '0 1px 4px rgba(0,0,0,0.08)',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'box-shadow 0.15s',
  };
}

function tilePlaceholderStyle(color: string): CSSProperties {
  return {
    width: '100%', height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color, opacity: 0.4,
  };
}

function coverBadgeStyle(accent: string): CSSProperties {
  return {
    position: 'absolute', top: 6, left: 6,
    width: 20, height: 20, borderRadius: '50%',
    background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)', zIndex: 2,
  };
}

const hoverOverlayStyle: CSSProperties = {
  position: 'absolute', inset: 0,
  display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
  gap: 4, padding: 6,
  background: 'linear-gradient(to top, rgba(0,0,0,0.35), transparent 50%)',
  opacity: 0, transition: 'opacity 0.15s',
};

const tileActionBtnStyle: CSSProperties = {
  width: 24, height: 24, borderRadius: '50%', border: 'none',
  background: 'rgba(0,0,0,0.6)', color: '#fff', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function addTileStyle(_border: string, color: string): CSSProperties {
  return {
    aspectRatio: '1 / 1',
    borderRadius: 8,
    border: 'none',
    background: 'rgba(128,128,128,0.08)',
    color, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.15s',
  };
}
