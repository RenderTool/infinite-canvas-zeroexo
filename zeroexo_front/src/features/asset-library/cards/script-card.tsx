/**
 * script-card - 剧本卡片组件
 *
 * 从 AssetCard 中拆分剧本专用逻辑（episodeCount 解析 + 剧本专用渲染）。
 * 末尾调用 registerCard 注册到卡片注册表。
 */

import { useState, useMemo } from 'react';
import { BookOpen, Download, Pencil, Trash2 } from 'lucide-react';
import { Tooltip } from 'antd';
import { registerCard, type GridCardRendererProps, type ListCardRendererProps } from './card-registry.js';
import { actionBtnStyle } from '../asset-library-styles.js';

// ===== 辅助 =====

function parseEpisodeCount(asset: any): number {
  try {
    const scriptData = asset.data as { kind: 'script'; content: string };
    const parsed = JSON.parse(scriptData.content ?? '');
    const episodes = Array.isArray(parsed) ? parsed : parsed?.episodes;
    return Array.isArray(episodes) ? episodes.length : 0;
  } catch {
    return 0;
  }
}

// ===== 网格渲染 =====

function ScriptCardGrid({
  item: asset,
  multiSelectEnabled,
  onToggleSelect,
  onOpen,
  onRename,
  onDelete,
  onContextMenu,
  theme,
  t,
}: GridCardRendererProps<any>): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const episodeCount = useMemo(() => parseEpisodeCount(asset), [asset]);
  const isDark = theme.mode === 'dark';

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
          type: 'script',
          id: asset.id,
          name: asset.title,
        }));
      }}
    >
      {/* 封面区域 - 剧本专用样式 */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '239.2 / 135.4',
          borderRadius: 12,
          overflow: 'hidden',
          background: isDark ? 'rgba(255,255,255,0.02)' : '#ffffff',
          border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <BookOpen size={40} color={theme.toolbar.textMuted} />
        {/* 集数标签 */}
        {episodeCount > 0 && (
          <span style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 6,
            background: theme.toolbar.accent,
            color: '#fff',
          }}>
            {episodeCount} 集
          </span>
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
        }}>
          <span style={{
            fontSize: 11,
            color: theme.toolbar.textMuted,
            fontWeight: 500,
          }}>
            {t('asset.kindScript')}
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
            <button type="button" style={actionBtnStyle()}>
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

function ScriptCardList({
  item: asset,
  onClick,
  theme,
}: ListCardRendererProps<any>): React.ReactElement {
  const episodeCount = useMemo(() => parseEpisodeCount(asset), [asset]);

  return (
    <>
      <span
        style={{ width: '40%', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={onClick}
      >
        <BookOpen size={14} color={theme.toolbar.textMuted} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {asset.title}
        </span>
      </span>
      <span style={{ width: '20%' }}>
        <span style={{ fontSize: 10, padding: '0 6px', borderRadius: 4, border: `1px solid ${theme.toolbar.border}`, color: theme.toolbar.textMuted }}>
          script ({episodeCount}集)
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

registerCard('script', {
  renderGrid: ScriptCardGrid,
  renderList: ScriptCardList,
});