/**
 * GroupLayer - group 渲染层(容器)
 *
 * 职责:
 * 1. 渲染正式组(深度排序:父组先,子组后,确保内层组可选中)
 * 2. 渲染预览组(虚线框,置于所有组之上,不可拖拽)
 * 3. 版本文件夹叠卡预览(StackedPreview)
 * 4. 画布锚定教育提示(拖入组目标高亮,受全局开关 showHints 控制)
 *
 * 子模块:
 * - components/group-item.tsx: 单组渲染单元
 * - components/group-pin.tsx / group-resize-handle.tsx / hint-capsule.tsx
 * - hooks/use-group-interactions.ts: 组拖拽/resize 交互
 *
 * 渲染变换模式(与 NodeLayer 一致):
 * - 容器 transform: translate(viewport.x, viewport.y) scale(viewport.k)
 * - 子元素用世界坐标(left/top = bounds 值)
 * - T3: 容器每帧写连续 --zx-invk CSS 变量,GroupItem 视觉经 calc(var) 连续跟随
 *
 * 性能设施(对齐节点层):
 * - T1: 订阅 dragOffsets 瞬态直写组 DOM(拖拽期间组实时跟随,不重建 graph)
 * - T3: invK 量化门控(5% 桶)+ CSS 连续化,缩放帧内 GroupItem 零重渲染
 * - T4: 视口遮挡裁剪(视口外组不渲染 DOM)
 * - T5: 组数超阈值时关闭磨砂玻璃背景(合成层上限降级)
 *
 * 订阅:
 * - store(graph + viewport + selection + dragOffsets)
 * - GroupController(预览组状态变化)
 */

import React from 'react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { Rect, SceneNode } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useGraph, useViewport, useSelection, quantizeZoom } from '@zeroexo/plugin-render-react';
import {
  isGroup,
  isVersionFolder,
  getDepth,
  getGroupBounds,
  getGroupBoundsWithEmptyFallback,
  isVersionFolderStacked,
  getActiveVersionId,
  getVersionFolderData,
  getDescendantIds,
  type NodeSizeAccessor,
} from './scene-graph.js';
import { StackedPreview } from './stacked-preview.js';
import type { GroupController } from './controller.js';
import { useGroupDefaults } from './group-defaults.js';
import { GROUP_TITLE_HEIGHT, PREVIEW_GROUP_ID, GROUP_BLUR_LIMIT } from './constants.js';
import { GroupItem } from './components/group-item.js';
import { HintCapsule } from './components/hint-capsule.js';
import { useGroupDrag, useGroupResize } from './hooks/use-group-interactions.js';

export interface GroupLayerProps {
  store: ReactGraphStore;
  controller: GroupController;
  /** 节点尺寸访问器(从 extensions.defaultSize 获取实际渲染尺寸,用于 bounds 计算) */
  getNodeSize?: NodeSizeAccessor;
  /** group pin pointerdown 回调(由 app 注入 connection 控制器) */
  onGroupPinPointerDown?: (
    e: React.PointerEvent,
    pinEl: HTMLElement,
    groupId: string,
    pinId: string,
    direction: 'input' | 'output',
  ) => void;
  /** group pin pointerenter 回调 */
  onGroupPinPointerEnter?: (
    e: React.PointerEvent,
    groupId: string,
    pinId: string,
    direction: 'input' | 'output',
  ) => void;
  /** group pin pointerleave 回调 */
  onGroupPinPointerLeave?: () => void;
  /**
   * 外部触发的重命名组 id(由 toolbar 的"重命名"按钮设置)。
   * 设置时 GroupLayer 进入重命名态(等同双击组标题),自动 focus + select 全文。
   * 完成或取消后通过 onRenameFinish 回调通知外部清除。
   * 预览组不能改名(由外部保证不设置此 prop)。
   */
  externalRenamingGroupId?: string | null;
  /** 重命名完成/取消回调(通知外部清除 externalRenamingGroupId) */
  onRenameFinish?: () => void;
  /** 强制显示所有引脚(连线拖拽期间) */
  forceShowPins?: boolean;
  /** 组双击聚焦回调(替代原重命名,重命名由胶囊工具栏按钮控制) */
  onGroupDoubleClick?: (groupId: string) => void;
  /** 是否显示画布锚定教育提示胶囊(由 app 的全局开关注入,默认 true) */
  showHints?: boolean;
}

/** 遮挡裁剪 overscan 比例(与 node-layer 一致) */
const OVERSCAN_RATIO = 0.2;

/**
 * T1: 计算本次拖拽需要瞬态跟随的组 → 偏移表。
 * 组 bounds 平移不变性仅在「组内全部非组成员都在拖拽集」时成立:
 * - 整体平移(组内全部成员被拖,interaction 写入同一偏移)→ 组框平移该偏移 ✓
 * - 组内移动单个节点(部分成员被拖)→ 包围盒不是简单平移,组框保持原位,
 *   松手后 graph 更新重算 bounds —— 恢复「组内移动节点组框不动」的原有交互特性
 */
function computeFollowGroupOffsets(
  scene: SceneNode[],
  offsets: ReadonlyMap<string, { dx: number; dy: number }>,
): Map<string, { dx: number; dy: number }> {
  const result = new Map<string, { dx: number; dy: number }>();
  const byId = new Map(scene.map((n) => [n.id, n]));
  const dragged = new Set(offsets.keys());
  // 拖拽集全部节点同源同一偏移(interaction 写入同一 worldDx/worldDy),取任意一个即可
  const anyOff = offsets.values().next().value!;
  for (const nodeId of dragged) {
    let cur = byId.get(nodeId);
    while (cur?.parentId) {
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      if (parent.type === 'group' && !result.has(parent.id)) {
        const members = getDescendantIds(scene, parent.id)
          .filter((id) => (byId.get(id)?.type ?? 'group') !== 'group');
        if (members.length > 0 && members.every((mid) => dragged.has(mid))) {
          result.set(parent.id, anyOff);
        }
      }
      cur = parent;
    }
  }
  return result;
}

/**
 * 订阅 GroupController 状态变化。
 * 用 useSyncExternalStore 订阅 controller;快照用版本号而非 previewBounds 引用——
 * P0-2 瞬态拖拽通道下拖拽期间 graph 不更新,若快照只看 previewBounds,
 * 拖拽中 hoverJoinGroupId 的变化(绿色"加入组"提示)将无法驱动重渲染。
 */
function useGroupControllerPreview(controller: GroupController): void {
  const subscribe = React.useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const getSnapshot = React.useCallback(
    () => controller.getVersion(),
    [controller],
  );
  useSyncExternalStore(subscribe, getSnapshot);
}

/** GroupLayer 容器 */
export const GroupLayer = React.memo(function GroupLayer({
  store,
  controller,
  getNodeSize,
  onGroupPinPointerDown,
  onGroupPinPointerEnter,
  onGroupPinPointerLeave,
  externalRenamingGroupId,
  onRenameFinish,
  forceShowPins,
  onGroupDoubleClick,
  showHints = true,
}: GroupLayerProps): React.ReactElement | null {
  const graph = useGraph(store);
  const viewport = useViewport(store);
  const selection = useSelection(store);
  // 订阅 controller(预览组状态)
  useGroupControllerPreview(controller);
  // 读取全局 Group 默认样式(由 EditorPage 通过 GroupDefaultsProvider 从 canvasConfig 注入)
  // 节点级字段优先,undefined 时回退到此 defaults,再 undefined 回退到 GroupItem 内置硬编码
  const defaults = useGroupDefaults();
  const { t } = useTranslation();

  // T3: invK 量化门控(5% 桶,与 edge-layer/node-layer 同源同节奏)——
  // 缩放动画帧内 GroupItem memo 命中不重渲染,视觉连续由容器 --zx-invk 变量承担
  const invK = viewport.k > 0 ? quantizeZoom(1 / viewport.k) : 1;
  const scene = graph.nodes;

  // 容器 ref(直写 + 尺寸测量共用)
  const layerRef = React.useRef<HTMLDivElement | null>(null);

  // T1: 瞬态拖拽期间组实时跟随 —— 订阅 dragOffsets 直写组 DOM(与 drag-offset-writer 同模式)。
  // 节点拖拽走瞬态通道(graph 不更新),组 bounds 基于静态 scene 计算;本直写把偏移叠加到
  // 组容器 transform(不动 left/top),组 bounds 平移不变性保证松手提交命令后无跳变。
  // 仅「组内全部成员被拖」的组跟随(computeFollowGroupOffsets),组内移动单节点不跟随。
  const sceneRef = React.useRef(scene);
  sceneRef.current = scene;
  /** 本次拖拽的跟随组偏移表(null = 未在拖拽中;拖拽开始计算一次,期间复用) */
  const followGroupOffsetsRef = React.useRef<Map<string, { dx: number; dy: number }> | null>(null);
  /**
   * 组 DOM 索引(渲染期构建,直写回调零 DOM 查询——修复拖拽卡顿)。
   * 拖拽期间 GroupLayer 重渲染时 GroupItem 为 memo 命中(DOM 元素引用不变),
   * 索引保持有效;每次渲染后无依赖 useLayoutEffect 重建,保证与当前 DOM 一致。
   * 注意:预览框(虚线"成组"框)不在此索引内 —— 其跟随由 P0-2 既有通道
   * movePreviewSilent(React 渲染 previewBounds)承担,直写再叠加会双重偏移。
   */
  const groupElsRef = React.useRef<Map<string, HTMLElement>>(new Map());
  React.useLayoutEffect(() => {
    const layer = layerRef.current;
    const map = new Map<string, HTMLElement>();
    if (layer) {
      for (let i = 0; i < layer.children.length; i++) {
        const el = layer.children[i] as HTMLElement;
        const id = el.getAttribute('data-canvas-group-id');
        if (id) map.set(id, el);
      }
    }
    groupElsRef.current = map;
  });
  React.useEffect(() => {
    return store.subscribeDragOffsets(() => {
      const offsets = store.getDragOffsets();
      // 拖拽结束(offsets 清空):一次性清空全部组 transform + 复位跟随表
      if (offsets.size === 0) {
        followGroupOffsetsRef.current = null;
        for (const el of groupElsRef.current.values()) el.style.transform = '';
        return;
      }
      // 拖拽开始帧计算跟随组集合(期间 scene/offsets 不变,仅计算一次)
      if (followGroupOffsetsRef.current === null) {
        followGroupOffsetsRef.current = computeFollowGroupOffsets(sceneRef.current, offsets);
      }
      // 直写:仅遍历跟随组(通常 1-2 个),零 DOM 查询
      for (const [gid, off] of followGroupOffsetsRef.current) {
        const el = groupElsRef.current.get(gid);
        if (el) el.style.transform = `translate(${off.dx}px, ${off.dy}px)`;
      }
    });
  }, [store]);

  // 1. 收集所有正式组(type==='group' 且未隐藏) + 预计算 bounds,按深度升序排序(父组先,子组后)
  // hidden=true 的组不渲染(从层级面板点击隐藏后,组及其子树在画布中消失)
  // T4: bounds 预计算依赖 scene/detachedIds 变化,避免 map 内重复子树遍历
  const detachedIds = controller.getDragDetachedIds();
  const groupsWithBounds = React.useMemo(() => {
    const gs = scene.filter((n) => isGroup(n) && !n.hidden);
    gs.sort((a, b) => {
      const da = getDepth(scene, a.id);
      const db = getDepth(scene, b.id);
      if (da !== db) return da - db; // 深度小的先渲染(在下层)
      return (a.siblingOrder ?? 0) - (b.siblingOrder ?? 0);
    });
    return gs.map((g) => ({
      group: g,
      // 尊重 dirty 标记和用户自定义 bounds 缓存;
      // Shift+拖拽临时脱离:detachedIds 仅影响 getGroupBounds 重算(实时排除脱离节点);
      // 空组:统一回退为基准图片节点一半尺寸(与胶囊锚点/聚焦一致)
      bounds: getGroupBoundsWithEmptyFallback(scene, g.id, getNodeSize, detachedIds ?? undefined)
        ?? { x: g.position.x, y: g.position.y, width: 160, height: 60 },
    }));
  }, [scene, getNodeSize, detachedIds]);

  // T4: 视口遮挡裁剪(视口外组不渲染 DOM,与 node-layer 同款可见矩形计算)
  const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 });
  React.useLayoutEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const updateSize = () => {
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
  const canCull = viewport.k > 0 && containerSize.width > 0 && containerSize.height > 0;
  const visibleRect = canCull
    ? {
        left: -viewport.x / viewport.k - (containerSize.width / viewport.k) * OVERSCAN_RATIO,
        top: -viewport.y / viewport.k - (containerSize.height / viewport.k) * OVERSCAN_RATIO,
        right: -viewport.x / viewport.k + (containerSize.width / viewport.k) * (1 + OVERSCAN_RATIO),
        bottom: -viewport.y / viewport.k + (containerSize.height / viewport.k) * (1 + OVERSCAN_RATIO),
      }
    : null;
  // 含被拖/选中节点的组必然与视口相交(被拖节点在视口内,组 bounds ⊇ 节点),culling 安全
  const visibleGroups = visibleRect
    ? groupsWithBounds.filter(({ bounds }) =>
        bounds.x < visibleRect.right &&
        bounds.x + bounds.width > visibleRect.left &&
        bounds.y < visibleRect.bottom &&
        bounds.y + bounds.height > visibleRect.top,
      )
    : groupsWithBounds;

  // T5: 组数超阈值时关闭磨砂玻璃背景(合成层上限降级,对齐边层 GLOW_LIMIT 模式)
  const blurDisabled = groupsWithBounds.length > GROUP_BLUR_LIMIT;

  // 2. 预览组 bounds
  const previewBounds = controller.getPreviewBounds();
  const isPreviewing = controller.isPreviewing();

  // 3. 组重命名状态
  const [renamingGroupId, setRenamingGroupId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');

  // 3c. 版本文件夹网格模式折叠回调(移至组件顶层,避免 map 循环内调用 useCallback)
  const handleVfFold = React.useCallback((groupId: string) => {
    store.updateNodeData(groupId, { previewMode: 'stacked' });
  }, [store]);

  // 4. 组拖拽/resize(独立于 interaction,用 window pointermove/pointerup)
  const handleGroupPointerDown = useGroupDrag(store, controller);
  const handleResizeHandlePointerDown = useGroupResize(store, controller);

  // 5. 组双击聚焦(重命名由胶囊工具栏按钮控制)
  const handleGroupDoubleClick = React.useCallback(
    (e: React.MouseEvent, groupId: string) => {
      e.stopPropagation();
      onGroupDoubleClick?.(groupId);
    },
    [onGroupDoubleClick],
  );

  // 5b. 标题文字双击重命名(与普通节点双击标题行为一致)
  const handleTitleDoubleClick = React.useCallback(
    (groupId: string) => {
      const group = scene.find((n) => n.id === groupId);
      if (!group) return;
      setRenamingGroupId(groupId);
      setRenameValue(group.title ?? '');
    },
    [scene],
  );

  // 5c. 外部触发重命名(toolbar "重命名"按钮 → externalRenamingGroupId 变化)
  // 等效双击:设置 renamingGroupId + renameValue,后续由 GroupItem 的 useEffect 自动 focus+select
  React.useEffect(() => {
    if (!externalRenamingGroupId) return;
    const group = scene.find((n) => n.id === externalRenamingGroupId);
    if (!group) return;
    setRenamingGroupId(externalRenamingGroupId);
    setRenameValue(group.title ?? '');
  }, [externalRenamingGroupId, scene]);

  // 6. 重命名确认/取消(组允许空标题)
  const commitRename = React.useCallback(() => {
    if (renamingGroupId) {
      controller.renameGroup(renamingGroupId, renameValue);
    }
    setRenamingGroupId(null);
    setRenameValue('');
    onRenameFinish?.();
  }, [controller, renamingGroupId, renameValue, onRenameFinish]);

  const cancelRename = React.useCallback(() => {
    setRenamingGroupId(null);
    setRenameValue('');
    onRenameFinish?.();
  }, [onRenameFinish]);

  // 7. 锚定教育提示数据(拖拽期间由 controller 版本快照驱动重渲染)
  // 场景: 拖无父组节点悬停于组上方 → 目标组"加入组" + 绿色虚线高亮
  // P0-2 瞬态拖拽通道:拖拽期间 graph 不更新(只写 dragOffsets 偏移表),
  // 悬停目标判定由 controller.handleDragMove 叠加偏移实时计算并 notify,
  // 本层经 getVersion() 快照感知变化后读取最新目标组并计算高亮 bounds。
  // (Shift+拖拽移出组提示已转为右侧面板常驻条目,选中组内节点即显示)
  const hoverJoinId = controller.getHoverJoinGroupId();
  let hoverJoinBounds: Rect | null = null;
  if (hoverJoinId) {
    const g = scene.find((n) => n.id === hoverJoinId);
    hoverJoinBounds = (g ? getGroupBounds(scene, hoverJoinId, getNodeSize) ?? g.bounds ?? null : null);
  }

  // 8. 渲染
  return (
    <div
      ref={layerRef}
      data-canvas-group-layer
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
        transformOrigin: 'top left',
        pointerEvents: 'none', // 容器不接收事件,子组通过 pointerEvents:auto 接收
        // T3: 连续反缩放变量(GroupItem 视觉经 calc(var(--zx-invk, 1)) 逐帧连续跟随)
        ['--zx-invk' as string]: String(viewport.k > 0 ? 1 / viewport.k : 1),
        // 不设容器 zIndex: 容器 transform 建立 stacking context,子 GroupItem 用
        // GROUP_Z_INDEX(-10) 在 NodeItem(0/5/10)之下,确保组可见且组内节点可命中。
        // (之前用 zIndex:-1 会让整层跑到 CanvasView 背景之后导致组不可见)
      }}
    >
      {/* Version Folder stacked preview groups - rendered separately from regular groups */}
      {visibleGroups.filter(({ group: g }) => isVersionFolderStacked(g)).map(({ group: g }) => {
        const childNodes = (g.childrenIds?.map((cid) => scene.find((n) => n.id === cid)).filter(Boolean) ?? []) as SceneNode[];
        const activeId = getActiveVersionId(g) ?? (childNodes[0]?.id ?? '');
        const isSelected = selection.selectedNodeIds.has(g.id);
        return (
          <StackedPreview
            key={g.id}
            group={g}
            children={childNodes}
            activeVersionId={activeId}
            onSwitchVersion={(newId) => store.updateNodeData(g.id, { activeVersionId: newId })}
            onExpand={() => store.updateNodeData(g.id, { previewMode: 'grid' })}
            invK={invK}
            isSelected={isSelected}
            onGroupPointerDown={handleGroupPointerDown}
            onGroupDoubleClick={handleGroupDoubleClick}
          />
        );
      })}
      {visibleGroups.filter(({ group: g }) => !isVersionFolderStacked(g)).map(({ group: g, bounds }) => {
        // 读取 bounds:尊重 dirty 标记和用户自定义 bounds 缓存;
        // Shift+拖拽临时脱离:detachedIds 仅影响 getGroupBounds 重算(实时排除脱离节点);
        // 空组:统一回退为基准图片节点一半尺寸(与胶囊锚点/聚焦一致)
        const isSelected = selection.selectedNodeIds.has(g.id);
        const isRenaming = renamingGroupId === g.id;
        const isVfGrid = isVersionFolder(g) && getVersionFolderData(g)?.previewMode === 'grid';
        return (
          <GroupItem
            key={g.id}
            groupId={g.id}
            title={g.title ?? ''}
            bounds={bounds}
            childrenCount={g.childrenIds?.length ?? 0}
            backgroundColor={g.backgroundColor ?? defaults.backgroundColor}
            borderRadius={g.borderRadius ?? defaults.borderRadius}
            outlineColor={g.outlineColor ?? defaults.outlineColor}
            outlineWidth={g.outlineWidth ?? defaults.outlineWidth}
            outlineType={defaults.outlineType}
            outlineOffset={g.outlineOffset ?? defaults.outlineOffset}
            opacity={g.opacity ?? defaults.opacity}
            isSelected={isSelected}
            isPreview={false}
            blurDisabled={blurDisabled}
            isRenaming={isRenaming}
            renameValue={renameValue}
            showVersionFolderFold={isVfGrid}
            onVersionFolderFold={handleVfFold}
            onGroupPointerDown={handleGroupPointerDown}
            onGroupDoubleClick={handleGroupDoubleClick}
            onTitleDoubleClick={handleTitleDoubleClick}
            onRenameChange={setRenameValue}
            onRenameCommit={commitRename}
            onRenameCancel={cancelRename}
            onResizeHandlePointerDown={handleResizeHandlePointerDown}
            onGroupPinPointerDown={onGroupPinPointerDown}
            onGroupPinPointerEnter={onGroupPinPointerEnter}
            onGroupPinPointerLeave={onGroupPinPointerLeave}
            forceShowPins={forceShowPins}
          />
        );
      })}
      {isPreviewing && previewBounds ? (
        <GroupItem
          key={PREVIEW_GROUP_ID}
          groupId={PREVIEW_GROUP_ID}
          title="成组"
          bounds={previewBounds}
          childrenCount={0}
          backgroundColor={undefined}
          borderRadius={undefined}
          outlineColor={undefined}
          outlineWidth={undefined}
          outlineType={undefined}
          outlineOffset={undefined}
          opacity={undefined}
          isSelected={false}
          isPreview={true}
          blurDisabled={blurDisabled}
          onGroupPointerDown={handleGroupPointerDown}
        />
      ) : null}
      {/* 锚定教育提示:拖入组目标高亮描边 + "加入组"胶囊(受全局开关控制) */}
      {showHints && hoverJoinBounds ? (
        <>
          <div
            style={{
              position: 'absolute',
              left: hoverJoinBounds.x,
              top: hoverJoinBounds.y,
              width: hoverJoinBounds.width,
              height: hoverJoinBounds.height,
              outline: `${2 * invK}px dashed rgba(34, 197, 94, 0.9)`,
              outlineOffset: 2 * invK,
              borderRadius: 8 * invK,
              pointerEvents: 'none',
              zIndex: 19,
            }}
          />
          <HintCapsule
            x={hoverJoinBounds.x + hoverJoinBounds.width / 2}
            y={hoverJoinBounds.y - (GROUP_TITLE_HEIGHT + 32) * invK}
            invK={invK}
            text={t('hints.dragIntoGroup')}
            accent="rgba(22, 163, 74, 0.95)"
          />
        </>
      ) : null}
    </div>
  );
});
