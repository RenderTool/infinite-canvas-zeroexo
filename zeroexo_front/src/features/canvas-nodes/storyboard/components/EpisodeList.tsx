/**
 * EpisodeList - 剧集管理侧边栏（Phase 5）
 *
 * ┌──────────────────────┐
 * │ 剧集                  │
 * │ 第1集 · 10页 ✓        │  ← 拖拽排序
 * │ 第2集 · 8页  ✏️       │  ← 当前编辑
 * │ 第3集 · 12页          │
 * │ [+ 新增剧集]           │
 * │ 总页数: 30页 · ≈30分钟 │
 * └──────────────────────┘
 * 行操作：⋮ 更多（重命名、复制、拆分、合并到上一集、删除）
 */
import { useState, useRef, useEffect, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import {
  Layers, MoreHorizontal, Copy, Scissors, GitMerge, Trash2, Pencil, GripVertical, Plus,
} from 'lucide-react';
import { Dropdown, Button, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import i18n from '@/i18n/config';
import type { MenuProps } from 'antd';
import type { Episode } from '../script-types.js';

interface EpisodeListProps {
  episodes: Episode[];
  activeEpisodeId: string;
  accent: string;
  border: string;
  text: string;
  textMuted: string;
  isDark: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (ep: Episode) => void;
  onRename: (id: string, title: string) => void;
  onReorder: (ids: string[]) => void;
  /** 复制剧集 */
  onDuplicate: (id: string) => void;
  /** 按分页拆分剧集 */
  onSplit: (id: string) => void;
  /** 合并到上一集 */
  onMergePrev: (id: string) => void;
  /** 头部右上角自定义操作区(如导入/全屏按钮) */
  actions?: ReactNode;
  // 弹层 z-index 由 antd token zIndexPopupBase 自动分配(全屏编辑器内局部 40000),不再手动传
}

const menuLabelStyle: CSSProperties = { fontSize: 12 };

/** 剧集行「更多」下拉菜单 */
function buildMenu(
  ep: Episode,
  idx: number,
  handlers: {
    onRename: () => void;
    onDuplicate: (id: string) => void;
    onSplit: (id: string) => void;
    onMergePrev: (id: string) => void;
    onDelete: (ep: Episode) => void;
  },
): MenuProps['items'] {
  return [
    { key: 'rename', icon: <Pencil size={12} />, label: <span style={menuLabelStyle}>{i18n.t('episodeList.rename')}</span>, onClick: handlers.onRename },
    { key: 'duplicate', icon: <Copy size={12} />, label: <span style={menuLabelStyle}>{i18n.t('episodeList.duplicate')}</span>, onClick: () => handlers.onDuplicate(ep.id) },
    { key: 'split', icon: <Scissors size={12} />, label: <span style={menuLabelStyle}>{i18n.t('episodeList.split')}</span>, onClick: () => handlers.onSplit(ep.id) },
    {
      key: 'merge',
      icon: <GitMerge size={12} />,
      label: <span style={menuLabelStyle}>{i18n.t('episodeList.mergePrev')}</span>,
      disabled: idx === 0,
      onClick: () => handlers.onMergePrev(ep.id),
    },
    { type: 'divider' },
    { key: 'delete', icon: <Trash2 size={12} />, label: <span style={menuLabelStyle}>{i18n.t('episodeList.delete')}</span>, danger: true, onClick: () => handlers.onDelete(ep) },
  ];
}

export function EpisodeList({
  episodes,
  activeEpisodeId,
  accent,
  border,
  text,
  textMuted,
  isDark,
  onSelect,
  onAdd,
  onDelete,
  onRename,
  onReorder,
  onDuplicate,
  onSplit,
  onMergePrev,
  actions,
}: EpisodeListProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleStartEdit = (ep: Episode) => {
    setEditingId(ep.id);
    setEditingTitle(ep.title);
  };

  const handleConfirmEdit = () => {
    if (editingId) {
      const trimmed = editingTitle.trim();
      if (trimmed) onRename(editingId, trimmed);
    }
    setEditingId(null);
  };

  const handleDragStart = (_e: DragEvent, index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const items = [...episodes];
    const [moved] = items.splice(dragIndex, 1);
    items.splice(index, 0, moved!);
    onReorder(items.map((ep) => ep.id));
    setDragIndex(index);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.045)';
  const selectedBg = isDark ? `${accent}30` : `${accent}18`;

  return (
    <div
      style={wrapStyle(border, theme)}
      // 仅阻止滚轮冒泡(避免剧集列表滚动时误触画布缩放);
      // 不阻止 pointerdown/pointermove,允许节点正常拖拽选中,
      // 剧集拖拽排序由 HTML5 draggable 原生处理,不干扰节点拖拽行为
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 标题 */}
      <div style={headerStyle(textMuted)}>
        <Layers size={12} />
        <span>{t('episodeList.episodes')}</span>
        <span style={{ fontSize: 10, opacity: 0.7 }}>{t('episodeList.episodesCount', { count: episodes.length })}</span>
        {actions ? (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {actions}
          </span>
        ) : null}
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {episodes.map((ep, idx) => {
          const isActive = ep.id === activeEpisodeId;
          return (
            <Dropdown
              key={ep.id}
              menu={{ items: buildMenu(ep, idx, { onRename: () => handleStartEdit(ep), onDuplicate, onSplit, onMergePrev, onDelete }), style: { minWidth: 160 } }}
              trigger={['contextMenu']}
            >
            <div
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              onClick={() => onSelect(ep.id)}
              // 阻止 pointerdown 冒泡到节点外壳,避免拖拽剧集时误触发节点位置移动;
              // HTML5 draggable 使用独立事件(dragstart/dragend),不受 pointerdown 影响
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                background: isActive ? selectedBg : 'transparent',
                border: isActive ? `1px solid ${accent}55` : `1px solid transparent`,
                transition: 'background 0.15s, border-color 0.15s',
                minHeight: 34,
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = hoverBg;
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              {/* 拖拽手柄 */}
              <Tooltip title={t('episodeList.dragToReorder')}>
                <span style={{ color: textMuted, opacity: 0.5, cursor: 'grab', display: 'inline-flex', flexShrink: 0 }}>
                  <GripVertical size={12} />
                </span>
              </Tooltip>

              {/* 标题 / 编辑输入 */}
              {editingId === ep.id ? (
                <input
                  ref={inputRef}
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmEdit();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onBlur={handleConfirmEdit}
                  onClick={(e) => e.stopPropagation()}
                  style={editInputStyle(accent, isDark)}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12,
                    color: isActive ? accent : text,
                    fontWeight: isActive ? 600 : 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={(() => {
                    const defaultTitle = `第${ep.number}集`;
                    const localized = t('storyboard.episodeLabel', { number: ep.number });
                    return ep.title !== defaultTitle ? `${localized} · ${ep.title}` : localized;
                  })()}
                >
                  {ep.title}
                </span>
              )}

              {/* 页数 */}
              <span style={pageBadgeStyle(textMuted)}>
                {t('episodeList.pageCount', { count: ep.pageCount ?? 0 })}
              </span>

              {/* 操作按钮：⋮ 更多（重命名/复制/拆分/合并/删除） */}
              <span style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                <Dropdown
                  menu={{ items: buildMenu(ep, idx, { onRename: () => handleStartEdit(ep), onDuplicate, onSplit, onMergePrev, onDelete }), style: { minWidth: 160 } }}
                  trigger={['click']}
                  placement="bottomRight"
                  rootClassName="zx-episode-more-dropdown"
                >
                  <Tooltip title={t('episodeList.moreActions')}>
                    <button type="button" style={actionBtnStyle(isDark)} onClick={(e) => e.stopPropagation()}>
                      <MoreHorizontal size={12} />
                    </button>
                  </Tooltip>
                </Dropdown>
              </span>
            </div>
            </Dropdown>
          );
        })}
      </div>

      {/* 新增剧集按钮（固定底部，不参与滚动） */}
      <div style={{ flexShrink: 0, paddingTop: 8 }}>
        <Button
          type="dashed"
          size="small"
          icon={<Plus size={13} />}
          style={{ width: '100%', height: 32, padding: '0 11px', lineHeight: '30px', color: text, fontSize: 12, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onAdd();
          }}
        >
          {t('episodeList.addEpisode')}
        </Button>
      </div>
    </div>
  );
}

// ===== Styles =====

const wrapStyle = (border: string, theme: ReturnType<typeof useTheme>['theme']): CSSProperties => ({
  width: '100%',
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  padding: '12px 10px',
  background: theme.toolbar.editorSurface,
  border: `1px solid ${border}`,
  borderRadius: 0,
  overflow: 'hidden',
});

const headerStyle = (muted: string): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 12,
  fontWeight: 600,
  color: muted,
  padding: '2px 2px 8px',
  borderBottom: `1px solid transparent`,
});

const pageBadgeStyle = (muted: string): CSSProperties => ({
  fontSize: 10,
  color: muted,
  background: 'rgba(128,128,128,0.12)',
  borderRadius: 4,
  padding: '1px 5px',
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

const actionBtnStyle = (isDark: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  border: 'none',
  background: 'transparent',
  color: isDark ? '#888' : '#999',
  cursor: 'pointer',
  borderRadius: 4,
  padding: 0,
  transition: 'background 0.12s',
});

const editInputStyle = (accent: string, isDark: boolean): CSSProperties => ({
  flex: 1,
  minWidth: 0,
  height: 24,
  padding: '0 6px',
  border: `1px solid ${accent}`,
  borderRadius: 4,
  background: isDark ? '#1a1a1a' : '#fff',
  color: isDark ? '#d4d4d4' : '#333',
  fontSize: 12,
  outline: 'none',
});


