/**
 * @zeroexo/plugin-group
 * group 层级系统插件 - 严格树形层级 + Scene Graph + 布局单元
 *
 * 沿用源项目设计:
 * - SceneNode 统一类型(Group 与 Node 共用,parentId 唯一层级来源)
 * - 严格树形层级(唯一父约束,严禁循环引用,无限嵌套)
 * - 组 z-index -10,渲染于节点之下
 * - 组尺寸 1.1 倍所选组件合并包围盒
 * - Delete/Backspace 触发删除选中(含组及子节点)
 * - Shift+Delete 解组(仅移除组壳,保留子节点)
 * - 拖入/拖出自动吸附(拖拽结束按鼠标落点判定,非弹窗;Shift+左键拖拽强制移出组)
 * - 移动父组通过 BFS 遍历同步所有子孙组与节点
 *
 * 架构分层:
 * - scene-graph.ts: DFS 工具集(纯函数,基于 NodeRecord[])
 * - group-service.ts: CRUD 服务(7 个 parentId 修改入口严格收口)
 * - constants.ts: 常量定义
 * - controller.ts: GroupController(状态管理 + 拖拽交互)
 * - commands.ts: ReplaceSceneCommand(可撤销的整场景替换命令)
 * - group-layer.tsx: GroupLayer(渲染层,深度排序/z-index/边框缩放/预览组)
 * - hierarchy-panel.tsx: 层级面板(树形 reparent/reorder/rename)— Phase 6.4
 * - layout-unit.ts: 布局单元系统(16 项操作)— Phase 6.3
 *
 * 依赖: render-react, interaction, selection, history
 *
 * install 时接入:
 * - interaction: setDragEndHook(controller.handleDragEnd) — 拖拽结束组归属判定
 * - eventBus: SelectionEvents.CHANGED 订阅 — 选中 ≥2 节点自动生成预览
 *
 * 快捷键(Ctrl+G/Escape/Enter/Delete 解组)不在此自动注册:
 * app 通过 getShortcutEntries() 获取条目,显式注册到 keyboard 插件,
 * 以保证注册顺序(后注册优先)和与标准快捷键(Delete 删除/Escape 清空)的协调。
 */

import type { Plugin, PluginContext, MergeStrategy } from '@zeroexo/core';
import { SelectionEvents, CommandEvents } from '@zeroexo/core';
import type { RenderReactPlugin } from '@zeroexo/plugin-render-react';
import type { InteractionPlugin } from '@zeroexo/plugin-interaction';
import type { ShortcutEntry } from '@zeroexo/plugin-keyboard';
import { GroupController } from './controller.js';
import { MoveGroupCommand, ResizeGroupCommand } from './commands.js';
import { PREVIEW_GROUP_ID } from './constants.js';

// 导出常量
export * from './constants.js';

// 导出 scene-graph 工具集
export * from './scene-graph.js';

// 导出 group-service CRUD
export * from './group-service.js';

// 导出命令
export { ReplaceSceneCommand, MoveGroupCommand, ResizeGroupCommand } from './commands.js';

// 导出控制器
export { GroupController } from './controller.js';

// 导出渲染层
export { GroupLayer } from './group-layer.js';
export type { GroupLayerProps } from './group-layer.js';

// 导出全局 Group 默认样式 Context(与 render-react 的 PinDefaults 对称)
export { GroupDefaultsProvider, useGroupDefaults } from './group-defaults.js';
export type { GroupDefaults } from './group-defaults.js';

// 导出单组渲染单元(供配置面板等静态挂载场景复用真实组渲染链)
export { GroupItem } from './components/group-item.js';
export type { GroupItemProps } from './components/group-item.js';

// 导出层级面板(C 混合解耦:纯展示组件 + hook + 内置过滤算法)
export { HierarchyPanel, useHierarchyPanelProps, DEFAULT_HIERARCHY_FILTER, matchHierarchyFilter, filterSceneNodes } from './hierarchy-panel.js';
export type { HierarchyPanelProps, HierarchyTreeNode, HierarchyFilter } from './hierarchy-panel.js';

/**
 * GroupPlugin - group 层级系统插件
 *
 * install 时:
 * - 从 render-react 获取 ReactGraphStore
 * - 创建 GroupController(注入 store + commandQueue)
 * - 接入 interaction 拖拽结束钩子
 * - 接入 keyboard 键盘前置钩子
 * - 订阅 selection 变化(选中 ≥2 节点自动生成预览)
 *
 * 外部通过 getController() 获取 GroupController,用于:
 * - 渲染层(<GroupLayer store={...} controller={...} />)
 * - 触发预览/确认/解组/重命名
 */
export class GroupPlugin implements Plugin {
  id = 'group';
  dependencies = ['render-react', 'interaction', 'selection', 'history'];

  private controller?: GroupController;
  private unsubs: Array<() => void> = [];

  install(context: PluginContext): void {
    // 1. 获取 store
    const renderReact = context.getPlugin<RenderReactPlugin>('render-react');
    if (!renderReact) {
      throw new Error(
        "[group] dependency 'render-react' not installed before GroupPlugin",
      );
    }
    const store = renderReact.getStore();

    // 2. 创建 GroupController
    this.controller = new GroupController(store, context.commandQueue);

    // 3. 接入 interaction 拖拽结束钩子 + 拖拽集扩展钩子 + 拖拽开始钩子
    const interaction = context.getPlugin<InteractionPlugin>('interaction');
    if (interaction) {
      const ctrl = this.controller;
      interaction.getController().setDragEndHook((nodeIds, shiftKey, hasMoved) => {
        ctrl.handleDragEnd(nodeIds, shiftKey, hasMoved);
      });
      // BFS 扩展:选中集中的组 → 展开为组本身 + 所有子孙(移动父组同步子孙)
      interaction.getController().setExpandDragIdsHook((ids) => {
        return ctrl.expandDragIds(ids);
      });
      // Shift+拖拽开始:标记临时脱离,组 bounds 实时排除被拖拽节点
      interaction.getController().setDragStartHook((nodeIds, shiftKey) => {
        ctrl.handleDragStart(nodeIds, shiftKey);
      });
      // 拖拽移动:实时计算悬停目标组(拖入组吸附提示)
      interaction.getController().setDragMoveHook((nodeIds) => {
        ctrl.handleDragMove(nodeIds);
        // P0-2: 拖动中预览框跟随(整体平移 bounds,不动 graph;pointerup 由 handleDragEnd 校正)
        const off = interaction.getController().getDragOffset();
        if (off) ctrl.movePreviewSilent(off.dx, off.dy);
      });
    }

    // 4. 快捷键不在此自动注册(避免与标准快捷键 Delete/Escape 的注册顺序冲突)。
    //    app 通过 getShortcutEntries() 显式注册到 keyboard 插件,
    //    确保组快捷键在标准快捷键之后注册(逆序优先)。

    // 5. 订阅 selection 变化 — 自动生成/取消预览
    //    (selection < 2 或全在同一组 → cancelPreview;否则 createPreview)
    //    不设 isPreviewing 守卫,确保失焦(空白点击清空 selection)时能取消预览
    const ctrl = this.controller;
    const onSelectionChanged = (): void => {
      const { selectedNodeIds } = store.getSelection();
      // 如果选中了预览组,不触发自动预览/取消(预览组拖拽不应取消预览状态)
      if (selectedNodeIds.has(PREVIEW_GROUP_ID)) return;
      ctrl.createPreview(selectedNodeIds);
    };
    this.unsubs.push(context.eventBus.on(SelectionEvents.CHANGED, onSelectionChanged));

    // 6. 订阅 graph 变化 — 节点移动时刷新预览 bounds;画布清空时取消预览;空组自动清理
    const onGraphChanged = (): void => {
      const graph = store.getGraph();
      if (graph.nodes.length === 0 && ctrl.isPreviewing()) {
        ctrl.cancelPreview();
      } else if (ctrl.isPreviewing()) {
        // 节点移动后预览框跟随刷新
        ctrl.refreshPreview();
      }
      // 空组自动清理:组内最后一个子节点被删除/移出后,组壳随之移除
      // (无空组时不发命令;清理后再次触发时检测为空,不会死循环)
      ctrl.cleanupEmptyGroups();
    };
    this.unsubs.push(context.eventBus.on(CommandEvents.EXECUTED, onGraphChanged));

    // 7. 注册 mergeStrategy — 合并连续的 MoveGroupCommand + ResizeGroupCommand
    //    (同 groupId 的连续 mousemove 合并为一条历史)
    //    使用 addMergeStrategy 追加(不覆盖其他插件注册的策略)
    const groupMerge: MergeStrategy = (prev, next) => {
      // 合并连续 MoveGroupCommand(累积 dx/dy)
      if (
        prev instanceof MoveGroupCommand &&
        next instanceof MoveGroupCommand &&
        prev.groupId === next.groupId
      ) {
        return new MoveGroupCommand(
          prev.groupId,
          prev.dx + next.dx,
          prev.dy + next.dy,
        );
      }
      // 合并连续 ResizeGroupCommand(保留第一条 oldBounds + 最后一条 newBounds)
      if (
        prev instanceof ResizeGroupCommand &&
        next instanceof ResizeGroupCommand &&
        prev.groupId === next.groupId
      ) {
        return new ResizeGroupCommand(prev.groupId, prev.oldBounds, next.newBounds);
      }
      return null;
    };
    context.commandQueue.addMergeStrategy(groupMerge);
  }

  /** 获取 GroupController(install 后可用) */
  getController(): GroupController {
    if (!this.controller) {
      throw new Error('GroupPlugin not installed: call editor.install(plugin) first');
    }
    return this.controller;
  }

  /**
   * 获取组相关快捷键条目(install 后可用)。
   * app 应在注册标准快捷键(copy/paste/delete/escape 等)之后,
   * 调用 keyboard.registerShortcuts(groupPlugin.getShortcutEntries()),
   * 使组快捷键后注册(逆序优先),从而:
   * - 选中组时 Delete/Backspace 触发解组(而非删除节点)
   * - 预览态 Escape 取消预览(而非清空选中)
   *
   * 条目:
   * - Ctrl/Cmd+G:切换预览/确认
   * - Escape:预览态取消预览
   * - Enter:预览态确认
   * - Delete/Backspace:删除选中节点(含组,非预览态)
   * - Shift+Delete/Backspace:解组保留子节点(非预览态)
   */
  getShortcutEntries(): ShortcutEntry[] {
    const ctrl = this.getController();
    return [
      {
        id: 'group:toggle-preview',
        key: 'g',
        ctrlKey: true,
        handler: (e) => {
          // Ctrl+Shift+G 不处理(留给未来扩展,如反向解组)
          if (e.shiftKey) return false;
          e.preventDefault();
          if (ctrl.isPreviewing()) {
            ctrl.confirmPreview();
          } else {
            const selected = ctrl.getSelectedNodeIds();
            if (selected.size >= 2) {
              ctrl.createPreview(selected);
            }
          }
          return true;
        },
      },
      {
        id: 'group:escape-preview',
        key: 'Escape',
        handler: () => {
          if (!ctrl.isPreviewing()) return false;
          ctrl.cancelPreview();
          return true;
        },
      },
      {
        id: 'group:enter-confirm',
        key: 'Enter',
        handler: (e) => {
          if (!ctrl.isPreviewing()) return false;
          e.preventDefault();
          ctrl.confirmPreview();
          return true;
        },
      },
      {
        id: 'group:delete-nodes',
        key: ['Delete', 'Backspace'],
        handler: (e) => {
          if (ctrl.isPreviewing()) return false;
          const selected = ctrl.getSelectedNodeIds();
          if (selected.size === 0) return false;
          e.preventDefault();
          // Delete: 删除选中的所有节点(含组及组内子节点)
          ctrl.deleteNodes(selected);
          return true;
        },
      },
      {
        id: 'group:delete-ungroup',
        key: ['Delete', 'Backspace'],
        shiftKey: true,
        handler: (e) => {
          if (ctrl.isPreviewing()) return false;
          const selected = ctrl.getSelectedNodeIds();
          if (selected.size === 0) return false;
          // Shift+Delete: 解组(仅移除组壳,保留子节点)
          const scene = ctrl.getScene();
          const groupIds = [...selected].filter((id) => {
            const n = scene.find((nn) => nn.id === id);
            return n ? n.type === 'group' : false;
          });
          if (groupIds.length === 0) return false;
          e.preventDefault();
          ctrl.ungroup(groupIds);
          return true;
        },
      },
      {
        id: 'group:create-version-folder',
        key: 'g',
        ctrlKey: true,
        shiftKey: true,
        handler: (e) => {
          e.preventDefault();
          const excluded = ctrl.createVersionFolderFromSelection();
          if (excluded.length > 0) {
            // We'll use console for now, UI toast will be handled by the caller
            console.log(`已收纳 3 个分镜节点，${excluded.length} 个节点不匹配类型已排除`);
          }
          return true;
        },
      },
    ];
  }

  activate(): void {
    // 暂无激活逻辑(钩子在 install 时已注入)
  }

  deactivate(): void {
    // 暂无停用逻辑
  }

  uninstall(context: PluginContext): void {
    // 清理 interaction 钩子注入
    const interaction = context.getPlugin<InteractionPlugin>('interaction');
    if (interaction) {
      interaction.getController().setDragEndHook(null);
      interaction.getController().setExpandDragIdsHook(null);
      interaction.getController().setDragStartHook(null);
    }
    // 快捷键由 app 注册(app 持有 cleanup),此处无需清理
    // 清理事件订阅
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.controller = undefined;
  }
}
