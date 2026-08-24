/**
 * 教育提示条目注册表(情境化快捷键面板 Contextual Controls)
 *
 * 参考游戏 Contextual Controls / Controls Overlay:按当前编辑器上下文
 * 动态展示可用操作提示,全部常驻于右侧面板(随上下文显隐,不做一次性弹窗)。
 *
 * 条目类型:
 * - panel: 屏幕右侧固定键帽面板(由 ContextualShortcutsPanel 渲染)
 * - anchor: 画布世界坐标锚定小胶囊(由 GroupLayer 渲染,拖拽实时反馈)
 *
 * 原则:
 * - 每条提示对应的操作必须真实存在(快捷键注册于 preset/group 插件)
 * - 键帽优先引用键盘插件注册表(shortcutId),由注册表派生,不再手写副本;
 *   手势类(无注册条目)才保留手写 keys
 * - 文案极简(键帽/鼠标图标已表达操作方式,文案只说结果),降低用户思考成本
 * - 显示条件由 ContextualShortcutsPanel 统一派生(集中管理上下文)
 */

export type HintKind = 'panel' | 'anchor';

/** 鼠标手势图标类型(panel 型渲染为鼠标示意图) */
export type MouseGesture = 'dblclick' | 'drag' | 'wheel';

export interface HintEntry {
  id: string;
  kind: HintKind;
  /** i18n key(hints.* 命名空间) */
  labelKey: string;
  /** 键帽列表(panel 型渲染为按键样式;为空则仅显示文案,anchor 型忽略) */
  keys?: string[];
  /** 引用键盘插件注册表条目 id(键帽由注册表派生,与 keys 二选一;支持多条并集) */
  shortcutId?: string | string[];
  /** 鼠标手势图标(与键帽可并存,如 Shift+拖拽) */
  gesture?: MouseGesture;
  /** 图标语义键(由消费面板模块内 Map 解析,见 shared/hints/icons.ts) */
  iconKey?: string;
  /** 排序权重(数值小者靠前) */
  priority?: number;
}

/** 全部内置提示条目(新增场景只需在此加条目 + 在面板派生中加条件) */
export const HINT_ENTRIES: readonly HintEntry[] = [
  // ===== panel 型:情境化快捷键列表(右侧常驻面板) =====
  // 预览组态:Enter 确认成组 / Esc 取消(选中多节点默认自动预览,无独立"预览成组"概念)
  // 只显示推荐键 Enter(预览确认主键);Ctrl+G 同效但不展示(用户拍板:避免"或"关系信息过载)
  { id: 'preview-confirm', kind: 'panel', labelKey: 'hints.previewConfirm', shortcutId: 'group:enter-confirm', priority: 10 },
  { id: 'preview-cancel', kind: 'panel', labelKey: 'hints.previewCancel', shortcutId: 'group:escape-preview', priority: 11 },
  // 单选节点或组:双击聚焦(操作真实存在:onNodeDoubleClick / onGroupDoubleClick)
  // 例外:text 节点双击=编辑内容,由专属条目替代展示
  { id: 'dblclick-focus', kind: 'panel', labelKey: 'hints.dblclickFocus', gesture: 'dblclick', priority: 14 },
  // 单选文本节点:双击进入编辑(复用既有 nodes.doubleClickToEdit key,消除孤儿 key)
  { id: 'text-dblclick-edit', kind: 'panel', labelKey: 'nodes.doubleClickToEdit', gesture: 'dblclick', priority: 14 },
  // 单选组:双击组标题重命名(与 dblclick-focus 并存,组标题为可点击重命名区域)
  { id: 'group-rename-dblclick', kind: 'panel', labelKey: 'hints.groupRenameDblclick', gesture: 'dblclick', priority: 15 },
  // 单选组内节点:Shift+拖拽移出组(选中即常驻显示,拖拽中同样可见)
  { id: 'drag-out-group', kind: 'panel', labelKey: 'hints.dragOutGroup', keys: ['Shift'], gesture: 'drag', priority: 15 },
  // 空白右键创建菜单打开时:提示可选类型快捷创建
  { id: 'canvas-create', kind: 'panel', labelKey: 'hints.canvasCreate', priority: 16 },
  // 空画布:新手最迷茫时刻,提示首个节点创建入口(右键或左侧加号)
  { id: 'empty-canvas-create', kind: 'panel', labelKey: 'hints.emptyCanvasCreate', priority: 13 },
  // 画布导航组(无选中时低优先级常驻,但精简至推荐项,避免信息过载):
  // 滚轮=缩放(2026-08-25 用户拍板:滚轮必须直接缩放,不再要求 Ctrl;
  // Ctrl+滚轮=上下平移兜底,Shift+滚轮=水平平移,均不常驻展示)
  { id: 'scroll-pan', kind: 'panel', labelKey: 'hints.scrollPan', gesture: 'wheel', priority: 17 },
  // Space 临时平移:仅按住时实时提示(取消无选中常驻,与滚轮提示叠加会信息过载)
  { id: 'space-pan', kind: 'panel', labelKey: 'hints.spacePan', keys: ['Space'], gesture: 'drag', priority: 18 },
  // 画布有节点且无选中:连线创建(核心隐藏操作,新手不知道节点可连线)
  { id: 'connect-create', kind: 'panel', labelKey: 'hints.connectCreate', gesture: 'drag', priority: 19 },
  // 画布有节点且可撤销:Ctrl+Z 为通用常识,不再单独提示(冗余),TopBar 撤销按钮兜底
  // Shift+框选追加选择(拖拽期间实时显示;普通框选进行中同样展示"加选"教育提示)
  { id: 'shift-marquee', kind: 'panel', labelKey: 'hints.shiftMarquee', keys: ['Shift'], gesture: 'drag', priority: 25 },
  // 选中组时:解组 = Delete(选中组节点即解散,子节点保留,无独立解组快捷键)
  // 选中堆叠媒体节点:移出当前卡片(还原为独立节点并自动连线)
  { id: 'stack-remove-card', kind: 'panel', labelKey: 'hints.stackRemoveCard', iconKey: 'eject', priority: 34 },
  // 选中堆叠媒体节点且有卡片时:点击缩略图预览
  { id: 'stack-preview-thumbnail', kind: 'panel', labelKey: 'hints.stackPreviewThumbnail', gesture: 'dblclick', priority: 33 },
  // 选中堆叠媒体节点且有连线预览时:点击收纳按钮加入堆叠
  { id: 'stack-collect-hint', kind: 'panel', labelKey: 'hints.stackCollectHint', priority: 32 },
  // 选中图片/视频节点(有内容时):胶囊工具栏有"转入堆叠"和"生成堆叠节点"工具
  { id: 'stackable-media-hint', kind: 'panel', labelKey: 'hints.stackableMediaHint', priority: 31 },

  // ===== anchor 型:画布锚定实时提示(由 GroupLayer 渲染,拖拽动态目标反馈) =====
  // 拖无父组节点入组 → 目标组顶部"加入组"
  { id: 'drag-into-group', kind: 'anchor', labelKey: 'hints.dragIntoGroup', priority: 41 },
];
