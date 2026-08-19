/**
 * HierarchyPanelSidebar - 画布结构(层级)侧边栏
 *
 * 抽屉式动画:外层 width+opacity(控制 flex 占位),内层 translate3d(GPU 加速滑入滑出)
 * - 展开:width 0→280 + translate3d(-280,0,0)→translate3d(0,0,0)(从左侧滑入)
 * - 收起:width 280→0 + translate3d(0,0,0)→translate3d(-280,0,0)(向左侧滑出)
 * - useLayoutEffect + 双 rAF 确保初始 DOM 提交后再触发 transition(React 18 生产模式兼容)
 * - will-change 提示浏览器提前创建 GPU 合成层,translate3d 强制硬件加速
 * - flex 布局固定占位,画布区域 flex-1 自适应
 *
 * 数据/回调来自 useHierarchyPanelProps(group 插件 hook);
 * 渲染样式: stone 暖色 + Lucide 图标 + 32px 行高 + 选中 alpha 态。
 */

import { useRef, useState, useLayoutEffect, useCallback, useMemo, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { VirtuosoHandle } from 'react-virtuoso';
import { useTranslation } from 'react-i18next';
import { Select, Tooltip } from 'antd';
import {
  ChevronDown, ChevronRight, FolderOpen, Image as ImageIcon,
  Settings2, Type as TypeIcon, File, FileText, Clapperboard, Film,
  Layers, X, Search, Download, CheckSquare, Square,
  Lock, Combine, Video,
} from 'lucide-react';
import JSZip from 'jszip';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useHierarchyPanelProps } from '@zeroexo/plugin-group';
import type { GroupPlugin, HierarchyTreeNode } from '@zeroexo/plugin-group';
import type { SceneNode } from '@zeroexo/core';
import type { ThemeConfig } from '@zeroexo/shared';
import { resolveThumbnailUrl, resolveVideoThumbnail } from '@zeroexo/plugin-persistence';
import { buildBackendUrl, resolveAnyThumbUrl, resolveContentUrl } from '@zeroexo/plugin-nodes';
import { AuthorizedImage, AuthorizedVideo } from '@/shared/components/authorized-media.js';

export interface HierarchyPanelSidebarProps {
  closing: boolean;
  store: ReactGraphStore;
  groupPlugin: GroupPlugin;
  theme: ThemeConfig;
  /** 移动端弹窗模式:禁用宽度动画,宽度 100%,无右边框 */
  modal?: boolean;
  /** 关闭按钮回调 */
  onClose?: () => void;
  /** 点击节点时聚焦(使用双击同款 focusOnNode 代码) */
  onFocusNode?: (nodeId: string) => void;
}

const PANEL_WIDTH = 280;
// 抽屉式动画:统一 0.35s cubic-bezier(0.22, 1, 0.36, 1),展开收起同节奏
const DRAWER_TRANSITION = '0.35s cubic-bezier(0.22, 1, 0.36, 1)';

// 类型 → 图标映射(与节点左上角图标一致)
function getTypeIcon(node: SceneNode): ReactNode {
  const cls = { size: 14, style: { opacity: 0.6 } } as const;
  switch (node.type) {
    case 'group': return <FolderOpen {...cls} />;
    case 'image': return <ImageIcon {...cls} />;
    case 'text': return <TypeIcon {...cls} />;
    case 'video': return <Video {...cls} />;
    case 'audio': return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>;
    case 'generator': return <Settings2 {...cls} />;
    case 'stacked-media': {
      // 堆叠节点:显示活跃卡片类型图标(空堆叠回退 Combine 图标)
      const data = node.data as Record<string, unknown> | undefined;
      const cards = (data?.cards as Array<{ sourceType: string }>) ?? [];
      const activeIndex = (data?.activeIndex as number) ?? 0;
      const activeCard = cards[activeIndex];
      if (!activeCard) return <Combine {...cls} />;
      if (activeCard.sourceType === 'video') return <Video {...cls} />;
      if (activeCard.sourceType === 'image') return <ImageIcon {...cls} />;
      if (activeCard.sourceType === 'text') return <TypeIcon {...cls} />;
      return <Combine {...cls} />;
    }
    case 'script': return <FileText {...cls} />;
    case 'storyboard': return <Clapperboard {...cls} />;
    case 'workbench': return <Film {...cls} />;
    default: return <File {...cls} />;
  }
}

/**
 * 层级面板缩略图 — 仅加载缩略图,绝不加载原图
 * 后端键(resources/): 同步构造 ?size=thumb URL
 * 本地键(image:/video:): 异步解析 IndexedDB 缩略图 blob URL
 * 视频无缩略图时回退到 <video preload="metadata">(仅拉头部,不下载全片)
 */
function HierarchyThumbnail({
  storageKey,
  content,
  isVideo,
  theme,
}: {
  storageKey?: string;
  content?: string;
  isVideo: boolean;
  theme: ThemeConfig;
}): React.ReactElement {
  const [thumbSrc, setThumbSrc] = useState('');
  // 重建后的有效内容 URL(刷新后 blob URL 失效场景,video 回退用)
  const [videoSrc, setVideoSrc] = useState('');

  useEffect(() => {
    // 无 storageKey(AI 生成未保存): content 通常是 dataURL,直接用
    if (!storageKey) {
      setThumbSrc(content || '');
      setVideoSrc(content || '');
      return;
    }
    // 视频: 优先 localforage 首帧(video-node-view 上传/播放时经 storeVideoThumbnail 存入);
    // 无首帧时用 resolveContentUrl 重建内容 URL(video preload=metadata 回退显示首帧)
    if (isVideo) {
      let cancelled = false;
      (async () => {
        try {
          const persisted = await resolveVideoThumbnail(storageKey);
          if (persisted && !cancelled) { setThumbSrc(persisted); return; }
        } catch { /* 继续 */ }
        // 无持久化首帧: 重建内容 URL(本地键从 IndexedDB 读,后端键走认证链路)
        const src = await resolveContentUrl(storageKey, content ?? '');
        if (!cancelled) setVideoSrc(src || '');
      })();
      return () => { cancelled = true; };
    }
    // 图片后端键: 同步构造 ?size=thumb URL(sharp 管道生成过该变体)
    const backendUrl = buildBackendUrl(storageKey, 'thumb');
    if (backendUrl) {
      setThumbSrc(backendUrl);
      return;
    }
    // 图片本地键: 缩略图回退链(持久化缩略图 → 后端 thumb 级资源)
    let cancelled = false;
    (async () => {
      try {
        const persisted = await resolveThumbnailUrl(storageKey);
        if (persisted && !cancelled) { setThumbSrc(persisted); return; }
      } catch { /* 继续下一级 */ }
      const thumb = await resolveAnyThumbUrl(storageKey);
      if (!cancelled) setThumbSrc(thumb || '');
    })();
    return () => { cancelled = true; };
  }, [storageKey, content, isVideo]);

  // 视频无缩略图帧时回退到 <video preload="metadata">(仅拉头部,本地键零网络开销)
  const useVideoElement = isVideo && !thumbSrc && !!videoSrc;

  return (
    <div
      style={{
        width: 32, height: 32, flexShrink: 0, borderRadius: 4, overflow: 'hidden',
        background: theme.toolbar.border + '33',
      }}
    >
      {useVideoElement ? (
        <AuthorizedVideo
          src={videoSrc}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          muted
          playsInline
          preload="metadata"
          onError={(e) => { (e.currentTarget as HTMLVideoElement).style.display = 'none'; }}
        />
      ) : thumbSrc ? (
        <AuthorizedImage
          src={thumbSrc}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        // 无缩略图时回退图标(避免空白)
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.toolbar.textMuted, opacity: 0.6 }}>
          {isVideo ? <Video size={14} /> : <ImageIcon size={14} />}
        </div>
      )}
    </div>
  );
}

export function HierarchyPanelSidebar({
  closing, store, groupPlugin, theme, modal, onClose, onFocusNode,
}: HierarchyPanelSidebarProps): React.ReactElement {
  const props = useHierarchyPanelProps(store, groupPlugin.getController());
  const dragIdRef = useRef<string | null>(null);
  const { t } = useTranslation();

  // 展开动画:useLayoutEffect 确保初始 DOM 状态提交后再触发过渡
  // React 18 生产模式下,useEffect 的批处理可能导致双 rAF 不稳定
  // useLayoutEffect 在 paint 前同步执行,配合单次 rAF 即可可靠触发 transition
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    if (closing) { setExpanded(false); return; }
    let rafId: number;
    const id = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => setExpanded(true));
    });
    return () => { cancelAnimationFrame(id); cancelAnimationFrame(rafId); };
  }, [closing]);

  // 本地类型筛选(不依赖插件 HierarchyFilter.typeFilter 的 'all'|'group'|'node' 限制)
  const [localTypeFilter, setLocalTypeFilter] = useState<'all' | string>('all');

  // 选择模式（类似主页批量选择）
  const [selectMode, setSelectMode] = useState(false);
  const [selectIds, setSelectIds] = useState<Set<string>>(new Set());

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectIds(new Set());
  }, []);

  // 键盘导航(底部快捷键栏 ↑↓/Enter/Esc):焦点行索引 + Virtuoso 滚动跟随
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [focusIndex, setFocusIndex] = useState(-1);

  // 对 props.tree 做本地类型过滤
  const filteredTree = localTypeFilter === 'all'
    ? props.tree
    : props.tree.filter((item) => item.node.type === localTypeFilter);

  // 键盘导航:筛选结果变化后钳制/重置焦点索引
  useEffect(() => {
    setFocusIndex((prev) => (filteredTree.length === 0 ? -1 : Math.min(prev, filteredTree.length - 1)));
  }, [filteredTree.length]);

  // ↑↓ 导航 / Enter 定位 / Esc 退出:仅展开且事件源非输入控件时消费(不与重命名/搜索/画布快捷键冲突)
  useEffect(() => {
    if (closing || !expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (filteredTree.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const base = focusIndex < 0 ? 0 : focusIndex;
        const next = e.key === 'ArrowDown'
          ? Math.min(base + 1, filteredTree.length - 1)
          : Math.max(base - 1, 0);
        setFocusIndex(next);
        virtuosoRef.current?.scrollToIndex({ index: next, behavior: 'smooth', align: 'center' });
      } else if (e.key === 'Enter') {
        const item = focusIndex >= 0 ? filteredTree[focusIndex] : undefined;
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        props.onSelect(item.node.id, false);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => onFocusNode?.(item.node.id));
        });
      } else if (e.key === 'Escape') {
        // 选择模式下 Esc 先退出选择,再退出面板
        if (selectMode) { e.preventDefault(); e.stopPropagation(); exitSelectMode(); return; }
        if (onClose) { e.preventDefault(); e.stopPropagation(); onClose(); }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closing, expanded, filteredTree, focusIndex, selectMode, exitSelectMode, onClose, onFocusNode, props]);

  // O-1: 预计算子节点数量(组节点用) — 避免每帧 O(n) filter
  const childrenCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of store.getGraph().nodes) {
      if (node.parentId) {
        map.set(node.parentId, (map.get(node.parentId) ?? 0) + 1);
      }
    }
    return map;
  }, [store.getGraph()]);

  // 引导线配置(每列14px,使用CSS border绘制树形连接线)
  const GUIDE_COL_WIDTH = 14;
  const LINE_COLOR = 'rgba(128,128,128,0.2)';

  // 预计算每个节点的引导线信息(祖先竖线延续 + 是否最后子节点)
  const guideLineInfo = useMemo(() => {
    const items = filteredTree;
    const result: Array<{
      continues: boolean[];
      isLastChild: boolean;
    }> = [];

    for (let i = 0; i < items.length; i++) {
      const depth = items[i]!.depth;
      const continues: boolean[] = new Array(depth).fill(false);

      // 检查每个祖先层级是否有后续兄弟(竖线需要延续)
      for (let d = 0; d < depth; d++) {
        for (let j = i + 1; j < items.length; j++) {
          const sibling = items[j]!;
          if (sibling.depth === d) {
            continues[d] = true;
            break;
          }
          if (sibling.depth < d) break;
        }
      }

      // 检查当前节点是否为该父级的最后一个子节点
      let isLastChild = true;
      for (let j = i + 1; j < items.length; j++) {
        const sibling = items[j]!;
        if (sibling.depth === depth) {
          isLastChild = false;
          break;
        }
        if (sibling.depth < depth) break;
      }

      result.push({ continues, isLastChild });
    }

    return result;
  }, [filteredTree]);

  // 渲染树形引导线(CSS 实现,参照目录结构.html 同款样式)
  function renderGuideLines(info: { continues: boolean[]; isLastChild: boolean }): ReactNode {
    const cols: ReactNode[] = [];

    // 祖先层竖线（仅延续可见）
    for (let i = 0; i < info.continues.length; i++) {
      cols.push(
        <div
          key={`v-${i}`}
          style={{
            width: GUIDE_COL_WIDTH, flexShrink: 0, alignSelf: 'stretch',
            position: 'relative',
          }}
        >
          {info.continues[i] && (
            <div
              style={{
                position: 'absolute', left: '50%', top: 0, bottom: 0,
                width: 1, background: LINE_COLOR,
                transform: 'translateX(-50%)',
              }}
            />
          )}
        </div>
      );
    }

    // 最后连接列（├─ 或 └─）
    if (info.continues.length > 0) {
      cols.push(
        <div
          key="connector"
          style={{
            width: GUIDE_COL_WIDTH, flexShrink: 0, alignSelf: 'stretch',
            position: 'relative',
          }}
        >
          {/* 向上竖线（从行顶到中心） */}
          <div
            style={{
              position: 'absolute', left: '50%', top: 0, bottom: '50%',
              width: 1, background: LINE_COLOR,
              transform: 'translateX(-50%)',
            }}
          />
          {/* 向下竖线（从中心到行底，非最后子节点） */}
          {!info.isLastChild && (
            <div
              style={{
                position: 'absolute', left: '50%', top: '50%', bottom: 0,
                width: 1, background: LINE_COLOR,
                transform: 'translateX(-50%)',
              }}
            />
          )}
          {/* 水平连接线（从中心到右边缘） */}
          <div
            style={{
              position: 'absolute', left: '50%', top: '50%',
              width: '50%', height: 1, background: LINE_COLOR,
            }}
          />
        </div>
      );
    }

    return <>{cols}</>;
  }

  // 类型筛选下拉选项
  const FILTER_OPTIONS = [
    { value: 'all', label: t('hierarchy.filter.all') },
    { value: 'text', label: t('hierarchy.filter.text') },
    { value: 'image', label: t('hierarchy.filter.image') },
    { value: 'video', label: t('hierarchy.filter.video') },
    { value: 'audio', label: t('hierarchy.filter.audio') },
    { value: 'generator', label: t('hierarchy.filter.generator') },
    { value: 'script', label: t('hierarchy.filter.script') },
    { value: 'storyboard', label: t('hierarchy.filter.storyboard') },
    { value: 'group', label: t('hierarchy.filter.group') },
  ];

  // ZIP 下载:收集选中节点资源(组=文件夹,无组=ROOT)
  const handleZipDownload = useCallback(async () => {
    const graph = store.getGraph();
    const targetIds = selectIds.size > 0 ? selectIds : new Set(graph.nodes.map((n) => n.id));
    if (targetIds.size === 0) return;

    const zip = new JSZip();
    // 先收集所有组节点(用于文件夹映射)
    const groupMap = new Map<string, SceneNode>();
    const nodeMap = new Map<string, SceneNode>();
    for (const n of graph.nodes) {
      nodeMap.set(n.id, n);
      if (n.type === 'group') groupMap.set(n.id, n);
    }

    // 递归获取节点在 ZIP 中的路径
    const getNodePath = (n: SceneNode): string => {
      if (n.parentId && groupMap.has(n.parentId)) {
        const parent = groupMap.get(n.parentId)!;
        const parentPath = getNodePath(parent);
        const folderName = parent.title?.trim() || parent.id;
        return `${parentPath}/${folderName}`;
      }
      return 'ROOT';
    };

    for (const nid of targetIds) {
      const n = nodeMap.get(nid);
      if (!n || n.type === 'group') continue; // 跳过组节点本身(组作为文件夹)
      const folder = getNodePath(n);
      const title = n.title?.trim() || n.id;
      // 序列化节点数据
      const data = JSON.stringify({ id: n.id, type: n.type, title: n.title, data: n.data }, null, 2);
      zip.file(`${folder}/${title}.json`, data);
      // 如果有资源内容(blob URL),尝试 fetch 并加入
      const nd = n.data as Record<string, unknown> | undefined;
      const content = nd?.content as string | undefined;
      if (content && (content.startsWith('blob:') || content.startsWith('data:') || content.startsWith('http'))) {
        try {
          const resp = await fetch(content);
          const blob = await resp.blob();
          const ext = blob.type.split('/')[1] || 'bin';
          zip.file(`${folder}/${title}.${ext}`, blob);
        } catch { /* 跳过无法 fetch 的资源 */ }
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nodes-export.zip';
    a.click();
    URL.revokeObjectURL(url);
    exitSelectMode();
  }, [store, selectIds, exitSelectMode]);

  const width = closing ? 0 : expanded ? PANEL_WIDTH : 0;
  const opacity = closing ? 0 : expanded ? 1 : 0;
  // translate3d 触发 GPU 合成层,生产环境动画更流畅
  const translate3d = closing ? `translate3d(${-PANEL_WIDTH}px, 0, 0)` : expanded ? 'translate3d(0, 0, 0)' : `translate3d(${-PANEL_WIDTH}px, 0, 0)`;

  // 选中色 + 20% alpha
  const selectedBg = theme.toolbar.accent + '22';
  const selectedText = theme.toolbar.accent;
  // 快捷键栏键帽样式(footer 三段式提示)
  const keycapStyle: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minWidth: 16, height: 16, padding: '0 4px', borderRadius: 4,
    border: `1px solid ${theme.toolbar.border}`, background: theme.toolbar.panel,
    color: theme.toolbar.text, fontSize: 9, fontWeight: 600, fontFamily: 'inherit',
  };

  // 抽屉式动画:展开收起统一节奏
  // will-change 提示浏览器提前创建 GPU 合成层,避免首帧卡顿
  const outerStyle: CSSProperties = modal
    ? {
        width: '100%', height: '100%',
        opacity: closing ? 0 : (expanded ? 1 : 0),
        pointerEvents: closing || !expanded ? 'none' : 'auto',
        transition: `opacity ${DRAWER_TRANSITION}`,
        willChange: 'opacity',
      }
    : {
        flexShrink: 0, width, opacity, overflow: 'clip',
        pointerEvents: closing || !expanded ? 'none' : undefined,
        transition: `width ${DRAWER_TRANSITION}, opacity ${DRAWER_TRANSITION}`,
        willChange: 'width, opacity',
      };
  const innerStyle: CSSProperties = modal
    ? {
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden', backgroundColor: theme.toolbar.panel,
        color: theme.toolbar.text,
        transform: translate3d,
        transition: `transform ${DRAWER_TRANSITION}, box-shadow ${DRAWER_TRANSITION}`,
        boxShadow: expanded ? '0 8px 24px -12px rgba(0,0,0,0.3)' : 'none',
        willChange: 'transform',
      }
    : {
        width: PANEL_WIDTH, height: '100%', display: 'flex', flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden', backgroundColor: theme.toolbar.panel,
        color: theme.toolbar.text,
        transform: translate3d,
        transition: `transform ${DRAWER_TRANSITION}, box-shadow ${DRAWER_TRANSITION}`,
        // 无边框：用方向性柔和投影替代生硬边线，与画布形成层次
        boxShadow: expanded ? '8px 0 24px -14px rgba(0,0,0,0.35)' : 'none',
        willChange: 'transform',
      };
  const listStyle: CSSProperties = {
    flex: 1, minHeight: 0, padding: '8px 0',
  };
  const emptyStyle: CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '64px 0', opacity: 0.8,
  };

  // 键盘焦点行(高亮 + Virtuoso 跟随目标)
  const focusedId = focusIndex >= 0 && focusIndex < filteredTree.length
    ? filteredTree[focusIndex]!.node.id
    : undefined;

  const renderItem = (item: HierarchyTreeNode, index: number): ReactNode => {
    const { node, depth, hasChildren } = item;
    const isSelected = props.selectedIds.has(node.id);
    const isCollapsed = props.collapsedIds.has(node.id);
    const isRenaming = props.renamingId === node.id;
    const isGroup = node.type === 'group';
    const hidden = node.hidden ?? false;
    const locked = node.locked ?? false;
    // O-1: 使用预计算 childrenCountMap,避免每帧 O(n) filter
    const childrenCount = childrenCountMap.get(node.id) ?? 0;

    // O-1: 使用 P0-2 节点索引 O(1) 查找,替代 O(n) nodes.find()
    const fullNode = store.getNode(node.id);
    const nodeData = fullNode?.data as Record<string, unknown> | undefined;
    const contentUrl = nodeData?.content as string | undefined;
    const storageKey = nodeData?.storageKey as string | undefined;
    const isImage = node.type === 'image';
    const isVideo = node.type === 'video';
    const isStackedMedia = node.type === 'stacked-media';

    // 堆叠节点:从活跃卡片提取缩略图信息
    let stackThumbContent: string | undefined;
    let stackThumbStorageKey: string | undefined;
    let stackThumbIsVideo = false;
    if (isStackedMedia && nodeData) {
      const cards = (nodeData.cards as Array<{ sourceType: string; data?: Record<string, unknown> }>) ?? [];
      const activeIndex = (nodeData.activeIndex as number) ?? 0;
      const activeCard = cards[activeIndex];
      if (activeCard?.data) {
        stackThumbContent = activeCard.data.content as string | undefined;
        stackThumbStorageKey = activeCard.data.storageKey as string | undefined;
        stackThumbIsVideo = activeCard.sourceType === 'video';
      }
    }

    const showThumbnail = (isImage || isVideo) && (!!storageKey || !!contentUrl)
      || (isStackedMedia && (!!stackThumbStorageKey || !!stackThumbContent));

    // 引导线
    const glInfo = guideLineInfo[index];

    const rowStyle: CSSProperties = {
      display: 'flex', alignItems: 'stretch', gap: 0,
      margin: '2px 8px', padding: 0,
      minHeight: 36, cursor: 'pointer', borderRadius: 6,
      backgroundColor: isSelected ? selectedBg : (node.id === focusedId ? theme.toolbar.accent + '12' : 'transparent'),
      color: isSelected ? selectedText : hidden ? theme.toolbar.textMuted : theme.toolbar.text,
      fontWeight: isSelected || isGroup ? 500 : 400,
      opacity: hidden ? 0.5 : 1,
      fontSize: 12, userSelect: 'none',
      transition: 'background-color 0.12s ease',
      boxShadow: isSelected ? `inset 2px 0 0 ${theme.toolbar.accent}` : undefined,
    };

    return (
      <div
        key={node.id}
        className="hierarchy-row"
        data-hierarchy-id={node.id}
        draggable={!isRenaming && !selectMode}
        onDragStart={(e) => { dragIdRef.current = node.id; e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={(e) => {
          if (isGroup && dragIdRef.current && dragIdRef.current !== node.id) {
            e.preventDefault(); e.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={(e) => {
          if (!isGroup) return;
          e.preventDefault(); e.stopPropagation();
          if (dragIdRef.current && dragIdRef.current !== node.id) {
            props.onReparent(dragIdRef.current, node.id);
          }
          dragIdRef.current = null;
        }}
        onClick={(e) => {
          if (selectMode) {
            e.stopPropagation();
            setSelectIds((prev) => {
              const next = new Set(prev);
              if (next.has(node.id)) next.delete(node.id);
              else next.add(node.id);
              return next;
            });
            return;
          }
          props.onSelect(node.id, e.shiftKey);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => onFocusNode?.(node.id));
          });
        }}
        onDoubleClick={() => { if (!selectMode) props.onStartRename(node.id); }}
        style={rowStyle}
      >
        {/* 树形引导线(类似目录结构) */}
        {depth > 0 && glInfo && renderGuideLines(glInfo)}

        {/* 内容区域(垂直居中) */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          flex: 1, minWidth: 0, padding: '0 6px', alignSelf: 'stretch',
        }}>
          {/* 选择模式复选框 */}
          {selectMode && (
            <span style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {selectIds.has(node.id) ? <CheckSquare size={14} color={theme.toolbar.accent} /> : <Square size={14} style={{ opacity: 0.4 }} />}
            </span>
          )}
          {/* 折叠/展开箭头 */}
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); props.onToggleCollapse(node.id); }}
              style={{
                width: 14, height: 14, flexShrink: 0, border: 'none', background: 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', opacity: 0.5, color: 'inherit', padding: 0, borderRadius: 3,
              }}
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}

          {/* 类型缩略图/图标 — 图片/视频/堆叠用缩略图,其余用纯图标(无装饰容器,用户验收反馈保持简洁) */}
          {showThumbnail ? (
            <HierarchyThumbnail
              storageKey={isStackedMedia ? stackThumbStorageKey : storageKey}
              content={isStackedMedia ? stackThumbContent : contentUrl}
              isVideo={isStackedMedia ? stackThumbIsVideo : isVideo}
              theme={theme}
            />
          ) : (
            <span style={{ width: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {getTypeIcon(node)}
            </span>
          )}

          {/* 标题 / 重命名输入 */}
          {isRenaming ? (
            <input
              autoFocus
              value={props.renamingValue}
              onChange={(e) => props.onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); props.onCommitRename(); }
                else if (e.key === 'Escape') { e.preventDefault(); props.onCancelRename(); }
              }}
              onBlur={() => props.onCommitRename()}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              style={{
                flex: 1, minWidth: 0, fontSize: 12, borderRadius: 4,
                border: `1px solid ${theme.toolbar.accent}`, background: 'transparent',
                color: 'inherit', padding: '0 4px', outline: 'none',
              }}
            />
          ) : (
            <span style={{
              flex: 1, minWidth: 0, marginLeft: 4,
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            }}>
              {isGroup
                ? (node.title?.trim() ? node.title : t('hierarchy.defaultGroup'))
                : (node.title?.trim()
                    ? node.title
                    : t(`nodeTypes.${node.type.replace('ai.', '')}`, { defaultValue: node.type }))}
            </span>
          )}

          {/* 子节点计数(组且未重命名时) */}
          {isGroup && !isRenaming && childrenCount > 0 ? (
            <span style={{ flexShrink: 0, fontSize: 10, opacity: 0.4, fontVariantNumeric: 'tabular-nums' }}>
              {childrenCount}
            </span>
          ) : null}

          {/* 锁定状态指示(纯展示不可点;hover 操作按钮已按用户验收要求移除) */}
          {locked && (
            <span style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
              <Lock size={11} />
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={outerStyle}>
      <style>{`.hierarchy-row:hover{background-color:rgba(128,128,128,0.09)}.hierarchy-close-btn:hover{opacity:.85!important;background:rgba(128,128,128,0.15)!important}.hierarchy-search:focus-within{box-shadow:0 0 0 1px ${theme.toolbar.accent}55}.hierarchy-icon-btn:hover{background:rgba(128,128,128,0.15)!important;opacity:.9!important}`}</style>
      <div style={innerStyle}>
        {/* 顶部工具栏：搜索 + 类型筛选 + 批量选择 + 关闭按钮并排（关闭收入流式布局，避免 absolute 浮层遮挡 Select/批量按钮） */}
        <div style={{
          padding: '8px 10px 10px',
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {/* 搜索框 */}
          <div className="hierarchy-search" style={{
            flex: 1, minWidth: 0,
            display: 'flex', alignItems: 'center', gap: 4,
            borderRadius: 6, padding: '0 8px',
            background: 'transparent',
            transition: 'box-shadow 0.15s ease, background 0.15s ease',
          }}>
            <Search size={13} style={{ flexShrink: 0, opacity: 0.4 }} />
            <input
              type="text"
              placeholder={t('hierarchy.searchPlaceholder')}
              value={props.filter.search}
              onChange={(e) => props.onFilterChange({ search: e.target.value })}
              style={{
                flex: 1, minWidth: 0, height: 28, border: 'none', background: 'transparent',
                outline: 'none', color: theme.toolbar.text, fontSize: 12,
              }}
            />
            {props.filter.search && (
              <button
                type="button"
                onClick={() => props.onFilterChange({ search: '' })}
                style={{ width: 16, height: 16, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, opacity: 0.4, color: theme.toolbar.text }}
              >
                <X size={12} />
              </button>
            )}
          </div>
          {/* 类型筛选(borderless Select,与搜索/批量选择并排) */}
          <Select
            value={localTypeFilter}
            onChange={(val) => setLocalTypeFilter(val)}
            options={FILTER_OPTIONS}
            size="small"
            variant="borderless"
            popupMatchSelectWidth={false}
            style={{ width: 64, fontSize: 11, flexShrink: 0 }}
            styles={{ popup: { root: { fontSize: 11, minWidth: 80 } } }}
          />
          {/* 批量选择开关（激活时再点一次退出） */}
          <Tooltip title={t('hierarchy.batchSelect')}>
            <button
              type="button"
              className="hierarchy-icon-btn"
              onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true); }}
              style={{
                width: 24, height: 24, flexShrink: 0, border: 'none',
                background: selectMode ? theme.toolbar.accent + '22' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: selectMode ? theme.toolbar.accent : theme.toolbar.textMuted,
                opacity: selectMode ? 1 : 0.55, padding: 0, borderRadius: 4,
                transition: 'opacity 0.15s, background 0.15s',
              }}
            >
              <CheckSquare size={13} />
            </button>
          </Tooltip>
          {/* 关闭按钮(桌面端；原 header 已删,收入工具行末尾流式占位,不再遮挡任何控件) */}
          {!modal && onClose && (
            <Tooltip title={t('hierarchy.close')}>
              <button
                type="button"
                onClick={onClose}
                className="hierarchy-close-btn"
                style={{
                  width: 22, height: 22, flexShrink: 0, border: 'none', background: 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: theme.toolbar.text, opacity: 0.5, padding: 0, borderRadius: 4,
                  transition: 'opacity 0.15s, background 0.15s',
                }}
              >
                <X size={14} />
              </button>
            </Tooltip>
          )}
        </div>

        {/* 选择模式工具栏 */}
        {selectMode && (
          <div style={{
            margin: '0 10px 6px', padding: '4px 8px', borderRadius: 6,
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
            background: theme.toolbar.accent + '15',
          }}>
            <span style={{ flex: 1, fontSize: 11, color: theme.toolbar.text, fontWeight: 500 }}>
              {t('hierarchy.selectedCount', { count: selectIds.size })}
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectIds(new Set(filteredTree.map((item) => item.node.id)));
              }}
              style={{
                padding: '2px 8px', fontSize: 10, borderRadius: 4, border: 'none',
                cursor: 'pointer', background: theme.toolbar.accent + '33',
                color: theme.toolbar.accent, fontWeight: 500,
              }}
            >
              {t('hierarchy.selectAll')}
            </button>
            <Tooltip title={t('hierarchy.downloadZip')}>
              <button
                type="button"
                onClick={handleZipDownload}
                style={{
                  padding: '2px 10px', fontSize: 10, borderRadius: 4, border: 'none',
                  cursor: 'pointer', background: theme.toolbar.accent,
                  color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <Download size={11} />
                {t('hierarchy.downloadZip')}
              </button>
              </Tooltip>
            <button
              type="button"
              onClick={exitSelectMode}
              style={{
                padding: '2px 8px', fontSize: 10, borderRadius: 4, border: 'none',
                cursor: 'pointer', background: 'transparent',
                color: theme.toolbar.textMuted,
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        )}

        {/* 列表 */}
        <div
          style={listStyle}
          onDragOver={(e) => { if (dragIdRef.current) e.preventDefault(); }}
          onDrop={() => {
            if (dragIdRef.current) {
              props.onReparent(dragIdRef.current, null);
              dragIdRef.current = null;
            }
          }}
        >
          {filteredTree.length === 0 ? (
            <div style={emptyStyle}>
              <Layers size={36} style={{ marginBottom: 10, opacity: 0.5 }} />
              <span style={{ fontSize: 12, color: theme.toolbar.textMuted }}>{props.filter.search ? t('hierarchy.noSearchResults') : t('hierarchy.empty')}</span>
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              style={listStyle}
              data={filteredTree}
              itemContent={(index, item) => renderItem(item, index)}
              increaseViewportBy={200}
              overscan={5}
            />
          )}
        </div>

        {/* 底部快捷键栏(参照卡 card-footer:三段式键帽 + 右侧节点总数徽标,自原 header 迁入) */}
        {!modal && (
          <div style={{
            height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
            padding: '0 10px', background: theme.toolbar.border + '33',
            fontSize: 10, color: theme.toolbar.textMuted,
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <kbd style={keycapStyle}>↑</kbd>
              <kbd style={keycapStyle}>↓</kbd>
              {t('hierarchy.hints.navigate')}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <kbd style={keycapStyle}>Enter</kbd>
              {t('hierarchy.hints.locate')}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <kbd style={keycapStyle}>Esc</kbd>
              {t('hierarchy.hints.quit')}
            </span>
            <span style={{
              marginLeft: 'auto', flexShrink: 0, fontSize: 10, padding: '1px 7px', borderRadius: 999,
              background: theme.toolbar.border + '55', fontVariantNumeric: 'tabular-nums',
            }}>
              {props.tree.length}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
