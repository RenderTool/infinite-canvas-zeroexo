/**
 * asset-card - 素材卡片组件
 *
 * 从 asset-library-page.tsx 内联 AssetCard 抽出。
 * 处理图片/视频/音频/文本四种素材类型。
 * 末尾调用 registerCard 注册到卡片注册表。
 */

import { useState, useRef, useEffect, useMemo } from 'react';
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
  Send,
  MoreHorizontal,
} from 'lucide-react';
import { Tooltip, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';
import type { TFunction } from 'i18next';
import { usePreviewImage } from '@zeroexo/plugin-nodes';
import { registerCard, type GridCardRendererProps, type ListCardRendererProps } from './card-registry.js';

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
  onSendToCanvas,
  theme,
  t,
}: GridCardRendererProps<any>): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const data = asset.data;
  const isImage = data.kind === 'image';
  const isVideo = data.kind === 'video';
  const cover = isImage ? data.dataUrl : isVideo ? data.url : undefined;
  // 封面走三档图片契约(征集 #77):展示层自适应预览档,永不直连原图;
  // 视频无尺寸变体概念,usePreviewImage 内部自动回退 hydrate 行为(悬停播放不受影响)
  const hydrated = usePreviewImage(
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

  // 更多下拉菜单：下载 / 重命名 / 删除（画布项目卡片同款）
  const moreMenuItems = useMemo<MenuProps['items']>(() => {
    const items: MenuProps['items'] = [];
    if (onDownload) {
      items.push({
        key: 'download',
        icon: <Download size={14} />,
        label: t('common.download'),
        onClick: (e) => { e.domEvent.stopPropagation(); onDownload(); },
      });
    }
    items.push({
      key: 'rename',
      icon: <Pencil size={14} />,
      label: t('assetLibrary.rename'),
      onClick: (e) => { e.domEvent.stopPropagation(); onRename(); },
    });
    items.push({
      key: 'delete',
      icon: <Trash2 size={14} />,
      label: t('assetLibrary.delete'),
      danger: true,
      onClick: (e) => { e.domEvent.stopPropagation(); onDelete(); },
    });
    return items;
  }, [onDownload, onRename, onDelete, t]);

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
        // 验收轮二十一:payload 携带完整数据 → 画布 drop 直接建节点;封面 img/video 已禁拖(防浏览器附带文件)
        e.dataTransfer.setData('application/x-testlib-item', JSON.stringify({
          type: 'asset',
          id: asset.id,
          name: asset.title,
          data: asset,
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
            draggable={false}
            muted
            playsInline
            preload="metadata"
          />
        ) : showCover && isImage ? (
          <img
            src={hydrated}
            alt={asset.title}
            loading="lazy"
            draggable={false}
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

        {/* 发送到画布快捷按钮(常驻,仅画布内嵌时提供) */}
        {onSendToCanvas && (
          <Tooltip title={t('assetLibrary.sendToCanvas')}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSendToCanvas(); }}
              // 征集 #95(Plan#49 T28):hover 后显示,与卡片其它操作按钮(更多/重命名/删除)显隐一致
              style={{
                ...cardActionBtnStyle, position: 'absolute', top: 8, right: 8, zIndex: 10,
                opacity: hovered ? 1 : 0, transition: 'opacity 0.2s, background 0.15s',
              }}
            >
              <Send size={13} />
            </button>
          </Tooltip>
        )}
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
          gap: 8,
        }}>
          <span style={{
            fontSize: 11,
            color: theme.toolbar.textMuted,
            fontWeight: 500,
          }}>
            {getKindLabel(asset.kind, t)}
          </span>
          {/* 画布项目卡片同款「更多」按钮(下载/重命名/删除) */}
          <Dropdown
            menu={{ items: moreMenuItems }}
            trigger={['click']}
            placement="bottomRight"
          >
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              style={{
                flexShrink: 0,
                width: 24,
                height: 24,
                padding: 0,
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.toolbar.textMuted,
                opacity: hovered ? 1 : 0,
                transition: 'opacity 0.2s, background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Tooltip title={t('projectCard.moreActions')}>
                <MoreHorizontal size={14} />
              </Tooltip>
            </button>
          </Dropdown>
        </div>
      </div>
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

// ===== 竖排操作按钮样式(提示词卡同款:28×28 半透明黑) =====

const cardActionBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'rgba(0,0,0,0.45)',
  color: '#fff',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s',
};

// ===== 注册 =====

registerCard('asset', {
  renderGrid: AssetCardGrid,
  renderList: AssetCardList,
});