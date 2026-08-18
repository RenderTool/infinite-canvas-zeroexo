/**
 * subject-card - 主体卡片组件
 *
 * 从 asset-library-page.tsx 内联 SubjectCard 抽出。
 * 末尾调用 registerCard 注册到卡片注册表。
 */

import { useState } from 'react';
import { User as UserIcon, Download, Pencil, Trash2 } from 'lucide-react';
import { Tooltip } from 'antd';
import type { Subject } from '../subjects-api.js';
import { registerCard, type GridCardRendererProps, type ListCardRendererProps } from './card-registry.js';
import {
  cardStyle,
  subjectIconStyle,
  cardBodyStyle,
  cardTitleStyle,
  cardMetaStyle,
  cardActionsStyle,
  actionBtnStyle,
} from '../asset-library-styles.js';

// ===== 网格渲染 =====

function SubjectCardGrid({
  item: subject,
  multiSelectEnabled,
  onToggleSelect,
  onOpen,
  onRename,
  onDelete,
  onContextMenu,
  theme,
  t,
}: GridCardRendererProps<Subject>): React.ReactElement {
  const [hovered, setHovered] = useState(false);

  const typeColor =
    subject.type === 'character' ? '#5b8fd9' : subject.type === 'scene' ? '#4ade80' : '#c9a84c';
  const typeLabel =
    subject.type === 'character'
      ? t('assetLibrary.filterCharacter')
      : subject.type === 'scene'
      ? t('assetLibrary.filterScene')
      : t('assetLibrary.filterProp');

  return (
    <div
      style={cardStyle(theme, hovered)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={multiSelectEnabled ? () => onToggleSelect(subject.id) : onOpen}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-testlib-item', JSON.stringify({
          type: 'subject',
          id: subject.id,
          name: subject.name,
        }));
      }}
    >
      <div style={subjectIconStyle(theme, typeColor)}>
        {subject.avatarEmoji ? (
          <span style={{ fontSize: 40 }}>{subject.avatarEmoji}</span>
        ) : (
          <UserIcon size={40} color={typeColor} />
        )}
      </div>
      <div style={cardBodyStyle()}>
        <div style={cardTitleStyle(theme)}>{subject.name}</div>
        <div style={cardMetaStyle(theme)}>
          <span style={{
            fontSize: 10,
            padding: '0 6px',
            borderRadius: 4,
            background: `${typeColor}20`,
            border: `1px solid ${typeColor}`,
            color: typeColor,
            lineHeight: '20px',
          }}>
            {typeLabel}
          </span>
          {subject.tags.slice(0, 2).map((tag) => (
            <span key={tag} style={{ fontSize: 10, color: theme.toolbar.textMuted }}>
              #{tag}
            </span>
          ))}
        </div>
      </div>
      {hovered && (
        <div style={cardActionsStyle(theme)} onClick={(e) => e.stopPropagation()}>
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

function SubjectCardList({
  item: subject,
  onClick,
  theme,
}: ListCardRendererProps<Subject>): React.ReactElement {
  const typeColor =
    subject.type === 'character' ? '#5b8fd9' : subject.type === 'scene' ? '#4ade80' : '#c9a84c';

  return (
    <>
      <span
        style={{ width: '40%', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={onClick}
      >
        <UserIcon size={14} color={typeColor} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {subject.name}
        </span>
      </span>
      <span style={{ width: '20%' }}>
        <span style={{
          fontSize: 10,
          padding: '0 6px',
          borderRadius: 4,
          background: `${typeColor}20`,
          border: `1px solid ${typeColor}`,
          color: typeColor,
          lineHeight: '20px',
        }}>
          {subject.type}
        </span>
      </span>
      <span style={{ width: '20%', color: theme.toolbar.textMuted, fontSize: 11 }}>-</span>
      <span style={{ width: '20%', color: theme.toolbar.textMuted, fontSize: 11 }}>
        {subject.createdAt ? new Date(subject.createdAt).toLocaleDateString() : '-'}
      </span>
    </>
  );
}

// ===== 注册 =====

registerCard('subject', {
  renderGrid: SubjectCardGrid,
  renderList: SubjectCardList,
});