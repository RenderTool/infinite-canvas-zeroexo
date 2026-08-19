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
 */

import React, { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { HINT_ENTRIES, type HintEntry } from './hint-entries.js';
import { useHintsEnabled } from './hints-settings.js';

/** 瞬态状态访问器(结构化类型,避免对插件包的硬依赖) */
export interface TransientAccessor {
  subscribeTransient: (listener: () => void) => () => void;
  getTransient: () => { spacePressed: boolean; marqueeAdditive: boolean };
}

export interface ContextualShortcutsPanelProps {
  /** 是否处于预览组态(展示 Enter 确认 / Esc 取消 / Ctrl+G 切换) */
  isGroupPreviewing: boolean;
  /** 单选了某个节点或组(展示双击聚焦提示;每次选中都显示) */
  singleSelected?: boolean;
  /** 单选且节点在组内(展示 Shift+拖拽移出组提示;选中即常驻) */
  singleSelectedInGroup?: boolean;
  /** 空白右键创建菜单是否打开(展示快捷创建提示) */
  createMenuOpen?: boolean;
  /** 选中集中是否含组(展示 Shift+Delete 解组提示) */
  selectionHasGroup?: boolean;
  /** 是否选中 ≥2 个图片节点(展示 Ctrl+Shift+G 收纳版本组提示) */
  canVersionFolder?: boolean;
  /** 是否选中堆叠媒体节点(展示移除卡片/收纳节点提示) */
  isStackedMedia?: boolean;
  /** 选中堆叠媒体节点且有卡片时(展示缩略图预览提示) */
  stackHasCards?: boolean;
  /** 选中堆叠媒体节点且有连线预览时(展示收纳节点提示) */
  hasIncomingPreviews?: boolean;
  /** 是否选中可堆叠媒体节点(image/video,有内容时,展示转入堆叠/生成堆叠节点提示) */
  isStackableMedia?: boolean;
  /** interaction 控制器瞬态订阅(Space 平移 / Shift+框选;未注入时跳过对应条目) */
  transient?: TransientAccessor | null;
}

/** panel 条目可见上下文 */
interface HintContext {
  isGroupPreviewing: boolean;
  singleSelected: boolean;
  singleSelectedInGroup: boolean;
  createMenuOpen: boolean;
  selectionHasGroup: boolean;
  canVersionFolder: boolean;
  isStackedMedia: boolean;
  stackHasCards: boolean;
  hasIncomingPreviews: boolean;
  isStackableMedia: boolean;
  spacePressed: boolean;
  marqueeAdditive: boolean;
}

/** panel 条目显示条件派生(集中管理,新增条目在此加条件) */
function isVisible(entry: HintEntry, ctx: HintContext): boolean {
  switch (entry.id) {
    case 'preview-confirm':
    case 'preview-cancel':
    case 'preview-toggle':
      return ctx.isGroupPreviewing;
    case 'dblclick-focus':
      return ctx.singleSelected && !ctx.isGroupPreviewing && !ctx.createMenuOpen;
    case 'drag-out-group':
      return ctx.singleSelectedInGroup && !ctx.isGroupPreviewing && !ctx.createMenuOpen;
    case 'canvas-create':
      return ctx.createMenuOpen;
    case 'space-pan':
      return ctx.spacePressed;
    case 'shift-marquee':
      return ctx.marqueeAdditive;
    case 'shift-delete-ungroup':
      return ctx.selectionHasGroup && !ctx.isGroupPreviewing;
    case 'version-folder-shortcut':
      return ctx.canVersionFolder && !ctx.isGroupPreviewing;
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

export const ContextualShortcutsPanel = React.memo(function ContextualShortcutsPanel({
  isGroupPreviewing,
  singleSelected,
  singleSelectedInGroup,
  createMenuOpen,
  selectionHasGroup,
  canVersionFolder,
  isStackedMedia,
  stackHasCards,
  hasIncomingPreviews,
  isStackableMedia,
  transient,
}: ContextualShortcutsPanelProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const hintsEnabled = useHintsEnabled();

  // 订阅瞬态状态(Space 按住 / Shift+框选);transient 未注入时用恒定快照
  const subscribe = React.useCallback(
    (listener: () => void) => transient?.subscribeTransient(listener) ?? (() => {}),
    [transient],
  );
  const getSnapshot = React.useCallback(
    () => {
      const tr = transient?.getTransient();
      return `${tr?.spacePressed ? 1 : 0}|${tr?.marqueeAdditive ? 1 : 0}`;
    },
    [transient],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const parts = snapshot.split('|');
  const spacePressed = parts[0] === '1';
  const marqueeAdditive = parts[1] === '1';

  const ctx: HintContext = {
    isGroupPreviewing,
    singleSelected: !!singleSelected,
    singleSelectedInGroup: !!singleSelectedInGroup,
    createMenuOpen: !!createMenuOpen,
    selectionHasGroup: !!selectionHasGroup,
    canVersionFolder: !!canVersionFolder,
    isStackedMedia: !!isStackedMedia,
    stackHasCards: !!stackHasCards,
    hasIncomingPreviews: !!hasIncomingPreviews,
    isStackableMedia: !!isStackableMedia,
    spacePressed,
    marqueeAdditive,
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
        pointerEvents: 'none',
        zIndex: 40,
        userSelect: 'none',
      }}
    >
      {visible.map((entry) => (
        <div
          key={entry.id}
          style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
        >
          {(entry.keys ?? []).map((k, i) => (
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
          {entry.id === 'stack-remove-card' ? (
            <LogOut size={16} strokeWidth={1.8} color={accent} aria-hidden />
          ) : null}
          <span style={{ color: textColor, fontSize: 12, fontWeight: 500 }}>
            {t(entry.labelKey)}
          </span>
        </div>
      ))}
    </div>
  );
});
