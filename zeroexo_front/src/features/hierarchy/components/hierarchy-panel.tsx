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
import { useTranslation } from 'react-i18next';
import { Select, Tooltip } from 'antd';
import {
  ChevronDown, ChevronRight, FolderOpen, Image as ImageIcon,
  Settings2, Type as TypeIcon, File, FileText, Clapperboard, Film,
  Layers, X, Search, Download, CheckSquare, Square,
  Eye, Lock, Unlock,
} from 'lucide-react';
import JSZip from 'jszip';
import { AssetDetailViewer } from '@/shared/components/index.js';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useHierarchyPanelProps } from '@zeroexo/plugin-group';
import type { GroupPlugin, HierarchyTreeNode } from '@zeroexo/plugin-group';
import type { SceneNode } from '@zeroexo/core';
import type { ThemeConfig } from '@zeroexo/shared';
import { resolveThumbnailUrl, resolveVideoThumbnail } from '@zeroexo/plugin-persistence';
import { buildBackendUrl } from '@zeroexo/plugin-nodes';
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
    case 'video': return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><path d="M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z"/><path d="M7 21h10"/><rect width="20" height="14" x="2" y="3" rx="2"/></svg>;
    case 'audio': return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>;
    case 'generator': return <Settings2 {...cls} />;
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

  useEffect(() => {
    // 无 storageKey(AI 生成未保存): content 通常是 dataURL,直接用
    if (!storageKey) {
      setThumbSrc(content || '');
      return;
    }
    // 后端键: 同步构造 ?size=thumb URL
    const backendUrl = buildBackendUrl(storageKey, 'thumb');
    if (backendUrl) {
      setThumbSrc(backendUrl);
      return;
    }
    // 本地键: 异步解析缩略图
    let cancelled = false;
    const resolver = isVideo ? resolveVideoThumbnail : resolveThumbnailUrl;
    resolver(storageKey)
      .then((url) => { if (!cancelled) setThumbSrc(url || ''); })
      .catch(() => { if (!cancelled) setThumbSrc(''); });
    return () => { cancelled = true; };
  }, [storageKey, content, isVideo]);

  // 视频无缩略图帧时回退到 <video preload="metadata">(仅拉头部)
  const useVideoElement = isVideo && !thumbSrc && !!content;

  return (
    <div
      style={{
        width: 32, height: 32, flexShrink: 0, borderRadius: 4, overflow: 'hidden',
        background: theme.toolbar.border + '33',
      }}
    >
      {useVideoElement ? (
        <AuthorizedVideo
          src={content}
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
      ) : null}
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

  // 资源查看器Modal状态
  const [viewerNode, setViewerNode] = useState<SceneNode | null>(null);

  // 本地类型筛选(不依赖插件 HierarchyFilter.typeFilter 的 'all'|'group'|'node' 限制)
  const [localTypeFilter, setLocalTypeFilter] = useState<'all' | string>('all');

  // 选择模式（类似主页批量选择）
  const [selectMode, setSelectMode] = useState(false);
  const [selectIds, setSelectIds] = useState<Set<string>>(new Set());

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectIds(new Set());
  }, []);

  // 对 props.tree 做本地类型过滤
  const filteredTree = localTypeFilter === 'all'
    ? props.tree
    : props.tree.filter((item) => item.node.type === localTypeFilter);

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
        overflow: 'hidden', backgroundColor: theme.toolbar.panel,
        color: theme.toolbar.text,
        transform: translate3d,
        transition: `transform ${DRAWER_TRANSITION}, box-shadow ${DRAWER_TRANSITION}`,
        boxShadow: expanded ? '0 8px 24px -12px rgba(0,0,0,0.3)' : 'none',
        willChange: 'transform',
      }
    : {
        width: PANEL_WIDTH, height: '100%', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', backgroundColor: theme.toolbar.panel,
        color: theme.toolbar.text,
        transform: translate3d,
        transition: `transform ${DRAWER_TRANSITION}, box-shadow ${DRAWER_TRANSITION}`,
        // 无边框：用方向性柔和投影替代生硬边线，与画布形成层次
        boxShadow: expanded ? '8px 0 24px -14px rgba(0,0,0,0.35)' : 'none',
        willChange: 'transform',
      };
  const headerStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, height: 46, padding: '0 14px',
    flexShrink: 0,
  };
  const titleStyle: CSSProperties = {
    fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, letterSpacing: '0.02em',
    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
  };
  const listStyle: CSSProperties = {
    flex: 1, minHeight: 0, padding: '8px 0',
  };
  const emptyStyle: CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '64px 0', opacity: 0.8,
  };
  // 行内操作按钮(可见性/锁定):默认隐藏,行 hover 时显示;状态激活时常驻
  const actionBtnStyle: CSSProperties = {
    width: 18, height: 18, flexShrink: 0, border: 'none', background: 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', color: 'inherit', padding: 0, borderRadius: 3,
  };

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
    const showThumbnail = (isImage || isVideo) && (!!storageKey || !!contentUrl);

    // 资源查看器不支持的类型:剧本/分镜/空图片/空视频(小眼睛不显示)
    const canViewResource = node.type !== 'script' && node.type !== 'storyboard'
      && !((isImage || isVideo) && !contentUrl);

    // 引导线
    const glInfo = guideLineInfo[index];

    const rowStyle: CSSProperties = {
      display: 'flex', alignItems: 'stretch', gap: 0,
      margin: '2px 8px', padding: 0,
      minHeight: 36, cursor: 'pointer', borderRadius: 6,
      backgroundColor: isSelected ? selectedBg : 'transparent',
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

          {/* 类型缩略图/图标 — 图片/视频用缩略图,其余用图标 */}
          {showThumbnail ? (
            <HierarchyThumbnail
              storageKey={storageKey}
              content={contentUrl}
              isVideo={isVideo}
              theme={theme}
            />
          ) : (
            <span style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

          {/* 资源查看器按钮(点击用Modal查看节点资源); 空组/不支持类型不显示 */}
          {!(isGroup && childrenCount === 0) && canViewResource ? (
            <Tooltip title={t('hierarchy.viewResource')}>
              <button
                type="button"
                className="hierarchy-action"
                onClick={(e) => { e.stopPropagation(); setViewerNode(fullNode ?? node); }}
                style={{ ...actionBtnStyle, opacity: 0 }}
              >
                <Eye size={12} />
              </button>
            </Tooltip>
          ) : <span style={{ width: 18, flexShrink: 0 }} />}
            <Tooltip title={locked ? t('hierarchy.unlock') : t('hierarchy.lock')}>
            <button
              type="button"
              className="hierarchy-action"
              onClick={(e) => { e.stopPropagation(); props.onToggleLock(node.id); }}
              style={{ ...actionBtnStyle, opacity: locked ? 0.5 : 0 }}
            >
              {locked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
            </Tooltip>
        </div>
      </div>
    );
  };

  return (
    <div style={outerStyle}>
      <style>{`.hierarchy-row:hover{background-color:rgba(128,128,128,0.09)}.hierarchy-row:hover .hierarchy-action{opacity:.55!important}.hierarchy-close-btn:hover{opacity:.85!important;background:rgba(128,128,128,0.15)!important}.hierarchy-search:focus-within{box-shadow:0 0 0 1px ${theme.toolbar.accent}55}.hierarchy-icon-btn:hover{background:rgba(128,128,128,0.15)!important;opacity:.9!important}`}</style>
      <div style={innerStyle}>
        {/* 头部(仅桌面端显示) */}
        {!modal && (
          <div style={headerStyle}>
            <Layers size={16} style={{ opacity: 0.6, flexShrink: 0 }} />
            <span style={titleStyle}>{t('hierarchy.title')}</span>
            <span style={{
              flexShrink: 0, fontSize: 10, padding: '1px 7px', borderRadius: 999,
              background: theme.toolbar.border + '55', color: theme.toolbar.textMuted,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {props.tree.length}
            </span>
            {onClose && (
              <Tooltip title={t('hierarchy.close')}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    width: 22, height: 22, flexShrink: 0, border: 'none', background: 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: theme.toolbar.text, opacity: 0.5, padding: 0, borderRadius: 4,
                    transition: 'opacity 0.15s, background 0.15s',
                  }}
                  className="hierarchy-close-btn"
                >
                  <X size={14} />
                </button>
                </Tooltip>
            )}
          </div>
        )}

        {/* 顶部工具栏：搜索 + 类型筛选 + 批量选择（社区惯例：筛选与选择操作置于顶部） */}
        <div style={{
          padding: '6px 10px 10px',
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {/* 搜索框 */}
          <div className="hierarchy-search" style={{
            flex: 1, minWidth: 0,
            display: 'flex', alignItems: 'center', gap: 4,
            borderRadius: 6, padding: '0 8px',
            background: theme.toolbar.border + '38',
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
          {/* 类型筛选 */}
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
              style={listStyle}
              data={filteredTree}
              itemContent={(index, item) => renderItem(item, index)}
              increaseViewportBy={200}
              overscan={5}
            />
          )}
        </div>
      </div>

      {/* 资源查看器Modal */}
      <AssetDetailViewer
        node={viewerNode}
        onClose={() => setViewerNode(null)}
      />
    </div>
  );
}
