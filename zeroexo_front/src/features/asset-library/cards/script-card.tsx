/**
 * script-card - 剧本卡片组件
 *
 * 从 AssetCard 中拆分剧本专用逻辑（episodeCount 解析 + 剧本专用渲染）。
 * 末尾调用 registerCard 注册到卡片注册表。
 */

import { useState, useMemo } from 'react';
import { BookOpen, Download, Pencil, Trash2, Send, MoreHorizontal } from 'lucide-react';
import { Tooltip, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { registerCard, type GridCardRendererProps, type ListCardRendererProps } from './card-registry.js';

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
  onDownload,
  onContextMenu,
  onSendToCanvas,
  theme,
  t,
}: GridCardRendererProps<any>): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const episodeCount = useMemo(() => parseEpisodeCount(asset), [asset]);
  const isDark = theme.mode === 'dark';

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
        // 验收轮二十一:payload 携带完整数据 → 画布 drop 直接建 script 节点(episodes 解析)
        e.dataTransfer.setData('application/x-testlib-item', JSON.stringify({
          type: 'script',
          id: asset.id,
          name: asset.title,
          data: asset,
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

        {/* 发送到画布快捷按钮(常驻,仅画布内嵌时提供) */}
        {onSendToCanvas && (
          <Tooltip title={t('assetLibrary.sendToCanvas')}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSendToCanvas(); }}
              // 征集 #95(Plan#49 T28):hover 后显示,与卡片其它操作按钮显隐一致
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
            {t('asset.kindScript')}
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

registerCard('script', {
  renderGrid: ScriptCardGrid,
  renderList: ScriptCardList,
});