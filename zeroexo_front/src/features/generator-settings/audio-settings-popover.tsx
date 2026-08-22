/**
 * AudioSettingsPopover - 音频节点生成配置弹出面板
 *
 * 用 SettingsPopoverShell 包裹,面板内容: 声音 + 格式 + 语速 + 声音指令。
 * 读写 node.data(voice/audioFormat/audioSpeed/audioInstructions),通过 onChange 回调上抛 patch。
 * OpenAI TTS 音色列表分组。
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import {
  SettingsPopoverShell,
  SettingGroup,
  OptionPill,
} from './settings-popover-shell.js';
import {
  useAiConfigStore,
  getModelSpecs,
} from '../ai-config/use-ai-config-store.js';

export interface AudioSettingsPopoverProps {
  /** Bug6: 当前模型值("channelId::model" 编码),用于获取后端 specs */
  model: string;
  /** 当前音色(alloy/ash/ballad/coral/echo/fable/nova/onyx/sage/shimmer/verse/marin/cedar) */
  voice: string;
  /** 当前格式(mp3/wav/opus/aac/flac/pcm) */
  format: string;
  /** 当前语速(0.25-4) */
  speed: number;
  /** 声音指令(可选) */
  instructions?: string;
  theme: ThemeConfig;
  /** 配置变更回调 */
  onChange: (patch: {
    voice?: string;
    audioFormat?: string;
    audioSpeed?: number;
    audioInstructions?: string;
  }) => void;
}

const VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: 'alloy', label: 'Alloy' },
  { value: 'ash', label: 'Ash' },
  { value: 'ballad', label: 'Ballad' },
  { value: 'coral', label: 'Coral' },
  { value: 'echo', label: 'Echo' },
  { value: 'fable', label: 'Fable' },
  { value: 'nova', label: 'Nova' },
  { value: 'onyx', label: 'Onyx' },
  { value: 'sage', label: 'Sage' },
  { value: 'shimmer', label: 'Shimmer' },
  { value: 'verse', label: 'Verse' },
  { value: 'marin', label: 'Marin' },
  { value: 'cedar', label: 'Cedar' },
];

const FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
  { value: 'opus', label: 'Opus' },
  { value: 'aac', label: 'AAC' },
  { value: 'flac', label: 'FLAC' },
  { value: 'pcm', label: 'PCM' },
];

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5];

function normalizeVoice(value: string): string {
  return VOICE_OPTIONS.some((v) => v.value === value) ? value : 'alloy';
}

function normalizeFormat(value: string): string {
  return FORMAT_OPTIONS.some((f) => f.value === value) ? value : 'mp3';
}

function normalizeSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.25, Math.min(4, Number(value.toFixed(2))));
}

function voiceLabel(value: string): string {
  const v = normalizeVoice(value);
  return VOICE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

function formatLabel(value: string): string {
  const f = normalizeFormat(value);
  return FORMAT_OPTIONS.find((o) => o.value === f)?.label ?? f;
}

export function AudioSettingsPopover({
  model,
  voice,
  format,
  speed,
  instructions,
  theme,
  onChange,
}: AudioSettingsPopoverProps): React.ReactElement {
  const { t } = useTranslation();
  const config = useAiConfigStore((state) => state.config);
  // Bug6: 从后端 ModelConfig 获取 specs(动态配置规格)
  const specs = useMemo(() => getModelSpecs(config.channels, model), [config.channels, model]);

  const safeVoice = normalizeVoice(voice);
  const safeFormat = normalizeFormat(format);
  const safeSpeed = normalizeSpeed(speed);

  // Bug6: 从 specs 提取动态规格(回退到常量)
  const voices = useMemo(() => {
    if (!specs || !Array.isArray(specs.voices)) return VOICE_OPTIONS.map((o) => o.value);
    return specs.voices.filter((v): v is string => typeof v === 'string');
  }, [specs]);
  const formats = useMemo(() => {
    if (!specs || !Array.isArray(specs.formats)) return FORMAT_OPTIONS.map((o) => o.value);
    return specs.formats.filter((v): v is string => typeof v === 'string');
  }, [specs]);
  const speedRange = useMemo<[number, number]>(() => {
    if (!specs || !Array.isArray(specs.speedRange) || specs.speedRange.length < 2) return [0.25, 4];
    const min = specs.speedRange[0];
    const max = specs.speedRange[1];
    return typeof min === 'number' && typeof max === 'number' ? [min, max] : [0.25, 4];
  }, [specs]);

  const summary = useMemo(() => {
    return `${voiceLabel(safeVoice)} · ${formatLabel(safeFormat)} · ${safeSpeed}x`;
  }, [safeVoice, safeFormat, safeSpeed]);

  return (
    <SettingsPopoverShell summary={summary} theme={theme} panelWidth={320} triggerVariant="dropdown">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SettingGroup title={t('prompt.audioVoiceTitle')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {VOICE_OPTIONS.filter((opt) => voices.includes(opt.value)).map((opt) => (
              <OptionPill
                key={opt.value}
                selected={safeVoice === opt.value}
                theme={theme}
                onClick={() => onChange({ voice: opt.value })}
              >
                {opt.label}
              </OptionPill>
            ))}
          </div>
        </SettingGroup>

        <SettingGroup title={t('prompt.audioFormatTitle')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {FORMAT_OPTIONS.filter((opt) => formats.includes(opt.value)).map((opt) => (
              <OptionPill
                key={opt.value}
                selected={safeFormat === opt.value}
                theme={theme}
                onClick={() => onChange({ audioFormat: opt.value })}
              >
                {opt.label}
              </OptionPill>
            ))}
          </div>
        </SettingGroup>

        <SettingGroup title={t('prompt.audioSpeedTitle')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {SPEED_OPTIONS.filter((s) => s >= speedRange[0] && s <= speedRange[1]).map((s) => (
              <OptionPill
                key={s}
                selected={safeSpeed === s}
                theme={theme}
                onClick={() => onChange({ audioSpeed: s })}
              >
                {s}x
              </OptionPill>
            ))}
            <SpeedInput
              value={safeSpeed}
              min={speedRange[0]}
              max={speedRange[1]}
              theme={theme}
              onChange={(value) => onChange({ audioSpeed: normalizeSpeed(value) })}
            />
          </div>
        </SettingGroup>

        <SettingGroup title={t('prompt.audioInstructionsTitle')} color={theme.toolbar.textMuted}>
          <textarea
            value={instructions ?? ''}
            placeholder={t('prompt.audioInstructionsPlaceholder')}
            onChange={(event) => onChange({ audioInstructions: event.target.value })}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              height: 80,
              resize: 'none',
              borderRadius: 8,
              border: `1px solid ${theme.toolbar.border}`,
              background: 'transparent',
              color: theme.toolbar.text,
              padding: '8px 10px',
              fontSize: 12,
              lineHeight: 1.5,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </SettingGroup>
      </div>
    </SettingsPopoverShell>
  );
}

/** 语速数字输入(支持小数步进) */
function SpeedInput({
  value,
  min,
  max,
  theme,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  theme: ThemeConfig;
  onChange: (value: number) => void;
}): React.ReactElement {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={0.05}
      value={value}
      onChange={(event) => onChange(Number(event.target.value) || 1)}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        height: 32,
        borderRadius: 9999,
        border: `1px solid ${theme.toolbar.border}`,
        background: 'transparent',
        color: theme.toolbar.text,
        padding: '0 10px',
        fontSize: 12,
        textAlign: 'center',
        outline: 'none',
        width: 64,
        WebkitAppearance: 'textfield' as unknown as 'none',
      }}
    />
  );
}
