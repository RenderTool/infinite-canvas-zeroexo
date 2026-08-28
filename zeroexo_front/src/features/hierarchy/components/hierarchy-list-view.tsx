/**
 * hierarchy-list-view - 画布层级树列表视图（层级分组专属，征集 #87 验收轮十）
 *
 * 从原 HierarchyPanelSidebar 完整恢复的树形列表：
 * - 树形引导线（线性化预计算，O(N) 单遍）
 * - 行组件 memo 化（props 原子化 + RenameContext 隔离重命名输入）
 * - 缩略图：云端 sm 档 / 本地 preview 优先链（Plan#48-T7）+ LRU 缓存（滚动防卡顿）
 * - Virtuoso 虚拟滚动 + 键盘导航（↑↓/Enter）+ 批量选择（全选/ZIP 导出）+ 拖拽改组
 *
 * 视图分工（用户拍板）：层级分组 = 本树形列表（专属）；素材/提示词/剧本 = 网格卡片。
 * 搜索词来自资产库工具栏（与素材分组共用同一搜索框）。
 */

import { useRef, useState, useCallback, useMemo, useEffect, memo, createContext, useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { VirtuosoHandle } from 'react-virtuoso';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from 'antd';
import {
  ChevronDown, ChevronRight, FolderOpen, Image as ImageIcon,
  Settings2, Type as TypeIcon, File, FileText, Aperture, Film,
  Layers, Download, X,
  Lock, Video,
} from 'lucide-react';
import { HIERARCHY_ICONS } from './icons.js';
import JSZip from 'jszip';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { HierarchyTreeNode } from '@zeroexo/plugin-group';
import type { SceneNode } from '@zeroexo/core';
import type { ThemeConfig } from '@zeroexo/shared';
import { resolvePreviewUrl, resolveThumbnailUrl, resolveVideoThumbnail } from '@zeroexo/plugin-persistence';
import { buildBackendUrl, resolveContentUrl } from '@zeroexo/plugin-nodes';
import { AuthorizedImage, AuthorizedVideo } from '@/shared/components/authorized-media.js';
import { useReadOnly } from '@/shared/readonly-context.js';
import { MultiSelectCheckbox } from '@/features/asset-library/components/multi-select-checkbox.js';

// ===== 行数据契约（useHierarchyPanelProps 返回值子集，由面板壳层传入） =====

export interface HierarchyListDataProps {
  tree: HierarchyTreeNode[];
  selectedIds: Set<string>;
  collapsedIds: Set<string>;
  renamingId: string | null;
  renamingValue: string;
  onRenameChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSelect: (id: string, additive: boolean) => void;
  onToggleCollapse: (id: string) => void;
  onStartRename: (id: string) => void;
  onReparent: (nodeId: string, newParentId: string | null) => void;
}

export interface HierarchyListViewProps {
  theme: ThemeConfig;
  store: ReactGraphStore;
  /** useHierarchyPanelProps 返回值（壳层调用，保持响应式订阅） */
  data: HierarchyListDataProps;
  /** 点击节点聚焦画布 */
  onFocusNode?: (nodeId: string) => void;
  /** 搜索关键词（来自资产库工具栏，与素材分组共用） */
  search: string;
  /** 征集 #87 验收轮十三:选择模式由外部驱动(资产库工具栏多选按钮);未提供时回退内部状态 */
  multiSelectEnabled?: boolean;
  onMultiSelectToggle?: () => void;
}

// ===== 类型 → 图标映射（与节点左上角图标一致） =====

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
      const data = node.data as Record<string, unknown> | undefined;
      const cards = (data?.cards as Array<{ sourceType: string }>) ?? [];
      const activeIndex = (data?.activeIndex as number) ?? 0;
      const activeCard = cards[activeIndex];
      if (!activeCard) return <HIERARCHY_ICONS.stack {...cls} />;
      if (activeCard.sourceType === 'video') return <Video {...cls} />;
      if (activeCard.sourceType === 'image') return <ImageIcon {...cls} />;
      if (activeCard.sourceType === 'text') return <TypeIcon {...cls} />;
      return <HIERARCHY_ICONS.stack {...cls} />;
    }
    case 'script': return <FileText {...cls} />;
    case 'storyboard': return <Aperture {...cls} />;
    case 'workbench': return <Film {...cls} />;
    default: return <File {...cls} />;
  }
}

// ===== 缩略图 LRU 缓存（滚动时行挂载/卸载频繁，命中缓存同步恢复避免闪烁与重复解码） =====

const thumbCache = new Map<string, { thumbSrc: string; videoSrc: string }>();
const THUMB_CACHE_LIMIT = 256;

function evictThumb(key: string): void {
  const entry = thumbCache.get(key);
  if (entry) {
    if (entry.thumbSrc.startsWith('blob:')) URL.revokeObjectURL(entry.thumbSrc);
    if (entry.videoSrc.startsWith('blob:')) URL.revokeObjectURL(entry.videoSrc);
  }
  thumbCache.delete(key);
}

function cacheThumb(key: string, entry: { thumbSrc: string; videoSrc: string }): void {
  thumbCache.delete(key); // 更新顺序(近似 LRU)
  thumbCache.set(key, entry);
  if (thumbCache.size > THUMB_CACHE_LIMIT) {
    const oldest = thumbCache.keys().next().value;
    if (oldest !== undefined) evictThumb(oldest);
  }
}

/**
 * 层级列表缩略图 — 仅加载缩略图档，绝不加载原图
 * 云端键：?size=sm（160px）；本地键：preview(256px) 优先 → thumb(48px) 兜底（Plan#48-T7，2x DPR 清晰）
 * 视频：持久化首帧 → <video preload="metadata"> 回退
 */
function HierarchyThumbnail({
  storageKey,
  content,
  isVideo,
  borderColor,
  mutedColor,
}: {
  storageKey?: string;
  content?: string;
  isVideo: boolean;
  borderColor: string;
  mutedColor: string;
}): React.ReactElement {
  const cacheKey0 = storageKey ? `${isVideo ? 'v' : 'i'}|${storageKey}` : '';
  const cached0 = cacheKey0 ? thumbCache.get(cacheKey0) : undefined;
  const [thumbSrc, setThumbSrc] = useState(cached0?.thumbSrc ?? '');
  const [videoSrc, setVideoSrc] = useState(cached0?.videoSrc ?? '');

  useEffect(() => {
    if (!storageKey) {
      setThumbSrc(content || '');
      setVideoSrc(content || '');
      return;
    }
    const cacheKey = `${isVideo ? 'v' : 'i'}|${storageKey}`;
    const cached = thumbCache.get(cacheKey);
    if (cached) {
      setThumbSrc(cached.thumbSrc);
      setVideoSrc(cached.videoSrc);
      return;
    }
    if (isVideo) {
      let cancelled = false;
      (async () => {
        try {
          const persisted = await resolveVideoThumbnail(storageKey);
          if (persisted && !cancelled) {
            setThumbSrc(persisted);
            cacheThumb(cacheKey, { thumbSrc: persisted, videoSrc: '' });
            return;
          }
        } catch { /* 继续 */ }
        const src = await resolveContentUrl(storageKey, content ?? '');
        if (!cancelled) {
          setVideoSrc(src || '');
          cacheThumb(cacheKey, { thumbSrc: '', videoSrc: src || '' });
        }
      })();
      return () => { cancelled = true; };
    }
    const backendUrl = buildBackendUrl(storageKey, 'sm');
    if (backendUrl) {
      setThumbSrc(backendUrl);
      return;
    }
    // 本地键：清晰度回退链（Plan#48-T7：preview 256px 优先 → thumb 48px 兜底 → 图标）
    let cancelled = false;
    (async () => {
      try {
        const preview = await resolvePreviewUrl(storageKey);
        if (preview && !cancelled) {
          setThumbSrc(preview);
          cacheThumb(cacheKey, { thumbSrc: preview, videoSrc: '' });
          return;
        }
      } catch { /* 继续下一级 */ }
      try {
        const persisted = await resolveThumbnailUrl(storageKey);
        if (persisted && !cancelled) {
          setThumbSrc(persisted);
          cacheThumb(cacheKey, { thumbSrc: persisted, videoSrc: '' });
        }
      } catch { /* 兜底图标 */ }
    })();
    return () => { cancelled = true; };
  }, [storageKey, content, isVideo]);

  const useVideoElement = isVideo && !thumbSrc && !!videoSrc;

  return (
    <div
      style={{
        width: 36, height: 36, flexShrink: 0, borderRadius: 4, overflow: 'hidden',
        background: borderColor + '33',
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
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: mutedColor, opacity: 0.6 }}>
          {isVideo ? <Video size={14} /> : <ImageIcon size={14} />}
        </div>
      )}
    </div>
  );
}

// ===== 树形引导线（CSS 实现） =====

const GUIDE_COL_WIDTH = 14;
const LINE_COLOR = 'rgba(128,128,128,0.2)';

function renderGuideLines(info: { continues: boolean[]; isLastChild: boolean }): ReactNode {
  const cols: ReactNode[] = [];
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
      </div>,
    );
  }
  if (info.continues.length > 0) {
    cols.push(
      <div
        key="connector"
        style={{
          width: GUIDE_COL_WIDTH, flexShrink: 0, alignSelf: 'stretch',
          position: 'relative',
        }}
      >
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: '50%', width: 1, background: LINE_COLOR, transform: 'translateX(-50%)' }} />
        {!info.isLastChild && (
          <div style={{ position: 'absolute', left: '50%', top: '50%', bottom: 0, width: 1, background: LINE_COLOR, transform: 'translateX(-50%)' }} />
        )}
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: '50%', height: 1, background: LINE_COLOR }} />
      </div>,
    );
  }
  return <>{cols}</>;
}

// ===== 重命名 context（输入时仅输入框重渲染） =====

interface RenameContextValue {
  value: string;
  onRenameChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}
const RenameContext = createContext<RenameContextValue | null>(null);

function RenameInput({ accent }: { accent: string }): React.ReactElement {
  const ctx = useContext(RenameContext);
  const onRenameChange = ctx?.onRenameChange ?? (() => {});
  const onCommitRename = ctx?.onCommitRename ?? (() => {});
  const onCancelRename = ctx?.onCancelRename ?? (() => {});
  return (
    <input
      autoFocus
      value={ctx?.value ?? ''}
      onChange={(e) => onRenameChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onCommitRename(); }
        else if (e.key === 'Escape') { e.preventDefault(); onCancelRename(); }
      }}
      onBlur={onCommitRename}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        flex: 1, minWidth: 0, fontSize: 12, borderRadius: 4,
        border: `1px solid ${accent}`, background: 'transparent',
        color: 'inherit', padding: '0 4px', outline: 'none',
      }}
    />
  );
}

// ===== 行组件（memo 化，props 原子化） =====

interface HierarchyRowProps {
  node: SceneNode;
  depth: number;
  hasChildren: boolean;
  childrenCount: number;
  guide?: { continues: boolean[]; isLastChild: boolean };
  isSelected: boolean;
  isCollapsed: boolean;
  isRenaming: boolean;
  isFocused: boolean;
  selectMode: boolean;
  inSelectIds: boolean;
  store: ReactGraphStore;
  accent: string;
  selectedBg: string;
  accentSoft: string;
  text: string;
  textMuted: string;
  border: string;
  onSelect: (id: string, additive: boolean) => void;
  onToggleCollapse: (id: string) => void;
  onStartRename: (id: string) => void;
  onReparent: (nodeId: string, newParentId: string | null) => void;
  onFocusNode: (id: string) => void;
  toggleSelectId: (id: string) => void;
  dragIdRef: { current: string | null };
}

const HierarchyRow = memo(function HierarchyRow({
  node, depth, hasChildren, childrenCount, guide,
  isSelected, isCollapsed, isRenaming, isFocused, selectMode, inSelectIds, store,
  accent, selectedBg, accentSoft, text, textMuted, border,
  onSelect, onToggleCollapse, onStartRename, onReparent, onFocusNode, toggleSelectId, dragIdRef,
}: HierarchyRowProps): React.ReactElement {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const hidden = node.hidden ?? false;
  const locked = node.locked ?? false;

  // O(1) 节点索引查找
  const fullNode = store.getNode(node.id);
  const nodeData = fullNode?.data as Record<string, unknown> | undefined;
  const contentUrl = nodeData?.content as string | undefined;
  const storageKey = nodeData?.storageKey as string | undefined;
  const isImage = node.type === 'image';
  const isVideo = node.type === 'video';
  const isStackedMedia = node.type === 'stacked-media';

  // 堆叠节点：从活跃卡片提取缩略图信息
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

  const rowStyle: CSSProperties = {
    display: 'flex', alignItems: 'stretch', gap: 0,
    margin: '2px 8px', padding: 0,
    minHeight: 44, cursor: 'pointer', borderRadius: 6,
    backgroundColor: isSelected ? selectedBg : (isFocused ? accentSoft : 'transparent'),
    color: isSelected ? accent : hidden ? textMuted : text,
    fontWeight: isSelected || node.type === 'group' ? 500 : 400,
    opacity: hidden ? 0.5 : 1,
    fontSize: 12, userSelect: 'none',
    transition: 'background-color 0.12s ease',
    boxShadow: isSelected ? `inset 2px 0 0 ${accent}` : undefined,
  };

  return (
    <div
      className="hierarchy-row"
      data-hierarchy-id={node.id}
      draggable={!isRenaming && !selectMode && !readOnly}
      onDragStart={(e) => {
        if (readOnly) { e.preventDefault(); return; }
        dragIdRef.current = node.id; e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (readOnly || node.type !== 'group') return;
        if (node.type === 'group' && dragIdRef.current && dragIdRef.current !== node.id) {
          e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={(e) => {
        if (readOnly) return;
        if (node.type !== 'group') return;
        e.preventDefault(); e.stopPropagation();
        if (dragIdRef.current && dragIdRef.current !== node.id) {
          onReparent(dragIdRef.current, node.id);
        }
        dragIdRef.current = null;
      }}
      onClick={(e) => {
        if (selectMode) {
          e.stopPropagation();
          toggleSelectId(node.id);
          return;
        }
        onSelect(node.id, e.shiftKey);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => onFocusNode(node.id));
        });
      }}
      onDoubleClick={() => { if (!selectMode && !readOnly) onStartRename(node.id); }}
      style={rowStyle}
    >
      {/* 树形引导线(类似目录结构) */}
      {depth > 0 && guide && renderGuideLines(guide)}

      {/* 内容区域(垂直居中) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        flex: 1, minWidth: 0, padding: '0 6px', alignSelf: 'stretch',
      }}>
        {/* 选择模式复选框（征集 #87 验收轮十九：与素材卡片同款 MultiSelectCheckbox，20×20 圆角4 边框2px + 白勾12） */}
        {selectMode && (
          <span style={{ width: 24, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MultiSelectCheckbox
              inline
              selected={inSelectIds}
              onToggle={() => toggleSelectId(node.id)}
              accentColor={accent}
            />
          </span>
        )}
        {/* 折叠/展开箭头 */}
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.id); }}
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

        {/* 类型缩略图/图标 */}
        {showThumbnail ? (
          <HierarchyThumbnail
            storageKey={isStackedMedia ? stackThumbStorageKey : storageKey}
            content={isStackedMedia ? stackThumbContent : contentUrl}
            isVideo={isStackedMedia ? stackThumbIsVideo : isVideo}
            borderColor={border}
            mutedColor={textMuted}
          />
        ) : (
          <span style={{ width: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {getTypeIcon(node)}
          </span>
        )}

        {/* 标题 / 重命名输入 */}
        {isRenaming ? (
          <RenameInput accent={accent} />
        ) : (
          <span style={{
            flex: 1, minWidth: 0, marginLeft: 4,
            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          }}>
            {node.type === 'group'
              ? (node.title?.trim() ? node.title : t('hierarchy.defaultGroup'))
              : (node.title?.trim()
                  ? node.title
                  : t(`nodeTypes.${node.type.replace('ai.', '')}`, { defaultValue: node.type }))}
          </span>
        )}

        {/* 子节点计数(组且未重命名时) */}
        {node.type === 'group' && !isRenaming && childrenCount > 0 ? (
          <span style={{ flexShrink: 0, fontSize: 10, opacity: 0.4, fontVariantNumeric: 'tabular-nums' }}>
            {childrenCount}
          </span>
        ) : null}

        {/* 锁定状态指示 */}
        {locked && (
          <span style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
            <Lock size={11} />
          </span>
        )}
      </div>
    </div>
  );
});

// ===== 类型筛选选项 =====

function useFilterOptions(): Array<{ value: string; label: string }> {
  const { t } = useTranslation();
  // 征集 #87 验收轮十二:移除「组」筛选项(用户拍板)
  return [
    { value: 'all', label: t('hierarchy.filter.all') },
    { value: 'text', label: t('hierarchy.filter.text') },
    { value: 'image', label: t('hierarchy.filter.image') },
    { value: 'video', label: t('hierarchy.filter.video') },
    { value: 'audio', label: t('hierarchy.filter.audio') },
    { value: 'generator', label: t('hierarchy.filter.generator') },
    { value: 'script', label: t('hierarchy.filter.script') },
    { value: 'storyboard', label: t('hierarchy.filter.storyboard') },
  ];
}

// ===== 主组件 =====

export function HierarchyListView({
  theme, store, data, onFocusNode, search,
  multiSelectEnabled: externalMultiSelect, onMultiSelectToggle,
}: HierarchyListViewProps): React.ReactElement {
  const { t } = useTranslation();
  const dragIdRef = useRef<string | null>(null);

  // 本地类型筛选
  const [localTypeFilter, setLocalTypeFilter] = useState<'all' | string>('all');
  const filterOptions = useFilterOptions();

  // 选择模式(征集 #87 验收轮十三:优先外部驱动,与资产库工具栏多选按钮联动;未提供时回退内部)
  const [internalSelectMode, setInternalSelectMode] = useState(false);
  const [selectIds, setSelectIds] = useState<Set<string>>(new Set());
  const selectMode = externalMultiSelect ?? internalSelectMode;
  const exitSelectMode = useCallback(() => {
    if (externalMultiSelect !== undefined) {
      onMultiSelectToggle?.();
    } else {
      setInternalSelectMode(false);
    }
    setSelectIds(new Set());
  }, [externalMultiSelect, onMultiSelectToggle]);

  // 稳定化回调（避免行 memo 失效）
  const commitRenameRef = useRef(data.onCommitRename);
  commitRenameRef.current = data.onCommitRename;
  const onCommitRenameStable = useCallback(() => { commitRenameRef.current(); }, []);
  const focusNodeRef = useRef(onFocusNode);
  focusNodeRef.current = onFocusNode;
  const onFocusNodeStable = useCallback((id: string) => { focusNodeRef.current?.(id); }, []);

  const renameContextValue = useMemo<RenameContextValue>(() => ({
    value: data.renamingValue,
    onRenameChange: data.onRenameChange,
    onCommitRename: onCommitRenameStable,
    onCancelRename: data.onCancelRename,
  }), [data.renamingValue, data.onRenameChange, onCommitRenameStable, data.onCancelRename]);

  const toggleSelectId = useCallback((id: string) => {
    setSelectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 键盘导航
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [focusIndex, setFocusIndex] = useState(-1);

  // 过滤：类型筛选 + 搜索词（来自资产库工具栏）
  const filteredTree = useMemo(() => {
    let list = data.tree;
    if (localTypeFilter !== 'all') {
      list = list.filter((item) => item.node.type === localTypeFilter);
    }
    const kw = search.trim().toLowerCase();
    if (kw) {
      list = list.filter((item) => {
        const title = item.node.title?.trim();
        if (!title) return false;
        return title.toLowerCase().includes(kw);
      });
    }
    return list;
  }, [data.tree, localTypeFilter, search]);

  useEffect(() => {
    setFocusIndex((prev) => (filteredTree.length === 0 ? -1 : Math.min(prev, filteredTree.length - 1)));
  }, [filteredTree.length]);

  // ↑↓ 导航 / Enter 定位：仅事件源非输入控件时消费
  useEffect(() => {
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
        data.onSelect(item.node.id, false);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => onFocusNode?.(item.node.id));
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filteredTree, focusIndex, data, onFocusNode]);

  // 引导线预计算（线性化：反向单遍，O(N)）
  const guideLineInfo = useMemo(() => {
    const items = filteredTree;
    const n = items.length;
    const result: Array<{ continues: boolean[]; isLastChild: boolean }> = new Array(n);
    const seenDepth = new Set<number>();
    const nextShallower: number[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const depth = items[i]!.depth;
      const ns = depth < nextShallower.length ? nextShallower[depth]! : -1;
      const isLastChild = ns === -1 || items[ns]!.depth < depth;
      const continues: boolean[] = new Array(depth);
      for (let d = 0; d < depth; d++) continues[d] = seenDepth.has(d);
      result[i] = { continues, isLastChild };
      seenDepth.add(depth);
      for (let d = depth; d < nextShallower.length; d++) nextShallower[d] = i;
      for (let d = nextShallower.length; d <= depth; d++) nextShallower.push(i);
    }
    return result;
  }, [filteredTree]);

  // ZIP 下载：收集选中节点资源（组=文件夹，无组=ROOT）
  const handleZipDownload = useCallback(async () => {
    const graph = store.getGraph();
    const targetIds = selectIds.size > 0 ? selectIds : new Set(graph.nodes.map((n) => n.id));
    if (targetIds.size === 0) return;

    const zip = new JSZip();
    const groupMap = new Map<string, SceneNode>();
    const nodeMap = new Map<string, SceneNode>();
    for (const n of graph.nodes) {
      nodeMap.set(n.id, n);
      if (n.type === 'group') groupMap.set(n.id, n);
    }

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
      if (!n || n.type === 'group') continue;
      const folder = getNodePath(n);
      const title = n.title?.trim() || n.id;
      const nd = n.data as Record<string, unknown> | undefined;
      const json = JSON.stringify({ id: n.id, type: n.type, title: n.title, data: n.data }, null, 2);
      zip.file(`${folder}/${title}.json`, json);
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

  const focusedId = focusIndex >= 0 && focusIndex < filteredTree.length
    ? filteredTree[focusIndex]!.node.id
    : undefined;

  const itemContent = useCallback((index: number, item: HierarchyTreeNode) => (
    <HierarchyRow
      key={item.node.id}
      node={item.node}
      depth={item.depth}
      hasChildren={item.hasChildren}
      childrenCount={item.childrenCount}
      guide={guideLineInfo[index]}
      isSelected={data.selectedIds.has(item.node.id)}
      isCollapsed={data.collapsedIds.has(item.node.id)}
      isRenaming={data.renamingId === item.node.id}
      isFocused={item.node.id === focusedId}
      selectMode={selectMode}
      inSelectIds={selectIds.has(item.node.id)}
      store={store}
      accent={theme.toolbar.accent}
      selectedBg={theme.toolbar.accent + '22'}
      accentSoft={theme.toolbar.accent + '12'}
      text={theme.toolbar.text}
      textMuted={theme.toolbar.textMuted}
      border={theme.toolbar.border}
      onSelect={data.onSelect}
      onToggleCollapse={data.onToggleCollapse}
      onStartRename={data.onStartRename}
      onReparent={data.onReparent}
      onFocusNode={onFocusNodeStable}
      toggleSelectId={toggleSelectId}
      dragIdRef={dragIdRef}
    />
  ), [guideLineInfo, data, selectMode, selectIds, focusedId, theme, onFocusNodeStable, toggleSelectId, store]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 征集 #87 验收轮十一/十三:筛选改资产库同款 pill 组;多选按钮已移至资产库工具栏(不再独占一行) */}
      {/* 验收轮二十:行顶部 padding 归零 → 到下划线距离与素材分组一致(分割线 12px);按钮尺寸同素材(24 高/11 字号/0 8px) */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        gap: 4, padding: '0 12px 4px', flexShrink: 0,
      }}>
        {filterOptions.map((o) => {
          const isActive = localTypeFilter === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setLocalTypeFilter(o.value)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                height: 24, padding: '0 8px',
                fontSize: 11, fontWeight: isActive ? 600 : 400,
                borderRadius: 6, cursor: 'pointer',
                border: isActive ? `1px solid ${theme.toolbar.accent}` : '1px solid transparent',
                background: isActive ? theme.toolbar.accent : 'transparent',
                color: isActive ? '#fff' : theme.toolbar.textMuted,
                transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {/* 树形列表（Virtuoso 虚拟滚动） */}
      <div
        style={{ flex: 1, minHeight: 0, padding: '4px 0' }}
        onDragOver={(e) => { if (dragIdRef.current) e.preventDefault(); }}
        onDrop={() => {
          if (dragIdRef.current) {
            data.onReparent(dragIdRef.current, null);
            dragIdRef.current = null;
          }
        }}
      >
        {filteredTree.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '64px 0', opacity: 0.8,
          }}>
            <Layers size={36} style={{ marginBottom: 10, opacity: 0.5 }} />
            <span style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
              {search.trim() ? t('hierarchy.noSearchResults') : t('hierarchy.empty')}
            </span>
          </div>
        ) : (
          <RenameContext.Provider value={renameContextValue}>
            <Virtuoso
              ref={virtuosoRef}
              style={{ height: '100%' }}
              data={filteredTree}
              itemContent={itemContent}
              computeItemKey={(_index, item) => item.node.id}
              increaseViewportBy={200}
              overscan={5}
            />
          </RenameContext.Provider>
        )}
      </div>

      {/* 底部：选择模式 = 资产库同款底部操作栏；常态 = 节点总数徽标 */}
      {selectMode ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', flexShrink: 0, background: 'transparent',
        }}>
          <span style={{ fontSize: 13, color: theme.toolbar.text }}>
            {t('hierarchy.selectedCount', { count: selectIds.size })}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              size="small"
              onClick={() => {
                if (selectIds.size === filteredTree.length) setSelectIds(new Set());
                else setSelectIds(new Set(filteredTree.map((item) => item.node.id)));
              }}
            >
              {selectIds.size === filteredTree.length ? t('hierarchy.deselectAll', { defaultValue: '取消全选' }) : t('hierarchy.selectAll')}
            </Button>
            <Button size="small" type="primary" icon={<Download size={12} />} onClick={handleZipDownload}>
              {t('hierarchy.downloadZip')}
            </Button>
            <Tooltip title={t('common.cancel')}>
              <Button size="small" icon={<X size={14} />} onClick={exitSelectMode} />
            </Tooltip>
          </div>
        </div>
      ) : (
        <div style={{
          height: 28, flexShrink: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'flex-end', padding: '0 12px',
          fontSize: 10, color: theme.toolbar.textMuted,
        }}>
          <span style={{
            fontSize: 10, padding: '1px 7px', borderRadius: 999,
            background: theme.toolbar.border + '55', fontVariantNumeric: 'tabular-nums',
          }}>
            {data.tree.length}
          </span>
        </div>
      )}
    </div>
  );
}
