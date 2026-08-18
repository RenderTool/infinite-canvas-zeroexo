/**
 * parameter-def - 参数定义常量
 *
 * 从 use-ai-config-store.ts 和 video-settings-popover.tsx 提取
 * 包含 size/quality/count 等参数定义
 */

// ===== 图片参数 =====

/** 图片质量选项 */
export const IMAGE_QUALITY_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'standard', labelKey: 'prompt.imageQualityStandard' },
  { value: 'hd', labelKey: 'prompt.imageQualityHD' },
];

/** 图片尺寸选项 */
export const IMAGE_SIZE_OPTIONS: { value: string; labelKey: string; ratio: number }[] = [
  { value: '1024x1024', labelKey: 'prompt.imageSizeSquare', ratio: 1 },
  { value: '1792x1024', labelKey: 'prompt.imageSizeLandscape', ratio: 1792 / 1024 },
  { value: '1024x1792', labelKey: 'prompt.imageSizePortrait', ratio: 1024 / 1792 },
  { value: 'auto', labelKey: 'prompt.imageSizeAuto', ratio: 0 },
];

/** 图片生成数量选项 */
export const IMAGE_COUNT_OPTIONS = [1, 2, 3, 4] as const;

// ===== 视频参数 (Seedance) =====

export const SEEDANCE_RESOLUTIONS = ['480p', '720p', '1080p'] as const;

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

// ===== 视频参数 (OpenAI) =====

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

// ===== 音频参数 =====

/** 音频音色选项 */
export const AUDIO_VOICE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'alloy', labelKey: 'prompt.audioVoiceAlloy' },
  { value: 'echo', labelKey: 'prompt.audioVoiceEcho' },
  { value: 'fable', labelKey: 'prompt.audioVoiceFable' },
  { value: 'onyx', labelKey: 'prompt.audioVoiceOnyx' },
  { value: 'nova', labelKey: 'prompt.audioVoiceNova' },
  { value: 'shimmer', labelKey: 'prompt.audioVoiceShimmer' },
];

/** 音频格式选项 */
export const AUDIO_FORMAT_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'mp3', labelKey: 'prompt.audioFormatMp3' },
  { value: 'wav', labelKey: 'prompt.audioFormatWav' },
  { value: 'aac', labelKey: 'prompt.audioFormatAac' },
  { value: 'flac', labelKey: 'prompt.audioFormatFlac' },
  { value: 'opus', labelKey: 'prompt.audioFormatOpus' },
];

/** 音频语速范围 */
export const AUDIO_SPEED_RANGE: [number, number] = [0.25, 4.0];