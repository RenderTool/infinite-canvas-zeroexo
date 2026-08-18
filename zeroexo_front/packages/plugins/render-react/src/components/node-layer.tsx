/**
 * NodeLayer - 节点渲染层
 *
 * 性能优化:
 * 1. viewport transform 应用在容器 div,节点用世界坐标(节点不依赖 viewport)
 * 2. 内部 useViewport 订阅,不接收 viewport prop(避免父组件重渲染波及)
 * 3. NodeItem 用 React.memo 包裹,仅自身数据变化时重渲染
 * 4. 回调由父组件稳定化(useCallback),memo 比较有效
 * 5. 选中节点渲染 4 角点 resize handle
 * 6. 视口遮挡裁剪(culling):跳过视口外节点 DOM 渲染
 * 7. 所有节点统一高质量渲染,无 LOD 降级
 * 8. 所有节点均支持框选:pointerEvents + 选中/悬停视觉反馈
 * 9. P0-7: hidden 祖先过滤按 graph 引用缓存,viewport 帧内不重复祖先链遍历
 */

import React, { useRef, useLayoutEffect, useState, useMemo } from 'react';
import type { NodeRecord, NodeTypeExtension, NodeRenderer, CommandQueue } from '@zeroexo/core';
import type { ReactGraphStore } from '../store.js';
import { useViewport, useNodeById } from '../store.js';
import { useNodeDefaults } from '../pin-defaults.js';
import { NodeScaleContext } from './node-scale-context.js';
import { NodeConnectionHoverContext } from './node-connection-hover-context.js';
import { NodeViewContractContext } from './node-view-contract-context.js';

/** resize handle 类型(与 interaction 插件对齐) */
type ResizeHandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * 普通节点 resize handle:4 角透明命中区设计。
 * - 4 个角(top-left/top-right/bottom-left/bottom-right),无四边中点
 * - 28×28px 透明方块,向外偏移 14px(位于节点角点外侧)
 * - 仅靠 cursor 提示交互(nwse/nesw-resize)
 * - 不随视口缩放(固定屏幕尺寸 28px)
 *
 * 组的 resize handle 用 8 角点白圆(在 group-layer.tsx GroupResizeHandle)
 */
const NODE_HANDLE_DEFS: Array<{ type: 'nw' | 'ne' | 'sw' | 'se'; cursor: string }> = [
  { type: 'nw', cursor: 'nwse-resize' },
  { type: 'ne', cursor: 'nesw-resize' },
  { type: 'sw', cursor: 'nesw-resize' },
  { type: 'se', cursor: 'nwse-resize' },
];

/** 遮挡裁剪 overscan 比例 */
const OVERSCAN_RATIO = 0.2;

export interface NodeLayerProps {
  nodes: NodeRecord[];
  /** 节点类型扩展(从 node-registry 插件获取) */
  extensions: Map<string, NodeTypeExtension>;
  /** 选中节点 id 集合 */
  selectedIds: Set<string>;
  /** store(内部用于订阅 viewport) */
  store: ReactGraphStore;
  /** 悬停节点 id */
  hoveredId?: string | null;
  /** 强制显示所有引脚(连线拖拽期间所有节点Pin可见) */
  forceShowPins?: boolean;
  /** 连线拖拽时高亮的目标节点 id(提示可自动连接) */
  connectionHoverNodeId?: string | null;
  /** 节点更新回调 */
  onUpdateNode?: (nodeId: string, patch: Partial<NodeRecord>) => void;
  /** 命令队列(传递给节点渲染器,用于提交命令) */
  commandQueue?: CommandQueue;
  /** 节点指针事件(由 interaction 插件处理) */
  onNodePointerDown?: (e: React.PointerEvent, nodeId: string) => void;
  onNodePointerEnter?: (e: React.PointerEvent, nodeId: string) => void;
  onNodePointerLeave?: (e: React.PointerEvent, nodeId: string) => void;
  /** resize handle 指针事件(由 interaction 插件处理) */
  onResizeHandlePointerDown?: (
    e: React.PointerEvent,
    nodeId: string,
    handle: ResizeHandleType,
  ) => void;
  /** 触摸事件(用于移动端长按显示右键菜单) */
  onNodeTouchStart?: (e: React.TouchEvent, nodeId: string) => void;
  onNodeTouchEnd?: (e: React.TouchEvent, nodeId: string) => void;
  onNodeTouchMove?: (e: React.TouchEvent, nodeId: string) => void;
  /** 外部触发重命名的节点 id(由工具栏按钮触发) */
  externalRenaming?: string | null;
  /** 重命名完成/取消回调 */
  onRenameFinish?: () => void;
  /** 交互模式: select=选择/框选(指针), pan=平移(手型) */
  mode?: 'select' | 'pan';
  /** 双击节点回调:缩放画布以聚焦该节点,传递实际尺寸(含 ext.defaultSize 回退) */
  onNodeDoubleClick?: (nodeId: string, width: number, height: number) => void;
}

/** 单个节点项(P1-1: 改用 nodeId+store+useNodeById 订阅,避免全量 graph 订阅) */
interface NodeItemProps {
  nodeId: string;
  store: ReactGraphStore;
  ext: NodeTypeExtension | undefined;
  isSelected: boolean;
  isHovered: boolean;
  forceShowPins?: boolean;
  /** 连线拖拽时此节点是否为高亮目标 */
  isConnectionHover: boolean;
  /** 1/viewport.k,用于 resize handle 尺寸缩放(保持屏幕恒定) */
  invK: number;
  onUpdateNode?: (nodeId: string, patch: Partial<NodeRecord>) => void;
  commandQueue?: CommandQueue;
  onNodePointerDown?: (e: React.PointerEvent, nodeId: string) => void;
  onNodePointerEnter?: (e: React.PointerEvent, nodeId: string) => void;
  onNodePointerLeave?: (e: React.PointerEvent, nodeId: string) => void;
  onResizeHandlePointerDown?: (
    e: React.PointerEvent,
    nodeId: string,
    handle: ResizeHandleType,
  ) => void;
  /** 触摸事件(用于移动端长按显示右键菜单) */
  onNodeTouchStart?: (e: React.TouchEvent, nodeId: string) => void;
  onNodeTouchEnd?: (e: React.TouchEvent, nodeId: string) => void;
  onNodeTouchMove?: (e: React.TouchEvent, nodeId: string) => void;
  /** 外部触发重命名的节点 id(由工具栏按钮触发) */
  externalRenaming?: string | null;
  /** 重命名完成/取消回调 */
  onRenameFinish?: () => void;
  /** 交互模式: select=选择/框选(指针), pan=平移(手型) */
  mode?: 'select' | 'pan';
  /** 双击节点回调:缩放画布以聚焦该节点,传递实际尺寸(含 ext.defaultSize 回退) */
  onNodeDoubleClick?: (nodeId: string, width: number, height: number) => void;
}

const NodeItem = React.memo(
  function NodeItem(props: NodeItemProps): React.ReactElement {
    const {
      nodeId,
      store: _store,
      ext,
      isSelected,
      isHovered,
      forceShowPins,
      isConnectionHover,
      invK,
      onUpdateNode,
      commandQueue,
      onNodePointerDown,
      onNodePointerEnter,
      onNodePointerLeave,
      onResizeHandlePointerDown,
      onNodeTouchStart,
      onNodeTouchEnd,
      onNodeTouchMove,
      externalRenaming,
      onRenameFinish,
    } = props;
    // P1-1: per-node 订阅 — 仅当该节点数据变化时重渲染
    const node = useNodeById(_store, nodeId);
    // 节点外观全局默认(由 app 层从 canvasConfig + theme 注入,NodeDefaultsProvider 提供)
    // 必须放在所有条件返回之前调用，确保 Hooks 顺序一致
    const nodeDefaults = useNodeDefaults();
    // 节点未找到(极小概率,如快速删除):返回空占位
    if (!node) return <div data-node-id={nodeId} style={{ display: 'none' }} />;

    // P1-3: 低缩放 LOD (k < 0.35) — 渲染轻量占位(色块+标题),不渲染节点内容
    // 避免大量复杂节点内容(视频/图片/音频)在低缩放时全量渲染
    const isLowZoom = invK > 1 / 0.35; // invK = 1/k, 所以 k < 0.35 时 invK > 2.857
    if (isLowZoom) {
      // 使用节点底色(与 NodeShell shellColor 优先级一致: fillColor 优先于 ext.color)
      const nodeColor = node.backgroundColor ?? node.nodeColor ?? nodeDefaults.fillColor ?? ext?.color ?? '#16213e';
      const title = node.title ?? node.type;
      const size = node.size ?? ext?.defaultSize ?? { width: 200, height: 100 };
      const nodeTransform = `translate(${node.position.x}px, ${node.position.y}px)`;

      return (
        <div
          data-node-id={node.id}
          data-node-type={node.type}
          data-node-lod="placeholder"
          onPointerDown={
            onNodePointerDown && !node.locked ? (e) => onNodePointerDown(e, node.id) : undefined
          }
          onPointerEnter={
            onNodePointerEnter ? (e) => onNodePointerEnter(e, node.id) : undefined
          }
          onPointerLeave={
            onNodePointerLeave ? (e) => onNodePointerLeave(e, node.id) : undefined
          }
          onDoubleClick={
            props.onNodeDoubleClick
              ? (e) => { e.stopPropagation(); props.onNodeDoubleClick!(node.id, size.width, size.height); }
              : undefined
          }
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: size.width,
            height: size.height,
            transform: nodeTransform,
            transformOrigin: 'top left',
            pointerEvents: 'auto',
            overflow: 'hidden',
            boxSizing: 'border-box',
            borderRadius: 0,
            backgroundColor: nodeColor,
            opacity: node.opacity ?? 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: isSelected ? 10 : isHovered ? 5 : 0,
            boxShadow: isSelected
              ? '0 0 0 1px #e94560'
              : isHovered
                ? '0 2px 4px rgba(0,0,0,0.15)'
                : 'none',
            cursor: node.locked ? 'default' : (props.mode === 'pan' ? 'grab' : 'default'),
          }}
        >
          <span style={{
            fontSize: Math.max(10, 16 * invK),
            color: nodeDefaults?.contentTextColor ?? '#fff',
            textAlign: 'center',
            padding: '0 4px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
            lineHeight: 1.2,
            opacity: 0.9,
          }}>
            {title}
          </span>
        </div>
      );
    }

    // 注意: nodeDefaults 已在上面无条件调用，此处不再重复声明
    // size 解析:node.size 优先(已 resize 过的节点用实际尺寸),回退到 ext.defaultSize,再回退默认
    // 必须与 edge-layer.tsx 的 size 解析保持一致,否则 resize 后节点视觉不变但连线缩放 bug)
    const size = node.size ?? ext?.defaultSize ?? { width: 200, height: 100 };
    const resizable = ext?.resizable === true && !node.locked;
    const locked = node.locked === true;
    // 无缝拼接模式:borderRadius 显式为 0 的节点(如图片拆解切片)空闲时不渲染阴影,避免拼合时缝隙观感
    const tileMode = (node.borderRadius ?? 8) === 0;

    // GPU 加速缩放:当节点尺寸与默认尺寸不同时,使用 transform scale 代替 width/height 过渡
    // 避免 CSS width/height 过渡触发 layout 重算导致文字模糊
    // 注意:仅在等比缩放(sx ≈ sy)时启用 —— 非等比 scale 会导致标题/图标/文本形变,
    // 切分/裁剪等任意宽高比节点(如图片拆解切片)必须回退到真实尺寸渲染(React Flow 模式),
    // 否则相邻节点拼合时还会因合成层设备像素取整产生缝隙
    const defaultSize = ext?.defaultSize;
    // 旧扩展仍可使用 lockAspectRatio；新节点优先从 Runtime Contract 声明缩放策略。
    const scaleContract = ext?.runtime?.definition?.size;
    const canScale = ext?.lockAspectRatio === true || scaleContract?.mode === 'uniform';
    const rawSx = defaultSize && defaultSize.width > 0 ? size.width / defaultSize.width : 1;
    const rawSy = defaultSize && defaultSize.height > 0 ? size.height / defaultSize.height : 1;
    const isUniformScale = Math.abs(rawSx - rawSy) <= 0.001;
    const useScale = canScale && isUniformScale && !!(defaultSize && (size.width !== defaultSize.width || size.height !== defaultSize.height));
    const sx = useScale ? rawSx : 1;
    const sy = useScale ? rawSy : 1;
    const domW = useScale ? defaultSize.width : size.width;
    const domH = useScale ? defaultSize.height : size.height;
    const nodeTransform = useScale
      ? `translate(${node.position.x}px, ${node.position.y}px) scale(${sx}, ${sy})`
      : `translate(${node.position.x}px, ${node.position.y}px)`;

    const renderer: NodeRenderer | undefined = ext?.renderNode;
    const content: React.ReactNode = renderer
      ? (renderer({
          node,
          pins: ext?.getPins?.(node) ?? [],
          isSelected,
          isHovered,
          forceShowPins,
          updateNode: (patch) => onUpdateNode?.(node.id, patch),
          commandQueue,
          invK,
          externalRenaming: !!externalRenaming && node.id === externalRenaming,
          onRenameFinish,
          pinScaleX: useScale ? sx : 1,
          pinScaleY: useScale ? sy : 1,
        }) as React.ReactNode)
      : null;

    return (
      <div
        data-node-id={node.id}
        data-node-type={node.type}
        data-node-locked={locked ? 'true' : undefined}
        data-node-compact={useScale ? 'true' : undefined}
        onPointerDown={
          onNodePointerDown && !locked ? (e) => onNodePointerDown(e, node.id) : undefined
        }
        onPointerEnter={
          onNodePointerEnter ? (e) => onNodePointerEnter(e, node.id) : undefined
        }
        onPointerLeave={
          onNodePointerLeave ? (e) => onNodePointerLeave(e, node.id) : undefined
        }
        onTouchStart={
          onNodeTouchStart && !locked ? (e) => onNodeTouchStart(e, node.id) : undefined
        }
        onTouchEnd={
          onNodeTouchEnd ? (e) => onNodeTouchEnd(e, node.id) : undefined
        }
        onTouchMove={
          onNodeTouchMove ? (e) => onNodeTouchMove(e, node.id) : undefined
        }
        onDoubleClick={
          props.onNodeDoubleClick
            ? (e) => { e.stopPropagation(); props.onNodeDoubleClick!(node.id, domW, domH); }
            : undefined
        }
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: domW,
          height: domH,
          // 世界坐标 + GPU 加速缩放（transform 是 GPU 合成层属性，不触发 layout 重算）
          transform: nodeTransform,
          transformOrigin: 'top left',
          pointerEvents: 'auto',
          // NodeShell 内部(内容区)已设 overflow:hidden,外层无需重复裁剪
          // 保持 visible 以确保引脚(Pin 容器定位在 left:-40/right:-40)可见
          overflow: 'visible',
          boxSizing: 'border-box',
          borderRadius: node.borderRadius ?? nodeDefaults.borderRadius ?? 8,
          // 有 renderer 时外层背景透明(让 NodeShell 背景显示);无 renderer 时用 ext.color / 全局默认
          backgroundColor: renderer
            ? 'transparent'
            : (node.backgroundColor ?? node.nodeColor ?? ext?.color ?? nodeDefaults.fillColor ?? '#16213e'),
          // 透明度:node.opacity(0-1),undefined 用 1;仅在此层应用一次(NodeShell 不再重复)
          opacity: node.opacity ?? 1,
          // box-shadow: 统一高质量阴影(拼接节点空闲时不投影)
          // 参考image-viewer卡片效果:轻投影提升沉浸感
          // 选中态由NodeShell的outline负责,此处仅保留hover阴影
          // 连线悬停蓝色指示也已下沉到NodeShell(与选中红色互斥,消除叠加态)
          // 契约: hoverEffect=custom 时 hover 阴影交由视图自绘,此处跳过
          boxShadow: (isHovered && ext?.viewContract?.hoverEffect !== 'custom')
              ? '0 2px 6px rgba(0,0,0,0.08)'
              : tileMode
                ? 'none'
                : '0 1px 2px rgba(0,0,0,0.04)',
          // z-index 自动提升:选中节点置顶(10),悬停节点中间(5),普通节点默认(0)
          zIndex: isSelected ? 10 : isHovered ? 5 : 0,
          cursor: locked ? 'default' : (props.mode === 'pan' ? 'grab' : 'default'),
          // 移除 transform 过渡,避免拖拽移动/缩放时产生延迟感
          // 生成占位动画由 ResizeNodeCommand 驱动,无需 CSS transition
          transition: 'box-shadow 0.15s cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <NodeScaleContext.Provider value={{ sx: useScale ? sx : 1, sy: useScale ? sy : 1 }}>
          <NodeConnectionHoverContext.Provider value={isConnectionHover}>
            <NodeViewContractContext.Provider value={ext?.viewContract}>
              {content ?? <DefaultNodeContent node={node} ext={ext} />}
            </NodeViewContractContext.Provider>
          </NodeConnectionHoverContext.Provider>
        </NodeScaleContext.Provider>
        {/* resize handles:选中且可调整尺寸时显示 */}
        {isSelected && resizable && onResizeHandlePointerDown
          ? NODE_HANDLE_DEFS.map(({ type, cursor }) => (
              <NodeResizeHandle
                key={type}
                type={type}
                cursor={cursor}
                invK={invK}
                onPointerDown={(e) => onResizeHandlePointerDown(e, node.id, type)}
              />
            ))
          : null}
      </div>
    );
  },
  // P1-1: 比较 nodeId 字符串而非 node 对象引用;store 引用稳定所以跳过
  // node 数据变化由 useNodeById 内部订阅触发重渲染,不受 memo 拦截
  (prev, next) =>
    prev.nodeId === next.nodeId &&
    prev.ext === next.ext &&
    prev.isSelected === next.isSelected &&
    prev.isHovered === next.isHovered &&
    prev.forceShowPins === next.forceShowPins &&
    prev.isConnectionHover === next.isConnectionHover &&
    prev.invK === next.invK &&
    prev.onUpdateNode === next.onUpdateNode &&
    prev.commandQueue === next.commandQueue &&
    prev.onNodePointerDown === next.onNodePointerDown &&
    prev.onNodePointerEnter === next.onNodePointerEnter &&
    prev.onNodePointerLeave === next.onNodePointerLeave &&
    prev.onResizeHandlePointerDown === next.onResizeHandlePointerDown &&
    prev.onNodeTouchStart === next.onNodeTouchStart &&
    prev.onNodeTouchEnd === next.onNodeTouchEnd &&
    prev.onNodeTouchMove === next.onNodeTouchMove &&
    prev.externalRenaming === next.externalRenaming &&
    prev.onRenameFinish === next.onRenameFinish &&
    prev.onNodeDoubleClick === next.onNodeDoubleClick,
);

/**
 * 普通节点 resize handle(4 角透明命中区)。
 * - 28×28px 透明方块,向外偏移 14px(位于节点角点外侧)
 * - 仅靠 cursor 提示交互,无视觉描边
 * - 固定屏幕尺寸(不随视口缩放)
 *
 * 注意:此 handle 渲染在 NodeLayer 容器内(已应用 viewport scale),
 * handle 用 invK 反向缩放,保持屏幕尺寸恒定 28px。
 */
function NodeResizeHandle({
  type,
  cursor,
  invK,
  onPointerDown,
}: {
  type: 'nw' | 'ne' | 'sw' | 'se';
  cursor: string;
  invK: number;
  onPointerDown: (e: React.PointerEvent) => void;
}): React.ReactElement {
  // 固定屏幕尺寸 28px,外偏 14px
  // 用 invK 转换到世界坐标,NodeLayer 容器 scale 后保持屏幕 28px
  const sz = 28 * invK;
  const off = 14 * invK;
  // ne/se 用 right/bottom 定位(相对于节点右下角)
  const style: React.CSSProperties = {
    position: 'absolute',
    width: sz,
    height: sz,
    cursor,
    pointerEvents: 'auto',
    zIndex: 20,
    backgroundColor: 'transparent',
  };
  if (type === 'nw') {
    style.left = -off;
    style.top = -off;
  } else if (type === 'ne') {
    style.right = -off;
    style.top = -off;
  } else if (type === 'sw') {
    style.left = -off;
    style.bottom = -off;
  } else {
    style.right = -off;
    style.bottom = -off;
  }
  return (
    <div
      data-node-resize-handle={type}
      onPointerDown={onPointerDown}
      style={style}
    />
  );
}

/** NodeLayer 容器(memo 包裹,避免 CanvasView 无关重渲染波及) */
export const NodeLayer = React.memo(function NodeLayer({
  nodes,
  extensions,
  selectedIds,
  store,
  hoveredId,
  forceShowPins,
  connectionHoverNodeId,
  onUpdateNode,
  commandQueue,
  onNodePointerDown,
  onNodePointerEnter,
  onNodePointerLeave,
  onResizeHandlePointerDown,
  onNodeTouchStart,
  onNodeTouchEnd,
  onNodeTouchMove,
  externalRenaming,
  onRenameFinish,
  mode,
  onNodeDoubleClick,
}: NodeLayerProps): React.ReactElement {
  // 内部订阅 viewport: viewport 变化时仅更新容器 transform,NodeItem 因 memo 跳过
  const viewport = useViewport(store);
  const invK = viewport.k > 0 ? 1 / viewport.k : 1;

  // P0-7: 可见性过滤(类型/hidden/hidden祖先)按 graph 引用缓存 ——
  // 祖先链遍历仅在 graph 变更时执行一次,viewport 平移/缩放帧内只做矩形相交 culling
  const visibleNodes = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    /** 记忆化祖先链判定(路径压缩): 0=未知 1=可见 2=有 hidden 祖先 */
    const status = new Map<string, number>();
    const hasHiddenAncestor = (node: NodeRecord): boolean => {
      const chain: NodeRecord[] = [];
      let current = node;
      let result = false;
      for (;;) {
        const cached = status.get(current.id);
        if (cached !== undefined) {
          result = cached === 2;
          break;
        }
        chain.push(current);
        if (!current.parentId) {
          result = false;
          break;
        }
        const parent = byId.get(current.parentId);
        if (!parent) {
          result = false;
          break;
        }
        if (parent.hidden) {
          result = true;
          break;
        }
        current = parent;
      }
      for (const n of chain) status.set(n.id, result ? 2 : 1);
      return result;
    };
    return nodes.filter(
      (n) => n.type !== 'group' && !n.hidden && !hasHiddenAncestor(n),
    );
  }, [nodes]);

  // 遮挡裁剪(culling): 测量父容器尺寸,计算世界坐标系可见矩形,跳过视口外节点
  const layerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = layerRef.current?.parentElement;
    if (!el) return;

    const updateSize = (): void => {
      const rect = el.getBoundingClientRect();
      setContainerSize({
        width: rect.width || window.innerWidth,
        height: rect.height || window.innerHeight,
      });
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 视口外节点的世界坐标可见矩形
  const canCull = viewport.k > 0 && containerSize.width > 0 && containerSize.height > 0;
  const visibleRect = canCull
    ? {
        left: -viewport.x / viewport.k - (containerSize.width / viewport.k) * OVERSCAN_RATIO,
        top: -viewport.y / viewport.k - (containerSize.height / viewport.k) * OVERSCAN_RATIO,
        right: -viewport.x / viewport.k + (containerSize.width / viewport.k) * (1 + OVERSCAN_RATIO),
        bottom: -viewport.y / viewport.k + (containerSize.height / viewport.k) * (1 + OVERSCAN_RATIO),
      }
    : null;

  // P1-5: 使用网格空间索引进行视口裁剪(O(Gq+H) 替代 O(V) 全量遍历)
  const filteredNodes = useMemo(() => {
    if (!visibleRect) return visibleNodes;
    // 通过空间索引快速获取可见矩形内的候选节点
    const candidateIds = store.getSpatialIndex().queryRect(
      visibleRect.left,
      visibleRect.top,
      visibleRect.right,
      visibleRect.bottom,
    );
    // 与 visibleNodes(已过滤 hidden/hiddenAncestor/group)取交集
    return visibleNodes.filter((n) => candidateIds.has(n.id));
  }, [visibleRect, visibleNodes, store]);

  return (
      <div
        ref={layerRef}
        data-canvas-node-layer
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
          willChange: 'transform',
          WebkitBackfaceVisibility: 'hidden',
          backfaceVisibility: 'hidden',
        }}
      >
        {filteredNodes.map((node) => {
          const isSelected = selectedIds.has(node.id);
          const isHovered = hoveredId === node.id;
          const ext = extensions.get(node.type);

          return (
            <NodeItem
              key={node.id}
              nodeId={node.id}
              store={store}
              ext={ext}
              isSelected={isSelected}
              isHovered={isHovered}
              forceShowPins={forceShowPins}
              isConnectionHover={connectionHoverNodeId === node.id}
              invK={invK}
              onUpdateNode={onUpdateNode}
              commandQueue={commandQueue}
              onNodePointerDown={onNodePointerDown}
              onNodePointerEnter={onNodePointerEnter}
              onNodePointerLeave={onNodePointerLeave}
              onResizeHandlePointerDown={onResizeHandlePointerDown}
              onNodeTouchStart={onNodeTouchStart}
              onNodeTouchEnd={onNodeTouchEnd}
              onNodeTouchMove={onNodeTouchMove}
              externalRenaming={externalRenaming}
              onRenameFinish={onRenameFinish}
              mode={mode}
              onNodeDoubleClick={onNodeDoubleClick}
            />
          );
        })}
      </div>
  );
});

/** 默认节点内容(无 renderer 时) - 自带单层 outline(因为 NodeItem 外层不画 outline) */
function DefaultNodeContent({
  node,
  ext,
}: {
  node: NodeRecord;
  ext?: NodeTypeExtension;
}): React.ReactElement {
  const nodeDefaults = useNodeDefaults();
  const isLight = typeof window !== 'undefined' && window.matchMedia
    ? !window.matchMedia('(prefers-color-scheme: dark)').matches
    : true;
  const outlineWidth = node.outlineWidth ?? nodeDefaults.outlineWidth ?? 1;
  const outlineColor = node.outlineColor ?? nodeDefaults.outlineColor ?? '#0f3460';
  const outlineOffset = node.outlineOffset ?? 0;
  const radius = node.borderRadius ?? nodeDefaults.borderRadius ?? 8;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: 8,
        color: nodeDefaults?.contentTextColor ?? (isLight ? '#444' : '#bbb'),
        fontSize: 12,
        overflow: 'hidden',
        boxSizing: 'border-box',
        outline: `${outlineWidth}px solid ${outlineColor}`,
        outlineOffset,
        borderRadius: radius,
        backgroundColor: node.backgroundColor ?? node.nodeColor ?? ext?.color ?? nodeDefaults.fillColor ?? '#16213e',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {ext?.displayName ?? node.type}
      </div>
      <div style={{ opacity: 0.6 }}>{node.id}</div>
    </div>
  );
}

