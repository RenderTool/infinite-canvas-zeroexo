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
 *
 * 订阅:
 * - store(graph + viewport + selection)
 * - GroupController(预览组状态变化)
 */

import React from 'react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { Rect, SceneNode } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useGraph, useViewport, useSelection } from '@zeroexo/plugin-render-react';
import {
  isGroup,
  isVersionFolder,
  getDepth,
  getGroupBounds,
  getGroupBoundsWithEmptyFallback,
  isVersionFolderStacked,
  getActiveVersionId,
  getVersionFolderData,
  type NodeSizeAccessor,
} from './scene-graph.js';
import { StackedPreview } from './stacked-preview.js';
import type { GroupController } from './controller.js';
import { useGroupDefaults } from './group-defaults.js';
import { GROUP_TITLE_HEIGHT, PREVIEW_GROUP_ID } from './constants.js';
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

/**
 * 订阅 GroupController 预览状态变化。
 * 用 useSyncExternalStore 订阅 controller,当 previewBounds 引用变化时触发重渲染。
 */
function useGroupControllerPreview(controller: GroupController): void {
  const subscribe = React.useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const getSnapshot = React.useCallback(
    () => controller.getPreviewBounds(),
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

  const invK = viewport.k > 0 ? 1 / viewport.k : 1;
  const scene = graph.nodes;

  // 1. 收集所有正式组(type==='group' 且未隐藏),按深度升序排序(父组先,子组后)
  // hidden=true 的组不渲染(从层级面板点击隐藏后,组及其子树在画布中消失)
  const groups = scene.filter((n) => isGroup(n) && !n.hidden);
  groups.sort((a, b) => {
    const da = getDepth(scene, a.id);
    const db = getDepth(scene, b.id);
    if (da !== db) return da - db; // 深度小的先渲染(在下层)
    return (a.siblingOrder ?? 0) - (b.siblingOrder ?? 0);
  });

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

  // 5b. 外部触发重命名(toolbar "重命名"按钮 → externalRenamingGroupId 变化)
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

  // 7. 锚定教育提示数据(拖拽期间 graph 随 MoveNodeCommand 更新驱动重渲染)
  // 场景: 拖无父组节点悬停于组上方 → 目标组"加入组" + 绿色虚线高亮
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
        // 不设容器 zIndex: 容器 transform 建立 stacking context,子 GroupItem 用
        // GROUP_Z_INDEX(-10) 在 NodeItem(0/5/10)之下,确保组可见且组内节点可命中。
        // (之前用 zIndex:-1 会让整层跑到 CanvasView 背景之后导致组不可见)
      }}
    >
      {/* Version Folder stacked preview groups - rendered separately from regular groups */}
      {groups.filter((g) => isVersionFolderStacked(g)).map((g) => {
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
      {groups.filter((g) => !isVersionFolderStacked(g)).map((g) => {
        // 读取 bounds:尊重 dirty 标记和用户自定义 bounds 缓存;
        // Shift+拖拽临时脱离:detachedIds 仅影响 getGroupBounds 重算(实时排除脱离节点);
        // 空组:统一回退为基准图片节点一半尺寸(与胶囊锚点/聚焦一致)
        const detachedIds = controller.getDragDetachedIds();
        const bounds = getGroupBoundsWithEmptyFallback(scene, g.id, getNodeSize, detachedIds ?? undefined)
          ?? { x: g.position.x, y: g.position.y, width: 160, height: 60 };
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
            outlineOffset={g.outlineOffset ?? defaults.outlineOffset}
            opacity={g.opacity ?? defaults.opacity}
            isSelected={isSelected}
            isPreview={false}
            invK={invK}
            isRenaming={isRenaming}
            renameValue={renameValue}
            showVersionFolderFold={isVfGrid}
            onVersionFolderFold={handleVfFold}
            onGroupPointerDown={handleGroupPointerDown}
            onGroupDoubleClick={handleGroupDoubleClick}
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
          outlineOffset={undefined}
          opacity={undefined}
          isSelected={false}
          isPreview={true}
          invK={invK}
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
