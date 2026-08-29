/**
 * plan/resolve-slots — 槽位映射解析（Plan#51 T3）
 *
 * 解析链路：正文「图N」 → ShotSlot(slot=N) → refId → 主体/变体 → assetId → Asset.storageKey
 *
 * 为什么用槽位而不是正文写 @refId（对齐 zerovideoAgent 的 prompts_15s_PartA_v2.md 范式）：
 * 1. Seedance 等视频模型对 `@` 语法支持不稳定，「图1/图2」是稳定指代；
 * 2. 映射表与正文分离 —— 换素材/重新生成时不动正文，只改槽位绑定。
 */

import type { Asset } from '@/features/asset-picker/index.js';
import type { PlanDoc, Shot, VariantStatus } from './types.js';
import { findVariantByRef } from './types.js';

/** 从资产中取出可用于生成的图片 storageKey */
function imageStorageKeyOf(asset: Asset | undefined): string | null {
  if (!asset) return null;
  const data = asset.data as { kind: string; storageKey?: string };
  if (data.kind !== 'image') return null;
  return data.storageKey ?? null;
}

export interface ResolvedSlot {
  /** 槽位号（正文用「图{slot}」指代） */
  slot: number;
  refId: string;
  /** 展示标签，如 '小狼崽 · 受伤' */
  label: string;
  subjectName: string;
  variantName?: string;
  assetId?: string | null;
  storageKey?: string | null;
  status: VariantStatus;
  note?: string;
}

export interface ResolveResult {
  slots: ResolvedSlot[];
  /** 已解析出的图片 storageKey 列表（可直接喂给生图/生视频的 referenceImages） */
  images: string[];
  /** 未就绪的引用 refId 列表（缺素材或素材被删） */
  unresolved: string[];
  /** 全部槽位就绪 */
  ready: boolean;
}

/**
 * 解析一个分镜块的全部槽位。
 * @param shot 分镜块
 * @param plan Plan 文档
 * @param assets 资产列表（用于 assetId → storageKey 反查）
 */
export function resolveSlots(shot: Shot, plan: PlanDoc, assets: Asset[]): ResolveResult {
  const slots: ResolvedSlot[] = [];
  const images: string[] = [];
  const unresolved: string[] = [];

  // 槽位按序号升序，保证「图1/图2/图3」顺序稳定
  const ordered = [...shot.slots].sort((a, b) => a.slot - b.slot);

  for (const slotDef of ordered) {
    const hit = findVariantByRef(plan, slotDef.refId);
    if (!hit) {
      unresolved.push(slotDef.refId);
      slots.push({
        slot: slotDef.slot,
        refId: slotDef.refId,
        label: slotDef.refId,
        subjectName: slotDef.refId,
        status: 'missing',
        note: slotDef.note,
      });
      continue;
    }

    const { subject, variant } = hit;
    const asset = variant.assetId
      ? assets.find((a) => a.id === variant.assetId)
      : undefined;
    const storageKey = imageStorageKeyOf(asset);

    // 变体标了 ready/collected 但资产已不存在（悬空引用）→ 视为未就绪
    const bound = !!storageKey;
    if (!bound) unresolved.push(slotDef.refId);
    else images.push(storageKey);

    slots.push({
      slot: slotDef.slot,
      refId: slotDef.refId,
      label: variant.name ? `${subject.name} · ${variant.name}` : subject.name,
      subjectName: subject.name,
      variantName: variant.name,
      assetId: variant.assetId ?? null,
      storageKey,
      status: bound ? 'ready' : 'missing',
      note: slotDef.note,
    });
  }

  return {
    slots,
    images,
    unresolved,
    ready: unresolved.length === 0 && slots.length > 0,
  };
}

/**
 * 提取正文中出现的槽位号（用于校验正文与映射表是否一致）。
 * 匹配「图1」「图2」…「图N」（1-2 位数字）。
 */
export function extractSlotNumbers(prompt: string): number[] {
  const found = new Set<number>();
  const re = /图\s?(\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * 一致性校验：正文引用的槽位号是否都能在映射表中找到（反之亦然则仅提示，不阻断）。
 * 返回正向缺失（正文用了但映射表没有的槽位号）。
 */
export function validateShotSlots(shot: Shot): { missingInMap: number[]; unusedInMap: number[] } {
  const used = extractSlotNumbers(shot.prompt);
  const defined = new Set(shot.slots.map((s) => s.slot));
  const missingInMap = used.filter((n) => !defined.has(n));
  const unusedInMap = [...defined].filter((n) => !used.includes(n));
  return { missingInMap, unusedInMap };
}
