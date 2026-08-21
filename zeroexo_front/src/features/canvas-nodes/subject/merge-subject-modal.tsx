/**
 * MergeSubjectModal - 合并主体（Plan#20 T12a）
 * 选择目标主体卡；确认后由 use-editor-interactions 执行
 * 「全部引用改写 + 源卡删除」BatchCommand（可一键撤销）。
 * 无边线风格：背景分层 + 阴影替代硬边线，遵循 DESIGN.md。
 */
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Empty } from 'antd';
import { Merge } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { ENTITY_KIND_META } from '../storyboard/storyboard-utils.js';
import type { EntityKind } from '../storyboard/storyboard-types.js';

export interface MergeTargetInfo {
  nodeId: string;
  name: string;
  kind: EntityKind;
  aliases: string[];
}

export interface MergeSubjectModalProps {
  open: boolean;
  /** 源主体信息 */
  source: { name: string; kind: EntityKind } | null;
  /** 候选目标主体卡（不含源卡） */
  targets: MergeTargetInfo[];
  /** 引用源主体的镜头数（确认文案展示） */
  refCount: number;
  onClose: () => void;
  onConfirm: (targetNodeId: string) => void;
}

export const MergeSubjectModal = memo(function MergeSubjectModal({
  open, source, targets, refCount, onClose, onConfirm,
}: MergeSubjectModalProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const surfaceBg = theme.node.fill;
  const accent = theme.toolbar.accent;

  // 打开时重置选择
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setLastOpen(true);
    setSelectedId(null);
  }
  if (!open && lastOpen) setLastOpen(false);

  const selected = useMemo(
    () => targets.find((tgt) => tgt.nodeId === selectedId) ?? null,
    [targets, selectedId],
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={(
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: textPrimary }}>
          <Merge size={15} style={{ color: accent }} />
          {t('subject.mergeTitle')}
          <span style={{ fontSize: 12, fontWeight: 400, color: textMuted }}>「{source?.name ?? ''}」</span>
        </span>
      )}
      width={520}
      centered
      okText={t('common.confirm')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: !selected }}
      onOk={() => { if (selected) onConfirm(selected.nodeId); }}
      destroyOnHidden
      styles={{ body: { padding: '8px 20px 16px', color: textPrimary } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: textMuted, lineHeight: 1.6 }}>
          {t('subject.mergeDesc')}
        </div>

        <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }} className="zx-thin-scroll">
          {targets.length === 0 && (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('subject.mergeTargetEmpty')} style={{ margin: '24px 0' }} />
          )}
          {targets.map((tgt) => {
            const meta = ENTITY_KIND_META[tgt.kind] ?? ENTITY_KIND_META.character;
            const isSel = selectedId === tgt.nodeId;
            return (
              <div
                key={tgt.nodeId}
                onClick={() => setSelectedId(tgt.nodeId)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(tgt.nodeId); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10,
                  cursor: 'pointer', background: isSel ? `${accent}14` : surfaceBg,
                  boxShadow: isSel
                    ? `inset 0 0 0 1px ${accent}55`
                    : (isDark ? '0 1px 2px rgba(0,0,0,0.4)' : '0 1px 2px rgba(15,23,42,0.08)'),
                }}
              >
                <span
                  style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: isSel ? accent : 'rgba(128,128,128,0.35)',
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tgt.name || t('subject.untitled')}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, flexShrink: 0,
                  background: `${meta.color}20`, color: meta.color,
                }}>
                  {t(meta.labelKey)}
                </span>
              </div>
            );
          })}
        </div>

        {selected && refCount > 0 && (
          <div style={{ fontSize: 11, color: textMuted }}>
            {t('subject.mergeConfirm', { name: source?.name ?? '', count: refCount, target: selected.name })}
          </div>
        )}
      </div>
    </Modal>
  );
});
