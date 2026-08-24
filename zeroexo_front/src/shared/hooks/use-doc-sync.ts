/**
 * useDocSync - Yjs 统一自动保存 + 云端同步 Hook
 *
 * 每个创作模块（剧本/分镜/出片）一个 Y.Doc，docName = `{namespace}:{artifactId}`：
 * - y-indexeddb：本地缓存，刷新秒恢复、离线可用
 * - HocuspocusProvider：WebSocket 云端实时同步（多浏览器合并）
 * 服务端 onStoreDocument 防抖把顶层 Y.Map 序列化为 JSON 快照写回 Project.{field}
 *
 * 用法：
 *   const { data, ready, status, update, replace } = useDocSync<ScriptEditorState>(artifactId, 'script', parsedInitial);
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { getToken } from '@/services/api-client.js';

export type DocSyncNamespace = 'script' | 'storyboard' | 'generations';

export type DocSyncStatus = 'loading' | 'connected' | 'disconnected' | 'error';

export interface DocSyncResult<T> {
  /** 当前 JSON 快照；ready 前为 null */
  data: T | null;
  /** 本地缓存与云端首次同步是否完成 */
  ready: boolean;
  status: DocSyncStatus;
  /** 增量写入顶层 Y.Map（对象/数组自动深层转换为 Yjs 类型） */
  update: (patch: Partial<T>) => void;
  /** 整体替换文档内容（用于重置/回滚） */
  replace: (next: T) => void;
}

interface DocEntry {
  doc: Y.Doc;
  provider: HocuspocusProvider | null;
  websocket: HocuspocusProviderWebsocket | null;
  refCount: number;
  initialized: boolean;
  waiters: Array<() => void>;
}

/** 模块级 doc 缓存：同一 docName 共享同一 Y.Doc，避免多实例状态分裂 */
const docCache = new Map<string, DocEntry>();

function buildWsUrl(docName: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws-sync/${docName}`;
}

/** 获取（或创建）指定 docName 的同步条目，refCount+1 */
function acquireDoc(docName: string, initialJson: unknown): DocEntry {
  const cached = docCache.get(docName);
  if (cached) {
    cached.refCount += 1;
    try {
      cached.websocket?.connect();
    } catch {
      // 已连接等情况忽略
    }
    return cached;
  }

  const doc = new Y.Doc();
  let idbSynced = false;
  let cloudSynced = !getToken(); // 无 token 时为纯本地模式，视为已同步
  const entry: DocEntry = {
    doc,
    provider: null,
    websocket: null,
    refCount: 1,
    initialized: false,
    waiters: [],
  };
  docCache.set(docName, entry);

  const tryInit = () => {
    if (entry.initialized || !(idbSynced && cloudSynced)) return;
    entry.initialized = true;
    // 本地与服务端均无数据时，用初始 JSON 填充一次
    if (initialJson && doc.getMap().size === 0) {
      doc.transact(() => {
        const map = doc.getMap();
        for (const [key, value] of Object.entries(initialJson as Record<string, unknown>)) {
          map.set(key, value as unknown as Y.AbstractType<unknown>);
        }
      });
    }
    const waiters = entry.waiters;
    entry.waiters = [];
    waiters.forEach((w) => w());
  };

  // 1. 本地 IndexedDB 缓存（环境不支持时降级为直连云端）
  try {
    const indexeddb = new IndexeddbPersistence(docName, doc);
    indexeddb.on('synced', () => {
      idbSynced = true;
      tryInit();
    });
  } catch {
    idbSynced = true;
  }

  // 2. WebSocket 云端同步
  const token = getToken();
  if (token) {
    const websocket = new HocuspocusProviderWebsocket({
      url: buildWsUrl(docName),
      // 断线重连指数退避:500ms 起步,1.6x 指数增长,30s 封顶。
      // 服务器不可用期间避免高频重连轰炸(默认 maxDelay 仅 2.5s)。
      delay: 500,
      factor: 1.6,
      maxDelay: 30_000,
    });
    const provider = new HocuspocusProvider({
      url: buildWsUrl(docName),
      name: docName,
      token,
      document: doc,
      websocketProvider: websocket,
      onSynced: () => {
        cloudSynced = true;
        tryInit();
      },
    });
    // 关键修复：HocuspocusProvider 构造函数中 attach() 被 if (this.manageSocket) 包裹，
    // 当外部传入 websocketProvider 时 manageSocket 为 false，attach 不执行，
    // 导致 onOpen 监听器未注册，sendToken 永远不会触发，onSynced 永远不 fire。
    // 显式调用 attach() 确保事件监听器注册。
    provider.attach();
    entry.provider = provider;
    entry.websocket = websocket;
  }

  return entry;
}

/** refCount-1，归零时断开 WebSocket（保留 IndexedDB 本地缓存） */
function releaseDoc(docName: string): void {
  const entry = docCache.get(docName);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    try {
      entry.websocket?.disconnect();
    } catch {
      // 忽略断开异常
    }
  }
}

export function useDocSync<T>(
  artifactId: string | undefined,
  namespace: DocSyncNamespace,
  initialJson: T | null | undefined,
): DocSyncResult<T> {
  const docName = `${namespace}:${artifactId}`;
  const entryRef = useRef<DocEntry | null>(null);
  const initialJsonRef = useRef(initialJson);
  const lastJsonRef = useRef('');
  /** 本地写入标记：在 transact 前设为 true，syncFromDoc 检测到后跳过 setData，避免 push→hydrate 回环 */
  const localPushRef = useRef(false);

  const [data, setData] = useState<T | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<DocSyncStatus>('loading');

  useEffect(() => {
    if (!artifactId) return;
    const entry = acquireDoc(docName, initialJsonRef.current);
    entryRef.current = entry;
    const doc = entry.doc;

    const syncFromDoc = () => {
      // 本地写入的 update 事件：跳过 setData，由调用方的 hydrate 逻辑决定是否需要回读
      if (localPushRef.current) {
        localPushRef.current = false;
        return;
      }
      const json = doc.getMap().toJSON();
      const serialized = JSON.stringify(json);
      if (serialized === lastJsonRef.current) return;
      lastJsonRef.current = serialized;
      setData(json as T);
    };
    syncFromDoc();
    doc.on('update', syncFromDoc);

    if (entry.initialized) {
      setReady(true);
    } else {
      entry.waiters.push(() => setReady(true));
    }

    const onStatus = (event: { status: string }) => {
      if (event.status === 'connected') setStatus('connected');
      else if (event.status === 'disconnected') setStatus('disconnected');
    };
    entry.provider?.on('status', onStatus);
    if (entry.websocket) {
      onStatus({ status: entry.websocket.status });
    }

    return () => {
      doc.off('update', syncFromDoc);
      entry.provider?.off('status', onStatus);
      releaseDoc(docName);
    };
  }, [docName, artifactId]);

  const update = useCallback((patch: Partial<T>) => {
    const entry = entryRef.current;
    if (!entry) return;
    localPushRef.current = true;
    entry.doc.transact(() => {
      const map = entry.doc.getMap();
      for (const [key, value] of Object.entries(patch)) {
        map.set(key, value as Y.AbstractType<unknown>);
      }
    });
  }, []);

  const replace = useCallback((next: T) => {
    const entry = entryRef.current;
    if (!entry) return;
    entry.doc.transact(() => {
      const map = entry.doc.getMap();
      map.clear();
      for (const [key, value] of Object.entries(next as Record<string, unknown>)) {
        map.set(key, value as Y.AbstractType<unknown>);
      }
    });
  }, []);

  return { data, ready, status, update, replace };
}

// ============================================================================
// useCanvasSync - 画布 graph 的 Yjs 实时同步
//
// docName = `canvas:{canvasId}`，复用与 useDocSync 相同的 doc 缓存与连接机制。
// 顶层 Y.Map 存 { nodes, edges, metadata }（viewport 不入文档，避免高频抖动）。
// - 本地编辑：pushGraph 写入 Y.Doc → Hocuspocus 多端合并 → 后端 onStore 写 DB。
// - 远端编辑：subscribeRemote 监听 → 回调给编辑器 replaceState。
// 不注入 initialJson（画布初始 graph 由 PersistencePlugin 加载，避免二次填充）。
// ============================================================================

export interface CanvasGraphPayload {
  nodes: unknown[];
  edges: unknown[];
  metadata?: Record<string, unknown>;
}

/** Awareness 远端状态 */
export interface AwarenessStateInfo {
  clientId: number;
  state: Record<string, unknown>;
}

export interface CanvasSyncResult {
  /** 本地缓存与云端首次同步是否完成 */
  ready: boolean;
  status: DocSyncStatus;
  /** 将 graph 写入 Y.Doc（nodes/edges/metadata） */
  pushGraph: (graph: CanvasGraphPayload) => void;
  /** 订阅远端 graph 变化（本地 push 不触发回环） */
  subscribeRemote: (cb: (remote: CanvasGraphPayload) => void) => () => void;
  /** 主动读取当前 Y.Doc 中的 graph（无数据返回 null） */
  readRemote: () => CanvasGraphPayload | null;
  /** 设置本地 Awareness 字段（光标/视口/选中状态） */
  setAwarenessField: (key: string, value: unknown) => void;
  /** 订阅远端 Awareness 变化 */
  subscribeAwareness: (cb: (states: AwarenessStateInfo[]) => void) => () => void;
  /** 获取所有远端 Awareness 状态 */
  getAwarenessStates: () => AwarenessStateInfo[];
  /** 获取本地 Awareness clientId */
  getAwarenessClientId: () => number | null;
}

export function useCanvasSync(canvasId: string | undefined): CanvasSyncResult {
  const docName = `canvas:${canvasId}`;
  const entryRef = useRef<DocEntry | null>(null);
  /** 本地写入标记：pushGraph transact 前置 true，远端 update 检测到后跳过，避免 push→hydrate 回环 */
  const localPushRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<DocSyncStatus>('loading');

  useEffect(() => {
    if (!canvasId) return;
    const entry = acquireDoc(docName, null);
    entryRef.current = entry;

    if (entry.initialized) {
      setReady(true);
    } else {
      entry.waiters.push(() => setReady(true));
    }

    const onStatus = (event: { status: string }) => {
      if (event.status === 'connected') setStatus('connected');
      else if (event.status === 'disconnected') setStatus('disconnected');
    };
    entry.provider?.on('status', onStatus);
    if (entry.websocket) {
      onStatus({ status: entry.websocket.status });
    }

    return () => {
      entry.provider?.off('status', onStatus);
      releaseDoc(docName);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docName, canvasId]);

  const pushGraph = useCallback((graph: CanvasGraphPayload) => {
    const entry = entryRef.current;
    if (!entry) return;
    localPushRef.current = true;
    entry.doc.transact(() => {
      const map = entry.doc.getMap();
      map.set('nodes', graph.nodes as unknown as Y.AbstractType<unknown>);
      map.set('edges', graph.edges as unknown as Y.AbstractType<unknown>);
      if (graph.metadata) {
        map.set('metadata', graph.metadata as unknown as Y.AbstractType<unknown>);
      }
    });
  }, []);

  const subscribeRemote = useCallback((cb: (remote: CanvasGraphPayload) => void) => {
    const entry = entryRef.current;
    if (!entry) return () => {};
    const onUpdate = () => {
      if (localPushRef.current) {
        localPushRef.current = false;
        return;
      }
      const json = entry.doc.getMap().toJSON();
      cb({
        nodes: (json.nodes as unknown[]) ?? [],
        edges: (json.edges as unknown[]) ?? [],
        metadata: json.metadata as Record<string, unknown> | undefined,
      });
    };
    entry.doc.on('update', onUpdate);
    return () => entry.doc.off('update', onUpdate);
  }, []);

  const readRemote = useCallback((): CanvasGraphPayload | null => {
    const entry = entryRef.current;
    if (!entry) return null;
    const json = entry.doc.getMap().toJSON();
    if (Object.keys(json).length === 0) return null;
    return {
      nodes: (json.nodes as unknown[]) ?? [],
      edges: (json.edges as unknown[]) ?? [],
      metadata: json.metadata as Record<string, unknown> | undefined,
    };
  }, []);

  const setAwarenessField = useCallback((key: string, value: unknown) => {
    const entry = entryRef.current;
    if (!entry?.provider) return;
    try {
      entry.provider.setAwarenessField(key, value);
    } catch {
      // Awareness 未启用
    }
  }, []);

  const subscribeAwareness = useCallback((cb: (states: AwarenessStateInfo[]) => void) => {
    const entry = entryRef.current;
    if (!entry?.provider) return () => {};

    // 注意: HocuspocusProvider 的 'awarenessUpdate' 事件 states 已由
    // @hocuspocus/common 的 awarenessStatesToArray 平铺展开为 { clientId, ...state },
    // 不能再按 { clientId, state } 嵌套结构解析,否则 cursor-data 永远取不到。
    const handler = ({ states }: { states: Array<{ clientId: number } & Record<string, unknown>> }) => {
      cb(states.map((s) => ({ clientId: s.clientId, state: s })));
    };

    entry.provider.on('awarenessUpdate', handler);

    return () => {
      entry.provider?.off('awarenessUpdate', handler);
    };
  }, []);

  const getAwarenessStates = useCallback((): AwarenessStateInfo[] => {
    const entry = entryRef.current;
    if (!entry?.provider) return [];
    try {
      const states = entry.provider.awareness?.getStates() ?? new Map();
      return Array.from(states, ([, s]) => ({
        clientId: s.clientId,
        state: s.state,
      }));
    } catch {
      return [];
    }
  }, []);

  const getAwarenessClientId = useCallback((): number | null => {
    const entry = entryRef.current;
    if (!entry?.provider?.awareness) return null;
    try {
      return entry.provider.awareness.clientID ?? null;
    } catch {
      return null;
    }
  }, []);

  return useMemo(() => ({
    ready,
    status,
    pushGraph,
    subscribeRemote,
    readRemote,
    setAwarenessField,
    subscribeAwareness,
    getAwarenessStates,
    getAwarenessClientId,
  }), [ready, status, pushGraph, subscribeRemote, readRemote, setAwarenessField, subscribeAwareness, getAwarenessStates, getAwarenessClientId]);
}
