/** @deprecated 已被 features/asset-library 取代，请勿新引用 */
/**
 * AssetList - 资产列表视图
 *
 * 参考 zeroexo-asset-manager-v2.html 的 .list-table 设计。
 * 表格模式：名称、类型、状态、引用、修改时间。
 */

import { useState } from 'react';
import { FileText, Image, Music, Video } from 'lucide-react';
import type { ListViewProps } from './types.js';
import { createStyles } from './styles.js';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n/config';

/** 格式化文件大小 */
function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 类型标签映射 */
function typeLabel(type?: string): string {
  const map: Record<string, string> = {
    character: i18n.t('assetList.typeCharacter'),
    prop: i18n.t('assetList.typeProp'),
    scene: i18n.t('assetList.typeScene'),
    prompt: i18n.t('assetList.typePrompt'),
    material: i18n.t('assetList.typeMaterial'),
  };
  return map[type || ''] || i18n.t('assetList.typeMaterial');
}

/** kind 图标 */
function kindIcon(kind: string, size = 16): React.ReactElement {
  const props = { size, style: { opacity: 0.5 } as const };
  switch (kind) {
    case 'image': return <Image {...props} />;
    case 'video': return <Video {...props} />;
    case 'audio': return <Music {...props} />;
    default: return <FileText {...props} />;
  }
}

export function AssetList({
  assets,
  onInsert,
  onSelect,
  selectedAsset,
  theme,
}: ListViewProps): React.ReactElement {
  const s = createStyles(theme);
  const { t } = useTranslation();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (assets.length === 0) {
    return (
      <div style={s.emptyState()}>
        <FileText size={32} style={{ opacity: 0.3 }} />
        <span>{t('assetList.noAssets')}</span>
      </div>
    );
  }

  return (
    <table style={s.listTable()}>
      <thead>
        <tr>
          <th style={{ ...s.listTableHead(), width: '40%' }}>{t('assetList.name')}</th>
          <th style={{ ...s.listTableHead(), width: '15%' }}>{t('assetList.type')}</th>
          <th style={{ ...s.listTableHead(), width: '15%' }}>{t('assetList.size')}</th>
          <th style={{ ...s.listTableHead(), width: '15%' }}>{t('assetList.modifiedTime')}</th>
        </tr>
      </thead>
      <tbody>
        {assets.map((asset) => {
          const isHovered = hoveredId === asset.id;
          const isSelected = selectedAsset?.id === asset.id;

          return (
            <tr
              key={asset.id}
              style={{
                transition: 'background 0.12s',
                cursor: 'pointer',
                background: isSelected ? `${theme.toolbar.accent}12` : isHovered ? (theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)') : 'transparent',
              }}
              onMouseEnter={() => setHoveredId(asset.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelect?.(asset)}
              onDoubleClick={() => onInsert?.(asset)}
            >
              <td style={s.listTableCell()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: theme.toolbar.text, fontWeight: 500 }}>
                  <span style={{ width: 28, height: 20, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', flexShrink: 0 }}>
                    {kindIcon(asset.kind, 14)}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.title}</span>
                </div>
              </td>
              <td style={s.listTableCell()}>{typeLabel(asset.type)}</td>
              <td style={s.listTableCell()}>{formatBytes(asset.bytes)}</td>
              <td style={s.listTableCell()}>{asset.updatedAt || t('assetList.unknown')}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}