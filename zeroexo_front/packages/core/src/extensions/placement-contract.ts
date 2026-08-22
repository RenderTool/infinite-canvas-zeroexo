/**
 * 布局契约统一解析(2026-08-22)
 *
 * 背景: 生成新节点后"原本的垂直整理排序功能"消失——旧实现各业务层硬编码 position
 * 偏移(如 锚点x+宽+96, 批量 y+i*24), 间距/避让无统一契约, 重叠无人处理。
 *
 * 契约: 创建节点的默认排序方式 = NodeTypeExtension.placement(与 defaultSize 同级)。
 * 全创建入口必须通过 resolvePlacement 统一读取, 禁止业务层硬编码 position 偏移;
 * 调用方需要覆盖时传 overrides(优先级最高)。
 *
 * 行为:
 * - direction='right' : 锚点右侧一列, 纵向避让重叠(垂直整理)
 * - direction='down'  : 锚点下方一行, 横向避让重叠
 * - direction='auto'  : 默认(等价 right)
 * - avoidOverlap=true : 在锚点侧列/行内步进找空位, 保证新节点不与现有节点重叠
 */
import type { NodeTypeExtension } from './types.js';

/** 默认间距(与既有 96 习惯一致) */
export const PLACEMENT_DEFAULT_GAP = 96;
/** 重叠避让步进 */
export const PLACEMENT_OVERLAP_STEP = 32;

export interface PlacementOptions {
  /** 锚点节点(新节点的参照) */
  anchor: { position: { x: number; y: number }; size?: { width: number; height: number } };
  /** 新节点类型扩展(读 placement 契约; 未声明时 direction='auto', gap=96) */
  ext?: NodeTypeExtension;
  /** 新节点期望尺寸(未传时用 ext.defaultSize) */
  size?: { width: number; height: number };
  /** 已存在的全部节点(用于重叠避让); 缺省跳过避让 */
  existingNodes?: Array<{ id: string; position: { x: number; y: number }; size?: { width: number; height: number } }>;
  /** 调用方显式覆盖(优先级最高) */
  overrides?: { direction?: 'right' | 'down' | 'auto'; gap?: number; avoidOverlap?: boolean };
  /** 批量序号(同列/行内 i*step 错开, 避免本批节点互相重叠) */
  index?: number;
}

const FALLBACK_SIZE = { width: 200, height: 100 };

export function resolvePlacement(opts: PlacementOptions): { x: number; y: number } {
  const direction = opts.overrides?.direction ?? opts.ext?.placement?.direction ?? 'auto';
  const gap = opts.overrides?.gap ?? opts.ext?.placement?.gap ?? PLACEMENT_DEFAULT_GAP;
  const avoidOverlap = opts.overrides?.avoidOverlap ?? opts.ext?.placement?.avoidOverlap ?? true;

  const w = opts.size?.width ?? opts.ext?.defaultSize?.width ?? FALLBACK_SIZE.width;
  const h = opts.size?.height ?? opts.ext?.defaultSize?.height ?? FALLBACK_SIZE.height;
  const aw = opts.anchor.size?.width ?? FALLBACK_SIZE.width;
  const ah = opts.anchor.size?.height ?? FALLBACK_SIZE.height;
  const ax = opts.anchor.position.x;
  const ay = opts.anchor.position.y;

  // 基准位置: 右侧列 / 下方行
  let x = direction === 'down' ? ax : ax + aw + gap;
  let y = direction === 'down' ? ay + ah + gap : ay;

  // 批量序号错开(同列垂直 或 同行水平): 步进 = 新节点尺寸 + 间距, 保证本批节点互不重叠
  if (opts.index) {
    if (direction === 'down') { x += opts.index * (w + gap); }
    else { y += opts.index * (h + gap); }
  }

  // 重叠避让(垂直/水平整理): 在同列向下 / 同行向右 步进找空位
  if (avoidOverlap && opts.existingNodes && opts.existingNodes.length > 0) {
    let guard = 0;
    const rect = { x, y, width: w, height: h };
    const overlaps = (n: { position: { x: number; y: number }; size?: { width: number; height: number } }) => {
      const nw = n.size?.width ?? FALLBACK_SIZE.width;
      const nh = n.size?.height ?? FALLBACK_SIZE.height;
      return !(
        rect.x + rect.width <= n.position.x ||
        n.position.x + nw <= rect.x ||
        rect.y + rect.height <= n.position.y ||
        n.position.y + nh <= rect.y
      );
    };
    while (opts.existingNodes.some(overlaps) && guard < 500) {
      if (direction === 'down') { x += PLACEMENT_OVERLAP_STEP; }
      else { y += PLACEMENT_OVERLAP_STEP; }
      rect.x = x; rect.y = y;
      guard++;
    }
  }
  return { x, y };
}
