/**
 * StepAssign - 步骤 4：剧集分配方式
 *
 * 用户选择如何将选中的文本素材分配为剧集：
 * - N个文本 → 1集（用户自己合并）
 * - N个文本 → N集（一一对应）
 * - AI 智能分割（辅助建议，不强制）
 */
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import type { AssignMode, TextAssetItem } from './types.js';

export function StepAssign({
  assets,
  assignMode,
  onAssignModeChange,
  onNext,
  onBack,
}: {
  assets: TextAssetItem[];
  assignMode: AssignMode;
  onAssignModeChange: (mode: AssignMode) => void;
  onNext: () => void;
  onBack: () => void;
}): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;
  const bgCard = isDark ? '#1a1715' : '#f5f2ec';

  const count = assets.length;

  const modes: Array<{ key: AssignMode; titleKey: string; descKey: string; detailKey: string }> = [
    {
      key: 'merge',
      titleKey: 'scriptImport.mergeSingle',
      descKey: 'scriptImport.mergeSingleDesc',
      detailKey: 'scriptImport.mergeSingleDetail',
    },
    {
      key: 'one-to-one',
      titleKey: 'scriptImport.oneToOne',
      descKey: 'scriptImport.oneToOneDesc',
      detailKey: 'scriptImport.oneToOneDetail',
    },
    {
      key: 'ai-split',
      titleKey: 'scriptImport.aiSplit',
      descKey: 'scriptImport.aiSplitDesc',
      detailKey: 'scriptImport.aiSplitDetail',
    },
  ];

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Sora', system-ui, sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
          {t('scriptImport.assignmentMode')}
        </h2>
        <p style={{ fontSize: 13, color: textMuted, margin: 0 }}>
          {t('scriptImport.assignmentModeDesc', { count })}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {modes.map((mode) => (
          <label
            key={mode.key}
            style={{
              display: 'flex', gap: 14, padding: '14px 16px', borderRadius: 10,
              border: `1.5px solid ${assignMode === mode.key ? accent : border}`,
              background: assignMode === mode.key ? `${accent}08` : bgCard,
              cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
            }}
          >
            <input
              type="radio"
              name="assignMode"
              checked={assignMode === mode.key}
              onChange={() => onAssignModeChange(mode.key)}
              style={{ accentColor: accent, marginTop: 3 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t(mode.titleKey, { count })}</div>
              <div style={{ fontSize: 11, color: textMuted, marginBottom: 2 }}>{t(mode.descKey)}</div>
              <div style={{ fontSize: 10, color: textMuted, opacity: 0.7 }}>{t(mode.detailKey)}</div>

              {assignMode === 'one-to-one' && mode.key === 'one-to-one' && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {assets.map((a, idx) => (
                    <div key={a.id} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 8px', borderRadius: 4,
                      background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                      fontSize: 11,
                    }}>
                      <span style={{ color: accent, fontWeight: 600, flexShrink: 0 }}>{t('scriptImport.episodeOrdinal', { n: idx + 1 })}</span>
                      <ArrowLeft size={10} style={{ color: textMuted, transform: 'rotate(180deg)', flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>

      {assignMode === 'one-to-one' && count > 1 && (
        <div style={{
          fontSize: 11, color: textMuted, padding: '8px 14px',
          border: `1px solid ${border}`, borderRadius: 8, marginBottom: 20,
          background: bgCard,
        }}>
          {t('scriptImport.assignmentHint')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <button type="button" onClick={onBack} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 20px', borderRadius: 8, border: `1px solid ${border}`,
          background: 'transparent', color: textMuted, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <ArrowLeft size={12} /> {t('storyboard.previousStep')}
        </button>
        <button type="button" onClick={onNext} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 24px', borderRadius: 8, border: 'none',
          background: accent, color: '#fff', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: `0 4px 16px ${accent}40`,
        }}>
          <Sparkles size={12} /> {t('scriptImport.submitGenerate')}
        </button>
      </div>
    </div>
  );
}