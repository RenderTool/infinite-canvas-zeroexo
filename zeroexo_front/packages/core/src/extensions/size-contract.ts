/**
 * 节点尺寸契约统一解析(Plan#11 全节点迁移 B1)
 *
 * 设计原则(用户拍板):**每个节点本身的契约自己维护** —— 所有尺寸入口
 * (点击上传 / 拖拽建节点 / AI 生成返回 / 渲染回退 / 工具 dock / 协作 overlay)
 * 必须统一读取 `NodeTypeExtension` 声明的契约(defaultSize/minSize/...),
 * 禁止各入口散落硬编码 620/348/200/80 等魔法数字。
 *
 * 解析优先级(全入口一致):
 *   1. node.size(已 resize 过的节点用实际尺寸)
 *   2. ext.defaultSize(节点扩展自维护的基准尺寸)
 *   3. FALLBACK_NODE_SIZE(未知类型统一兜底)
 */

import type { NodeTypeExtension } from './types.js';

/** 未知节点类型的统一兜底尺寸(所有入口共用,禁止各入口自造 fallback) */
export const FALLBACK_NODE_SIZE = { width: 200, height: 100 };

/** 媒体类 resize 的统一高度下限(与 image/video 扩展 minSize 语义一致) */
export const MEDIA_MIN_HEIGHT = 80;

/**
 * resize 几何计算的兜底下限(所有 resizable 扩展都声明 minSize 后永不命中,
 * 仅作为未知类型的纵深防御 —— 数值只允许出现在本文件) */
export const RESIZE_MIN_FALLBACK_SIZE = { width: 80, height: 60 };

/**
 * 节点有效尺寸: node.size > 扩展 defaultSize > 统一兜底。
 * 用于渲染层 / 工具 dock / 协作 overlay 等需要"节点当前尺寸"的场景。
 */
export function resolveNodeSize(
  node: { size?: { width: number; height: number } },
  ext?: NodeTypeExtension,
): { width: number; height: number } {
  if (node.size && node.size.width > 0 && node.size.height > 0) return node.size;
  return ext?.defaultSize ?? FALLBACK_NODE_SIZE;
}

/**
 * 扩展基准宽度(media 类"保宽调高"语义的基准):
 * 上传/替换/AI 生成返回时,以扩展声明的 defaultSize.width 为基准宽度,
 * 高度按素材宽高比缩放 —— 契约变更一处,所有入口自动跟随。
 */
export function resolveBaseWidth(ext?: NodeTypeExtension): number {
  return ext?.defaultSize?.width ?? FALLBACK_NODE_SIZE.width;
}

/**
 * 扩展最小高度钳制(media 类 resize 下限):
 * 优先读扩展 minSize.height,未声明时用统一媒体下限。
 */
export function resolveMinHeight(ext?: NodeTypeExtension): number {
  return ext?.minSize?.height ?? MEDIA_MIN_HEIGHT;
}
