/**
 * ParamComparisonStep - 参数对比步骤
 */
import { useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import type { ParamComparison } from './types.js';

interface ParamComparisonStepProps {
  mergedContent: string;
  projectSetupConfig: Record<string, unknown>;
  onComplete: (comparison: ParamComparison) => void;
  onBack: () => void;
}

export function ParamComparisonStep({ mergedContent, projectSetupConfig, onComplete, onBack }: ParamComparisonStepProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;

  // Extract some basic info from content
  const importDuration = mergedContent.length > 500 ? '约 8 分钟' : '约 30 秒';
  const importType = mergedContent.includes('镜头') || mergedContent.includes('景别') ? '玄幻动画' : '未知';

  const schemes = (projectSetupConfig as Record<string, unknown>)?.schemes as Array<Record<string, unknown>> | undefined;
  const baseAttributes = schemes?.[0]?.baseAttributes as Record<string, string> | undefined;

  const diffs = [
    { key: 'filmType', label: '影片类型', importValue: importType, setupValue: baseAttributes?.filmType || 'TVC广告', suggestedValue: importType, severity: 'critical' as const },
    { key: 'duration', label: '时长', importValue: importDuration, setupValue: baseAttributes?.duration || '30s', suggestedValue: importDuration, severity: 'critical' as const },
    { key: 'aspectRatio', label: '画面比例', importValue: '16:9', setupValue: baseAttributes?.aspectRatio || '16:9', suggestedValue: '16:9', severity: 'same' as const },
  ];

  const [choices, setChoices] = useState<Record<string, 'import' | 'setup'>>({});

  const handleChoose = (key: string, choice: 'import' | 'setup') => {
    setChoices(prev => ({ ...prev, [key]: choice }));
  };

  const handleConfirm = () => {
    onComplete({ diffs: diffs.map(d => ({ ...d, importValue: choices[d.key] === 'setup' ? d.setupValue : d.importValue })), hasDifferences: diffs.some(d => d.severity !== 'same') });
  };

  const criticalDiffs = diffs.filter(d => d.severity === 'critical');
  const sameDiffs = diffs.filter(d => d.severity === 'same');

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: "'Sora', system-ui, sans-serif", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>参数对比</div>
      <div style={{ fontSize: 12, color: textMuted, marginBottom: 20 }}>导入内容与立项参数的差异项</div>

      <div style={{ textAlign: 'left', marginBottom: 20 }}>
        {/* Critical diffs */}
        {criticalDiffs.map(d => (
          <div key={d.key} style={{ padding: '12px 16px', borderRadius: 10, border: `1px solid #ef444430`, background: `${isDark ? '#ef4444' : '#ef4444'}08`, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <AlertTriangle size={14} style={{ color: '#ef4444' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#ef4444' }}>{d.label}</span>
            </div>
            <div style={{ fontSize: 12, color: textMuted, marginBottom: 8, display: 'flex', gap: 16 }}>
              <span>导入值: <strong>{d.importValue}</strong></span>
              <span>立项值: <strong>{d.setupValue}</strong></span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => handleChoose(d.key, 'import')} style={choiceBtnStyle(choices[d.key] === 'import', accent, border, textMuted)}>
                {choices[d.key] === 'import' && <Check size={10} />} 使用导入值
              </button>
              <button type="button" onClick={() => handleChoose(d.key, 'setup')} style={choiceBtnStyle(choices[d.key] === 'setup', accent, border, textMuted)}>
                {choices[d.key] === 'setup' && <Check size={10} />} 保留立项值
              </button>
            </div>
          </div>
        ))}

        {/* Same items (collapsed) */}
        {sameDiffs.map(d => (
          <div key={d.key} style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${border}`, marginBottom: 4, fontSize: 12, color: textMuted }}>
            ⚪ {d.label} (一致) {d.importValue}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button type="button" onClick={onBack} style={{ padding: '8px 20px', borderRadius: 8, border: `1px solid ${border}`, background: 'transparent', color: textMuted, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>上一步</button>
        <button type="button" onClick={handleConfirm} style={{ padding: '8px 24px', borderRadius: 8, border: 'none', background: accent, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>确认参数</button>
      </div>
    </div>
  );
}

function choiceBtnStyle(selected: boolean, accent: string, border: string, textMuted: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 12px', borderRadius: 6, fontSize: 11,
    border: `1px solid ${selected ? accent : border}`,
    background: selected ? `${accent}15` : 'transparent',
    color: selected ? accent : textMuted,
    cursor: 'pointer', fontFamily: 'inherit',
  };
}