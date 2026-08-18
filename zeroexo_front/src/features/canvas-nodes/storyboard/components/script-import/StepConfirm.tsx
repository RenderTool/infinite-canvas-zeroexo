/**
 * StepConfirm - 步骤 2：确认选择
 *
 * 展示已选文件列表，支持拖拽排序。
 * 每项显示 token 预估，底部显示合计。
 */
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Eye, GripVertical } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { TextPreviewModal } from './TextPreviewModal.js';
import type { TextAssetItem } from './types.js';

export function StepConfirm({
  assets,
  onNext,
  onBack,
}: {
  assets: TextAssetItem[];
  onNext: (ordered: TextAssetItem[]) => void;
  onBack: () => void;
}): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;
  const bgCard = isDark ? '#1a1715' : '#f5f2ec';

  const [items, setItems] = useState<TextAssetItem[]>(assets);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [previewItem, setPreviewItem] = useState<TextAssetItem | null>(null);

  const handleDragStart = useCallback((idx: number) => {
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const newItems = [...items];
    const [moved] = newItems.splice(dragIdx, 1);
    newItems.splice(idx, 0, moved!);
    setItems(newItems);
    setDragIdx(idx);
  }, [dragIdx, items]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
  }, []);

  const totalTokens = items.reduce((sum, a) => sum + a.estimatedTokens, 0);
  const totalChars = items.reduce((sum, a) => sum + a.content.length, 0);

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Sora', system-ui, sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
          {t('scriptImport.flowStepConfirm')}
        </h2>
        <p style={{ fontSize: 13, color: textMuted, margin: 0 }}>
          {t('scriptImport.confirmDragHint')}
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        {items.map((item, idx) => (
          <div
            key={item.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 12px', marginBottom: 4,
              borderRadius: 8, background: bgCard,
              border: `1px solid ${dragIdx === idx ? accent : 'transparent'}`,
              cursor: 'grab', userSelect: 'none',
            }}
          >
            <GripVertical size={14} style={{ color: textMuted, flexShrink: 0, cursor: 'grab' }} />
            <span style={{
              width: 20, height: 20, borderRadius: '50%',
              background: `${accent}15`, color: accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 600, flexShrink: 0,
            }}>
              {idx + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.title}
              </div>
            </div>
            <span style={{ fontSize: 10, color: textMuted, whiteSpace: 'nowrap' }}>
              ~{item.estimatedTokens.toLocaleString()} tokens
            </span>
            <button
              type="button"
              onClick={() => setPreviewItem(item)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '3px 8px', borderRadius: 4, border: `1px solid ${border}`,
                background: 'transparent', color: textMuted, fontSize: 10,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <Eye size={10} /> {t('scriptImport.preview')}
            </button>
          </div>
        ))}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', border: `1px solid ${border}`, borderRadius: 8,
        background: bgCard, marginBottom: 20,
      }}>
        <span style={{ fontSize: 12, color: textMuted }}>
          {t('scriptImport.confirmFileCount', { count: items.length })}
        </span>
        <span style={{ fontSize: 11, color: textMuted }}>
          {t('scriptImport.confirmStats', { chars: totalChars.toLocaleString(), tokens: totalTokens.toLocaleString() })}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <button type="button" onClick={onBack} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 20px', borderRadius: 8, border: `1px solid ${border}`,
          background: 'transparent', color: textMuted, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <ArrowLeft size={12} /> {t('storyboard.previousStep')}
        </button>
        <button type="button" onClick={() => onNext(items)} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 24px', borderRadius: 8, border: 'none',
          background: accent, color: '#fff', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          {t('storyboard.nextStep')}
        </button>
      </div>

      {previewItem && (
        <TextPreviewModal
          open={true}
          onClose={() => setPreviewItem(null)}
          title={previewItem.title}
          content={previewItem.content}
        />
      )}
    </div>
  );
}