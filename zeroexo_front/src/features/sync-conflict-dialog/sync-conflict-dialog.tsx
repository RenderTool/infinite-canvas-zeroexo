/**
 * SyncConflictDialog - 同步冲突弹窗
 *
 * 当云端版本与本地版本不一致时弹出,提示用户选择"拉取云端"或"推送本地"。
 * 会话锁已废弃 — Yjs 实时协作允许多标签页共存,不再需要会话过期提示。
 */

import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/shared/components/modal.js';
import { Button } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';
import type { ProjectConflict } from '@/services/sync/sync-service.js';

export interface SyncConflictDialogProps {
  conflict: ProjectConflict;
  theme: ThemeConfig;
  onPullCloud: () => void;
  onPushLocal: () => void;
  onClose: () => void;
}

export function SyncConflictDialog({
  conflict,
  theme,
  onPullCloud,
  onPushLocal,
  onClose,
}: SyncConflictDialogProps): React.ReactElement {
  const { t } = useTranslation();

  const isCloudDeleted = conflict.cloudDeleted;

  const syncBodyStyle: CSSProperties = {
    fontSize: 13,
    lineHeight: 1.8,
    color: theme.toolbar.text,
    textAlign: 'center',
    padding: '20px 0',
  };

  return (
    <Modal
      open={true}
      title={isCloudDeleted ? t('sync.cloudDeletedTitle') : t('sync.versionConflictTitle')}
      width={460}
      onClose={onClose}
      theme={theme}
      footer={
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, width: '100%' }}>
          {isCloudDeleted ? (
            <Button type="primary" size="middle" onClick={onPushLocal}>
              {t('sync.pushLocal')}
            </Button>
          ) : (
            <>
              <Button size="middle" onClick={onPullCloud}>
                {t('sync.pullCloud')}
              </Button>
              <Button type="primary" size="middle" onClick={onPushLocal}>
                {t('sync.pushLocal')}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div style={syncBodyStyle}>
        {isCloudDeleted
          ? t('sync.cloudDeletedHint')
          : t('sync.versionConflictHint')}
      </div>
    </Modal>
  );
}