/**
 * production-manager-panels - 统筹编辑器子组件（Plan#29 V3）
 *
 * 严格复刻基线子组件（SubjectEditorModal 原版），低对比设计：
 * - ItemImageCard = 资产浏览器 asset-card 1:1（239.2/135.4 + hover 浮条 + 封面星角标）
 * - AlbumPanel = 提示词页面预览区 1:1（棋盘格舞台 + 76×76 胶卷条 + 加号 tile）
 * - SelectedImageDetail = 提示词页面同款表单（prompt 字段 = 自由标签）
 * - ItemNavItem = 状态导航同款（背景分层选中态，hover 显示删除）
 * - ItemThumb = 节点垂直导航缩略图（首张剧照，无图 → kind 图标骨架）
 */
import { memo, useState } from 'react';
import { Tooltip } from 'antd';
import {
  UserRound, MapPin, Package, Plus, Trash2, X, Copy, Star, Loader2, Image as ImageIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { ImageViewerStage, ZoomToolbar, useImagePanZoom } from '@/shared/components/image-viewer.js';
import { AuthorizedImage } from '@/shared/components/authorized-media.js';
import { actionBtnStyle } from '@/features/asset-library/asset-library-styles.js';
import type { ProductionItemImage, ProductionItemKind } from './production-manager-types.js';
import {
  previewStageStyle, previewImageStyle, coverBadgeStyle, imageCounterStyle, emptyPreviewStyle,
  filmstripStyle, thumbItemStyle, thumbImageStyle, thumbCoverBadgeStyle, thumbHoverOverlayStyle, thumbActionBtnStyle, uploadTileStyle,
  formSectionStyle, formLabelStyle, formLabelRowStyle, copyBtnStyle,
  promptBlockStyle, promptTextareaStyle, tagInputStyle, cardCoverStyle, stateNavItemStyle,
} from './production-editor-styles.js';

export const KIND_ICON: Record<ProductionItemKind, React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>> = {
  character: UserRound,
  scene: MapPin,
  prop: Package,
};

// ===== 网格图片卡片（资产浏览器 asset-card.tsx AssetCardGrid 1:1） =====

interface ItemImageCardProps {
  storageKey: string;
  localPreview?: string;
  ordinal: number;
  isCover: boolean;
  /** 自由标签（与资产库提示词 card 同款展示：前 4 个逗号连接 + +N） */
  tags: string[];
  theme: ReturnType<typeof useTheme>['theme'];
  onClick: () => void;
  onDelete: () => void;
}

export const ItemImageCard = memo(function ItemImageCard({
  storageKey, localPreview, ordinal, isCover, tags, theme, onClick, onDelete,
}: ItemImageCardProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const fallback = localPreview ?? getResourceUrl(storageKey, 'preview') ?? '';
  const hydrated = useHydratedContent(storageKey, fallback);
  const [imgError, setImgError] = useState(false);

  return (
    <div
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, width: '100%', cursor: 'pointer' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <div style={cardCoverStyle(theme)}>
        {hydrated && !imgError ? (
          <img
            src={hydrated}
            alt=""
            loading="lazy"
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={() => setImgError(true)}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ImageIcon size={40} color={theme.toolbar.textMuted} />
          </div>
        )}
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.05)',
          opacity: hovered ? 1 : 0, transition: 'opacity 0.3s', pointerEvents: 'none',
        }} />
        {isCover && (
          <div style={{ ...thumbCoverBadgeStyle, zIndex: 2 }}>
            <Star size={8} fill="currentColor" />
          </div>
        )}
      </div>

      {/* 底部信息（资产浏览器同款两行） */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, paddingLeft: 4, paddingRight: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 24 }}>
          <span style={{
            fontSize: 14, lineHeight: '22px', fontWeight: 500, color: theme.toolbar.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
          }}>
            {t('subject.imageOrdinal', { n: ordinal })}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: theme.toolbar.textMuted, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tags.length > 0
              ? tags.slice(0, 4).join(', ') + (tags.length > 4 ? ` +${tags.length - 4}` : '')
              : '—'}
          </span>
        </div>
      </div>

      {/* Hover 操作浮条（资产浏览器同款：删除） */}
      {hovered && (
        <div style={{
          position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4,
          background: theme.toolbar.background, border: `1px solid ${theme.toolbar.border}`,
          borderRadius: 8, padding: '2px 4px', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', zIndex: 10,
        }} onClick={(e) => e.stopPropagation()}>
          <Tooltip title={t('common.delete')}>
            <button type="button" onClick={onDelete} style={{ ...actionBtnStyle(), color: theme.toolbar.danger }}>
              <Trash2 size={13} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
});

// ===== 图册模式（提示词页面 prompt-create-page.tsx 预览区 1:1） =====

export function AlbumPanel({ images, selectedKey, coverKey, localPreviews, theme, panZoom, t, uploading, onSelect, onSetCover, onRemove, onAddFiles }: {
  images: ProductionItemImage[];
  selectedKey: string | null;
  coverKey: string | null;
  localPreviews: Record<string, string>;
  theme: ReturnType<typeof useTheme>['theme'];
  panZoom: ReturnType<typeof useImagePanZoom>;
  t: ReturnType<typeof useTranslation>['t'];
  uploading: boolean;
  onSelect: (key: string) => void;
  onSetCover: (key: string) => void;
  onRemove: (key: string) => void;
  onAddFiles: (files: FileList) => void;
}) {
  const idx = images.findIndex((i) => i.storageKey === selectedKey);
  const current = idx >= 0 ? images[idx] : undefined;
  const rawSrc = current
    ? (localPreviews[current.storageKey] || getResourceUrl(current.storageKey, 'full') || '')
    : '';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      {current ? (
        <ImageViewerStage
          src={rawSrc}
          alt=""
          panZoom={panZoom}
          containerStyle={previewStageStyle(theme)}
          imgStyle={previewImageStyle}
          onImgError={(e) => { e.currentTarget.style.opacity = '0.3'; }}
        >
          {coverKey === current.storageKey && (
            <div style={coverBadgeStyle}>
              <Star size={11} fill="currentColor" />
              {t('subject.coverImage')}
            </div>
          )}
          <div style={imageCounterStyle}>
            {idx + 1} / {images.length}
          </div>
          <ZoomToolbar panZoom={panZoom} orientation="vertical" style={{ position: 'absolute', bottom: 10, right: 10 }} />
        </ImageViewerStage>
      ) : (
        <div style={previewStageStyle(theme)}>
          <div style={emptyPreviewStyle}>
            <span style={{ fontSize: 12, opacity: 0.5 }}>{t('subject.noImages')}</span>
          </div>
        </div>
      )}

      {/* 缩略图胶卷条（提示词页面同款 76×76，hover 设封面/删除，设封面唯一入口） */}
      <div style={filmstripStyle()}>
        {images.map((img) => {
          const thumbSrc = localPreviews[img.storageKey] || getResourceUrl(img.storageKey, 'preview') || '';
          const isActive = img.storageKey === selectedKey;
          const isCover = coverKey === img.storageKey;
          return (
            <div
              key={img.storageKey}
              style={thumbItemStyle(theme, isActive, isCover)}
              onClick={() => onSelect(img.storageKey)}
            >
              <AuthorizedImage
                src={thumbSrc}
                alt=""
                style={thumbImageStyle}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              {isCover && (
                <div style={thumbCoverBadgeStyle}>
                  <Star size={8} fill="currentColor" />
                </div>
              )}
              <div
                style={thumbHoverOverlayStyle}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
              >
                {!isCover && (
                  <button
                    type="button"
                    style={thumbActionBtnStyle}
                    onClick={(e) => { e.stopPropagation(); onSetCover(img.storageKey); }}
                    title={t('subject.setAsCover')}
                  >
                    <ImageIcon size={11} />
                  </button>
                )}
                <Tooltip title={t('promptCreate.remove')}>
                  <button
                    type="button"
                    style={thumbActionBtnStyle}
                    onClick={(e) => { e.stopPropagation(); onRemove(img.storageKey); }}
                  >
                    <X size={11} />
                  </button>
                </Tooltip>
              </div>
            </div>
          );
        })}
        {/* 上传按钮（提示词页面同款加号 tile） */}
        <label style={uploadTileStyle(theme)}>
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files && e.target.files.length > 0) onAddFiles(e.target.files); e.target.value = ''; }}
          />
          {uploading ? <Loader2 size={20} style={{ animation: 'zeroexo-spin 1s linear infinite' }} /> : <Plus size={22} />}
        </label>
      </div>
    </div>
  );
}

// ===== 单图详情（提示词页面同款表单；prompt=提示词，note=备注，tags=自由标签） =====

export function SelectedImageDetail({ image, ordinal, theme, t, onPromptChange, onNoteChange, onTagsChange, onCopy }: {
  image: ProductionItemImage;
  ordinal: number;
  theme: ReturnType<typeof useTheme>['theme'];
  t: ReturnType<typeof useTranslation>['t'];
  onPromptChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onTagsChange: (tags: string[]) => void;
  onCopy: () => void;
}) {
  return (
    <div style={{ ...formSectionStyle(), flex: 1, minHeight: 0, gap: 14 }}>
      {/* 提示词 */}
      <div style={formSectionStyle()}>
        <div style={formLabelRowStyle()}>
          <label style={formLabelStyle(theme)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            {t('productionManager.prompt')}
          </label>
          <button
            type="button"
            onClick={onCopy}
            style={copyBtnStyle(theme)}
            title={t('subject.copyPrompt')}
          >
            <Copy size={12} />
            {t('subject.copyPrompt')}
          </button>
        </div>
        <div style={{ ...promptBlockStyle(theme), flex: 1, minHeight: 120, display: 'flex', flexDirection: 'column' }}>
          <textarea
            value={image.prompt ?? ''}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder={t('productionManager.promptPlaceholder')}
            style={{ ...promptTextareaStyle(theme), flex: 1 }}
          />
        </div>
      </div>
      {/* 标签（自由标签，区分不同时期/造型） */}
      <div style={formSectionStyle()}>
        <label style={formLabelStyle(theme)}>{t('productionManager.tags')}</label>
        <input
          value={image.tags.join(', ')}
          onChange={(e) => onTagsChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          placeholder={t('productionManager.tagPlaceholder')}
          style={tagInputStyle(theme)}
        />
      </div>
      {/* 备注 */}
      <div style={formSectionStyle()}>
        <label style={formLabelStyle(theme)}>{t('productionManager.note')}</label>
        <input
          value={image.note ?? ''}
          onChange={(e) => onNoteChange(e.target.value)}
          style={tagInputStyle(theme)}
        />
      </div>
      <span style={{ fontSize: 11, color: theme.toolbar.textMuted, marginTop: 'auto' }}>
        {t('subject.imageOrdinal', { n: ordinal })}
      </span>
    </div>
  );
}

// ===== 条目导航条目（无边线：背景分层，删除按钮 hover 显示） =====

interface ItemNavItemProps {
  index: number;
  name: string;
  count: number;
  isActive: boolean;
  accent: string;
  surfaceBg: string;
  textMuted: string;
  deletable: boolean;
  /** 删除按钮 Tooltip 文案（antd Tooltip） */
  tDelete: string;
  onClick: () => void;
  onDelete: () => void;
}

export function ItemNavItem({ index, name, count, isActive, accent, surfaceBg, textMuted, deletable, tDelete, onClick, onDelete }: ItemNavItemProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={stateNavItemStyle(isActive, accent, surfaceBg)}
    >
      <span style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, background: isActive ? accent : 'rgba(128,128,128,0.2)', color: isActive ? '#fff' : 'inherit',
      }}>
        {index + 1}
      </span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: isActive ? 600 : 400 }}>{name}</span>
      <span style={{ fontSize: 10, color: textMuted, flexShrink: 0 }}>{count}</span>
      {deletable && hovered && (
        <Tooltip title={tDelete}>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: textMuted, flexShrink: 0 }}>
            <Trash2 size={11} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

// ===== 节点垂直导航缩略图（首张剧照，无图 → kind 图标骨架） =====

export function ItemThumb({ kind, storageKey, dark }: { kind: ProductionItemKind; storageKey?: string; dark: boolean }): React.ReactElement {
  const KindIcon = KIND_ICON[kind];
  const fallback = storageKey ? (getResourceUrl(storageKey, 'preview') ?? '') : '';
  const hydrated = useHydratedContent(storageKey ?? '', fallback);
  if (!hydrated) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', color: dark ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.35)' }}>
        <KindIcon size={14} />
      </div>
    );
  }
  return <img src={hydrated} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
}
