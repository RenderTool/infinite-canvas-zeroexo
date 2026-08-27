/**
 * ContentTextureLayer — 节点内容引擎化（Plan#27 T4R 全面 Three.js）
 *
 * 替代被否决的「内容 DOM overlay」：节点内容（标题/图标/表单/富文本）不再全量 DOM 渲染，
 * 而是离屏快照 → NodeContentAtlas 图集 → instMesh shader 实例 uv 采样（单 draw call）。
 *
 * 调度策略：
 * - 对账：graph.nodes 变化 → 内容签名（title + data JSON 摘要）比较，增/变入快照队列，删即释放槽位
 * - 快照循环：rAF 每帧最多启动 PER_FRAME 批，隐藏容器池 CONCURRENCY 路并发（每批 2 帧布局等待）
 * - LOD：k < CONTENT_LOD_K 不渲染内容（与 DOM 版 LOD 占位语义一致：纯色卡片）；图集满同样降级
 * - 采样倍率：k≥1 用 2x（放大高清重拍），k<1 用 1x（缩略省显存/耗时）
 *
 * EditingOverlayLayer：重命名（externalRenaming）等编辑态单节点 DOM 覆盖——文本输入物理上必须 DOM
 * （canvas 无法接收 IME/光标），仅此一个节点挂 DOM，且编辑期间清理其内容槽位防双标题；
 * 编辑提交后 title/data 变化由对账自动重拍快照。
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NodeRecord, NodeTypeExtension, NodeRenderer, NodeRendererProps } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { NodeOverlayModeContext, useGraph } from '@zeroexo/plugin-render-react';
import type { CanvasViewProps } from '@zeroexo/plugin-render-react';
import type { ThreeCanvasAdapter } from './three-canvas-adapter.js';
import { NodeContentAtlas } from './three-content-atlas.js';
import { snapshotElementToCanvas } from './three-content-snapshot.js';

const CONTENT_LOD_K = 0.35; // 缩放低于此值不渲染内容（DOM 版 LOD 占位同阈值）
// [2026-08-27 征集 #75 用户拍板暂时禁用] 与 DOM 版（node-layer.tsx）同步：
// 稍微缩小就变纯色块的体验差，暂去除「缩小就回退」概念；置回 true 即恢复。
const CONTENT_LOD_ENABLED: boolean = false;
const PER_FRAME = 4; // 每帧最多启动的快照批数
const CONCURRENCY = 4; // 隐藏渲染容器并发数
const SIG_LEN = 400; // 内容签名 JSON 摘要长度上限

interface PoolSlot {
  div: HTMLDivElement;
  root: Root;
  busy: boolean;
}

/** 等待 N 帧（隐藏容器布局/样式稳定后再快照） */
function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number): void => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(n);
  });
}

/** 渲染单个节点内容的 renderNode props（快照态：只读、无交互态、invK=1 基准） */
function snapshotProps(
  node: NodeRecord,
  ext: NodeTypeExtension | undefined,
): NodeRendererProps {
  return {
    node,
    pins: ext?.getPins?.(node) ?? [],
    isSelected: false,
    isHovered: false,
    forceShowPins: false,
    updateNode: () => {}, // 快照只读：内容变更由对账重拍
    commandQueue: undefined,
    invK: 1,
    externalRenaming: false,
    onRenameFinish: () => {},
    pinScaleX: 1,
    pinScaleY: 1,
  };
}

export function ContentTextureLayer({
  store,
  extensions,
  adapterRef,
  getNodeSize,
}: {
  store: ReactGraphStore;
  extensions: Map<string, NodeTypeExtension>;
  adapterRef: React.RefObject<ThreeCanvasAdapter | null>;
  ctx: CanvasViewProps | null;
  getNodeSize?: (node: NodeRecord) => { width: number; height: number };
}): React.ReactElement | null {
  const graph = useGraph(store);
  const [atlas] = useState(() => new NodeContentAtlas());
  const sigRef = useRef<Map<string, string>>(new Map());
  const queueRef = useRef<string[]>([]);
  const busyRef = useRef(0);
  const nodesRef = useRef<Map<string, NodeRecord>>(new Map());
  const extensionsRef = useRef(extensions);
  const getNodeSizeRef = useRef(getNodeSize);
  const poolRef = useRef<PoolSlot[] | null>(null);

  extensionsRef.current = extensions;
  getNodeSizeRef.current = getNodeSize;

  // 节点最新快照（快照任务执行时读取）
  useEffect(() => {
    nodesRef.current = new Map(graph.nodes.map((n) => [n.id, n]));
  }, [graph.nodes]);

  // 挂载：注入图集纹理 + 隐藏渲染容器池（页面 CSS 环境真实生效）
  useEffect(() => {
    const eng = adapterRef.current?.getEngine();
    eng?.setContentAtlas(atlas.texture);
    const pool: PoolSlot[] = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const div = document.createElement('div');
      div.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none;visibility:hidden;';
      document.body.appendChild(div);
      pool.push({ div, root: createRoot(div), busy: false });
    }
    poolRef.current = pool;
    return () => {
      for (const p of pool) p.root.unmount();
      pool.forEach((p) => p.div.remove());
      poolRef.current = null;
      eng?.setContentAtlas(null);
      atlas.texture.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapterRef]);

  // 对账：graph 变化 → 增/变入队，删即释放
  useEffect(() => {
    const next = new Map<string, string>();
    let changed = false;
    for (const n of graph.nodes) {
      if (n.type === 'group') continue;
      const sig = (n.title ?? '') + '|' + JSON.stringify(n.data ?? {}).slice(0, SIG_LEN);
      next.set(n.id, sig);
      if (sigRef.current.get(n.id) !== sig) {
        if (sigRef.current.has(n.id)) {
          // 内容/尺寸变化：释放旧槽位重拍（重分配保证尺寸匹配）
          atlas.free(n.id);
          adapterRef.current?.clearNodeContentRect?.(n.id);
        }
        queueRef.current.push(n.id);
        changed = true;
      }
    }
    for (const [id] of sigRef.current) {
      if (!next.has(id)) {
        atlas.free(id);
        adapterRef.current?.clearNodeContentRect?.(id);
        changed = true;
      }
    }
    sigRef.current = next;
    void changed; // 快照循环 rAF 常驻，无需唤醒
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.nodes, atlas]);

  // 快照循环：rAF 常驻；LOD 门槛 + 每帧 PER_FRAME 批 + CONCURRENCY 路并发
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const k = adapterRef.current?.getViewport()?.k ?? 1;
      if (CONTENT_LOD_ENABLED && k < CONTENT_LOD_K) {
        // LOD 降级：全部释放（纯色卡，与 DOM 版占位一致）
        for (const id of [...sigRef.current.keys()]) {
          atlas.free(id);
          adapterRef.current?.clearNodeContentRect?.(id);
        }
        queueRef.current.length = 0;
        return;
      }
      const pool = poolRef.current;
      if (!pool) return;
      let started = 0;
      while (busyRef.current < CONCURRENCY && queueRef.current.length > 0 && started < PER_FRAME) {
        const id = queueRef.current.shift();
        if (!id || !sigRef.current.has(id)) continue; // 已删除/已降级
        if (atlas.has(id)) continue; // 已有槽位
        const slot = pool.find((p) => !p.busy);
        if (!slot) break;
        slot.busy = true;
        busyRef.current++;
        started++;
        void runSnapshot(id, slot, atlas, adapterRef, nodesRef, extensionsRef, getNodeSizeRef).finally(
          () => {
            slot.busy = false;
            busyRef.current--;
          },
        );
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapterRef, atlas]);

  return null;
}

/** 单节点快照任务：隐藏容器渲染 → 2 帧布局 → 快照 canvas → 图集绘制 → uv 写引擎 */
async function runSnapshot(
  id: string,
  slot: PoolSlot,
  atlas: NodeContentAtlas,
  adapterRef: React.RefObject<ThreeCanvasAdapter | null>,
  nodesRef: React.MutableRefObject<Map<string, NodeRecord>>,
  extensionsRef: React.MutableRefObject<Map<string, NodeTypeExtension>>,
  getNodeSizeRef: React.MutableRefObject<((node: NodeRecord) => { width: number; height: number }) | undefined>,
): Promise<void> {
  const node = nodesRef.current.get(id);
  if (!node) return;
  const ext = extensionsRef.current.get(node.type);
  const renderer = ext?.renderNode as NodeRenderer | undefined;
  if (!renderer) return; // 无内容渲染器的节点（纯色卡）
  const k = adapterRef.current?.getViewport()?.k ?? 1;
  const scale = k >= 1 ? 2 : 1;
  const size = getNodeSizeRef.current?.(node) ?? node.size ?? { width: 200, height: 100 };
  const rect = atlas.alloc(id, size.width * scale, size.height * scale);
  if (!rect) {
    adapterRef.current?.clearNodeContentRect?.(id); // 图集满：降级纯色卡
    return;
  }
  slot.root.render(
    <NodeOverlayModeContext.Provider value={true}>
      <div style={{ width: size.width, height: size.height, overflow: 'hidden' }}>
        {renderer(snapshotProps(node, ext)) as React.ReactNode}
      </div>
    </NodeOverlayModeContext.Provider>,
  );
  await nextFrames(2); // 布局/样式稳定
  const el = slot.div.firstElementChild as HTMLElement | null;
  slot.root.render(null);
  if (!el) return;
  const canvas = await snapshotElementToCanvas(el, scale);
  if (!canvas) return; // 快照失败：保持纯色卡（下次对账重试）
  // 快照期间节点可能已删除/变更：槽位归属校验（重拍会 free 旧槽位，这里以 atlas.has 为准）
  if (!atlas.has(id)) return;
  atlas.draw(id, canvas);
  const uv = atlas.uvOf(id);
  if (uv) adapterRef.current?.setNodeContentRect?.(id, uv);
}

/** 编辑态单节点 DOM 覆盖（externalRenaming）：文本输入物理必须 DOM，仅此一节点挂载 */
export function EditingOverlayLayer({
  store,
  extensions,
  adapterRef,
  ctx,
  getNodeSize,
}: {
  store: ReactGraphStore;
  extensions: Map<string, NodeTypeExtension>;
  adapterRef: React.RefObject<ThreeCanvasAdapter | null>;
  ctx: CanvasViewProps | null;
  getNodeSize?: (node: NodeRecord) => { width: number; height: number };
}): React.ReactElement | null {
  const graph = useGraph(store);
  const renamingId = ctx?.externalRenaming;
  const node = renamingId ? graph.nodes.find((n) => n.id === renamingId) : undefined;
  const ext = node ? extensions.get(node.type) : undefined;
  const renderer = ext?.renderNode;

  // 编辑期间清理该节点内容槽位（防快照旧标题与输入框双标题）
  useEffect(() => {
    if (!renamingId) return;
    adapterRef.current?.clearNodeContentRect?.(renamingId);
    // 编辑提交后 title/data 变化由 ContentTextureLayer 对账自动重拍快照，无需手动入队
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renamingId]);

  if (!node || !renderer) return null;
  const size = getNodeSize?.(node) ?? node.size ?? { width: 200, height: 100 };

  return (
    <EditOverlayItem
      node={node}
      renderer={renderer as NodeRenderer}
      ext={ext}
      adapterRef={adapterRef}
      ctx={ctx}
      width={size.width}
      height={size.height}
    />
  );
}

function EditOverlayItem({
  node,
  renderer,
  ext,
  adapterRef,
  ctx,
  width,
  height,
}: {
  node: NodeRecord;
  renderer: NodeRenderer;
  ext: NodeTypeExtension | undefined;
  adapterRef: React.RefObject<ThreeCanvasAdapter | null>;
  ctx: CanvasViewProps | null;
  width: number;
  height: number;
}): React.ReactElement | null {
  const ref = React.useRef<HTMLDivElement>(null);
  // 每帧跟随引擎屏幕矩形（单节点，成本可忽略）
  useEffect(() => {
    let raf = 0;
    const sync = (): void => {
      raf = requestAnimationFrame(sync);
      const el = ref.current;
      if (!el) return;
      const r = adapterRef.current?.getNodeScreenRect(node.id);
      if (r) {
        el.style.transform = `translate(${r.x}px, ${r.y}px)`;
        el.style.width = `${r.w}px`;
        el.style.height = `${r.h}px`;
      }
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [adapterRef, node.id]);

  const props: NodeRendererProps = {
    ...snapshotProps(node, ext),
    isSelected: true,
    externalRenaming: true,
    updateNode: (patch) => ctx?.store?.updateNodeData?.(node.id, patch as Record<string, unknown>),
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transformOrigin: 'top left',
        pointerEvents: 'auto', // 编辑态输入框需接收点击/键盘
        zIndex: 200,
      }}
    >
      <NodeOverlayModeContext.Provider value={true}>
        <div style={{ width, height }}>{renderer(props) as React.ReactNode}</div>
      </NodeOverlayModeContext.Provider>
    </div>
  );
}
