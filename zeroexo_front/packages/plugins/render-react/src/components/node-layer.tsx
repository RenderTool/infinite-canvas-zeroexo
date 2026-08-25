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

import React, { useRef, useLayoutEffect, useState, useMemo, useEffect } from 'react';
import type { NodeRecord, NodeTypeExtension, NodeRenderer, CommandQueue, Viewport } from '@zeroexo/core';
import { resolveNodeSize } from '@zeroexo/core';
import type { ReactGraphStore } from '../store.js';
import { useNodeById } from '../store.js';
import { useNodeDefaults } from '../pin-defaults.js';
import { quantizeZoom } from './edge-layer.js';
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

    // P1-3: 低缩放 LOD (k < 0.35) — 渲染轻量占位(纯色块,不渲染节点内容/标题文本)
    // 避免大量复杂节点内容(视频/图片/音频)在低缩放时全量渲染。
    // 去标题文本: 全视图(k<0.35)时节点屏幕尺寸小,标题本就不可读(k=0.35 时
    // 16px 标题 ≈ 5.6px);而 3000 节点全视图时文本布局/绘制成本随节点数翻倍
    // (每节点 div+span 两个 DOM),是大量节点掉帧的主因之一 —— 占位改为纯色块。
    const isLowZoom = invK > 1 / 0.35; // invK = 1/k, 所以 k < 0.35 时 invK > 2.857
    if (isLowZoom) {
      // 使用节点底色(与 NodeShell shellColor 优先级一致: fillColor 优先于 ext.color)
      const nodeColor = node.backgroundColor ?? node.nodeColor ?? nodeDefaults.fillColor ?? ext?.color ?? '#16213e';
      const size = resolveNodeSize(node, ext);
      const nodeTransform = `translate(${node.position?.x ?? 0}px, ${node.position?.y ?? 0}px)`;

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
        </div>
      );
    }

    // 注意: nodeDefaults 已在上面无条件调用，此处不再重复声明
    // size 解析:node.size 优先(已 resize 过的节点用实际尺寸),回退到 ext.defaultSize,再回退默认
    // 必须与 edge-layer.tsx 的 size 解析保持一致,否则 resize 后节点视觉不变但连线缩放 bug)
    const size = resolveNodeSize(node, ext);
    const resizable = ext?.resizable === true && !node.locked;
    const locked = node.locked === true;
      // 无缝拼接模式:borderRadius 显式为 0 的节点(如图片拆解切片)空闲时不渲染阴影,避免拼合时缝隙观感
      // 与 NodeShell 同源:全局默认 borderRadius 调 0 也应触发 tileMode
      const tileMode = (node.borderRadius ?? nodeDefaults.borderRadius ?? 2) === 0;

    // GPU 加速缩放:当节点尺寸与默认尺寸不同时,使用 transform scale 代替 width/height 过渡
    // 避免 CSS width/height 过渡触发 layout 重算导致文字模糊
    // 注意:仅在等比缩放(sx ≈ sy)时启用 —— 非等比 scale 会导致标题/图标/文本形变,
    // 切分/裁剪等任意宽高比节点(如图片拆解切片)必须回退到真实尺寸渲染(React Flow 模式),
    // 否则相邻节点拼合时还会因合成层设备像素取整产生缝隙
    const defaultSize = ext?.defaultSize;
    // 旧扩展仍可使用 lockAspectRatio；新节点优先从 Runtime Contract 声明缩放策略。
    const scaleContract = ext?.runtime?.definition?.size;
    const canScale = ext?.lockAspectRatio === true || scaleContract?.mode === 'uniform';
    // T9: per-node 缩放覆写 —— StackNode 文本卡活跃时置位 scaleOverride='real'，
    // 强制真实尺寸渲染(文本重排不糊)，同步解锁 resize 等比(见 preset accessor)
    const scaleOverrideReal = (node.data as { scaleOverride?: string } | undefined)?.scaleOverride === 'real';
    const rawSx = defaultSize && defaultSize.width > 0 ? size.width / defaultSize.width : 1;
    const rawSy = defaultSize && defaultSize.height > 0 ? size.height / defaultSize.height : 1;
    // resize 结果整数化会引入 ≤0.5px 高度舍入误差,固定比例容差 0.001 会把等比锁定的
    // 中间尺寸误判为非等比 → 回退真实尺寸渲染(内容挤压/字体跳跃)。改用高度偏差 ≤0.75px 判定
    const isUniformScale = Math.abs(rawSx - rawSy) * (defaultSize?.height ?? 1) <= 0.75;
    const useScale = canScale && isUniformScale && !scaleOverrideReal && !!(defaultSize && (size.width !== defaultSize.width || size.height !== defaultSize.height));
    const sx = useScale ? rawSx : 1;
    const sy = useScale ? rawSy : 1;
    const domW = useScale ? defaultSize.width : size.width;
    const domH = useScale ? defaultSize.height : size.height;
    const nodeTransform = useScale
      ? `translate(${node.position?.x ?? 0}px, ${node.position?.y ?? 0}px) scale(${sx}, ${sy})`
      : `translate(${node.position?.x ?? 0}px, ${node.position?.y ?? 0}px)`;

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
          borderRadius: node.borderRadius ?? nodeDefaults.borderRadius ?? 2,
          // 有 renderer 时外层背景透明(让 NodeShell 背景显示);无 renderer 时用 ext.color / 全局默认
          backgroundColor: renderer
            ? 'transparent'
            : (node.backgroundColor ?? node.nodeColor ?? ext?.color ?? nodeDefaults.fillColor ?? '#16213e'),
          // 透明度:node.opacity(0-1),undefined 用 1;仅在此层应用一次(NodeShell 不再重复)
          opacity: node.opacity ?? 1,
          // box-shadow: 统一高质量阴影(拼接节点空闲时不投影)
          // hover 卡片式悬浮投影(验收反馈 B9:替代原蓝色描边观感,参考 .card:hover 风格)
          // 选中态由NodeShell的outline负责,此处仅保留hover阴影
          // 连线悬停蓝色指示也已下沉到NodeShell(与选中红色互斥,消除叠加态)
          // 契约: hoverEffect=custom 时 hover 阴影交由视图自绘,此处跳过
          boxShadow: (isHovered && ext?.viewContract?.hoverEffect !== 'custom')
              ? '6px 8px 20px rgba(0,0,0,0.35)'
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
                sx={sx}
                sy={sy}
                bottomInset={ext?.resizeHandleInset?.bottom}
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
 * 且位于节点自身 transform:scale 之内 —— handle 用连续 CSS 变量 --zx-invk 反转视口缩放,
 * 再用 1/sx, 1/sy 反转节点 GPU scale,双重叠加后保持屏幕 28px 恒定。
 * 特化外观节点(StackNode 外框含底部导航区)可用 bottomInset 指定底部
 * handle 的本地垂直位移,使命中区与可视媒体卡片对齐。
 */
function NodeResizeHandle({
  type,
  cursor,
  sx,
  sy,
  bottomInset,
  onPointerDown,
}: {
  type: 'nw' | 'ne' | 'sw' | 'se';
  cursor: string;
  /** 节点 GPU scale 因子 X(useScale=false 时传 1) */
  sx: number;
  /** 节点 GPU scale 因子 Y(useScale=false 时传 1) */
  sy: number;
  /** 底部 handle 本地内缩(世界坐标;如 StackNode 导航区高度),默认 0 */
  bottomInset?: number;
  onPointerDown: (e: React.PointerEvent) => void;
}): React.ReactElement {
  // 固定屏幕尺寸 28px，外偏 14px
  // T8: invK 部分改走连续 CSS 变量(--zx-invk 由 NodeLayer 容器每帧写入)，
  // 视口缩放时 handle 尺寸/偏移逐帧连续跟随，不再随 5% 桶量化跳变；
  // ÷sx/÷sy 仍为 JS 数值(节点 resize 每帧重渲染，天然连续)。
  const invKVar = 'var(--zx-invk, 1)';
  const szW = `calc(28px * ${invKVar} / ${sx})`;
  const szH = `calc(28px * ${invKVar} / ${sy})`;
  // 负号必须在 calc 内部：`-calc(...)` 会被 CSS 词法解析为不存在的函数名 `-calc`，
  // 整条声明被丢弃导致 handle 落回静态位置(左上角错位)——验收反馈 T11 二次修复
  const offY = `calc(14px * ${invKVar} / ${sy})`;
  const negOffX = `calc(-14px * ${invKVar} / ${sx})`;
  const negOffY = `calc(-14px * ${invKVar} / ${sy})`;
  // 底部内缩:本地位移(世界坐标)，底部 handle 的 bottom 需叠加该值
  const insetPx = (bottomInset ?? 0) / sy;
  // ne/se 用 right/bottom 定位(相对于节点右下角)
  const style: React.CSSProperties = {
    position: 'absolute',
    width: szW,
    height: szH,
    cursor,
    pointerEvents: 'auto',
    zIndex: 20,
    backgroundColor: 'transparent',
  };
  if (type === 'nw') {
    style.left = negOffX;
    style.top = negOffY;
  } else if (type === 'ne') {
    style.right = negOffX;
    style.top = negOffY;
  } else if (type === 'sw') {
    style.left = negOffX;
    style.bottom = `calc(${insetPx}px - ${offY})`;
  } else {
    style.right = negOffX;
    style.bottom = `calc(${insetPx}px - ${offY})`;
  }
  return (
    <div
      data-node-resize-handle={type}
      onPointerDown={onPointerDown}
      style={style}
    >
      {/* 右下角可见 grip 提示可缩放(验收反馈 B7):屏幕恒定 12px，不可缩放节点不渲染 handle 即天然隐藏 */}
      {type === 'se' ? (
        <svg
          viewBox="0 0 12 12"
          // SVG 的 width/height 属性不支持 calc()/var()，必须走 CSS(style)；
          // 属性值解析失败会退回默认固有尺寸导致 grip 位置错乱
          style={{ position: 'absolute', width: `calc(12px * ${invKVar} / ${sx})`, height: `calc(12px * ${invKVar} / ${sy})`, right: `calc(7px * ${invKVar} / ${sx})`, bottom: `calc(7px * ${invKVar} / ${sy})`, opacity: 0.45, pointerEvents: 'none', transition: 'opacity 0.15s' }}
        >
          <path d="M10.5 5.5 L5.5 10.5 M10.5 8.5 L8.5 10.5 M10.5 2.5 L2.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        </svg>
      ) : null}
    </div>
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
  const layerRef = useRef<HTMLDivElement>(null);

  // === 视口 transform 直写 DOM + invK 低频更新（平移缩放零 React reconcile）===
  // 之前用 useViewport 订阅,每次 rAF 合帧后仍触发 NodeLayer 整棵子树重渲染:
  // 即使 NodeItem 被 memo 拦截,1000 个可见节点每帧 1000 次 props 浅比较,
  // 加上 Context Provider 重建,在节点多 + 平移缩放时成为主线程瓶颈。
  // 现改为:store 订阅回调里直接写 layerRef.current.style,React 完全不参与。
  // 仅 invK(量化到 5% 桶)通过 state 低频更新,驱动 NodeItem 跨桶重渲染。
  const [invK, setInvK] = useState(1);

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
    // 防御性去重：协作同步/撤销重做/Agent 快速创建等边界情况可能产生重复 ID
    // Map 保留后出现的节点（更新的数据），避免 React duplicate key 警告
    const deduped = Array.from(byId.values());
    // 防御性过滤无 id 节点：Agent add_node 契约允许缺省 id，若上游未兜底生成会
    // 产生 id=undefined 节点，渲染 key=node.id 失效触发 React unique key 警告。
    // 执行端已兜底（canvas-op-executor），此处为渲染层双保险。
    return deduped.filter(
      (n) => typeof n.id === 'string' && n.id.length > 0 && n.type !== 'group' && !n.hidden && !hasHiddenAncestor(n),
    );
  }, [nodes]);

  // 遮挡裁剪(culling): 测量父容器尺寸,计算世界坐标系可见矩形,跳过视口外节点
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

  // culling 节流：viewport 每帧变化都重算 filteredNodes 会导致空间索引查询 +
  // 全量 visibleNodes.filter 每帧执行（节点多时 CPU 开销显著）。
  // 改为节流状态：120ms 窗口内只更新一次可见矩形；缩放跨 5% 桶时立即更新。
  // 120ms 内已离开视口的节点仍短暂存在（但 DOM 还在，仅几帧），视觉上因 overscan
  // 缓冲不可见；新进入视口的节点最多延迟 120ms 出现（可接受，且快速平移时本就模糊）。
  const CULL_THROTTLE_MS = 120;
  const [cullRect, setCullRect] = useState<{
    left: number; top: number; right: number; bottom: number;
  } | null>(null);
  useEffect(() => {
    let last = 0;
    let lastBucket = 0;
    let timer: number | null = null;

    // 直写 DOM:transform + --zx-invk(每帧,无 React 参与)
    const writeTransform = (vp: Viewport): void => {
      const el = layerRef.current;
      if (el) {
        const k = vp.k > 0 ? vp.k : 1;
        el.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${k})`;
        el.style.setProperty('--zx-invk', String(1 / k));
      }
    };

    const compute = (vp: Viewport, immediate: boolean): void => {
      // 1) transform 始终直写(每帧)
      writeTransform(vp);
      // 2) invK 跨 5% 桶时 setState(驱动 NodeItem 重渲染)
      const nextInvK = quantizeZoom(vp.k > 0 ? 1 / vp.k : 1);
      setInvK((prev) => (prev === nextInvK ? prev : nextInvK));
      // 3) culling 矩形节流更新(120ms + 缩放跨桶立即更新)
      const k = vp.k > 0 ? vp.k : 1;
      if (containerSize.width === 0) return;
      const invK = 1 / k;
      const padW = (containerSize.width * invK) * OVERSCAN_RATIO;
      const padH = (containerSize.height * invK) * OVERSCAN_RATIO;
      const cx = -vp.x * invK;
      const cy = -vp.y * invK;
      const rect = {
        left: cx - padW,
        top: cy - padH,
        right: cx + containerSize.width * invK + padW,
        bottom: cy + containerSize.height * invK + padH,
      };
      const bucket = Math.round(k / 0.05);
      const now = performance.now();
      if (immediate || bucket !== lastBucket || now - last >= CULL_THROTTLE_MS) {
        last = now;
        lastBucket = bucket;
        setCullRect((prev) => {
          if (prev &&
            Math.abs(prev.left - rect.left) < 1 &&
            Math.abs(prev.top - rect.top) < 1 &&
            Math.abs(prev.right - rect.right) < 1 &&
            Math.abs(prev.bottom - rect.bottom) < 1) {
            return prev;
          }
          return rect;
        });
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
      } else if (timer === null) {
        timer = window.setTimeout(() => {
          timer = null;
          last = performance.now();
          setCullRect(rect);
        }, CULL_THROTTLE_MS);
      }
    };
    compute(store.getViewport(), true);
    return store.subscribeViewport(() => compute(store.getViewport(), false));
  }, [store, containerSize.width, containerSize.height]);

  // P1-5: 使用网格空间索引进行视口裁剪(O(Gq+H) 替代 O(V) 全量遍历)
  // 依赖 cullRect(节流)而非每帧 viewport，平移缩放时不重算
  const filteredNodes = useMemo(() => {
    if (!cullRect) return visibleNodes;
    const candidateIds = store.getSpatialIndex().queryRect(
      cullRect.left, cullRect.top, cullRect.right, cullRect.bottom,
    );
    return visibleNodes.filter((n) => candidateIds.has(n.id));
  }, [cullRect, visibleNodes, store]);

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
          transformOrigin: 'top left',
          pointerEvents: 'none',
          willChange: 'transform',
          WebkitBackfaceVisibility: 'hidden',
          backfaceVisibility: 'hidden',
          // transform 与 --zx-invk 由 useLayoutEffect 订阅直写 DOM,
          // 避免每帧触发 React 重渲染。初始提供占位值。
          ['--zx-invk' as string]: '1',
        } as React.CSSProperties}
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
  const outlineWidth = node.outlineWidth ?? nodeDefaults.outlineWidth ?? 0;
  const outlineColor = node.outlineColor ?? nodeDefaults.outlineColor ?? '#0f3460';
  const outlineOffset = node.outlineOffset ?? 0;
  const radius = node.borderRadius ?? nodeDefaults.borderRadius ?? 2;
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

