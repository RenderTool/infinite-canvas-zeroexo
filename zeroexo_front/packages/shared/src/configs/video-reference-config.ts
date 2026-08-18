/**
 * video-reference-config - 视频参考配置纯函数
 *
 * 从 video-settings-popover.tsx 提取配置逻辑
 * 导出纯函数，不依赖 React
 */

// ===== Seedance 选项常量 =====

export const SEEDANCE_RESOLUTIONS = ['480p', '720p', '1080p'] as const;

export const VIDEO_MODES: { value: string; labelKey: string }[] = [
  { value: 'text-to-video', labelKey: 'prompt.videoModeTextToVideo' },
  { value: 'image-to-video', labelKey: 'prompt.videoModeImageToVideo' },
  { value: 'first-last-frame', labelKey: 'prompt.videoModeFirstLastFrame' },
  { value: 'all-reference', labelKey: 'prompt.videoModeAllReference' },
  { value: 'image-reference', labelKey: 'prompt.videoModeImageReference' },
];

export const SEEDANCE_RATIOS: { value: string; ratio: number }[] = [
  { value: '16:9', ratio: 16 / 9 },
  { value: '9:16', ratio: 9 / 16 },
  { value: '1:1', ratio: 1 },
  { value: '4:3', ratio: 4 / 3 },
  { value: '3:4', ratio: 3 / 4 },
  { value: '21:9', ratio: 21 / 9 },
  { value: 'adaptive', ratio: 0 },
];

export const SEEDANCE_DURATIONS = [-1, 4, 5, 6, 8, 10, 12, 15] as const;

// ===== OpenAI 选项常量 =====

export const OPENAI_RESOLUTIONS = ['480p', '720p'] as const;

export const OPENAI_SIZES: { value: string; labelKey: string; ratio: number }[] = [
  { value: '1280x720', labelKey: 'prompt.videoSizeLandscape', ratio: 16 / 9 },
  { value: '720x1280', labelKey: 'prompt.videoSizePortrait', ratio: 9 / 16 },
  { value: '1024x1024', labelKey: 'prompt.videoSizeSquare', ratio: 1 },
  { value: '1792x1024', labelKey: 'prompt.videoSizeWide', ratio: 1792 / 1024 },
  { value: '1024x1792', labelKey: 'prompt.videoSizeTall', ratio: 1024 / 1792 },
  { value: 'auto', labelKey: 'prompt.videoSizeAuto', ratio: 0 },
];

export const OPENAI_SECONDS = [6, 10, 12, 16, 20] as const;

// ===== 归一化辅助函数 =====

export function normalizeSeedanceResolution(value: string): string {
  if (value === 'low') return '480p';
  if (value === 'auto' || value === 'high' || value === 'medium') return '720p';
  const v = String(value || '').replace(/p$/i, '');
  return ['480', '720', '1080'].includes(v) ? `${v}p` : '720p';
}

export function normalizeSeedanceRatio(value: string): string {
  if (!value || value === 'auto' || value === 'adaptive') return 'adaptive';
  return SEEDANCE_RATIOS.some((r) => r.value === value) ? value : 'adaptive';
}

export function normalizeSeedanceDuration(value: number): number {
  if (value === -1) return -1;
  const s = Math.floor(Number(value) || 5);
  return Math.max(4, Math.min(15, s));
}

export function normalizeOpenaiResolution(value: string): string {
  if (value === '480p' || value === '480') return '480p';
  return '720p';
}

export function normalizeOpenaiSize(value: string): string {
  return OPENAI_SIZES.some((s) => s.value === value) ? value : 'auto';
}

// ===== 标签辅助函数 =====

export function seedanceResolutionLabel(value: string): string {
  return normalizeSeedanceResolution(value);
}

export function seedanceRatioLabel(t: (k: string) => string, value: string): string {
  const normalized = normalizeSeedanceRatio(value);
  if (normalized === 'adaptive') return t('prompt.videoRatioAdaptive');
  return normalized;
}

export function seedanceDurationLabel(value: number): string {
  const normalized = normalizeSeedanceDuration(value);
  return normalized === -1 ? 'smart' : `${normalized}s`;
}

export function openaiResolutionLabel(value: string): string {
  return normalizeOpenaiResolution(value);
}

export function openaiSizeLabel(t: (k: string) => string, value: string): string {
  const normalized = normalizeOpenaiSize(value);
  const opt = OPENAI_SIZES.find((s) => s.value === normalized);
  return opt ? t(opt.labelKey) : normalized;
}

export function openaiSecondsLabel(value: number): string {
  return `${value}s`;
}

// ===== specs 提取辅助函数 =====

/** 从 specs 中提取字符串数组(回退到默认值) */
export function getSpecStringArray(
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
export function getSpecNumberArray(
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