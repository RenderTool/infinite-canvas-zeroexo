/**
 * ContextualShortcutsPanel - 情境化快捷键面板(Contextual Controls)
 *
 * 参考游戏中按当前状态动态展示的快捷键列表:屏幕右侧固定的键帽面板,
 * 常驻于画布,随当前上下文动态增减条目(无激活条目时整体隐藏)。
 * pointer-events:none,不干扰画布交互。
 *
 * 数据来源:
 * - HINT_ENTRIES 中 kind==='panel' 的条目(集中注册于 hint-entries.ts)
 * - 显示条件由本组件根据 props(编辑器上下文)统一派生
 *
 * 其他:
 * - 主题自适应(useTheme 派生明/暗配色,不硬编码单一主题)
 * - 全局开关(hints-settings,ConfigDialog 控制,关闭时整体隐藏)
 * - 可收纳成小三角(用户手动收纳,右缘三角把手常驻可点,状态跨会话持久化;
 *   三角为用户拍板形状,同下方鼠标手势图标先例,以 SVG 绘制不走 lucide 语义键)
 */

import React, { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { HINT_ICONS } from './icons.js';
import { useTheme } from '@zeroexo/plugin-theme';
import { toKeyCaps, type ShortcutEntry } from '@zeroexo/plugin-keyboard';
import { HINT_ENTRIES, type HintEntry } from './hint-entries.js';
import { useHintsEnabled, useHintsPanelCollapsed, setHintsPanelCollapsed } from './hints-settings.js';

/** 瞬态状态访问器(结构化类型,避免对插件包的硬依赖) */
export interface TransientAccessor {
  subscribeTransient: (listener: () => void) => () => void;
  getTransient: () => { spacePressed: boolean; marqueeAdditive: boolean; marqueeSelecting: boolean };
}

export interface ContextualShortcutsPanelProps {
  /** 是否处于预览组态(展示 Enter 确认 / Esc 取消) */
  isGroupPreviewing: boolean;
  /** 单选了某个节点或组(展示双击聚焦提示;每次选中都显示) */
  singleSelected?: boolean;
  /** 单选且节点在组内(展示 Shift+拖拽移出组提示;选中即常驻) */
  singleSelectedInGroup?: boolean;
  /** 空白右键创建菜单是否打开(展示快捷创建提示) */
  createMenuOpen?: boolean;
  /** 是否选中堆叠媒体节点(展示移除卡片/收纳节点提示) */
  isStackedMedia?: boolean;
  /** 选中堆叠媒体节点且有卡片时(展示缩略图预览提示) */
  stackHasCards?: boolean;
  /** 选中堆叠媒体节点且有连线预览时(展示收纳节点提示) */
  hasIncomingPreviews?: boolean;
  /** 是否选中可堆叠媒体节点(image/video,有内容时,展示转入堆叠/生成堆叠节点提示) */
  isStackableMedia?: boolean;
  /** 当前选中节点类型(区分 text/video/group 等双击语义;无选中/多选时为空) */
  selectedNodeType?: string | null;
  /** 画布是否已有节点(连线创建/导航提示的常驻条件) */
  canvasHasNodes?: boolean;
  /** interaction 控制器瞬态订阅(Space 平移 / Shift+框选;未注入时跳过对应条目) */
  transient?: TransientAccessor | null;
  /** 键盘插件注册表(shortcutId 引用条目时由此派生键帽,单一事实源) */
  keyboardShortcuts?: readonly ShortcutEntry[];
}

/** panel 条目可见上下文 */
interface HintContext {
  isGroupPreviewing: boolean;
  singleSelected: boolean;
  singleSelectedInGroup: boolean;
  createMenuOpen: boolean;
  isStackedMedia: boolean;
  stackHasCards: boolean;
  hasIncomingPreviews: boolean;
  isStackableMedia: boolean;
  selectedNodeType: string | null;
  canvasHasNodes: boolean;
  spacePressed: boolean;
  marqueeAdditive: boolean;
  marqueeSelecting: boolean;
}

/** panel 条目显示条件派生(集中管理,新增条目在此加条件) */
function isVisible(entry: HintEntry, ctx: HintContext): boolean {
  switch (entry.id) {
    case 'preview-confirm':
    case 'preview-cancel':
      return ctx.isGroupPreviewing;
    // 双击聚焦:非 text 节点(text 双击语义由专属条目替代)
    case 'dblclick-focus':
      return (
        ctx.singleSelected &&
        ctx.selectedNodeType !== 'text' &&
        !ctx.isGroupPreviewing &&
        !ctx.createMenuOpen
      );
    // 双击编辑文字(接入既有 nodes.doubleClickToEdit)
    case 'text-dblclick-edit':
      return ctx.singleSelected && ctx.selectedNodeType === 'text' && !ctx.isGroupPreviewing && !ctx.createMenuOpen;
    // 双击组标题重命名(单选组时与聚焦提示并存)
    case 'group-rename-dblclick':
      return ctx.singleSelected && ctx.selectedNodeType === 'group' && !ctx.isGroupPreviewing && !ctx.createMenuOpen;
    case 'drag-out-group':
      return ctx.singleSelectedInGroup && !ctx.isGroupPreviewing && !ctx.createMenuOpen;
    case 'canvas-create':
      return ctx.createMenuOpen;
    // 空画布:提示创建首个节点(新手最迷茫时刻)
    case 'empty-canvas-create':
      return !ctx.canvasHasNodes && !ctx.isGroupPreviewing && !ctx.createMenuOpen;
    // 滚轮平移画布:无选中时低优先级常驻(导航教育通道;性能考量默认滚轮平移而非缩放)
    case 'scroll-pan':
      return ctx.canvasHasNodes && !ctx.singleSelected && !ctx.isGroupPreviewing && !ctx.createMenuOpen;
    // Space 平移:仅按住时实时提示(取消常驻展示,避免与滚轮提示叠加信息过载)
    case 'space-pan':
      return ctx.spacePressed;
    // 连线创建:画布有节点且无选中时常驻(核心隐藏操作)
    case 'connect-create':
      return ctx.canvasHasNodes && !ctx.singleSelected && !ctx.isGroupPreviewing && !ctx.createMenuOpen;
    // Shift+框选加选:普通框选进行中或 Shift 加选时展示(教育提示即时可懂)
    case 'shift-marquee':
      return (ctx.marqueeSelecting || ctx.marqueeAdditive) && !ctx.isGroupPreviewing && !ctx.createMenuOpen;
    case 'stack-remove-card':
      return ctx.isStackedMedia && !ctx.isGroupPreviewing;
    case 'stack-preview-thumbnail':
      return ctx.isStackedMedia && ctx.stackHasCards && !ctx.isGroupPreviewing;
    case 'stack-collect-hint':
      return ctx.isStackedMedia && ctx.hasIncomingPreviews && !ctx.isGroupPreviewing;
    case 'stackable-media-hint':
      return ctx.isStackableMedia && !ctx.isGroupPreviewing;
    default:
      return false;
  }
}

// ===== 鼠标手势图标(示意图,降低文字理解成本) =====

/** 鼠标双击图标:左键高亮 + ×2 角标 */
function MouseDoubleClickIcon({ stroke, accent }: { stroke: string; accent: string }): React.ReactElement {
  return (
    <svg width="21" height="19" viewBox="0 0 21 19" fill="none" style={{ flexShrink: 0 }} aria-hidden>
      <rect x="1.5" y="1.5" width="12" height="16" rx="6" stroke={stroke} strokeWidth="1.4" />
      <path d="M7.5 1.5 A6 6 0 0 0 1.5 7.5 L1.5 8 L7.5 8 Z" fill={accent} opacity="0.9" />
      <line x1="7.5" y1="1.5" x2="7.5" y2="8" stroke={stroke} strokeWidth="1" />
      <line x1="1.5" y1="8" x2="13.5" y2="8" stroke={stroke} strokeWidth="1" />
      <text x="15" y="17.5" fontSize="8" fontWeight="700" fill={accent}>×2</text>
    </svg>
  );
}

/** 鼠标拖拽图标:鼠标 + 右下箭头 */
function MouseDragIcon({ stroke, accent }: { stroke: string; accent: string }): React.ReactElement {
  return (
    <svg width="23" height="23" viewBox="0 0 23 23" fill="none" style={{ flexShrink: 0 }} aria-hidden>
      <rect x="1.5" y="1.5" width="11" height="14.5" rx="5.5" stroke={stroke} strokeWidth="1.4" />
      <line x1="7" y1="1.5" x2="7" y2="7" stroke={stroke} strokeWidth="1" />
      <line x1="1.5" y1="7" x2="12.5" y2="7" stroke={stroke} strokeWidth="1" />
      <line x1="13" y1="13" x2="20.5" y2="20.5" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20.5 20.5 L15.8 19.9 M20.5 20.5 L19.9 15.8" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 鼠标滚轮图标:鼠标 + 中部滚轮高亮 */
function MouseWheelIcon({ stroke, accent }: { stroke: string; accent: string }): React.ReactElement {
  return (
    <svg width="21" height="19" viewBox="0 0 21 19" fill="none" style={{ flexShrink: 0 }} aria-hidden>
      <rect x="1.5" y="1.5" width="12" height="16" rx="6" stroke={stroke} strokeWidth="1.4" />
      <line x1="7.5" y1="2" x2="7.5" y2="10.5" stroke={accent} strokeWidth="1.6" />
      <line x1="1.5" y1="7" x2="13.5" y2="7" stroke={stroke} strokeWidth="1" />
    </svg>
  );
}

export const ContextualShortcutsPanel = React.memo(function ContextualShortcutsPanel({
  isGroupPreviewing,
  singleSelected,
  singleSelectedInGroup,
  createMenuOpen,
  isStackedMedia,
  stackHasCards,
  hasIncomingPreviews,
  isStackableMedia,
  selectedNodeType,
  canvasHasNodes,
  transient,
  keyboardShortcuts,
}: ContextualShortcutsPanelProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const hintsEnabled = useHintsEnabled();
  const collapsed = useHintsPanelCollapsed();
  const [tabHovered, setTabHovered] = React.useState(false);

  // 订阅瞬态状态(Space 按住 / Shift+框选);transient 未注入时用恒定快照
  const subscribe = React.useCallback(
    (listener: () => void) => transient?.subscribeTransient(listener) ?? (() => {}),
    [transient],
  );
  const getSnapshot = React.useCallback(
    () => {
      const tr = transient?.getTransient();
      return `${tr?.spacePressed ? 1 : 0}|${tr?.marqueeAdditive ? 1 : 0}|${tr?.marqueeSelecting ? 1 : 0}`;
    },
    [transient],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const parts = snapshot.split('|');
  const spacePressed = parts[0] === '1';
  const marqueeAdditive = parts[1] === '1';
  const marqueeSelecting = parts[2] === '1';

  // 键帽解析:shortcutId 引用注册表派生(单一事实源);未引用时回退手写 keys(手势类)
  // DEV 断言:引用必须在注册表中存在,防止注册表改名/删除导致键帽静默丢失
  const resolveKeys = React.useMemo(() => {
    const capMap = new Map<string, string[]>();
    for (const s of keyboardShortcuts ?? []) capMap.set(s.id, toKeyCaps(s));
    if (import.meta.env.DEV) {
      for (const entry of HINT_ENTRIES) {
        if (!entry.shortcutId) continue;
        const ids = Array.isArray(entry.shortcutId) ? entry.shortcutId : [entry.shortcutId];
        for (const id of ids) {
          if (!capMap.has(id)) {
            console.warn(`[hints] hint '${entry.id}' 引用的快捷键 '${id}' 不在键盘注册表中,键帽将为空`);
          }
        }
      }
      for (const entry of HINT_ENTRIES) {
        if (entry.iconKey && !(entry.iconKey in HINT_ICONS)) {
          console.warn(`[hints] hint '${entry.id}' 的图标语义键 '${entry.iconKey}' 不在模块图标 Map(HINT_ICONS)中,图标将缺失`);
        }
      }
    }
    return (entry: HintEntry): string[] => {
      if (!entry.shortcutId) return entry.keys ?? [];
      const ids = Array.isArray(entry.shortcutId) ? entry.shortcutId : [entry.shortcutId];
      const caps: string[] = [];
      for (const id of ids) {
        for (const cap of capMap.get(id) ?? []) {
          if (!caps.includes(cap)) caps.push(cap);
        }
      }
      return caps;
    };
  }, [keyboardShortcuts]);

  const ctx: HintContext = {
    isGroupPreviewing,
    singleSelected: !!singleSelected,
    singleSelectedInGroup: !!singleSelectedInGroup,
    createMenuOpen: !!createMenuOpen,
    isStackedMedia: !!isStackedMedia,
    stackHasCards: !!stackHasCards,
    hasIncomingPreviews: !!hasIncomingPreviews,
    isStackableMedia: !!isStackableMedia,
    selectedNodeType: selectedNodeType ?? null,
    canvasHasNodes: !!canvasHasNodes,
    spacePressed,
    marqueeAdditive,
    marqueeSelecting,
  };

  const visible = HINT_ENTRIES
    .filter((e) => e.kind === 'panel' && isVisible(e, ctx))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  // 全局开关关闭或无激活条目时整体隐藏(hooks 已在上方全部调用,顺序稳定)
  if (!hintsEnabled || visible.length === 0) return null;

  // ===== 主题自适应配色(与 NodeCapsuleToolbar 同源 token) =====
  const dark = theme.mode === 'dark';
  const panelBg = dark ? 'rgba(24, 24, 27, 0.78)' : 'rgba(255, 255, 255, 0.88)';
  const panelBorder = dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';
  const textColor = dark ? 'rgba(255, 255, 255, 0.88)' : '#292524';
  const iconStroke = dark ? 'rgba(255, 255, 255, 0.75)' : '#57534e';
  const accent = theme.toolbar.accent ?? '#e94560';
  const keyCapStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 22,
    height: 20,
    padding: '0 6px',
    borderRadius: 5,
    backgroundColor: dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.06)',
    border: `1px solid ${dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.15)'}`,
    boxShadow: dark ? '0 1px 0 rgba(0, 0, 0, 0.35)' : '0 1px 0 rgba(0, 0, 0, 0.08)',
    color: textColor,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  };

  return (
    <div
      data-contextual-shortcuts-panel
      style={{
        position: 'absolute',
        right: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        pointerEvents: 'none',
        zIndex: 40,
        userSelect: 'none',
      }}
    >
      {/* 条目面板:收纳时淡出右移(屏幕空间覆盖层,非反缩放元素,transform 过渡安全) */}
      <div
        aria-hidden={collapsed}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '10px 12px',
          borderRadius: 12,
          backgroundColor: panelBg,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${panelBorder}`,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
          opacity: collapsed ? 0 : 1,
          transform: collapsed ? 'translateX(14px)' : 'translateX(0)',
          transition: 'opacity 160ms ease, transform 160ms ease',
        }}
      >
      {visible.map((entry) => (
        <div
          key={entry.id}
          style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
        >
          {resolveKeys(entry).map((k, i) => (
            <React.Fragment key={`${entry.id}-${k}-${i}`}>
              {i > 0 ? <span style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)', fontSize: 10 }}>+</span> : null}
              <span style={keyCapStyle}>{k}</span>
            </React.Fragment>
          ))}
          {entry.gesture === 'dblclick' ? (
            <MouseDoubleClickIcon stroke={iconStroke} accent={accent} />
          ) : null}
          {entry.gesture === 'drag' ? (
            <MouseDragIcon stroke={iconStroke} accent={accent} />
          ) : null}
          {entry.gesture === 'wheel' ? (
            <MouseWheelIcon stroke={iconStroke} accent={accent} />
          ) : null}
          {entry.iconKey ? (
            <HintIcon iconKey={entry.iconKey} accent={accent} />
          ) : null}
          <span style={{ color: textColor, fontSize: 12, fontWeight: 500 }}>
            {t(entry.labelKey)}
          </span>
        </div>
      ))}
      </div>
      {/* 收纳/展开三角把手:贴屏幕右缘常驻;收纳态 ◀(点击展开)/展开态 ▶(点击收纳),
          旋转 180° 过渡;事件阻断冒泡,防止误触画布交互 */}
      <div
        role="button"
        aria-label={collapsed ? t('hints.expandPanel') : t('hints.collapsePanel')}
        title={collapsed ? t('hints.expandPanel') : t('hints.collapsePanel')}
        onMouseEnter={() => setTabHovered(true)}
        onMouseLeave={() => setTabHovered(false)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setHintsPanelCollapsed(!collapsed);
        }}
        onWheel={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          right: -16,
          top: '50%',
          transform: `translateY(-50%) scale(${tabHovered ? 1.2 : 1})`,
          transition: 'transform 140ms ease',
          pointerEvents: 'auto',
          cursor: 'pointer',
          padding: '10px 2px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <svg
          width="11"
          height="18"
          viewBox="0 0 11 18"
          aria-hidden
          style={{
            display: 'block',
            transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 180ms ease',
          }}
        >
          <polygon
            points="10,1 10,17 1,9"
            fill={tabHovered ? accent : iconStroke}
            style={{ transition: 'fill 140ms ease' }}
          />
        </svg>
      </div>
    </div>
  );
});

/** iconKey 渲染兜底:语义键缺失时静默跳过(DEV 断言已报警) */
function HintIcon({ iconKey, accent }: { iconKey: string; accent: string }): React.ReactElement | null {
  const IconComp = HINT_ICONS[iconKey];
  if (!IconComp) return null;
  return <IconComp size={16} strokeWidth={1.8} color={accent} aria-hidden />;
}
