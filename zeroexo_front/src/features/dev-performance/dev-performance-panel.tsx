import { useCallback, useEffect, useState } from 'react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { CommandQueue, GraphModel } from '@zeroexo/core';

interface PerformanceSnapshot {
  fps: number;
  frameMs: number;
  nodes: number;
  edges: number;
  heapMb?: number;
  bottleneck: string;
}

interface DevPerformancePanelProps {
  store: ReactGraphStore;
  commandQueue: CommandQueue | null;
  syncStatus?: string;
}

interface PerformanceMemory {
  usedJSHeapSize: number;
}

function getHeapMb(): number | undefined {
  const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : undefined;
}

function classify(snapshot: Omit<PerformanceSnapshot, 'bottleneck'>): string {
  if (snapshot.fps < 45) return 'render / paint';
  if (snapshot.edges > 50_000) return 'edge density';
  if (snapshot.nodes > 1_000) return 'node volume';
  if (snapshot.heapMb !== undefined && snapshot.heapMb > 700) return 'memory';
  return 'nominal';
}

export function DevPerformancePanel({ store, commandQueue, syncStatus }: DevPerformancePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [injectInfo, setInjectInfo] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot>({
    fps: 0,
    frameMs: 0,
    nodes: 0,
    edges: 0,
    bottleneck: 'sampling',
  });

  useEffect(() => {
    // 关闭面板时不保留 RAF 采样循环，开发工具不能反过来污染性能数据。
    if (!open) return;
    let frame = 0;
    let last = performance.now();
    let frames = 0;
    let windowStart = last;
    let running = true;

    const sample = (now: number) => {
      if (!running) return;
      frames += 1;
      const frameMs = now - last;
      last = now;
      if (now - windowStart >= 500) {
        const graph = store.getGraph();
        const fps = Math.round((frames * 1000) / (now - windowStart));
        const base = { fps, frameMs: Math.round(frameMs * 10) / 10, nodes: graph.nodes.length, edges: graph.edges.length, heapMb: getHeapMb() };
        setSnapshot({ ...base, bottleneck: classify(base) });
        frames = 0;
        windowStart = now;
      }
      frame = requestAnimationFrame(sample);
    };

    frame = requestAnimationFrame(sample);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
    };
  }, [store, open]);

  /** 一键注入 1000 节点压力 fixture(public/stress/stress-1000.json),验证渲染/连线/同步瓶颈 */
  const handleInjectStress = useCallback(async () => {
    if (injecting) return;
    setInjecting(true);
    setInjectInfo(null);
    try {
      const res = await fetch('/stress/stress-1000.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const graph = (await res.json()) as GraphModel & { viewport: { x: number; y: number; k: number } };
      commandQueue?.replaceState(graph);
      store.setViewport(graph.viewport ?? { x: 80, y: 80, k: 0.42 });
      setInjectInfo(`injected: ${graph.nodes.length} nodes / ${graph.edges.length} edges`);
    } catch (err) {
      setInjectInfo(`inject failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInjecting(false);
    }
  }, [injecting, commandQueue, store]);

  return (
    <div
      data-dev-performance
      style={{
        position: 'fixed',
        top: 12,
        left: 12,
        zIndex: 1200,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        color: '#e8edf2',
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 6,
          background: 'rgba(20,24,28,0.88)',
          color: '#b8f2d0',
          padding: '5px 8px',
          cursor: 'pointer',
          boxShadow: '0 8px 22px rgba(0,0,0,0.18)',
        }}
      >
        PERF {snapshot.fps || '--'} FPS
      </button>
      {open ? (
        <div
          style={{
            marginTop: 6,
            minWidth: 238,
            padding: 10,
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 8,
            background: 'rgba(20,24,28,0.94)',
            boxShadow: '0 16px 42px rgba(0,0,0,0.28)',
            lineHeight: 1.7,
          }}
        >
          <div style={{ color: '#b8f2d0', marginBottom: 4 }}>Canvas Runtime</div>
          <div>nodes: {snapshot.nodes} / edges: {snapshot.edges}</div>
          <div>fps: {snapshot.fps} / frame: {snapshot.frameMs}ms</div>
          <div>heap: {snapshot.heapMb === undefined ? 'n/a' : `${snapshot.heapMb}MB`}</div>
          <div>sync: {syncStatus ?? 'unknown'}</div>
          <div style={{ color: snapshot.bottleneck === 'nominal' ? '#b8f2d0' : '#ffd28a' }}>
            bottleneck: {snapshot.bottleneck}
          </div>
          <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 8 }}>
            <button
              type="button"
              onClick={() => void handleInjectStress()}
              disabled={injecting}
              style={{
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 5,
                background: 'rgba(255,255,255,0.06)',
                color: '#e8edf2',
                padding: '4px 8px',
                cursor: injecting ? 'not-allowed' : 'pointer',
                opacity: injecting ? 0.5 : 1,
              }}
            >
              {injecting ? 'INJECTING...' : 'INJECT 1000 NODES'}
            </button>
            {injectInfo ? (
              <div style={{ marginTop: 4, fontSize: 10, color: injectInfo.startsWith('injected') ? '#b8f2d0' : '#ff9d9d' }}>
                {injectInfo}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
