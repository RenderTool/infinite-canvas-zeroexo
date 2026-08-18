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
 * - 文案极简(键帽/鼠标图标已表达操作方式,文案只说结果),降低用户思考成本
 * - 显示条件由 ContextualShortcutsPanel 统一派生(集中管理上下文)
 */

export type HintKind = 'panel' | 'anchor';

/** 鼠标手势图标类型(panel 型渲染为鼠标示意图) */
export type MouseGesture = 'dblclick' | 'drag';

export interface HintEntry {
  id: string;
  kind: HintKind;
  /** i18n key(hints.* 命名空间) */
  labelKey: string;
  /** 键帽列表(panel 型渲染为按键样式;为空则仅显示文案,anchor 型忽略) */
  keys?: string[];
  /** 鼠标手势图标(与键帽可并存,如 Shift+拖拽) */
  gesture?: MouseGesture;
  /** 排序权重(数值小者靠前) */
  priority?: number;
}

/** 全部内置提示条目(新增场景只需在此加条目 + 在面板派生中加条件) */
export const HINT_ENTRIES: readonly HintEntry[] = [
  // ===== panel 型:情境化快捷键列表(右侧常驻面板) =====
  // 预览组态:Enter 成组 / Esc 取消 / Ctrl+G 切换
  { id: 'preview-confirm', kind: 'panel', labelKey: 'hints.previewConfirm', keys: ['Enter'], priority: 10 },
  { id: 'preview-cancel', kind: 'panel', labelKey: 'hints.previewCancel', keys: ['Esc'], priority: 11 },
  { id: 'preview-toggle', kind: 'panel', labelKey: 'hints.previewToggle', keys: ['Ctrl', 'G'], priority: 12 },
  // 单选节点或组:双击聚焦(操作真实存在:onNodeDoubleClick / onGroupDoubleClick)
  { id: 'dblclick-focus', kind: 'panel', labelKey: 'hints.dblclickFocus', gesture: 'dblclick', priority: 14 },
  // 单选组内节点:Shift+拖拽移出组(选中即常驻显示,拖拽中同样可见)
  { id: 'drag-out-group', kind: 'panel', labelKey: 'hints.dragOutGroup', keys: ['Shift'], gesture: 'drag', priority: 15 },
  // 空白右键创建菜单打开时:提示可选类型快捷创建
  { id: 'canvas-create', kind: 'panel', labelKey: 'hints.canvasCreate', priority: 16 },
  // Space 临时平移
  { id: 'space-pan', kind: 'panel', labelKey: 'hints.spacePan', keys: ['Space'], gesture: 'drag', priority: 20 },
  // Shift+框选追加选择(拖拽期间实时显示)
  { id: 'shift-marquee', kind: 'panel', labelKey: 'hints.shiftMarquee', keys: ['Shift'], gesture: 'drag', priority: 25 },
  // 选中组时:Shift+Delete 解组保留子节点(group:delete-ungroup 快捷键)
  { id: 'shift-delete-ungroup', kind: 'panel', labelKey: 'hints.shiftDeleteUngroup', keys: ['Shift', 'Delete'], priority: 30 },
  // 选中 ≥2 图片节点:Ctrl+Shift+G 收纳版本组(group:create-version-folder 快捷键)
  { id: 'version-folder-shortcut', kind: 'panel', labelKey: 'hints.versionFolderShortcut', keys: ['Ctrl', 'Shift', 'G'], priority: 32 },
  // 选中堆叠媒体节点:移出当前卡片(还原为独立节点并自动连线)
  { id: 'stack-remove-card', kind: 'panel', labelKey: 'hints.stackRemoveCard', priority: 34 },
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
