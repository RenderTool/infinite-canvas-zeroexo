/**
 * canvas-tab-store — 画布分层顶部页签状态（Plan#50 / 征集 #97）
 *
 * 设计契约：
 * - 画布是底层（Layer 0），对应固定页签 CANVAS_TAB_KEY，始终第一个、不可关闭。
 * - 资源页签（剧本/分镜/工作台…）的 key = `${kind}:${id}`，**1:1 幂等**：
 *   重复打开同一资源只复用并激活已有页签，绝不新建第二份。
 * - 关闭当前激活页签 → 回退到左侧相邻页签；关闭后无资源页签 → 回到画布页签。
 *
 * 页签只保存「描述」（kind/id/title），不保存编辑器实例：编辑器由 editor-page 按激活页签挂载，
 * 画布区始终挂载（display:none 隐藏），避免 WebGL/canvas 实例与视口丢失（调研结论）。
 */

import { create } from 'zustand';

/** 画布底层页签的固定 key（不可关闭） */
export const CANVAS_TAB_KEY = 'canvas';

/**
 * 资源类型
 * - script 剧本 / storyboard 分镜 / workbench 工作台
 * - plan 制作计划（Plan#51）：幂等 key `plan:<assetId>`，内容层渲染 PlanWorkbench
 */
export type CanvasTabKind = 'script' | 'storyboard' | 'workbench' | 'plan';

export interface CanvasTab {
  key: string;
  kind: CanvasTabKind;
  /** 资源 id（剧本=节点 id） */
  id: string;
  title: string;
}

/** 幂等 key：`kind:id` */
export function buildTabKey(kind: CanvasTabKind, id: string): string {
  return `${kind}:${id}`;
}

export interface CanvasTabState {
  tabs: CanvasTab[];
  activeTabKey: string;
  /**
   * 页签内容层挂载点（Plan#50）：由 editor-page 的页签内容容器注册，
   * 节点组件（如剧本节点）通过 createPortal 把编辑器渲染到这里，
   * 从而数据/回调仍留在节点组件内，无需把编辑器状态上提。
   */
  contentHost: HTMLElement | null;
  setContentHost: (el: HTMLElement | null) => void;
  /** 打开（或复用激活）一个资源页签——幂等 */
  openTab: (input: { kind: CanvasTabKind; id: string; title?: string }) => void;
  /** 激活页签 */
  activateTab: (key: string) => void;
  /** 关闭页签（画布页签不可关闭）；关闭当前激活时回退相邻/画布 */
  closeTab: (key: string) => void;
  /** 资源页签拖拽排序（from→to，仅资源页签参与，画布/计划固定页签不受影响） */
  reorderTabs: (from: number, to: number) => void;
  /** 关闭全部资源页签，回到画布 */
  closeAllTabs: () => void;
}

export const useCanvasTabStore = create<CanvasTabState>((set, get) => ({
  tabs: [],
  activeTabKey: CANVAS_TAB_KEY,
  contentHost: null,
  setContentHost: (el) => set({ contentHost: el }),

  openTab: ({ kind, id, title }) => {
    const key = buildTabKey(kind, id);
    const { tabs } = get();
    const existing = tabs.find((t) => t.key === key);
    if (existing) {
      // 幂等：已存在 → 仅激活（标题可刷新，避免改名后页签文案陈旧）
      set({
        activeTabKey: key,
        tabs: title && title !== existing.title
          ? tabs.map((t) => (t.key === key ? { ...t, title } : t))
          : tabs,
      });
      return;
    }
    set({
      tabs: [...tabs, { key, kind, id, title: title?.trim() || defaultTitle(kind) }],
      activeTabKey: key,
    });
  },

  activateTab: (key) => {
    const { tabs, activeTabKey } = get();
    if (key === CANVAS_TAB_KEY) {
      set({ activeTabKey: key });
      return;
    }
    if (!tabs.some((t) => t.key === key)) return;
    if (activeTabKey === key) return;
    set({ activeTabKey: key });
  },

  closeTab: (key) => {
    if (key === CANVAS_TAB_KEY) return; // 画布页签不可关闭
    const { tabs, activeTabKey } = get();
    const idx = tabs.findIndex((t) => t.key === key);
    if (idx < 0) return;
    const nextTabs = tabs.filter((t) => t.key !== key);
    if (activeTabKey !== key) {
      set({ tabs: nextTabs });
      return;
    }
    // 关闭当前激活：回退到左侧相邻页签，无则回画布
    const fallback = nextTabs[idx - 1]?.key ?? CANVAS_TAB_KEY;
    set({ tabs: nextTabs, activeTabKey: fallback });
  },

  reorderTabs: (from, to) => {
    const { tabs } = get();
    if (from === to || from < 0 || from >= tabs.length || to < 0 || to >= tabs.length) return;
    const next = [...tabs];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    set({ tabs: next });
  },

  closeAllTabs: () => set({ tabs: [], activeTabKey: CANVAS_TAB_KEY }),
}));

function defaultTitle(kind: CanvasTabKind): string {
  if (kind === 'script') return '剧本';
  if (kind === 'storyboard') return '分镜';
  if (kind === 'plan') return '制作计划';
  return '工作台';
}

/** 非 hook 场景（事件总线/命令层）打开页签 */
export function openCanvasTab(input: { kind: CanvasTabKind; id: string; title?: string }): void {
  useCanvasTabStore.getState().openTab(input);
}
