/**
 * ThreeCanvasHost — Three.js 渲染层宿主（Plan#27 T4/T6）
 *
 * 由 editor-page 在 CanvasView renderer='three' 时作为 threeHost 注入：
 * - T4 接线：CanvasView 把完整 props 经 CanvasViewPropsContext 透传，本组件优先从 context
 *   读取（组装方仅需 renderer='three' + threeHost 两行接入，零重复传参）；直接使用（demo）
 *   时回退自身 props。
 * - 自包含容器 div：引擎 canvas（适配层 append）+ 节点内容 DOM overlay + 透传宿主 overlay children
 * - 创建 ThreeCanvasAdapter（store ↔ 引擎双向同步，接口与 CanvasView props 同签名）
 * - 节点内容 DOM overlay：复用原画布 NodeRenderer（extension.renderNode），rAF 直写 transform 跟随引擎外壳，
 *   内容像素级 1:1（内容本身就是 DOM），外壳（圆角/阴影/描边/PIN/连线/背景）由引擎 GPU 渲染
 * - overlay 容器 pointerEvents none：交互全部走引擎（点击/拖拽/缩放/平移），避免 DOM 拦截
 * - 容器级事件（右键菜单/拖入素材）在 mount div 监听，转发宿主同签名回调
 */
import React, { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CommandQueue, NodeRecord, NodeTypeExtension } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import {
  CanvasViewPropsContext,
  useGraph,
} from '@zeroexo/plugin-render-react';
import { useGroupDefaults } from '@zeroexo/plugin-group';
import { ThreeCanvasAdapter } from './three-canvas-adapter.js';
import { ContentTextureLayer, EditingOverlayLayer } from './three-content-layer.js';

export interface ThreeCanvasHostProps {
  store?: ReactGraphStore;
  commandQueue?: CommandQueue;
  extensions?: Map<string, NodeTypeExtension>;
  background?: 'dots' | 'lines' | 'none';
  /** 画布背景色（组标题纹理打底；与 CanvasView props 同名） */
  backgroundColor?: string;
  gridDotColor?: string;
  gridLineColor?: string;
  gridSize?: number;
  edgeColor?: string;
  edgeSelectedColor?: string;
  getNodeSize?: (node: NodeRecord) => { width: number; height: number };
  getNodeColor?: (node: NodeRecord) => string | undefined;
  onNodeDoubleClick?: (nodeId: string, width: number, height: number) => void;
  /** T9: 3D 层级模式外部开关（editor-page 3D 按钮；adapter 就绪后 enter/exit，动画期间自动忽略） */
  threeMode?: boolean;
  /** 透传宿主 overlay（CanvasOverlays / CollabOverlay / SubjectEpisodeFilterBar 等） */
  children?: ReactNode;
}

/** 空画布指引（welcomeHint，与 DOM 版 CanvasView 语义一致：首次交互后不再显示） */
function WelcomeHintLayer({
  store,
  hint,
  dismissedRef,
}: {
  store: ReactGraphStore;
  hint: string;
  dismissedRef: React.RefObject<boolean>;
}): React.ReactElement | null {
  const graph = useGraph(store);
  if (graph.nodes.length > 0 || dismissedRef.current) return null;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, userSelect: 'none' }}>{hint}</span>
    </div>
  );
}

export function ThreeCanvasHost(props: ThreeCanvasHostProps): React.ReactElement {
  // T4: 优先读取 CanvasView renderer='three' 分支透传的完整 props（组装方零重复传参）；
  // 直接使用（demo / 独立宿主）时回退自身 props
  const ctx = React.useContext(CanvasViewPropsContext);
  const store = ctx?.store ?? props.store;
  const commandQueue = ctx?.commandQueue ?? props.commandQueue;
  const extensions = ctx?.extensions ?? props.extensions;
  const onNodeDoubleClick = ctx?.onNodeDoubleClick ?? props.onNodeDoubleClick;
  const mountRef = useRef<HTMLDivElement>(null);
  const [adapter, setAdapter] = useState<ThreeCanvasAdapter | null>(null);
  const adapterRef = useRef<ThreeCanvasAdapter | null>(null);
  const hintDismissedRef = useRef(false);
  // T7: 3D 模式标记——2D 组框由 DOM GroupLayer 渲染（像素级 1:1），3D 切引擎 SDF（DOM 组框隐藏防双重绘制）
  const [is3D, setIs3D] = useState(false);
  // T9: 3D 模式外部开关（editor-page 3D 按钮）；依赖 adapter 就绪（首次挂载先建引擎再 enter）
  useEffect(() => {
    const a = adapterRef.current;
    if (!a) return;
    const eng = a.getEngine();
    if (props.threeMode && !eng.isLayerMode) eng.enter3D();
    else if (!props.threeMode && eng.isLayerMode) eng.exit3D();
  }, [props.threeMode, adapter]);
  // T7: 组全局默认样式（editor-page 经 GroupDefaultsProvider 注入；与 DOM 版 GroupLayer 同源）
  const groupDefaults = useGroupDefaults();

  // 创建适配层（引擎 + store 双向同步）；commandQueue 缺失时降级为渲染只读（demo 页无 commandQueue 也可用）
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (store && commandQueue) {
      const a = new ThreeCanvasAdapter({
        store,
        commandQueue,
        container: mount,
        background: ctx?.background ?? props.background,
        backgroundColor: ctx?.backgroundColor ?? props.backgroundColor,
        gridDotColor: ctx?.gridDotColor ?? props.gridDotColor,
        gridLineColor: ctx?.gridLineColor ?? props.gridLineColor,
        gridSize: ctx?.gridSize ?? props.gridSize,
        edgeColor: ctx?.edgeColor ?? props.edgeColor,
        edgeSelectedColor: ctx?.edgeSelectedColor ?? props.edgeSelectedColor,
        edgeHoverColor: ctx?.edgeHoverColor,
        groupDefaults,
        resolvers: { getNodeSize: props.getNodeSize, getNodeColor: props.getNodeColor },
        // T7: 3D 模式通知宿主（切换 DOM GroupLayer 显隐）
        on3DStateChange: setIs3D,
      });
      adapterRef.current = a;
      setAdapter(a);
      return () => {
        a.dispose();
        adapterRef.current = null;
        setAdapter(null);
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, commandQueue]);

  // 视觉 props 变化 → 适配层（主题/背景切换即时生效）
  useEffect(() => {
    adapterRef.current?.updateVisuals({
      background: ctx?.background ?? props.background,
      backgroundColor: ctx?.backgroundColor ?? props.backgroundColor,
      gridDotColor: ctx?.gridDotColor ?? props.gridDotColor,
      gridLineColor: ctx?.gridLineColor ?? props.gridLineColor,
      gridSize: ctx?.gridSize ?? props.gridSize,
      edgeColor: ctx?.edgeColor ?? props.edgeColor,
      edgeSelectedColor: ctx?.edgeSelectedColor ?? props.edgeSelectedColor,
      edgeHoverColor: ctx?.edgeHoverColor,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ctx?.background, ctx?.backgroundColor, ctx?.gridDotColor, ctx?.gridLineColor, ctx?.gridSize,
    ctx?.edgeColor, ctx?.edgeSelectedColor, ctx?.edgeHoverColor,
    props.background, props.backgroundColor, props.gridDotColor, props.gridLineColor, props.gridSize,
    props.edgeColor, props.edgeSelectedColor,
  ]);

  return (
    <div
      ref={mountRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
      onPointerDown={() => { hintDismissedRef.current = true; }}
      onContextMenu={
        ctx?.onCanvasContextMenu
          ? (e) => {
              // T7: 组框 DOM（2D 由 DOM GroupLayer 渲染）优先命中——替换 target 为组节点语义 proxy，
              // 使宿主 handleCanvasContextMenu 走「组」分支（DOM 版右键命中 NodeLayer 组节点壳 data-node-id；
              // three 模式无 NodeLayer，需桥接）。预览组无 gid（data-canvas-group-preview）不处理，与 DOM 版同落空白。
              const rawTarget = e.target as Element;
              const groupEl = rawTarget.closest?.('[data-canvas-group-id]');
              if (groupEl) {
                const gid = groupEl.getAttribute('data-canvas-group-id');
                if (gid) {
                  const proxyEl = {
                    closest: (sel: string): Element | null =>
                      sel === '[data-node-id]'
                        ? ({ getAttribute: (name: string) => (name === 'data-node-id' ? gid : null) } as unknown as Element)
                        : null,
                  };
                  try {
                    Object.defineProperty(e, 'target', { value: proxyEl, configurable: true });
                  } catch {
                    // target 只读时的兑底：走空白菜单分支（可接受降级）
                  }
                  ctx.onCanvasContextMenu!(e);
                  return;
                }
              }
              // T5: three 模式下右键目标由引擎 raycast 判定（DOM 版依赖 e.target.closest('[data-node-id]')
              // 区分节点/空白；引擎 canvas 是命中 target 且 overlay pointerEvents:none，无法复用 DOM 检测）
              const engine = adapterRef.current?.getEngine();
              if (engine) {
                const nodeId = engine.pickAt(e.clientX, e.clientY);
                if (nodeId) {
                  const proxyEl = {
                    closest: (sel: string): Element | null =>
                      sel === '[data-node-id]'
                        ? ({ getAttribute: (name: string) => (name === 'data-node-id' ? nodeId : null) } as unknown as Element)
                        : null,
                  };
                  try {
                    Object.defineProperty(e, 'target', { value: proxyEl, configurable: true });
                  } catch {
                    // target 只读时的兑底：走空白菜单分支（可接受降级）
                  }
                }
              }
              ctx.onCanvasContextMenu!(e);
            }
          : undefined
      }
      onDrop={ctx?.onCanvasDrop ? (e) => ctx.onCanvasDrop!(e as unknown as React.DragEvent<HTMLDivElement>) : undefined}
      onDragOver={ctx?.onCanvasDragOver ? (e) => ctx.onCanvasDragOver!(e as unknown as React.DragEvent<HTMLDivElement>) : undefined}
      onDoubleClick={
        onNodeDoubleClick
          ? (e) => {
              // T4R: 双击节点 → 宿主（DOM overlay 移除后由引擎 raycast 判定，语义与原 NodeLayer 一致）
              const engine = adapterRef.current?.getEngine();
              if (!engine) return;
              const nodeId = engine.pickAt(e.clientX, e.clientY);
              if (!nodeId) return;
              const n = engine.getNode(nodeId);
              onNodeDoubleClick(nodeId, n?.data.w ?? 200, n?.data.h ?? 100);
            }
          : undefined
      }
    >
      {/** T7: 2D 组框 = 原 DOM GroupLayer（belowNodesLayer，像素级 1:1 + 徽标/handles/pin/重命名全交互）；
         3D 模式隐藏（引擎组框 SDF 接管，防双重绘制）——DOM 顺序在节点内容之前（组在节点之下） */}
      {!is3D && ctx?.belowNodesLayer}
      {/** T4R: 节点内容引擎化（离屏快照 → 内容图集 → instMesh 采样）+ 重命名编辑态单节点 DOM 覆盖 */}
      {adapter && extensions && store ? (
        <ContentTextureLayer
          store={store}
          extensions={extensions}
          adapterRef={adapterRef}
          ctx={ctx}
          getNodeSize={props.getNodeSize}
        />
      ) : null}
      {adapter && extensions && store ? (
        <EditingOverlayLayer
          store={store}
          extensions={extensions}
          adapterRef={adapterRef}
          ctx={ctx}
          getNodeSize={props.getNodeSize}
        />
      ) : null}
      {store && ctx?.welcomeHint ? (
        <WelcomeHintLayer store={store} hint={ctx.welcomeHint} dismissedRef={hintDismissedRef} />
      ) : null}
      {ctx?.children ?? props.children}
    </div>
  );
}
