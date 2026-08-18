/**
 * VideoSettingsPopover - 视频节点生成配置弹出面板
 *
 * 用 SettingsPopoverShell 包裹,根据模型判断走 Seedance 或 OpenAI 分支:
 * - Seedance: 分辨率(480p/720p/1080p) + 比例(16:9/9:16/1:1/4:3/3:4/21:9/自适应) + 时长(智能/4-15s) + 输出(声音/水印)
 * - OpenAI:   清晰度(480p/720p) + 尺寸(横屏/竖屏/方形/宽屏/长图/auto) + 秒数(6/10/12/16/20)
 *
 * 读写 node.data(vquality/size/seconds/generateAudio/watermark),通过 onChange 回调上抛 patch。
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import { Tooltip } from 'antd';
import {
  SettingsPopoverShell,
  SettingGroup,
  OptionPill,
  SwitchRow,
  NumberInput,
} from './settings-popover-shell.js';
import {
  useAiConfigStore,
  isSeedanceModelValue,
  getVideoSupportedModes,
  getModelSpecs,
} from '../../ai-config/use-ai-config-store.js';

export interface VideoSettingsPopoverProps {
  /** 当前模型值("channelId::model" 编码),用于判断 Seedance/OpenAI 分支 */
  model: string;
  /** 当前分辨率/清晰度(Seedance: 480p/720p/1080p;OpenAI: 480/720) */
  vquality: string;
  /** 当前尺寸/比例(Seedance: 比例;OpenAI: WxH 或 auto) */
  size: string;
  /** 当前时长(秒,Seedance -1 表示智能) */
  seconds: number;
  /** 是否生成声音 */
  generateAudio: boolean;
  /** 是否添加水印 */
  watermark: boolean;
  /** BUG8.5: 视频生成模式(Seedance 专用) */
  videoMode?: string;
  theme: ThemeConfig;
  /** 配置变更回调 */
  onChange: (patch: {
    vquality?: string;
    size?: string;
    seconds?: number;
    generateAudio?: boolean;
    watermark?: boolean;
    videoMode?: string;
  }) => void;
}

// ===== Seedance 选项 =====

const SEEDANCE_RESOLUTIONS = ['480p', '720p', '1080p'] as const;

/** BUG8.5: Seedance 视频生成模式 */
const VIDEO_MODES: { value: string; labelKey: string }[] = [
  { value: 'text-to-video', labelKey: 'prompt.videoModeTextToVideo' },
  { value: 'image-to-video', labelKey: 'prompt.videoModeImageToVideo' },
  { value: 'first-last-frame', labelKey: 'prompt.videoModeFirstLastFrame' },
  { value: 'all-reference', labelKey: 'prompt.videoModeAllReference' },
  { value: 'image-reference', labelKey: 'prompt.videoModeImageReference' },
];

const SEEDANCE_RATIOS: { value: string; ratio: number }[] = [
  { value: '16:9', ratio: 16 / 9 },
  { value: '9:16', ratio: 9 / 16 },
  { value: '1:1', ratio: 1 },
  { value: '4:3', ratio: 4 / 3 },
  { value: '3:4', ratio: 3 / 4 },
  { value: '21:9', ratio: 21 / 9 },
  { value: 'adaptive', ratio: 0 },
];

const SEEDANCE_DURATIONS = [-1, 4, 5, 6, 8, 10, 12, 15] as const;

// ===== OpenAI 选项 =====

const OPENAI_RESOLUTIONS = ['480p', '720p'] as const;

const OPENAI_SIZES: { value: string; labelKey: string; ratio: number }[] = [
  { value: '1280x720', labelKey: 'prompt.videoSizeLandscape', ratio: 16 / 9 },
  { value: '720x1280', labelKey: 'prompt.videoSizePortrait', ratio: 9 / 16 },
  { value: '1024x1024', labelKey: 'prompt.videoSizeSquare', ratio: 1 },
  { value: '1792x1024', labelKey: 'prompt.videoSizeWide', ratio: 1792 / 1024 },
  { value: '1024x1792', labelKey: 'prompt.videoSizeTall', ratio: 1024 / 1792 },
  { value: 'auto', labelKey: 'prompt.videoSizeAuto', ratio: 0 },
];

const OPENAI_SECONDS = [6, 10, 12, 16, 20] as const;

// ===== 归一化辅助 =====

function normalizeSeedanceResolution(value: string): string {
  if (value === 'low') return '480p';
  if (value === 'auto' || value === 'high' || value === 'medium') return '720p';
  const v = String(value || '').replace(/p$/i, '');
  return ['480', '720', '1080'].includes(v) ? `${v}p` : '720p';
}

function normalizeSeedanceRatio(value: string): string {
  if (!value || value === 'auto' || value === 'adaptive') return 'adaptive';
  return SEEDANCE_RATIOS.some((r) => r.value === value) ? value : 'adaptive';
}

function normalizeSeedanceDuration(value: number): number {
  if (value === -1) return -1;
  const s = Math.floor(Number(value) || 5);
  return Math.max(4, Math.min(15, s));
}

function normalizeOpenaiResolution(value: string): string {
  if (value === '480p' || value === '480') return '480p';
  return '720p';
}

function normalizeOpenaiSize(value: string): string {
  return OPENAI_SIZES.some((s) => s.value === value) ? value : 'auto';
}

// ===== 标签辅助 =====

function seedanceResolutionLabel(value: string): string {
  return normalizeSeedanceResolution(value);
}

function seedanceRatioLabel(t: (k: string) => string, value: string): string {
  const normalized = normalizeSeedanceRatio(value);
  if (normalized === 'adaptive') return t('prompt.videoRatioAdaptive');
  return normalized;
}

function seedanceDurationLabel(value: number): string {
  const normalized = normalizeSeedanceDuration(value);
  return normalized === -1 ? 'smart' : `${normalized}s`;
}

function openaiResolutionLabel(value: string): string {
  return normalizeOpenaiResolution(value);
}

function openaiSizeLabel(t: (k: string) => string, value: string): string {
  const normalized = normalizeOpenaiSize(value);
  const opt = OPENAI_SIZES.find((s) => s.value === normalized);
  return opt ? t(opt.labelKey) : normalized;
}

function openaiSecondsLabel(value: number): string {
  return `${value}s`;
}

// ===== 主组件 =====

export function VideoSettingsPopover({
  model,
  vquality,
  size,
  seconds,
  generateAudio,
  watermark,
  videoMode,
  theme,
  onChange,
}: VideoSettingsPopoverProps): React.ReactElement {
  const { t } = useTranslation();
  const config = useAiConfigStore((state) => state.config);
  const isSeedance = isSeedanceModelValue(config, model);

  // Bug6: 从后端 ModelConfig 获取 supportedModes 和 specs(动态配置)
  const supportedModes = useMemo(() => getVideoSupportedModes(config.channels, model), [config.channels, model]);
  const specs = useMemo(() => getModelSpecs(config.channels, model), [config.channels, model]);

  const summary = useMemo(() => {
    if (isSeedance) {
      return `${seedanceResolutionLabel(vquality)} · ${seedanceRatioLabel(t, size)} · ${seedanceDurationLabel(seconds)}`;
    }
    return `${openaiResolutionLabel(vquality)} · ${openaiSizeLabel(t, size)} · ${openaiSecondsLabel(seconds)}`;
  }, [t, isSeedance, vquality, size, seconds]);

  if (isSeedance) {
    return (
      <SeedancePanel
        vquality={vquality}
        size={size}
        seconds={seconds}
        generateAudio={generateAudio}
        watermark={watermark}
        videoMode={videoMode}
        theme={theme}
        summary={summary}
        onChange={onChange}
        t={t}
        supportedModes={supportedModes}
        specs={specs}
      />
    );
  }

  return (
    <OpenaiPanel
      vquality={vquality}
      size={size}
      seconds={seconds}
      theme={theme}
      summary={summary}
      onChange={onChange}
      t={t}
      specs={specs}
    />
  );
}

// ===== Seedance 面板 =====

function SeedancePanel({
  vquality,
  size,
  seconds,
  generateAudio,
  watermark,
  videoMode,
  theme,
  summary,
  onChange,
  t,
  supportedModes,
  specs,
}: {
  vquality: string;
  size: string;
  seconds: number;
  generateAudio: boolean;
  watermark: boolean;
  videoMode?: string;
  theme: ThemeConfig;
  summary: string;
  onChange: VideoSettingsPopoverProps['onChange'];
  t: (key: string) => string;
  /** Bug6: 后端配置的 supportedModes */
  supportedModes: string[];
  /** Bug6: 后端配置的 specs(含 resolutions/ratios/durationRange/generateAudio/watermark) */
  specs?: Record<string, unknown>;
}): React.ReactElement {
  const safeResolution = normalizeSeedanceResolution(vquality);
  const safeRatio = normalizeSeedanceRatio(size);
  const safeDuration = normalizeSeedanceDuration(seconds);
  // Bug6: 模式列表按后端 supportedModes 过滤
  const visibleModes = VIDEO_MODES.filter((m) => supportedModes.includes(m.value));
  const safeMode = visibleModes.some((m) => m.value === videoMode) ? (videoMode as string) : (visibleModes[0]?.value ?? 'text-to-video');

  // Bug6: 从 specs 提取动态规格(回退到常量)
  const resolutions = getSpecStringArray(specs, 'resolutions', SEEDANCE_RESOLUTIONS as readonly string[]);
  const ratios = getSpecStringArray(specs, 'ratios', SEEDANCE_RATIOS.map((r) => r.value));
  const durationRange = getSpecNumberArray(specs, 'durationRange', [4, 15]);
  const hasGenerateAudio = specs ? Boolean(specs.generateAudio) : true;
  const hasWatermark = specs ? specs.watermark !== undefined : true;

  return (
    <SettingsPopoverShell summary={summary} theme={theme} panelWidth={320}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* BUG8.5: 视频生成模式选择器(Bug6: 按后端 supportedModes 动态显示) */}
        {visibleModes.length > 1 ? (
          <SettingGroup title={t('prompt.videoModeTitle')} color={theme.toolbar.textMuted}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {visibleModes.map((opt) => (
                <OptionPill
                  key={opt.value}
                  selected={safeMode === opt.value}
                  theme={theme}
                  onClick={() => onChange({ videoMode: opt.value })}
                >
                  {t(opt.labelKey)}
                </OptionPill>
              ))}
            </div>
          </SettingGroup>
        ) : null}

        <SettingGroup title={t('prompt.videoResolutionTitle')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {resolutions.map((res) => (
              <OptionPill
                key={res}
                selected={safeResolution === res}
                theme={theme}
                onClick={() => onChange({ vquality: res })}
              >
                {res}
              </OptionPill>
            ))}
          </div>
        </SettingGroup>

        <SettingGroup title={t('prompt.videoRatioTitle')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {ratios.map((ratioValue) => {
              const matched = SEEDANCE_RATIOS.find((r) => r.value === ratioValue);
              return (
                <RatioButton
                  key={ratioValue}
                  value={ratioValue}
                  ratio={matched?.ratio ?? 0}
                  selected={safeRatio === ratioValue}
                  theme={theme}
                  onClick={() => onChange({ size: ratioValue })}
                />
              );
            })}
          </div>
        </SettingGroup>

        <SettingGroup title={t('prompt.videoDurationTitle')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {SEEDANCE_DURATIONS.filter((dur) => dur === -1 || (dur >= durationRange[0] && dur <= durationRange[1])).map((dur) => (
              <OptionPill
                key={dur}
                selected={safeDuration === dur}
                theme={theme}
                onClick={() => onChange({ seconds: dur })}
              >
                {dur === -1 ? t('prompt.videoDurationSmart') : `${dur}s`}
              </OptionPill>
            ))}
            <NumberInput
              value={String(safeDuration)}
              min={durationRange[0]}
              max={durationRange[1]}
              theme={theme}
              onChange={(value) => {
                const n = Math.floor(Number(value) || 5);
                onChange({ seconds: n });
              }}
            />
          </div>
        </SettingGroup>

        {hasGenerateAudio || hasWatermark ? (
          <SettingGroup title={t('prompt.videoOutputTitle')} color={theme.toolbar.textMuted}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 10, borderRadius: 10, border: `1px solid ${theme.toolbar.border}` }}>
              {hasGenerateAudio ? (
                <SwitchRow
                  label={t('prompt.videoGenerateAudio')}
                  checked={generateAudio}
                  theme={theme}
                  onChange={(checked) => onChange({ generateAudio: checked })}
                />
              ) : null}
              {hasWatermark ? (
                <SwitchRow
                  label={t('prompt.videoWatermark')}
                  checked={watermark}
                  theme={theme}
                  onChange={(checked) => onChange({ watermark: checked })}
                />
              ) : null}
            </div>
          </SettingGroup>
        ) : null}
      </div>
    </SettingsPopoverShell>
  );
}

// ===== OpenAI 面板 =====

function OpenaiPanel({
  vquality,
  size,
  seconds,
  theme,
  summary,
  onChange,
  t,
  specs,
}: {
  vquality: string;
  size: string;
  seconds: number;
  theme: ThemeConfig;
  summary: string;
  onChange: VideoSettingsPopoverProps['onChange'];
  t: (key: string) => string;
  /** Bug6: 后端配置的 specs */
  specs?: Record<string, unknown>;
}): React.ReactElement {
  const safeResolution = normalizeOpenaiResolution(vquality);
  const safeSize = normalizeOpenaiSize(size);
  const safeSeconds = [6, 10, 12, 16, 20].includes(seconds) ? seconds : 6;

  // Bug6: 从 specs 提取动态规格(回退到常量)
  const resolutions = getSpecStringArray(specs, 'resolutions', OPENAI_RESOLUTIONS as readonly string[]);
  const sizes = getSpecStringArray(specs, 'sizes', OPENAI_SIZES.map((s) => s.value));
  const durationRange = getSpecNumberArray(specs, 'durationRange', [1, 20]);

  return (
    <SettingsPopoverShell summary={summary} theme={theme} panelWidth={320}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SettingGroup title={t('prompt.videoClarityTitle')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {resolutions.map((res) => (
              <OptionPill
                key={res}
                selected={safeResolution === res}
                theme={theme}
                onClick={() => onChange({ vquality: res })}
              >
                {res}
              </OptionPill>
            ))}
          </div>
        </SettingGroup>

        <SettingGroup title={t('prompt.videoSizeTitle')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {sizes.map((sizeValue) => {
              const matched = OPENAI_SIZES.find((s) => s.value === sizeValue);
              return (
                <RatioButton
                  key={sizeValue}
                  value={sizeValue}
                  ratio={matched?.ratio ?? 0}
                  selected={safeSize === sizeValue}
                  theme={theme}
                  onClick={() => onChange({ size: sizeValue })}
                />
              );
            })}
          </div>
        </SettingGroup>

        <SettingGroup title={t('prompt.videoSecondsTitle')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {OPENAI_SECONDS.filter((sec) => sec >= durationRange[0] && sec <= durationRange[1]).map((sec) => (
              <OptionPill
                key={sec}
                selected={safeSeconds === sec}
                theme={theme}
                onClick={() => onChange({ seconds: sec })}
              >
                {sec}s
              </OptionPill>
            ))}
            <NumberInput
              value={String(safeSeconds)}
              min={durationRange[0]}
              max={durationRange[1]}
              theme={theme}
              onChange={(value) => {
                const n = Math.max(durationRange[0], Math.min(durationRange[1], Math.floor(Number(value) || 6)));
                onChange({ seconds: n });
              }}
            />
          </div>
        </SettingGroup>
      </div>
    </SettingsPopoverShell>
  );
}

// ===== Bug6: specs 提取辅助函数 =====

/** 从 specs 中提取字符串数组(回退到默认值) */
function getSpecStringArray(
  specs: Record<string, unknown> | undefined,
  key: string,
  fallback: readonly string[],
): string[] {
  if (!specs) return [...fallback];
  const value = specs[key];
  if (Array.isArray(value) && value.length > 0) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return [...fallback];
}

/** 从 specs 中提取数字范围 [min, max](回退到默认值) */
function getSpecNumberArray(
  specs: Record<string, unknown> | undefined,
  key: string,
  fallback: [number, number],
): [number, number] {
  if (!specs) return fallback;
  const value = specs[key];
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return [value[0], value[1]];
  }
  return fallback;
}

// ===== 比例按钮(复用 image 的视觉风格) =====

function RatioButton({
  value,
  ratio,
  selected,
  theme,
  onClick,
}: {
  value: string;
  ratio: number;
  selected: boolean;
  theme: ThemeConfig;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Tooltip title={value}>
      <button
        type="button"
        onClick={onClick}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          height: 56,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          borderRadius: 10,
          border: `1px solid ${selected ? theme.toolbar.text : theme.toolbar.border}`,
          background: 'transparent',
          color: theme.toolbar.text,
          cursor: 'pointer',
          fontSize: 11,
          transition: 'opacity 0.12s',
        }}
      >
      <RatioIcon ratio={ratio} color={theme.toolbar.text} />
      <span>{value}</span>
    </button>
    </Tooltip>
  );
}

function RatioIcon({ ratio, color }: { ratio: number; color: string }): React.ReactElement {
  if (ratio === 0) {
    return <span style={{ height: 22, display: 'inline-flex', alignItems: 'center', fontSize: 10, opacity: 0.6 }}>auto</span>;
  }
  const boxWidth = ratio >= 1 ? 22 : Math.max(8, 22 * ratio);
  const boxHeight = ratio >= 1 ? Math.max(8, 22 / ratio) : 22;
  return (
    <span style={{ height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ width: boxWidth, height: boxHeight, border: `2px solid ${color}`, borderRadius: 2 }} />
    </span>
  );
}
