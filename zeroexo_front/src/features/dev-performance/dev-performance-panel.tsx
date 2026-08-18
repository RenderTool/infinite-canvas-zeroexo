import { useEffect, useState } from 'react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';

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

export function DevPerformancePanel({ store, syncStatus }: DevPerformancePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
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
        </div>
      ) : null}
    </div>
  );
}
