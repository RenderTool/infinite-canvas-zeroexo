/**
 * InteractionController - 交互控制器
 * 处理: 节点拖拽、视口缩放、视口平移、框选、交互模式状态机
 * 接收原生 DOM 事件,不依赖 React,可在任意框架使用
 *
 * 模式行为矩阵:
 *   select 模式: 直接左键 = 框选/选中节点, Space+左键 = 平移, 中键 = 平移
 *   pan 模式:    直接左键 = 平移, Ctrl+左键 = 框选/选中节点, 中键 = 平移
 *
 * 文件拆分:
 * - types.ts: 公开类型 + 拖拽状态机载体(DragState/NO_DRAG)
 * - helper-lines.ts: 对齐辅助线纯计算
 * - resize-geometry.ts: resize 几何纯计算
 * - cursor-styles.ts: 拖拽光标 CSS 注入
 */

import { MoveNodesCommand, ResizeNodeCommand } from '@zeroexo/core';
import type { CommandQueue } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import {
  NO_DRAG,
  type DragState,
  type InteractionMode,
  type MarqueeController,
  type DragEndHook,
  type ExpandDragIdsHook,
  type DragStartHook,
  type DragMoveHook,
  type InteractionTransient,
  type HelperLine,
  type HelperLinesCallback,
  type ResizeConfigAccessor,
  type ResizeHandleType,
} from './types.js';
import { calculateHelperLines, type HelperLineNode } from './helper-lines.js';
import { computeResizeRect } from './resize-geometry.js';
import { ensureCursorStyles } from './cursor-styles.js';

// 兼容旧导入路径:公开类型从 types.ts 转出
export type {
  InteractionMode,
  MarqueeController,
  DragEndHook,
  ExpandDragIdsHook,
  DragStartHook,
  DragMoveHook,
  InteractionTransient,
  HelperLine,
  HelperLinesCallback,
  ResizeConfig,
  ResizeConfigAccessor,
  ResizeHandleType,
} from './types.js';

export class InteractionController {
  private drag: DragState = { ...NO_DRAG };
  private spacePressed = false;
  /** 交互模式(默认选择模式) */
  private mode: InteractionMode = 'select';
  /** 框选控制器(由 selection 插件注入,可选) */
  private marqueeController: MarqueeController | null = null;
  /** 拖拽结束钩子(由 group 插件注入,可选) */
  private dragEndHook: DragEndHook | null = null;
  /** 拖拽集扩展钩子(由 group 插件注入,可选) */
  private expandDragIdsHook: ExpandDragIdsHook | null = null;
  /** 拖拽开始钩子(由 group 插件注入,用于 Shift+拖拽临时脱离,可选) */
  private dragStartHook: DragStartHook | null = null;
  /** 拖拽移动钩子(由 group 插件注入,用于拖拽中悬停目标判定,可选) */
  private dragMoveHook: DragMoveHook | null = null;
  /** 瞬态状态订阅者(Space/拖拽态变化时通知) */
  private readonly transientListeners = new Set<() => void>();
  /** Resize 配置访问器(由 app 注入,从 extensions 获取) */
  private resizeConfigAccessor: ResizeConfigAccessor | null = null;
  /** 节点锁定访问器(由 app 注入,生成中节点返回 true → 禁止移动/缩放) */
  private nodeLockedAccessor: ((nodeId: string) => boolean) | null = null;

  /** Helper Lines 回调(由 React 层注入,接收对齐线数据) */
  private helperLinesCallback: HelperLinesCallback | null = null;

  /**
   * 容器 rect 缓存(强制重排缓解):
   * screenToWorld 在每次 pointermove(拖拽/框选/悬停)都会用到容器偏移,
   * 拖拽帧又持续写 DOM(transform),若每次都 getBoundingClientRect 会形成
   * 写→读交错的强制重排循环。改为 ResizeObserver 维护缓存,
   * 容器位置/尺寸变化时才重新测量(面板开合/窗口 resize)。
   */
  private cachedContainerRect: { left: number; top: number } | null = null;
  private cachedContainerEl: HTMLElement | null = null;
  private containerResizeObserver: ResizeObserver | null = null;

  private getContainerOffset(): { left: number; top: number } {
    const container = this.getContainer();
    if (!container) return { left: 0, top: 0 };
    // 容器元素更换时重新绑定观察
    if (this.cachedContainerEl !== container) {
      this.containerResizeObserver?.disconnect();
      this.cachedContainerEl = container;
      this.cachedContainerRect = null;
      this.containerResizeObserver = new ResizeObserver(() => {
        this.cachedContainerRect = null;
      });
      this.containerResizeObserver.observe(container);
    }
    if (!this.cachedContainerRect) {
      const rect = container.getBoundingClientRect();
      this.cachedContainerRect = { left: rect.left, top: rect.top };
    }
    return this.cachedContainerRect;
  }

  /** 主动失效缓存(窗口滚动/面板开合等可能改变容器位置的场景可调用) */
  invalidateContainerRect(): void {
    this.cachedContainerRect = null;
  }

  /** 对齐阈值(世界坐标像素) */
  private readonly HELPER_LINE_THRESHOLD = 5;

  constructor(
    private store: ReactGraphStore,
    private commandQueue: CommandQueue,
    private getContainer: () => HTMLElement | null,
  ) {
    ensureCursorStyles();
  }

  // ===== 交互模式状态机 =====

  /** 获取当前交互模式 */
  getMode(): InteractionMode {
    return this.mode;
  }

  /** 设置交互模式 */
  setMode(mode: InteractionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    // 切换到 pan 模式时取消任何进行中的框选
    if (mode === 'pan' && this.marqueeController) {
      this.marqueeController.cancelMarquee();
    }
  }

  // ===== 键盘 =====

  setSpacePressed(pressed: boolean): void {
    this.spacePressed = pressed;
    // Space 临时平移:设置光标属性(在 select 模式下显示 grab 手型)
    const container = this.getContainer();
    if (container) {
      if (pressed) {
        container.setAttribute('data-canvas-space', 'true');
      } else {
        container.removeAttribute('data-canvas-space');
      }
    }
    this.notifyTransient();
  }

  // ===== 瞬态状态订阅(教育提示浮层等 UI 用) =====

  /** 读取瞬态交互状态 */
  getTransient = (): InteractionTransient => ({
    spacePressed: this.spacePressed,
    draggingNode: this.drag.type === 'node',
    marqueeAdditive: this.drag.type === 'marquee' && this.drag.additive,
    marqueeSelecting: this.drag.type === 'marquee',
    resizing: this.drag.type === 'resize',
  });

  /** 订阅瞬态状态变化,返回取消函数 */
  subscribeTransient = (listener: () => void): (() => void) => {
    this.transientListeners.add(listener);
    return () => this.transientListeners.delete(listener);
  };

  private notifyTransient(): void {
    this.transientListeners.forEach((l) => l());
  }

  /** 读取当前节点拖拽的世界偏移(group 插件拖动中平移预览框用),无拖拽时返回 null */
  getDragOffset = (): { dx: number; dy: number } | null => {
    if (this.drag.type !== 'node') return null;
    return { dx: this.drag.lastWorldDx, dy: this.drag.lastWorldDy };
  };

  // ===== 框选控制器注入 =====

  /** 注入框选控制器(由 selection 插件调用) */
  setMarqueeController(controller: MarqueeController | null): void {
    this.marqueeController = controller;
  }

  /** 注入拖拽结束钩子(由 group 插件调用,用于拖拽结束时的组归属判定) */
  setDragEndHook(hook: DragEndHook | null): void {
    this.dragEndHook = hook;
  }

  /** 注入拖拽集扩展钩子(由 group 插件调用,用于 BFS 同步子孙) */
  setExpandDragIdsHook(hook: ExpandDragIdsHook | null): void {
    this.expandDragIdsHook = hook;
  }

  /** 注入拖拽开始钩子(由 group 插件调用,用于 Shift+拖拽临时脱离组 bounds) */
  setDragStartHook(hook: DragStartHook | null): void {
    this.dragStartHook = hook;
  }

  /** 注入拖拽移动钩子(由 group 插件调用,用于拖拽中悬停目标组判定) */
  setDragMoveHook(hook: DragMoveHook | null): void {
    this.dragMoveHook = hook;
  }

  /** 注入 Resize 配置访问器(由 app 调用,从 extensions 获取节点 resize 配置) */
  setResizeConfigAccessor(accessor: ResizeConfigAccessor | null): void {
    this.resizeConfigAccessor = accessor;
  }

  /** 注入节点锁定访问器(由 app 调用,生成中节点返回 true → 禁止移动/缩放) */
  setNodeLockedAccessor(accessor: ((nodeId: string) => boolean) | null): void {
    this.nodeLockedAccessor = accessor;
  }

  /** 设置 Helper Lines 回调(由 React 层注入,用于渲染对齐辅助线) */
  setHelperLinesCallback(callback: HelperLinesCallback | null): void {
    this.helperLinesCallback = callback;
  }

  /** 判断节点是否锁定(生成中不可移动/缩放) */
  isNodeLocked(nodeId: string): boolean {
    return this.nodeLockedAccessor?.(nodeId) ?? false;
  }

  // ===== 指针事件 =====

  /**
   * 判断左键是否应该平移(而非选中/框选)
   * select 模式: Space+左键 = 平移
   * pan 模式: 普通左键 = 平移(Ctrl+左键 = 选中/框选)
   */
  private shouldPanOnLeftClick(event: PointerEvent): boolean {
    if (this.mode === 'pan') return !event.ctrlKey;
    return this.spacePressed;
  }

  /** 画布空白处 pointerdown */
  handleCanvasPointerDown = (event: PointerEvent): void => {
    // 中键 → 平移(任何模式)
    if (event.button === 1) {
      event.preventDefault();
      this.beginPan(event.clientX, event.clientY);
      return;
    }
    if (event.button !== 0) return;

    // 左键: 根据模式判断是平移还是框选
    if (this.shouldPanOnLeftClick(event)) {
      event.preventDefault();
      this.beginPan(event.clientX, event.clientY);
      return;
    }

    // 框选(select 模式普通左键, 或 pan 模式 Ctrl+左键)
    if (this.marqueeController) {
      const world = this.screenToWorld(event.clientX, event.clientY);
      this.marqueeController.beginMarquee(world.x, world.y);
      this.drag = {
        ...NO_DRAG,
        type: 'marquee',
        startClientX: event.clientX,
        startClientY: event.clientY,
        additive: event.shiftKey,
      };
      // 框选开始即通知(普通框选展示加选提示/Shift 追加框选提示均需即时展示)
      this.notifyTransient();
      return;
    }

    // 无框选控制器: 清除选择
    this.store.clearSelection();
  };

  /** 节点 pointerdown */
  handleNodePointerDown = (event: PointerEvent, nodeId: string): void => {
    if (event.button !== 0) return;
    // 清除文本选中范围,避免拖拽节点时浏览器误触发文本拖拽
    window.getSelection()?.removeAllRanges();
    // pan 模式: 普通左键先选中节点,再开始平移(让节点单选/取消与选择模式一致)
    // 选中后拖拽 = 平移画布,纯点击 = 选中节点,胶囊体菜单正常显示
    if (this.shouldPanOnLeftClick(event)) {
      event.stopPropagation();
      // 在 pan 模式下,点击节点时先选中它(与选择模式一致)
      if (this.mode === 'pan') {
        const selection = this.store.getSelection();
        if (!selection.selectedNodeIds.has(nodeId)) {
          this.store.selectNodes([nodeId], false);
        }
      }
      this.beginPan(event.clientX, event.clientY);
      return;
    }
    event.stopPropagation();

    const selection = this.store.getSelection();
    // 如果点击的节点不在选中集中,则选中它
    if (!selection.selectedNodeIds.has(nodeId)) {
      if (event.shiftKey) {
        this.store.selectNodes([nodeId], true);
      } else {
        // 移动端:没有 Shift 键,点击追加选择;桌面端:点击替换选择
        const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        if (isMobile && selection.selectedNodeIds.size > 0) {
          this.store.selectNodes([nodeId], true);
        } else {
          this.store.selectNodes([nodeId], false);
        }
      }
    }

    // 生成中节点锁定:禁止拖拽移动(仍允许选中以查看/取消)
    if (this.isNodeLocked(nodeId)) return;

    // 开始拖拽(选中集的所有节点)
    // 若注入了 expandDragIdsHook(group 插件),扩展拖拽集以包含组子孙(BFS 同步)
    let ids = [...this.store.getSelection().selectedNodeIds];
    if (this.expandDragIdsHook) {
      ids = this.expandDragIdsHook(ids);
    }
    const positions = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const node = this.store.getNode(id);
      if (node) {
        positions.set(id, { ...node.position });
      }
    }

    this.drag = {
      type: 'node',
      nodeIds: ids,
      startPositions: positions,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewportX: 0,
      startViewportY: 0,
      lastWorldDx: 0,
      lastWorldDy: 0,
      hasMoved: false,
      additive: false,
      shiftKey: event.shiftKey,
    };
    // 通知 group 插件拖拽开始(Shift+拖拽时标记临时脱离,组 bounds 实时排除)
    if (this.dragStartHook) {
      this.dragStartHook(ids, event.shiftKey);
    }
    this.notifyTransient();
    // 节点拖拽中也显示 grabbing 光标
    this.setDraggingAttribute('node');
  };

  /** 边 pointerdown */
  handleEdgePointerDown = (event: PointerEvent, edgeId: string): void => {
    if (event.button !== 0) return;
    // pan 模式普通左键 / select 模式 Space+左键 → 平移(不选中边)
    if (this.shouldPanOnLeftClick(event)) {
      event.stopPropagation();
      this.beginPan(event.clientX, event.clientY);
      return;
    }
    event.stopPropagation();
    // 选中边
    this.store.setSelection({
      selectedNodeIds: new Set(),
      selectedEdgeIds: new Set([edgeId]),
    });
  };

  /**
   * 节点 resize handle pointerdown
   * 由 NodeLayer 的 8 角点 handle 触发,开始 resize 拖拽。
   * 通过 ResizeNodeCommand 提交(可合并,连续 mousemove 合并为一条历史)。
   */
  handleResizeHandlePointerDown = (
    event: PointerEvent,
    nodeId: string,
    handle: ResizeHandleType,
  ): void => {
    if (event.button !== 0) return;
    // pan 模式普通左键 / select 模式 Space+左键 → 不启动 resize(让用户先切模式)
    if (this.shouldPanOnLeftClick(event)) return;
    event.stopPropagation();

    // 生成中节点锁定:禁止缩放
    if (this.isNodeLocked(nodeId)) return;

    // 获取 resize 配置(由 app 从 extensions 注入)
    const config = this.resizeConfigAccessor?.(nodeId);
    if (!config || !config.resizable) return;

    // 选中该节点(若未选中)
    const selection = this.store.getSelection();
    if (!selection.selectedNodeIds.has(nodeId)) {
      this.store.selectNodes([nodeId], false);
    }

    const node = this.store.getNode(nodeId);
    if (!node) return;

    // size 解析与 NodeLayer/EdgeLayer 一致:node.size 优先,回退 config.defaultSize
    const size = node.size ?? config.defaultSize ?? { width: 200, height: 100 };
    const startRect = {
      x: node.position.x,
      y: node.position.y,
      width: size.width,
      height: size.height,
    };

    this.drag = {
      type: 'resize',
      nodeIds: [nodeId],
      startPositions: new Map(),
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewportX: 0,
      startViewportY: 0,
      lastWorldDx: 0,
      lastWorldDy: 0,
      hasMoved: false,
      additive: false,
      shiftKey: event.shiftKey,
      resizeNodeId: nodeId,
      resizeHandle: handle,
      resizeStartRect: startRect,
      resizeOldRect: startRect, // 初始 oldRect = 起始状态(合并时保留第一条)
      resizeConfig: config,
    };
  };

  /** pointermove(全局,拖拽中持续触发) */
  handlePointerMove = (event: PointerEvent): void => {
    if (this.drag.type === 'none') return;

    const dx = event.clientX - this.drag.startClientX;
    const dy = event.clientY - this.drag.startClientY;
    if (!this.drag.hasMoved && Math.abs(dx) + Math.abs(dy) < 3) return;
    this.drag.hasMoved = true;

    if (this.drag.type === 'pan') {
      this.store.setViewport({
        ...this.store.getViewport(),
        x: this.drag.startViewportX + dx,
        y: this.drag.startViewportY + dy,
      });
      return;
    }

    if (this.drag.type === 'marquee') {
      const world = this.screenToWorld(event.clientX, event.clientY);
      this.marqueeController?.updateMarquee(world.x, world.y);
      return;
    }

    if (this.drag.type === 'node') {
      // P0-2 瞬态拖拽通道: 拖拽期间不走命令队列、也不重建 graph —— 只把
      // 「拖动集节点 → 世界偏移」写入 store 的偏移表,渲染层(NodeItem/EdgeItem)
      // 经 rAF 订阅直改 DOM transform/path,避免每次 pointermove 全量重建节点树;
      // pointerup 时提交一条 MoveNodesCommand 入历史。
      const k = this.store.getViewport().k;
      const worldDx = dx / k;
      const worldDy = dy / k;
      this.drag.lastWorldDx = worldDx;
      this.drag.lastWorldDy = worldDy;

      if (worldDx !== 0 || worldDy !== 0) {
        const offsets: Map<string, { dx: number; dy: number }> = new Map();
        for (const id of this.drag.nodeIds) {
          offsets.set(id, { dx: worldDx, dy: worldDy });
        }
        this.store.setDragOffsets(offsets);
      }

      // 计算 Helper Lines(对齐辅助线)
      if (this.helperLinesCallback) {
        const lines = this.calculateHelperLines();
        this.helperLinesCallback(lines);
      }

      // 通知 group 插件拖拽移动(实时计算悬停目标组,用于吸附提示)
      if (this.dragMoveHook) {
        this.dragMoveHook(this.drag.nodeIds);
      }
    }

    if (this.drag.type === 'resize') {
      this.handleResizeMove(event);
    }
  };

  /** pointerup(结束拖拽) */
  handlePointerUp = (): void => {
    if (this.drag.type === 'marquee' && this.marqueeController) {
      if (!this.drag.hasMoved) {
        // 点击空白(未移动): 取消框选 + 清除选择(失焦)
        // Shift 追加模式不清除(允许累加选择时误点不丢失已有选择)
        this.marqueeController.cancelMarquee();
        if (!this.drag.additive) {
          this.store.clearSelection();
        }
      } else {
        this.marqueeController.endMarquee(this.drag.additive);
      }
    } else if (this.drag.type === 'node') {
      // P0-2: 先清除瞬态偏移表(DOM 直改归一),再提交批量移动命令入历史
      this.store.setDragOffsets(new Map());
      // P0-1: 拖拽结束,提交一条批量移动命令入历史(幂等:状态已被 silent 更新到终点,
      // execute 仅作为历史记录;undo 一次恢复全部节点起点)
      if (this.drag.hasMoved) {
        const endPositions = new Map<string, { x: number; y: number }>();
        for (const id of this.drag.nodeIds) {
          const start = this.drag.startPositions.get(id);
          if (start) {
            endPositions.set(id, {
              x: start.x + this.drag.lastWorldDx,
              y: start.y + this.drag.lastWorldDy,
            });
          }
        }
        this.commandQueue.execute(
          new MoveNodesCommand(new Map(this.drag.startPositions), endPositions),
        );
      }
      // 节点拖拽结束: 通知 group 插件做组归属判定(自动吸附/脱离/Shift移出)
      // 注意: 即使未移动也通知(纯点击可能用于取消预览,由 controller 自行判断)
      if (this.dragEndHook) {
        this.dragEndHook(this.drag.nodeIds, this.drag.shiftKey, this.drag.hasMoved);
      }
    }
    // 清除拖拽光标标记
    this.setDraggingAttribute(null);
    // 清除 Helper Lines
    this.helperLinesCallback?.([]);
    this.drag = { ...NO_DRAG };
    this.notifyTransient();
  };

  // ===== 滚轮缩放/平移 =====

  /**
   * 滚轮交互:
   * - 普通滚轮: 上下平移画布(类似主流画布 Figma/Excalidraw)
   * - Ctrl/Cmd + 滚轮: 以鼠标位置为中心缩放
   * - Shift + 滚轮: 水平平移画布
   */
  handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const container = this.getContainer();
    if (!container) return;

    const rect = this.getContainerOffset();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const viewport = this.store.getViewport();

    // Ctrl/Cmd + 滚轮: 以鼠标位置为中心缩放
    if (event.ctrlKey || event.metaKey) {
      const delta = -event.deltaY;
      const factor = Math.pow(1.1, delta / 100);
      const newK = Math.min(Math.max(viewport.k * factor, 0.05), 5);

      const worldX = (mouseX - viewport.x) / viewport.k;
      const worldY = (mouseY - viewport.y) / viewport.k;

      this.store.setViewport({
        x: mouseX - worldX * newK,
        y: mouseY - worldY * newK,
        k: newK,
      });
      return;
    }

    // Shift + 滚轮: 水平平移
    if (event.shiftKey) {
      const speed = 1.5;
      this.store.setViewport({
        ...viewport,
        x: viewport.x - event.deltaY * speed,
      });
      return;
    }

    // 普通滚轮: 上下平移
    const speed = 1.5;
    this.store.setViewport({
      ...viewport,
      y: viewport.y - event.deltaY * speed,
    });
  };

  // ===== 内部方法 =====

  private beginPan(clientX: number, clientY: number): void {
    const viewport = this.store.getViewport();
    this.drag = {
      type: 'pan',
      nodeIds: [],
      startPositions: new Map(),
      startClientX: clientX,
      startClientY: clientY,
      startViewportX: viewport.x,
      startViewportY: viewport.y,
      lastWorldDx: 0,
      lastWorldDy: 0,
      hasMoved: false,
      additive: false,
      shiftKey: false,
    };
    // 设置拖拽光标标记(grabbing)
    this.setDraggingAttribute('pan');
  }

  /** 设置/清除拖拽中 data 属性(控制 cursor: grabbing) */
  private setDraggingAttribute(type: 'pan' | 'node' | null): void {
    const container = this.getContainer();
    if (!container) return;
    if (type) {
      container.setAttribute('data-canvas-dragging', type);
    } else {
      container.removeAttribute('data-canvas-dragging');
    }
  }

  /**
   * resize 拖拽中:用纯函数 computeResizeRect 计算 newRect,提交 ResizeNodeCommand。
   * 用绝对值 oldRect/newRect,合并时取第一条 oldRect + 最后一条 newRect。
   */
  private handleResizeMove(event: PointerEvent): void {
    if (
      !this.drag.resizeNodeId ||
      !this.drag.resizeHandle ||
      !this.drag.resizeStartRect ||
      !this.drag.resizeOldRect ||
      !this.drag.resizeConfig
    ) {
      return;
    }

    const k = this.store.getViewport().k;
    const dx = (event.clientX - this.drag.startClientX) / k;
    const dy = (event.clientY - this.drag.startClientY) / k;

    const newRect = computeResizeRect(
      this.drag.resizeStartRect,
      this.drag.resizeHandle,
      this.drag.resizeConfig,
      dx,
      dy,
    );

    // 提交 ResizeNodeCommand(oldRect = 初始状态,合并时保留第一条)
    this.commandQueue.execute(
      new ResizeNodeCommand(this.drag.resizeNodeId, this.drag.resizeOldRect, newRect),
    );
  }

  /**
   * 屏幕坐标 → 世界坐标
   * 关键: clientX/Y 是相对浏览器视口的, viewport.x/y 是相对容器 div 的
   * 必须减去容器偏移(工具栏高度等),否则坐标会偏移
   */
  private screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const vp = this.store.getViewport();
    const rect = this.getContainerOffset();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    return { x: (screenX - vp.x) / vp.k, y: (screenY - vp.y) / vp.k };
  }

  // ===== Helper Lines 计算 =====

  /**
   * 计算拖拽中的对齐辅助线。
   * 使用累积偏移计算拖拽节点当前位置(比读取 graph 更精确,避免命令队列时序问题)。
   */
  private calculateHelperLines(): HelperLine[] {
    const graph = this.store.getGraph();
    const byId = this.store.getNodesById();
    const draggedIds = new Set(this.drag.nodeIds);
    if (draggedIds.size === 0) return [];

    const { startPositions, lastWorldDx, lastWorldDy } = this.drag;
    const getDraggedPos = (id: string): { x: number; y: number } => {
      const start = startPositions.get(id);
      if (!start) {
        const node = byId.get(id);
        return node?.position ?? { x: 0, y: 0 };
      }
      return { x: start.x + lastWorldDx, y: start.y + lastWorldDy };
    };

    const toSnapshot = (id: string, pos: { x: number; y: number }, size?: { width: number; height: number }): HelperLineNode => ({
      id,
      position: pos,
      size: size ?? { width: 200, height: 100 },
    });

    const draggedNodes: HelperLineNode[] = [];
    for (const draggedId of draggedIds) {
      const node = byId.get(draggedId);
      draggedNodes.push(toSnapshot(draggedId, getDraggedPos(draggedId), node?.size));
    }

    const otherNodes: HelperLineNode[] = graph.nodes
      .filter((n) => !draggedIds.has(n.id))
      .map((n) => toSnapshot(n.id, n.position, n.size));

    return calculateHelperLines(draggedNodes, otherNodes, this.HELPER_LINE_THRESHOLD);
  }
}
