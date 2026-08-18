/**
 * EpisodeConfigStep - 分集配置步骤
 */
import { useState } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import type { EpisodeConfig } from './types.js';

interface EpisodeConfigStepProps {
  onComplete: (config: EpisodeConfig) => void;
  onBack: () => void;
}

export function EpisodeConfigStep({ onComplete, onBack }: EpisodeConfigStepProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;
  const bgCard = isDark ? '#1a1715' : '#f5f2ec';

  const [mode, setMode] = useState<'auto' | 'manual' | 'none'>('auto');
  const [manualCount, setManualCount] = useState(12);

  const handleConfirm = () => {
    onComplete({
      mode,
      count: mode === 'manual' ? manualCount : mode === 'none' ? 1 : 0, // 0 = AI 真实分析
      aiAssigned: mode === 'auto',
    });
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: "'Sora', system-ui, sans-serif", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>是否需要智能整理分集？</div>
      <div style={{ fontSize: 12, color: textMuted, marginBottom: 24 }}>AI 将根据剧本内容自动划分场景和分集结构</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left', marginBottom: 24 }}>
        {/* Auto option */}
        <label style={{
          display: 'flex', gap: 14, padding: '16px 18px', borderRadius: 10,
          border: `1.5px solid ${mode === 'auto' ? accent : border}`,
          background: mode === 'auto' ? `${accent}08` : bgCard, cursor: 'pointer',
          fontFamily: 'inherit', color: 'inherit',
        }}>
          <input type="radio" name="episodeMode" checked={mode === 'auto'} onChange={() => setMode('auto')} style={{ accentColor: accent, marginTop: 3 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>AI 自动分配（推荐）</div>
            <div style={{ fontSize: 11, color: textMuted }}>AI 将根据内容智能分析并划分</div>
          </div>
        </label>

        {/* Manual option */}
        <label style={{
          display: 'flex', gap: 14, padding: '16px 18px', borderRadius: 10,
          border: `1.5px solid ${mode === 'manual' ? accent : border}`,
          background: mode === 'manual' ? `${accent}08` : bgCard, cursor: 'pointer',
          fontFamily: 'inherit', color: 'inherit',
        }}>
          <input type="radio" name="episodeMode" checked={mode === 'manual'} onChange={() => setMode('manual')} style={{ accentColor: accent, marginTop: 3 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>手动指定集数</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 12, color: textMuted }}>共</span>
              <input
                type="number" value={manualCount} onChange={(e) => setManualCount(Math.max(1, parseInt(e.target.value) || 1))}
                style={{ width: 60, padding: '4px 8px', borderRadius: 6, border: `1px solid ${border}`, fontSize: 12, background: 'transparent', color: 'inherit', textAlign: 'center', fontFamily: 'inherit' }}
                min={1} max={100}
              />
              <span style={{ fontSize: 12, color: textMuted }}>集</span>
            </div>
          </div>
        </label>

        {/* None option */}
        <label style={{
          display: 'flex', gap: 14, padding: '16px 18px', borderRadius: 10,
          border: `1.5px solid ${mode === 'none' ? accent : border}`,
          background: mode === 'none' ? `${accent}08` : bgCard, cursor: 'pointer',
          fontFamily: 'inherit', color: 'inherit',
        }}>
          <input type="radio" name="episodeMode" checked={mode === 'none'} onChange={() => setMode('none')} style={{ accentColor: accent, marginTop: 3 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>无需分集，合并为单集</div>
            <div style={{ fontSize: 11, color: textMuted }}>适合短篇内容</div>
          </div>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button type="button" onClick={onBack} style={{ padding: '8px 20px', borderRadius: 8, border: `1px solid ${border}`, background: 'transparent', color: textMuted, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>上一步</button>
        <button type="button" onClick={handleConfirm} style={{ padding: '8px 24px', borderRadius: 8, border: 'none', background: accent, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>确认分集</button>
      </div>
    </div>
  );
}