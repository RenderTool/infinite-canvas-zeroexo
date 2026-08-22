/**
 * workflow-chain-position - 工作执行链落点算法(Plan#33 D4)
 *
 * 两段式布局契约(2026-08-22 tA5 重构:生成器节点废弃,移除中间生成器段):
 *   素材源副本列(垂直排布, gap=96) → 右侧产物节点
 * 产物节点为「空 media 节点」(无 content/storageKey),由 NodeGenerateDock 三态语义
 * 承担生成器态:选中即显示吸附生成面板,连入副本作为参考素材,用户点击生成触发。
 * 基准 = 视口中心(resolveStackSpawnPosition 同款公式):
 *   cx = (containerSize.width / 2 - viewport.x) / viewport.k
 *   cy = (containerSize.height / 2 - viewport.y) / viewport.k
 * 整体 batch 落点后做重叠避让,并产出包围盒供 focusOnBounds 聚焦。
 *
 * 纯函数,无 React/hook 依赖(便于单测)。尺寸契约:
 * - 副本尺寸优先取源节点实际 size,缺失回退 SOURCE_FALLBACK_SIZE
 * - 产物尺寸由调用方注入(读 NodeTypeExtension.defaultSize)
 */

/** 默认间距(与 placement-contract PLACEMENT_DEFAULT_GAP 一致) */
export const WORKFLOW_CHAIN_GAP = 96;
/** 避让偏移步进(与 placement-contract PLACEMENT_OVERLAP_STEP 一致) */
export const WORKFLOW_AVOID_STEP = 32;
/** 避让最大试探次数 */
export const WORKFLOW_AVOID_MAX_ITER = 500;
/** 副本尺寸缺失回退(media 常规尺寸) */
export const WORKFLOW_SOURCE_FALLBACK_SIZE = { width: 200, height: 100 };

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export interface Size2D {
  width: number;
  height: number;
}

/** 画布节点最小描述(避让/尺寸读取用) */
export interface CanvasNodeLike {
  id: string;
  position: { x: number; y: number };
  size?: Size2D;
}

/** 素材源(副本列布局输入) */
export interface ChainSource {
  id: string;
  type: string;
  title?: string;
  /** 实际尺寸(前端从 graph 读取源节点;缺失回退兜底) */
  size?: Size2D;
}

/** 落点算法输入 */
export interface ResolveWorkflowChainPositionInput {
  viewport: Viewport;
  containerSize: Size2D;
  /** 素材源列表(顺序即副本列从上到下顺序) */
  sources: ChainSource[];
  /** 产物节点尺寸(读 targetType 扩展 defaultSize) */
  productSize: Size2D;
  /** 画布全部现有节点(避让检测;缺省跳过避让) */
  existingNodes?: CanvasNodeLike[];
}

/** 落点结果:各段 position + 整体包围盒(聚焦用) */
export interface WorkflowChainPositions {
  /** 副本 id → position(顺序与 sources 一致) */
  copies: Array<{ id: string; position: { x: number; y: number } }>;
  product: { position: { x: number; y: number } };
  /** 两段整体包围盒(供 focusOnBounds) */
  bounds: { x: number; y: number; width: number; height: number };
}

/** 副本节点 id 生成(可被调用方覆盖) */
export function defaultCopyId(sourceId: string): string {
  return `wf-copy-${sourceId}`;
}

/** 产物节点 id 生成 */
export function defaultProductId(targetType: string): string {
  return `wf-product-${targetType}-${Date.now().toString(36)}`;
}

/**
 * 解析工作执行链落点(两段式 + 避让)
 *
 * 布局:
 *   1. 副本列: 起点 (cx, cy), 每个副本 y = cy + index*(h+gap), x = cx(同列);
 *      列宽 = 最大副本宽
 *   2. 产物: 副本列右侧 (x = cx + 列宽 + gap, y = cy, 与副本列顶部对齐)
 * 避让: 整链包围盒与现有节点重叠时,整体向右下步进偏移(至多 AVOID_MAX_ITER 次)
 */
export function resolveWorkflowChainPosition(
  input: ResolveWorkflowChainPositionInput,
): WorkflowChainPositions {
  const { viewport, containerSize, sources, productSize, existingNodes } = input;

  const cx = (containerSize.width / 2 - viewport.x) / viewport.k;
  const cy = (containerSize.height / 2 - viewport.y) / viewport.k;

  // 副本列:计算每副本尺寸与纵向位置
  const copySizes = sources.map((s) => s.size ?? WORKFLOW_SOURCE_FALLBACK_SIZE);
  const columnWidth = copySizes.reduce((max, s) => Math.max(max, s.width), 0);

  const copies = sources.map((src, index) => {
    const prevHeight = copySizes.slice(0, index).reduce((sum, s) => sum + s.height + WORKFLOW_CHAIN_GAP, 0);
    return {
      id: defaultCopyId(src.id),
      position: { x: cx, y: cy + prevHeight },
    };
  });

  // 产物:副本列右侧,顶部对齐
  const product = {
    position: { x: cx + columnWidth + WORKFLOW_CHAIN_GAP, y: cy },
  };

  // 整链包围盒(计算各段尺寸)
  const totalHeight = copySizes.reduce((sum, s) => sum + s.height + WORKFLOW_CHAIN_GAP, 0) - WORKFLOW_CHAIN_GAP;
  const chainWidth = columnWidth
    + WORKFLOW_CHAIN_GAP
    + productSize.width;
  let bounds = {
    x: cx,
    y: cy,
    width: chainWidth,
    height: Math.max(totalHeight, productSize.height),
  };

  // 避让:整链包围盒与现有节点重叠 → 整体向右下步进(保留两段相对布局)
  if (existingNodes && existingNodes.length > 0) {
    const rect = { ...bounds };
    const overlaps = (n: CanvasNodeLike): boolean => {
      const nw = n.size?.width ?? WORKFLOW_SOURCE_FALLBACK_SIZE.width;
      const nh = n.size?.height ?? WORKFLOW_SOURCE_FALLBACK_SIZE.height;
      return !(
        rect.x + rect.width <= n.position.x ||
        n.position.x + nw <= rect.x ||
        rect.y + rect.height <= n.position.y ||
        n.position.y + nh <= rect.y
      );
    };
    let guard = 0;
    while (existingNodes.some(overlaps) && guard < WORKFLOW_AVOID_MAX_ITER) {
      rect.x += WORKFLOW_AVOID_STEP;
      rect.y += WORKFLOW_AVOID_STEP;
      guard++;
    }
    if (guard > 0) {
      const dx = rect.x - bounds.x;
      const dy = rect.y - bounds.y;
      for (const c of copies) {
        c.position.x += dx;
        c.position.y += dy;
      }
      product.position.x += dx;
      product.position.y += dy;
      bounds = { ...rect };
    }
  }

  return { copies, product, bounds };
}
