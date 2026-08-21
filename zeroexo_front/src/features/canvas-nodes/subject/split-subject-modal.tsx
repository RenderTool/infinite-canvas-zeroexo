/**
 * SplitSubjectModal - 拆分主体（Plan#20 T12b）
 * 列出引用源主体的全部镜头，勾选归属到新主体；确认后由 use-editor-interactions
 * 执行「建新卡 + 改写勾选镜头引用」BatchCommand（可一键撤销）。
 * 无边线风格：背景分层 + 阴影替代硬边线，遵循 DESIGN.md。
 */
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Input, Empty, Checkbox } from 'antd';
import { GitFork } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import type { ShotRef } from './subject-risks.js';

export interface SplitSubjectModalProps {
  open: boolean;
  /** 源主体名（标题展示） */
  sourceName: string;
  /** 画布中引用源主体的镜头列表 */
  shotRefs: ShotRef[];
  onClose: () => void;
  onConfirm: (newName: string, selectedKeys: string[]) => void;
}

/** 镜头定位键（storyboardId|episodeId|shotIndex） */
export function shotRefKey(ref: ShotRef): string {
  return `${ref.storyboardId}|${ref.episodeId ?? ''}|${ref.shotIndex}`;
}

export const SplitSubjectModal = memo(function SplitSubjectModal({
  open, sourceName, shotRefs, onClose, onConfirm,
}: SplitSubjectModalProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const [newName, setNewName] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const surfaceBg = theme.node.fill;
  const accent = theme.toolbar.accent;

  // 打开时重置表单
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setLastOpen(true);
    setNewName('');
    setChecked(new Set());
  }
  if (!open && lastOpen) setLastOpen(false);

  const groups = useMemo(() => {
    const m = new Map<string, ShotRef[]>();
    for (const ref of shotRefs) {
      const key = ref.storyboardId;
      const list = m.get(key) ?? [];
      list.push(ref);
      m.set(key, list);
    }
    return [...m.entries()];
  }, [shotRefs]);

  const toggleAll = (refs: ShotRef[]) => {
    const keys = refs.map(shotRefKey);
    const allChecked = keys.every((k) => checked.has(k));
    setChecked((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (allChecked) next.delete(k); else next.add(k);
      }
      return next;
    });
  };

  const toggleOne = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const canConfirm = newName.trim().length > 0 && checked.size > 0;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={(
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: textPrimary }}>
          <GitFork size={15} style={{ color: accent }} />
          {t('subject.splitTitle')}
          <span style={{ fontSize: 12, fontWeight: 400, color: textMuted }}>「{sourceName}」</span>
        </span>
      )}
      width={560}
      centered
      okText={t('common.confirm')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: !canConfirm }}
      onOk={() => onConfirm(newName.trim(), [...checked])}
      destroyOnHidden
      styles={{ body: { padding: '8px 20px 16px', color: textPrimary } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: textMuted, marginBottom: 6 }}>
            {t('subject.splitNameLabel')}
          </div>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('subject.splitNamePlaceholder')}
            maxLength={40}
            allowClear
          />
          <div style={{ fontSize: 11, color: textMuted, marginTop: 6 }}>
            {t('subject.splitDesc')}（{shotRefs.length}）
          </div>
        </div>

        <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }} className="zx-thin-scroll">
          {groups.length === 0 && (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('subject.splitRefsEmpty')} style={{ margin: '24px 0' }} />
          )}
          {groups.map(([storyboardId, refs]) => (
            <div
              key={storyboardId}
              style={{
                borderRadius: 10, padding: '8px 10px',
                background: surfaceBg,
                boxShadow: isDark ? '0 1px 2px rgba(0,0,0,0.4)' : '0 1px 2px rgba(15,23,42,0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {refs[0]!.storyboardTitle || storyboardId}
                </span>
                <Checkbox
                  checked={refs.every((r) => checked.has(shotRefKey(r)))}
                  indeterminate={refs.some((r) => checked.has(shotRefKey(r))) && !refs.every((r) => checked.has(shotRefKey(r)))}
                  onChange={() => toggleAll(refs)}
                  style={{ fontSize: 11 }}
                >
                  {t('common.selectAll')}
                </Checkbox>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {refs.map((ref) => {
                  const key = shotRefKey(ref);
                  return (
                    <label
                      key={key}
                      onClick={() => toggleOne(key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px', borderRadius: 6,
                        cursor: 'pointer', fontSize: 11, color: textMuted,
                        background: checked.has(key) ? `${accent}14` : 'transparent',
                      }}
                    >
                      <Checkbox checked={checked.has(key)} onChange={() => toggleOne(key)} style={{ fontSize: 11 }} />
                      <span style={{ flexShrink: 0, color: textPrimary }}>
                        {t('subject.shotShort')} {ref.shotIndex + 1}
                        {ref.episodeId ? ` · ${ref.episodeId.slice(0, 12)}` : ''}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ref.preview || ref.mention}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
});
