/**
 * PickerCard - 资源选择器单卡片(纯展示组件)
 *
 * 可点击插入 + 可拖拽(HTML5 drag,setData 'application/x-canvas-asset')。
 * 接收 theme prop,不直接依赖 useTheme。
 *
 * 支持选择模式:
 * - selectMode=true 时,左上角显示复选框,点击只切换选中,不触发插入
 * - selectMode=true 时,隐藏"插入"遮罩层
 */

import { useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { FileText, ImageIcon, CheckSquare, Square, Download } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import type { Asset, InsertAssetPayload } from '../index.js';
import { downloadAsset } from '../services/download-asset.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { AuthorizedImage, AuthorizedVideo } from '@/shared/components/authorized-media.js';
import { stripMarkdown } from '@/shared/utils/markdown.js';

const DRAG_MIME = 'application/x-canvas-asset';

/** 将 Asset 转换为可插入画布的 payload(同时用于点击插入与拖拽)。 */
export function toInsertPayload(asset: Asset): InsertAssetPayload {
  const data = asset.data;
  if (data.kind === 'text' || data.kind === 'script') {
    // md 格式发送到画布时还原为纯文本；script 插入画布有专属链路(资产库剧本分组),此处文本化兜底
    const content = asset.mimeType === 'text/markdown' ? stripMarkdown(data.content) : data.content;
    return { kind: 'text', content, title: asset.title };
  }
  if (data.kind === 'video') {
    return {
      kind: 'video',
      url: data.url,
      storageKey: data.storageKey,
      title: asset.title,
      width: data.width,
      height: data.height,
      durationMs: data.durationMs,
    };
  }
  if (data.kind === 'audio') {
    return {
      kind: 'audio',
      url: data.url,
      storageKey: data.storageKey,
      title: asset.title,
      durationMs: data.durationMs,
    };
  }
  // image（plan 等无媒体字段的类型不会走到此分支，dataUrl 恒有值）
  return {
    kind: 'image',
    dataUrl: data.dataUrl ?? '',
    storageKey: data.storageKey,
    title: asset.title,
    width: data.width,
    height: data.height,
  };
}

/** 格式化时长(ms → mm:ss) */
function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface PickerCardProps {
  asset: Asset;
  theme: ThemeConfig;
  onClick: () => void;
  onDragStart: () => void;
  /** 是否处于选择模式(选择模式下点击只切换选中,不触发插入画布) */
  selectMode?: boolean;
  /** 是否已选中(仅在选择模式下生效) */
  selected?: boolean;
}

export function PickerCard({ asset, theme, onClick, onDragStart, selectMode = false, selected = false }: PickerCardProps): React.ReactElement {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const payload = toInsertPayload(asset);
  const data = asset.data;
  // 问题10: 刷新后 blob URL 失效,通过 storageKey 重建 cover URL
  // image: 用 storageKey 重新解析 dataUrl; video: 用 storageKey 重建 blob URL 供 <video> 预览
  // audio/text: 无封面,显示图标
  const coverStorageKey =
    data.kind === 'image' || data.kind === 'video' || data.kind === 'audio' ? data.storageKey : undefined;
  const rawCover = asset.coverUrl;
  const hydratedCover = useHydratedContent(coverStorageKey, rawCover ?? '');
  // useHydratedContent 不处理 resources/ 前缀（后端键），手动构建后端 URL(不拼接 token,由 AuthorizedImage/AuthorizedVideo 携带 Authorization header)
  const cover = ((): string | undefined => {
    if (hydratedCover && !hydratedCover.startsWith('resources/')) return hydratedCover;
    const key = coverStorageKey ?? rawCover;
    // 封面走三档图片契约(征集 #77):图片预览档,视频/音频无尺寸变体维持 full 解析
    return key ? getResourceUrl(key, data.kind === 'image' ? 'preview' : 'full') : undefined;
  })();
  const duration = data.kind === 'video' || data.kind === 'audio' ? formatDuration(data.durationMs) : '';
  const kindLabel = t(`asset.kind${asset.kind.charAt(0).toUpperCase()}${asset.kind.slice(1)}`);

  const handleDragStart = (e: DragEvent<HTMLButtonElement>): void => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
    onDragStart();
  };

  const cardStyle: CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    cursor: selectMode ? 'default' : 'pointer',
    overflow: 'hidden',
    borderRadius: 8,
    padding: 0,
    textAlign: 'left',
    border: `1px solid ${selected ? theme.toolbar.accent : hovered ? theme.toolbar.accent : theme.toolbar.border}`,
    background: theme.node.contentBackground,
    transition: 'border 0.15s',
    opacity: selectMode && !selected ? 0.85 : 1,
  };

  const coverBase: CSSProperties = { aspectRatio: '4 / 3', width: '100%', display: 'block' };
  const coverImgStyle: CSSProperties = { ...coverBase, objectFit: 'cover' };
  const coverFallbackStyle: CSSProperties = {
    ...coverBase,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    background: theme.toolbar.background,
    color: theme.toolbar.textMuted,
  };

  // 不同类型的图标
  const fallbackIcon = (() => {
    const size = 32;
    const op = 0.4;
    if (asset.kind === 'video') return <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}><path d="M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z"/><path d="M7 21h10"/><rect width="20" height="14" x="2" y="3" rx="2"/></svg>;
    if (asset.kind === 'audio') return <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>;
    if (asset.kind === 'text') return <FileText size={size} style={{ opacity: op }} />;
    return <ImageIcon size={size} style={{ opacity: op }} />;
  })();

  // 时长标签(视频/音频)
  const durationTagStyle: CSSProperties = {
    position: 'absolute',
    right: 6,
    bottom: 6,
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 4,
    background: 'rgba(0,0,0,0.7)',
    color: '#ffffff',
    pointerEvents: 'none',
  };

  // 选择模式复选框
  const checkboxStyle: CSSProperties = {
    position: 'absolute',
    top: 6,
    left: 6,
    zIndex: 2,
    width: 22,
    height: 22,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    background: selected ? theme.toolbar.accent : 'rgba(0,0,0,0.4)',
    color: '#ffffff',
    pointerEvents: 'none',
  };

  const footerStyle: CSSProperties = {
    padding: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  };
  const titleStyle: CSSProperties = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    fontWeight: 500,
    color: theme.toolbar.text,
  };
  const tagStyle: CSSProperties = {
    flexShrink: 0,
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 4,
    background: theme.toolbar.background,
    color: theme.toolbar.textMuted,
    border: `1px solid ${theme.toolbar.border}`,
  };

  const downloadBtnStyle: CSSProperties = {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 2,
    width: 22,
    height: 22,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    background: 'rgba(0,0,0,0.4)',
    color: '#ffffff',
    border: 'none',
    cursor: 'pointer',
    opacity: hovered ? 1 : 0,
    transition: 'opacity 0.15s',
  };

  const handleDownload = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    await downloadAsset(asset);
  };

  // 非选择模式下的"插入"遮罩
  const maskStyle: CSSProperties = {
    pointerEvents: 'none',
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.55)',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 500,
    opacity: hovered ? 1 : 0,
    transition: 'opacity 0.15s',
  };

  return (
    <button
      type="button"
      draggable={!selectMode}
      onClick={onClick}
      onDragStart={!selectMode ? handleDragStart : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={cardStyle}
    >
      <div style={{ position: 'relative' }}>
        {/* 选择模式复选框 */}
        {selectMode && (
          <div style={checkboxStyle}>
            {selected ? <CheckSquare size={14} /> : <Square size={14} />}
          </div>
        )}
        {/* 下载按钮 */}
        <Tooltip title={t('asset.download')}><button type="button" style={downloadBtnStyle} onClick={handleDownload}>
          <Download size={14} />
        </button></Tooltip>
        {asset.kind === 'video' && cover && cover !== '' ? (
          <AuthorizedVideo src={cover} style={coverImgStyle} muted playsInline preload="metadata" />
        ) : cover && cover !== '' && asset.kind === 'image' ? (
          <AuthorizedImage src={cover} alt={asset.title} style={coverImgStyle} draggable={false} />
        ) : (
          <div style={coverFallbackStyle}>{fallbackIcon}</div>
        )}
        {duration && <span style={durationTagStyle}>{duration}</span>}
      </div>
      <div style={footerStyle}>
        <span style={titleStyle}>{asset.title}</span>
        <span style={tagStyle}>{kindLabel}</span>
      </div>
      {/* 非选择模式:显示"插入"遮罩 */}
      {!selectMode && <div style={maskStyle}>{t('asset.insert')}</div>}
    </button>
  );
}