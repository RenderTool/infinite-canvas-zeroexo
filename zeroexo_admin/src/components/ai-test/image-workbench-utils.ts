/**
 * ImageWorkbench 工具函数与常量
 *
 * 包含宽高比匹配、品牌图标解析、生成记录转换、blob URL 转 base64 等纯函数。
 */
import type { FC } from 'react';
import { BRAND_ICONS, DefaultBrandIcon } from '@/components/api-settings/brand-icons';
import { apiGet } from '@/services/api-client';
import type { GenerationRecord, ReferenceImage, ResultImage } from './types';

/** 宽高比字符串 → 数值比（用于模糊匹配） */
export const RATIO_VALUE_MAP: Record<string, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '3:2': 3 / 2,
  '2:3': 2 / 3,
  '21:9': 21 / 9,
};

/**
 * 在预设宽高比列表中查找与 w/h 最接近的选项（容忍 2% 偏差）
 * 用于将手动输入尺寸的宽高比映射到预设按钮
 */
export function matchAspectRatio(w: number, h: number, options: string[]): string | null {
  if (w <= 0 || h <= 0) return null;
  const ratio = w / h;
  for (const opt of options) {
    const target = RATIO_VALUE_MAP[opt];
    if (target === undefined) continue;
    if (Math.abs(ratio - target) / target < 0.02) return opt;
  }
  return null;
}

/** 根据 provider key 获取品牌图标组件 */
export function getBrandIcon(providerKey: string): FC<{ size?: number }> {
  return (BRAND_ICONS[providerKey] || DefaultBrandIcon) as unknown as FC<{ size?: number }>;
}

/** 后端 AiGeneration 记录 → 前端 GenerationRecord */
export function mapGenToRecord(gen: any, t: (key: string) => string): GenerationRecord {
  const params = (gen.params ?? {}) as Record<string, any>;
  const rawParams = { ...params };
  // 过滤内部字段（以 _ 开头，用于回溯结果，不展示给用户）
  const cleanParams: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!k.startsWith('_')) cleanParams[k] = v;
  }
  // 参考图还原（URL 数组 → ReferenceImage[]）
  const refUrls = (params.referenceImages as string[] | undefined) ?? [];
  const references: ReferenceImage[] = refUrls.map((url, i) => ({
    id: `ref-${gen.id}-${i}`,
    url,
    name: `${t('ai.image')}${i + 1}`,
  }));
  // 结果图片还原
  const results: ResultImage[] = [];
  if (params._resultUrl) {
    results.push({
      id: `result-${gen.id}`,
      url: params._resultUrl,
      width: params._resultWidth ?? 1024,
      height: params._resultHeight ?? 1024,
      costTokens: gen.costTokens ?? undefined,
      durationMs: gen.costMs ?? undefined,
    });
  }
  const isSuccess = gen.status === 'success';
  const isCancelled = gen.status === 'cancelled';
  const isQueued = gen.status === 'pending';
  const isRunning = gen.status === 'running';
  // pending（排队中）和 running（处理中）都视为"进行中"，不计入失败
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
    failCount: isSuccess ? 0 : (isInProgress || isCancelled ? 0 : 1),
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

/** 将 blob: URL 转为 base64 data URL，后端无法直接访问浏览器 blob URL */
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
 * 轮询 AI 生成结果，直到完成或超时
 * @deprecated 推荐使用 SSE 事件驱动（use-ai-generation-sse.ts），避免长任务累积轮询请求
 */
export async function pollGenerationResult(generationId: string, maxAttempts = 600): Promise<{
  generationId: string;
  url: string;
  width: number;
  height: number;
  mimeType: string;
  assetId: string;
  costTokens: number;
  costMs: number;
}> {
  for (let i = 0; i < maxAttempts; i++) {
    const gen = await apiGet<any>(`/ai/generations/${generationId}`);
    if (gen.status === 'success') {
      const params = gen.params || {};
      return {
        generationId: gen.id,
        url: params._resultUrl,
        width: params._resultWidth,
        height: params._resultHeight,
        mimeType: params._resultMime,
        assetId: gen.resultAssetId,
        costTokens: gen.costTokens,
        costMs: gen.costMs,
      };
    }
    if (gen.status === 'failed') {
      throw new Error(gen.errorMessage || '生成失败');
    }
    if (gen.status === 'cancelled') {
      throw new Error('生成已取消');
    }
    // 等待 500ms 再查
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('生成超时，请稍后查看历史记录');
}

/**
 * 后台轮询单个历史任务，用于页面刷新后继续追踪进行中的任务
 * 返回更新后的 GenerationRecord（任务仍未完成则返回 null）
 * @deprecated 推荐使用 SSE 事件驱动（use-ai-generation-sse.ts），避免长任务累积轮询请求
 */
export async function pollHistoryTask(
  generationId: string,
  t: (key: string) => string,
  maxAttempts = 600,
): Promise<GenerationRecord | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const gen = await apiGet<any>(`/ai/generations/${generationId}`);
    if (gen.status === 'success' || gen.status === 'failed' || gen.status === 'cancelled') {
      return mapGenToRecord(gen, t);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null; // 超时未完成，保留原状态
}
