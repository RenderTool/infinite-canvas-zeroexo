/** @deprecated 已被 features/asset-library 取代，请勿新引用 */
/**
 * AssetGrid - 资产网格视图
 *
 * 样式与主页项目卡片 ProjectCard 完全一致（自定义 div 布局，非 antd Card）。
 * 结构: 封面缩略图 → 名称 → 标签 → 操作按钮(下载/重命名/删除)
 */

import { useState } from 'react';
import { Download, Pencil, Trash2, FileText, Star } from 'lucide-react';
import type { GridViewProps } from './types.js';
import { createStyles } from './styles.js';
import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';

/** 资产类型 -> 颜色映射 */
const TYPE_COLORS: Record<string, string> = {
  character: '#e94560',
  prop: '#3b82f6',
  scene: '#10b981',
  prompt: '#8b5cf6',
  material: '#f59e0b',
};

/** 资产类型 -> SVG 图标 */
function getTypeIcon(type?: string, color?: string): React.ReactElement {
  const iconColor = color || '#888';
  const size = 22;
  const svgProps = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: iconColor,
    strokeWidth: '2',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style: { width: size, height: size },
  };
  switch (type) {
    case 'character':
      return <svg {...svgProps}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    case 'prop':
      return <svg {...svgProps}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>;
    case 'scene':
      return <svg {...svgProps}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
    case 'prompt':
      return <svg {...svgProps}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
    default:
      return <svg {...svgProps}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
  }
}

export function AssetGrid({
  assets,
  onInsert,
  onSelect,
  onDelete,
  onRename,
  onExport,
  onToggleFavorite,
  theme,
}: GridViewProps): React.ReactElement {
  void onInsert; // unused in grid view
  const s = createStyles(theme);
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (assets.length === 0) {
    return (
      <div style={s.emptyState()}>
        <FileText size={32} style={{ opacity: 0.3 }} />
        <span>{t('assetGrid.noAssets')}</span>
      </div>
    );
  }

  return (
    <div style={s.assetGrid()}>
      {assets.map((asset) => {
        const isHovered = hoveredId === asset.id;
        const typeColor = TYPE_COLORS[asset.type || 'material'] || '#888';
        const hasCover = asset.thumbnail || asset.data?.dataUrl || asset.data?.url || (asset.kind === 'image' && asset.data?.storageKey);

        const handleActionClick = (e: React.MouseEvent): void => {
          e.stopPropagation();
        };

        // 封面背景色
        const coverBg = isDark
          ? 'rgba(255,255,255,0.02)'
          : '#ffffff';
        const coverBorder = isDark
          ? `1px solid rgba(255,255,255,0.06)`
          : `1px solid #e5e7eb`;

        return (
          <div
            key={asset.id}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              width: '100%',
              cursor: 'pointer',
            }}
            onMouseEnter={() => setHoveredId(asset.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => onSelect?.(asset)}
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
              {hasCover ? (
                <img
                  src={asset.thumbnail || asset.data?.dataUrl || asset.data?.url}
                  alt={asset.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <>
                  {/* 无封面时显示类型图标 */}
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <div style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: `${typeColor}15`,
                    }}>
                      {getTypeIcon(asset.type, typeColor)}
                    </div>
                  </div>
                </>
              )}
              {/* Hover 遮罩 */}
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,0.05)',
                opacity: isHovered ? 1 : 0,
                transition: 'opacity 0.3s',
                pointerEvents: 'none',
              }} />
              {/* 星标按钮 */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(asset); }}
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 24,
                  height: 24,
                  padding: 0,
                  border: 'none',
                  borderRadius: 6,
                  background: isDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: asset.favorite ? '#f59e0b' : theme.toolbar.textMuted,
                  opacity: isHovered || asset.favorite ? 1 : 0,
                  transition: 'opacity 0.2s, color 0.2s, background 0.15s',
                  backdropFilter: 'blur(4px)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.9)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.7)'; }}
                title={asset.favorite ? t('assetGrid.unfavorite') : t('assetGrid.favorite')}
              >
                <Star size={12} fill={asset.favorite ? '#f59e0b' : 'none'} />
              </button>
            </div>

            {/* 底部信息 */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 2,
              minHeight: 'auto',
              paddingLeft: 4,
              paddingRight: 4,
            }}>
              {/* 名称 */}
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

              {/* 标签 + 操作按钮 */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}>
                {/* 标签 */}
                <div style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  gap: 4,
                  flexWrap: 'wrap',
                  overflow: 'hidden',
                }}>
                  {asset.tags && asset.tags.length > 0 ? (
                    <>
                      {asset.tags.slice(0, 3).map((tag, i) => (
                        <span key={i} style={{
                          padding: '1px 6px',
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 500,
                          background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                          color: theme.toolbar.textMuted,
                          border: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
                        }}>
                          {tag}
                        </span>
                      ))}
                      {asset.tags.length > 3 && (
                        <span style={{
                          fontSize: 10,
                          fontWeight: 500,
                          color: theme.toolbar.textMuted,
                          padding: '1px 4px',
                        }}>
                          +{asset.tags.length - 3}
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{
                      fontSize: 11,
                      lineHeight: '16px',
                      color: theme.toolbar.textMuted,
                    }}>
                      {asset.type || asset.kind || 'asset'}
                    </span>
                  )}
                </div>

                {/* 操作按钮（hover 显示，与 ProjectCard more button 完全一致） */}
                <div style={{
                  display: 'flex',
                  gap: 2,
                  flexShrink: 0,
                  opacity: isHovered ? 1 : 0,
                  transition: 'opacity 0.2s, background 0.15s',
                }}>
                  {onExport && (
                    <Tooltip title={t('assetGrid.download')}>
                      <button
                        type="button"
                        onClick={(e) => { handleActionClick(e); onExport(asset); }}
                        style={actionBtnStyle(theme)}
                        onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <Download size={12} />
                      </button>
                    </Tooltip>
                  )}
                  {onRename && (
                    <Tooltip title={t('assetGrid.rename')}>
                      <button
                        type="button"
                        onClick={(e) => { handleActionClick(e); onRename(asset, asset.title); }}
                        style={actionBtnStyle(theme)}
                        onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <Pencil size={12} />
                      </button>
                    </Tooltip>
                  )}
                  {onDelete && (
                    <Tooltip title={t('assetGrid.delete')}>
                      <button
                        type="button"
                        onClick={(e) => { handleActionClick(e); onDelete(asset); }}
                        style={{
                          ...actionBtnStyle(theme),
                          color: '#ef4444',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#ef444410'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== 样式（与 ProjectCard more button 完全一致） =====

const actionBtnStyle = (theme: { toolbar: { textMuted: string } }): React.CSSProperties => ({
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
  transition: 'background 0.15s',
});