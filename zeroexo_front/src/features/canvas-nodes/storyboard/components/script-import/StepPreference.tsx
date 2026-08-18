/**
 * StepPreference - 步骤 3：生成偏好设置
 *
 * 用户选择短剧/长剧/每集时长等预设，以及风格/类型和语言。
 */
import { useState, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';
import type { GenerationPreference } from './types.js';

const GENRES = ['悬疑', '喜剧', '爱情', '科幻', '历史', '动作', '奇幻', '剧情'];

const DRAMA_OPTIONS = [
  { key: 'short' as const, labelKey: 'scriptImport.shortDrama', descKey: 'scriptImport.shortDramaDesc', duration: '1-3' },
  { key: 'standard' as const, labelKey: 'scriptImport.standard', descKey: 'scriptImport.standardDesc', duration: '5-10' },
  { key: 'long' as const, labelKey: 'scriptImport.longDrama', descKey: 'scriptImport.longDramaDesc', duration: '15-30' },
  { key: 'custom' as const, labelKey: 'scriptImport.customDuration', descKey: 'scriptImport.customDurationDesc', duration: null },
];

export function StepPreference({
  totalChars,
  totalTokens,
  onNext,
  onBack,
}: {
  totalChars: number;
  totalTokens: number;
  onNext: (pref: GenerationPreference) => void;
  onBack: () => void;
}): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;
  const bgCard = isDark ? '#1a1715' : '#f5f2ec';

  const [dramaType, setDramaType] = useState<'short' | 'standard' | 'long' | 'custom'>('standard');
  const [customDuration, setCustomDuration] = useState(10);
  const [genres, setGenres] = useState<string[]>([]);
  const [language, setLanguage] = useState<'zh' | 'en' | 'bilingual'>('zh');

  const handleToggleGenre = useCallback((g: string) => {
    setGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  }, []);

  const handleNext = useCallback(() => {
    onNext({ dramaType, customDuration: dramaType === 'custom' ? customDuration : undefined, genres, language });
  }, [dramaType, customDuration, genres, language, onNext]);

  const selectedOption = DRAMA_OPTIONS.find((o) => o.key === dramaType)!;
  const estimatedEpisodes = Math.max(1, Math.floor(totalChars / 5000));

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Sora', system-ui, sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
          {t('scriptImport.preferenceTitle')}
        </h2>
        <p style={{ fontSize: 13, color: textMuted, margin: 0 }}>
          {t('scriptImport.preferenceDesc')}
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          {t('scriptImport.episodeType')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DRAMA_OPTIONS.map((opt) => {
            const borderStyle = dramaType === opt.key ? accent : border;
            const bgStyle = dramaType === opt.key ? accent + '08' : bgCard;
            return (
              <label key={opt.key} style={{
                display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 8,
                border: '1.5px solid ' + borderStyle,
                background: bgStyle,
                cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
              }}>
                <input type="radio" name="dramaType" checked={dramaType === opt.key}
                  onChange={() => setDramaType(opt.key)}
                  style={{ accentColor: accent, marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{t(opt.labelKey)}</div>
                  <div style={{ fontSize: 11, color: textMuted }}>{t(opt.descKey)}</div>
                  {opt.key === 'custom' && dramaType === 'custom' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <span style={{ fontSize: 12, color: textMuted }}>{t('scriptImport.perEpisode')}</span>
                      <input type="number" value={customDuration}
                        onChange={(e) => setCustomDuration(Math.max(1, parseInt(e.target.value) || 1))}
                        style={{ width: 60, padding: '4px 8px', borderRadius: 6, border: '1px solid ' + border, fontSize: 12, background: 'transparent', color: 'inherit', textAlign: 'center', fontFamily: 'inherit' }}
                        min={1} max={120} />
                      <span style={{ fontSize: 12, color: textMuted }}>{t('scriptImport.minutes')}</span>
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
          {t('scriptImport.styleGenre')}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {GENRES.map((g) => {
            const btnBorder = genres.includes(g) ? accent : border;
            const btnBg = genres.includes(g) ? accent + '15' : 'transparent';
            const btnColor = genres.includes(g) ? accent : textMuted;
            return (
              <button
                key={g}
                type="button"
                onClick={() => handleToggleGenre(g)}
                style={{
                  padding: '4px 12px', borderRadius: 9999, border: '1px solid ' + btnBorder,
                  background: btnBg,
                  color: btnColor,
                  fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {g}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
          {t('scriptImport.languageStyle')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['zh', 'en', 'bilingual'] as const).map((l) => {
            const langBorder = language === l ? accent : border;
            const langBg = language === l ? accent + '08' : 'transparent';
            return (
              <label key={l} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 6,
                border: '1px solid ' + langBorder,
                background: langBg,
                cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', fontSize: 12,
              }}>
                <input type="radio" name="language" checked={language === l}
                  onChange={() => setLanguage(l)}
                  style={{ accentColor: accent }} />
                {l === 'zh' ? t('scriptImport.chinese') : l === 'en' ? t('scriptImport.english') : t('scriptImport.bilingual')}
              </label>
            );
          })}
        </div>
      </div>

      <div style={{
        padding: '12px 14px', border: '1px solid ' + border, borderRadius: 8,
        background: bgCard, marginBottom: 20,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('scriptImport.presetInfo')}</div>
        <div style={{ fontSize: 11, color: textMuted, lineHeight: 1.5 }}>
          {t('scriptImport.currentSelection', {
            label: t(selectedOption.labelKey),
            detail: selectedOption.duration
              ? t('scriptImport.minutesPerEpisode', { duration: selectedOption.duration })
              : t('scriptImport.customMinutes', { minutes: customDuration }),
          })}
          <br />
          {t('scriptImport.charsTokens', { chars: totalChars.toLocaleString(), tokens: totalTokens.toLocaleString() })}
          <br />
          {t('scriptImport.estimatedEpisodes', { count: estimatedEpisodes })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <button type="button" onClick={onBack} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 20px', borderRadius: 8, border: '1px solid ' + border,
          background: 'transparent', color: textMuted, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <ArrowLeft size={12} /> {t('storyboard.previousStep')}
        </button>
        <button type="button" onClick={handleNext} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 24px', borderRadius: 8, border: 'none',
          background: accent, color: '#fff', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          {t('storyboard.nextStep')}
        </button>
      </div>
    </div>
  );
}
