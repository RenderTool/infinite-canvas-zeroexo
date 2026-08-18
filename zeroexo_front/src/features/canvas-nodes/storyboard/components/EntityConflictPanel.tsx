/**
 * EntityConflictPanel - 实体冲突面板组件
 *
 * 展示 Agent 输出的冲突候选列表；合并/忽略/重命名操作按钮；合并后实体 ID 重映射。
 */
import { type ReactElement, useState, useCallback } from 'react';
import { Button, Input, Tooltip } from 'antd';
import { Check, X, Merge, Edit3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import type { EntityConflict, StoryboardEntity } from '../storyboard-types';

export interface EntityConflictPanelProps {
  conflicts: EntityConflict[];
  onMerge?: (groupId: string, mergedEntity: StoryboardEntity) => void;
  onIgnore?: (groupId: string) => void;
  onRename?: (groupId: string, newName: string) => void;
  onRemap?: (groupId: string, targetEntityId: string) => void;
}

export function EntityConflictPanel({
  conflicts,
  onMerge,
  onIgnore,
  onRename,
  onRemap,
}: EntityConflictPanelProps): ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const borderMuted = isDark ? '#2e2e2e' : '#e5e5e5';
  const bgCard = isDark ? '#1f1f1f' : '#f5f5f5';

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleStartRename = useCallback((groupId: string, currentName?: string) => {
    setRenamingId(groupId);
    setRenameValue(currentName || '');
  }, []);

  const handleConfirmRename = useCallback((groupId: string) => {
    if (renameValue.trim() && onRename) {
      onRename(groupId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renameValue, onRename]);

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
  }, []);

  if (conflicts.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 11, color: mutedColor }}>
        {t('entity.noConflicts')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, overflow: 'auto', height: '100%' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: mutedColor, marginBottom: 4 }}>
        {t('entity.conflictList', { count: conflicts.length })}
      </div>
      {conflicts.map((conflict) => (
        <div
          key={conflict.groupId}
          style={{
            borderRadius: 8,
            border: `1px solid ${isDark ? 'rgba(251,191,36,0.3)' : 'rgba(251,191,36,0.2)'}`,
            background: isDark ? 'rgba(251,191,36,0.05)' : 'rgba(251,191,36,0.03)',
            overflow: 'hidden',
          }}
        >
          {/* 冲突头部 */}
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${borderMuted}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: textColor }}>
              {t('entity.conflictGroup')} {conflict.groupId}
            </div>
            <div style={{ fontSize: 10, color: mutedColor }}>
              {t('entity.confidence')} {(conflict.confidence * 100).toFixed(0)}%
            </div>
          </div>

          {/* 候选实体列表 */}
          <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {conflict.entities.map((entity) => (
              <div
                key={entity.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 6px',
                  borderRadius: 4,
                  background: bgCard,
                  fontSize: 11,
                  color: textColor,
                }}
              >
                <span style={{ color: mutedColor, fontSize: 10 }}>
                  {entity.kind === 'character' ? '\u{1F464}' : entity.kind === 'scene' ? '\u{1F4CD}' : '\u{1F4E6}'}
                </span>
                <span style={{ flex: 1 }}>{entity.name}</span>
                {onRemap && (
                  <Tooltip title={t('entity.remapToEntity')}>
                    <Button
                      size="small"
                      type="text"
                      icon={<Merge size={11} />}
                      onClick={() => onRemap(conflict.groupId, entity.id)}
                      style={{ width: 20, height: 20, color: mutedColor }}
                    />
                  </Tooltip>
                )}
              </div>
            ))}
          </div>

          {/* 建议名称 */}
          {conflict.suggestedName && (
            <div style={{ padding: '4px 10px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              {renamingId === conflict.groupId ? (
                <Input
                  size="small"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onPressEnter={() => handleConfirmRename(conflict.groupId)}
                  style={{ flex: 1, fontSize: 11, height: 24 }}
                  autoFocus
                />
              ) : (
                <span style={{ fontSize: 11, color: mutedColor }}>
                  {t('entity.suggestedName')}: <strong style={{ color: accent }}>{conflict.suggestedName}</strong>
                </span>
              )}
            </div>
          )}

          {/* 操作按钮 */}
          <div style={{ padding: '6px 10px', borderTop: `1px solid ${borderMuted}`, display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
            {onMerge && (
              <Button
                size="small"
                type="text"
                icon={<Check size={12} />}
                onClick={() => {
                  const merged: StoryboardEntity = {
                    id: `merged-${conflict.groupId}`,
                    name: conflict.suggestedName || conflict.entities[0]?.name || 'merged',
                    kind: conflict.entities[0]?.kind || 'character',
                    description: conflict.entities.map((e) => e.description).filter(Boolean).join('; '),
                    source: 'merged',
                    mergedFrom: conflict.entities.map((e) => e.id),
                  };
                  onMerge(conflict.groupId, merged);
                }}
                style={{ color: '#52c41a', fontSize: 11 }}
              >
                {t('entity.merge')}
              </Button>
            )}
            {onIgnore && (
              <Button
                size="small"
                type="text"
                icon={<X size={12} />}
                onClick={() => onIgnore(conflict.groupId)}
                style={{ color: mutedColor, fontSize: 11 }}
              >
                {t('entity.ignore')}
              </Button>
            )}
            {onRename && (
              renamingId === conflict.groupId ? (
                <>
                  <Button size="small" type="text" icon={<Check size={12} />} onClick={() => handleConfirmRename(conflict.groupId)} style={{ color: '#52c41a', fontSize: 11 }}>
                    {t('entity.confirm')}
                  </Button>
                  <Button size="small" type="text" icon={<X size={12} />} onClick={handleCancelRename} style={{ color: mutedColor, fontSize: 11 }}>
                    {t('common.cancel')}
                  </Button>
                </>
              ) : (
                <Button
                  size="small"
                  type="text"
                  icon={<Edit3 size={12} />}
                  onClick={() => handleStartRename(conflict.groupId, conflict.suggestedName)}
                  style={{ color: mutedColor, fontSize: 11 }}
                >
                  {t('entity.rename')}
                </Button>
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}