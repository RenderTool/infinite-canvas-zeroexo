/**
 * video-workbench-utils — 视频工作台工具函数
 *
 * 包含视频生成记录转换、blob URL 转 base64 等纯函数。
 * 与 image-workbench-utils 共用 getBrandIcon。
 */
import type { GenerationRecord, ReferenceImage, ResultVideo } from './types';

/** 后端 AiGeneration 记录 → 前端 GenerationRecord（视频版） */
export function mapVideoGenToRecord(
  gen: any,
  t: (key: string) => string,
): GenerationRecord {
  const params = (gen.params ?? {}) as Record<string, any>;
  const rawParams = { ...params };
  // 过滤内部字段（以 _ 开头，用于回溯结果，不展示给用户）
  const cleanParams: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!k.startsWith('_')) cleanParams[k] = v;
  }
  // 参考图还原
  const refUrls = (params.referenceImages as string[] | undefined) ?? [];
  const references: ReferenceImage[] = refUrls.map((url, i) => ({
    id: `ref-${gen.id}-${i}`,
    url,
    name: `${t('ai.image')}${i + 1}`,
  }));
  // 结果视频还原
  const results: ResultVideo[] = [];
  if (params._resultUrl) {
    results.push({
      id: `result-${gen.id}`,
      url: params._resultUrl,
      width: params._resultWidth ?? 0,
      height: params._resultHeight ?? 0,
      costTokens: gen.costTokens ?? undefined,
      durationMs: gen.costMs ?? undefined,
    });
  }
  const isSuccess = gen.status === 'success';
  const isCancelled = gen.status === 'cancelled';
  const isQueued = gen.status === 'pending';
  const isRunning = gen.status === 'running';
  const isInProgress = isQueued || isRunning;
  return {
    id: gen.id,
    createdAt: new Date(gen.createdAt).getTime(),
    prompt: gen.prompt,
    providerId: gen.providerId ?? '',
    providerName: gen.providerName ?? t('ai.unknownChannel'),
    model: gen.model,
    params: cleanParams,
    rawParams,
    references,
    results,
    successCount: isSuccess && results.length > 0 ? results.length : 0,
    failCount: isSuccess ? 0 : isInProgress || isCancelled ? 0 : 1,
    durationMs: gen.costMs ?? 0,
    status: isSuccess
      ? 'success'
      : isCancelled
        ? 'cancelled'
        : isQueued
          ? 'pending'
          : isRunning
            ? 'running'
            : 'failed',
    errorMessage: gen.errorMessage ?? undefined,
  };
}

/** 将 blob: URL 转为 base64 data URL */
export async function blobUrlToBase64(blobUrl: string): Promise<string> {
  if (!blobUrl.startsWith('blob:')) return blobUrl;
  const resp = await fetch(blobUrl);
  const blob = await resp.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 根据视频生成模式获取参考素材类型配置
 *
 * 简化后仅支持两种模式：
 *   1. 首尾帧（image-to-video-first-last-frame）：首帧 + 尾帧，各最多1张，至少需提供一张
 *   2. 多模态（multi-modal-reference）：图片 + 视频 + 音频
 */
export function getReferenceConfigByMode(
  mode: string,
  bounds: {
    maxReferenceImages?: number;
    maxReferenceVideos?: number;
    maxReferenceAudios?: number;
  },
): {
  /** 是否为首尾帧模式（需要单独显示首帧/尾帧两个上传区） */
  isFirstLastFrameMode: boolean;
  /** 显示图片上传 */
  showImages: boolean;
  /** 显示视频上传 */
  showVideos: boolean;
  /** 显示音频上传 */
  showAudio: boolean;
  imageLabel: string;
  imageMaxCount: number;
  videoLabel: string;
  videoMaxCount: number;
  audioLabel: string;
  audioMaxCount: number;
} {
  const {
    maxReferenceImages = 0,
    maxReferenceVideos = 0,
    maxReferenceAudios = 0,
  } = bounds;

  switch (mode) {
    case 'image-to-video-first-last-frame':
      return {
        isFirstLastFrameMode: true,
        showImages: false,
        showVideos: false,
        showAudio: false,
        imageLabel: '首尾帧参考图',
        imageMaxCount: 0,
        videoLabel: '参考视频',
        videoMaxCount: 0,
        audioLabel: '参考音频',
        audioMaxCount: 0,
      };
    case 'multi-modal-reference':
    case 'video-edit':
    case 'video-extend':
      return {
        isFirstLastFrameMode: false,
        showImages: maxReferenceImages > 0,
        showVideos: maxReferenceVideos > 0,
        showAudio: maxReferenceAudios > 0,
        imageLabel: '参考图',
        imageMaxCount: maxReferenceImages,
        videoLabel: '参考视频',
        videoMaxCount: maxReferenceVideos,
        audioLabel: '参考音频',
        audioMaxCount: maxReferenceAudios,
      };
    default:
      return {
        isFirstLastFrameMode: false,
        showImages: false,
        showVideos: false,
        showAudio: false,
        imageLabel: '参考图',
        imageMaxCount: 0,
        videoLabel: '参考视频',
        videoMaxCount: 0,
        audioLabel: '参考音频',
        audioMaxCount: 0,
      };
  }
}