/**
 * asset-card - 素材卡片组件
 *
 * 从 asset-library-page.tsx 内联 AssetCard 抽出。
 * 处理图片/视频/音频/文本四种素材类型。
 * 末尾调用 registerCard 注册到卡片注册表。
 */

import { useState, useRef, useEffect } from 'react';
import {
  Image as ImageIcon,
  Video as VideoIcon,
  Music as MusicIcon,
  FileText,
  BookOpen,
  Play,
  Download,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Tooltip } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';
import type { TFunction } from 'i18next';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import { registerCard, type GridCardRendererProps, type ListCardRendererProps } from './card-registry.js';
import { actionBtnStyle } from '../asset-library-styles.js';

// ===== 辅助 =====

function getKindIcon(kind: string, theme: ThemeConfig): React.ReactElement {
  const color = theme.toolbar.textMuted;
  switch (kind) {
    case 'image': return <ImageIcon size={40} color={color} />;
    case 'video': return <VideoIcon size={40} color={color} />;
    case 'audio': return <MusicIcon size={40} color={color} />;
    case 'text': return <FileText size={40} color={color} />;
    case 'script': return <BookOpen size={40} color={color} />;
    default: return <FileText size={40} color={color} />;
  }
}

function getKindLabel(kind: string, t: TFunction): string {
  const key = `asset.kind${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  return t(key);
}

// ===== 网格渲染 =====

function AssetCardGrid({
  item: asset,
  multiSelectEnabled,
  onToggleSelect,
  onOpen,
  onRename,
  onDelete,
  onDownload,
  onContextMenu,
  theme,
  t,
}: GridCardRendererProps<any>): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const data = asset.data;
  const isImage = data.kind === 'image';
  const isVideo = data.kind === 'video';
  const cover = isImage ? data.dataUrl : isVideo ? data.url : undefined;
  const hydrated = useHydratedContent(
    isImage || isVideo ? data.storageKey : undefined,
    cover ?? '',
  );
  const [coverError, setCoverError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoCreated] = useState(isVideo);

  // 视频悬停播放/暂停
  useEffect(() => {
    if (!isVideo || !videoRef.current) return;
    if (hovered) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [hovered, isVideo]);

  const kindIcon = getKindIcon(asset.kind, theme);
  const showCover = (isImage || isVideo) && hydrated && !coverError;
  const isDark = theme.mode === 'dark';
  const coverBg = isDark ? 'rgba(255,255,255,0.02)' : '#ffffff';
  const coverBorder = isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid #e5e7eb';

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: '100%',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={multiSelectEnabled ? () => onToggleSelect(asset.id) : onOpen}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-testlib-item', JSON.stringify({
          type: 'asset',
          id: asset.id,
          name: asset.title,
        }));
      }}
    >
      {/* 封面区域 */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '239.2 / 135.4',
          borderRadius: 12,
          overflow: 'hidden',
          background: coverBg,
          border: coverBorder,
        }}
      >
        {isVideo && videoCreated ? (
          <video
            ref={videoRef}
            src={hydrated}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            muted
            playsInline
            preload="metadata"
          />
        ) : showCover && isImage ? (
          <img
            src={hydrated}
            alt={asset.title}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={() => setCoverError(true)}
          />
        ) : (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {kindIcon}
          </div>
        )}
        {/* 视频播放图标 */}
        {isVideo && !hovered && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.15)',
            pointerEvents: 'none',
          }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Play size={20} color="#fff" fill="#fff" />
            </div>
          </div>
        )}
        {/* Hover 遮罩 */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.05)',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.3s',
          pointerEvents: 'none',
        }} />
      </div>

      {/* 底部信息 */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
        paddingLeft: 4,
        paddingRight: 4,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 24 }}>
          <span style={{
            fontSize: 14,
            lineHeight: '22px',
            fontWeight: 500,
            color: theme.toolbar.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}>
            {asset.title}
          </span>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontSize: 11,
            color: theme.toolbar.textMuted,
            fontWeight: 500,
          }}>
            {getKindLabel(asset.kind, t)}
          </span>
        </div>
      </div>

      {/* Hover 操作按钮 */}
      {hovered && (
        <div style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: 4,
          background: theme.toolbar.background,
          border: `1px solid ${theme.toolbar.border}`,
          borderRadius: 8,
          padding: '2px 4px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          zIndex: 10,
        }} onClick={(e) => e.stopPropagation()}>
          <Tooltip title={t('common.download')}>
            <button type="button" onClick={() => onDownload?.()} style={actionBtnStyle()}>
              <Download size={13} />
            </button>
          </Tooltip>
          <Tooltip title={t('assetLibrary.rename')}>
            <button type="button" onClick={onRename} style={actionBtnStyle()}>
              <Pencil size={13} />
            </button>
          </Tooltip>
          <Tooltip title={t('assetLibrary.delete')}>
            <button type="button" onClick={onDelete} style={actionBtnStyle()}>
              <Trash2 size={13} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ===== 列表渲染 =====

function AssetCardList({
  item: asset,
  onClick,
  theme,
}: ListCardRendererProps<any>): React.ReactElement {
  const kind = asset.kind as string;
  const iconMap: Record<string, React.ReactElement> = {
    image: <ImageIcon size={14} color={theme.toolbar.textMuted} />,
    video: <VideoIcon size={14} color={theme.toolbar.textMuted} />,
    audio: <MusicIcon size={14} color={theme.toolbar.textMuted} />,
    text: <FileText size={14} color={theme.toolbar.textMuted} />,
    script: <BookOpen size={14} color={theme.toolbar.textMuted} />,
  };
  const kindIcon = iconMap[kind] || <FileText size={14} color={theme.toolbar.textMuted} />;

  return (
    <>
      <span
        style={{ width: '40%', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={onClick}
      >
        {kindIcon}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {asset.title}
        </span>
      </span>
      <span style={{ width: '20%' }}>
        <span style={{ fontSize: 10, padding: '0 6px', borderRadius: 4, border: `1px solid ${theme.toolbar.border}`, color: theme.toolbar.textMuted }}>
          {asset.kind}
        </span>
      </span>
      <span style={{ width: '20%', color: theme.toolbar.textMuted, fontSize: 11 }}>
        {asset.bytes ? `${(asset.bytes / 1024).toFixed(1)} KB` : '-'}
      </span>
      <span style={{ width: '20%', color: theme.toolbar.textMuted, fontSize: 11 }}>
        {asset.createdAt ? new Date(asset.createdAt).toLocaleDateString() : '-'}
      </span>
    </>
  );
}

// ===== 注册 =====

registerCard('asset', {
  renderGrid: AssetCardGrid,
  renderList: AssetCardList,
});