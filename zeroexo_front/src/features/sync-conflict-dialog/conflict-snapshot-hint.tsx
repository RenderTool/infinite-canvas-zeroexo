/**
 * ConflictSnapshotHint - 同步冲突自动解决提示条
 *
 * 替代原 SyncConflictDialog(弹窗):云端版本冲突/云端已删除时,
 * 系统按「本地优先」自动解决并保存云端快照,本组件在画布顶部
 * 以轻提示条告知用户,可点击「查看历史快照」跳转版本历史还原点。
 * 非阻塞:默认数秒后自动消失,或用户主动关闭。
 */

import { type CSSProperties, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import type { ConflictSnapshotInfo } from '@/services/sync/sync-service.js';

export interface ConflictSnapshotHintProps {
  info: ConflictSnapshotInfo;
  theme: ThemeConfig;
  /** 点击「查看历史快照」回调(跳转版本历史弹窗) */
  onOpenHistory: () => void;
  /** 关闭提示条 */
  onClose: () => void;
  /** 自动消失时长(ms),默认 8s */
  autoDismissMs?: number;
}

export function ConflictSnapshotHint({
  info,
  theme,
  onOpenHistory,
  onClose,
  autoDismissMs = 8_000,
}: ConflictSnapshotHintProps): React.ReactElement {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);

  // 自动消失:超时后收起(先做淡出动画,再通知父组件清空状态)
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onClose();
    }, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, onClose]);

  const barStyle: CSSProperties = {
    position: 'fixed',
    top: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 2000,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 12px 8px 16px',
    borderRadius: 8,
    fontSize: 13,
    lineHeight: '20px',
    color: theme.toolbar.text,
    background: theme.toolbar.background,
    border: `1px solid ${theme.toolbar.border}`,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
    maxWidth: 520,
    transition: 'opacity 0.25s ease, transform 0.25s ease',
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? 'auto' : 'none',
  };

  const accentStyle: CSSProperties = {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
    background: theme.toolbar.accent,
  };

  const handleOpenHistory = (): void => {
    setVisible(false);
    onOpenHistory();
    onClose();
  };

  return (
    <div style={barStyle} role="status">
      <span style={accentStyle} />
      <span style={{ flex: 1, textAlign: 'left' }}>
        {info.cloudDeleted
          ? t('sync.conflictCloudDeletedHint', { title: info.title || t('sync.unknownProject') })
          : info.direction === 'local-active'
            ? info.snapshotVersion
              ? t('sync.conflictSnapshotLocalActive', { title: info.title || t('sync.unknownProject'), version: info.snapshotVersion })
              : t('sync.conflictSnapshotLocalActiveNoVersion', { title: info.title || t('sync.unknownProject') })
            : info.direction === 'local-stale'
              ? info.snapshotVersion
                ? t('sync.conflictSnapshotLocalStale', { title: info.title || t('sync.unknownProject'), version: info.snapshotVersion })
                : t('sync.conflictSnapshotLocalStaleNoVersion', { title: info.title || t('sync.unknownProject') })
              : info.snapshotVersion
                ? t('sync.conflictSnapshotHint', { title: info.title || t('sync.unknownProject'), version: info.snapshotVersion })
                : t('sync.conflictSnapshotHintNoVersion', { title: info.title || t('sync.unknownProject') })}
      </span>
      <button
        type="button"
        onClick={handleOpenHistory}
        style={{
          border: 'none',
          cursor: 'pointer',
          borderRadius: 4,
          padding: '3px 10px',
          fontSize: 12,
          background: theme.toolbar.accent,
          color: '#fff',
          flexShrink: 0,
        }}
      >
        {t('sync.viewHistory')}
      </button>
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={() => {
          setVisible(false);
          onClose();
        }}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          padding: 2,
          color: theme.toolbar.text,
          opacity: 0.7,
          flexShrink: 0,
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
