/**
 * AgentDock - 右侧可收起 Agent 对话面板（open-design 对话式壳）
 *
 * 布局对齐 open-design 对话式 UI：
 * - 聊天面板（默认 460px，左缘 8px 分隔条可拖拽调宽，min 340 / max 640）
 * - 右侧工作区 = 画布（由 editor-page 透出，本组件仅占宽）
 * 图标/主题色本地化：Lucide 图标 + 项目主题 token（useAgentTheme），
 * 不受旧 MVP 面板（TvcAgentShell）影响。
 * projectId 由 editor-page 注入，用于会话归属与项目上下文。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { Drawer } from 'antd';
import { useCanvasAgentStore } from './store.js';
import { useAgentTheme } from './context/theme-context.js';
import { DockContent } from './DockContent.js';
import { setSessionProjectId } from './session/agent-session.js';
import './AgentDock.css';

const DEFAULT_WIDTH = 460;
const MIN_WIDTH = 340;
const MAX_WIDTH = 640;
const RESIZER_WIDTH = 8;
const WIDTH_STORAGE_KEY = 'zeroexo:agent-dock-width';
/**
 * 2026-08-30 一致性需求：与资产抽屉 HierarchyPanelSidebar 的 DRAWER_TRANSITION
 * 完全同节奏（0.35s cubic-bezier(0.22, 1, 0.36, 1)），开闭动画观感统一。
 */
const DOCK_TRANSITION = '0.35s cubic-bezier(0.22, 1, 0.36, 1)';
/** 与 DOCK_TRANSITION 对齐的动画时长(ms) */
const DOCK_ANIM_MS = 350;
/**
 * 内容延迟挂载时机(对齐资产抽屉 HierarchyPanelSidebar 的 Plan#48-T6:420ms)。
 * width 是非合成属性,过渡期间每帧触发 layout;若与 DockContent(消息列表 + antd 控件)
 * 的挂载同帧竞争,打开会明显卡顿。故动画结束后再挂载真实内容,期间显示骨架屏。
 */
const CONTENT_MOUNT_DELAY_MS = DOCK_ANIM_MS + 70;

function clampWidth(w: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));
}

/** 主题 CSS 变量（分层背景色，代替磨砂玻璃与内部边线）——桌面 Dock 与移动端 Drawer 共用
 *  2026-08-31 用户拍板：全站统一画布背景色（t.background = toolbar.background = #11110f） */
export function getAgentThemeVars(t: ReturnType<typeof useAgentTheme>): CSSProperties {
  return {
    '--agent-bg': t.background,
    '--agent-panel': t.background,
    '--agent-surface': t.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    '--agent-surface-2': t.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
    '--agent-border': t.border,
    // 征集 #96:分割线专用色——与剧本编辑器同款(暗 rgba(255,255,255,0.06) / 亮 rgba(0,0,0,0.06)),
    // 比 --agent-border(#44403c) 更淡,避免面板内分割线过重
    '--agent-divider': t.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    '--agent-text': t.text,
    '--agent-muted': t.textMuted,
    '--agent-accent': t.accent,
    '--agent-accent-soft': t.isDark ? `${t.accent}2e` : `${t.accent}1a`,
    '--agent-danger': t.danger,
    '--agent-user-bubble': t.isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.05)',
    '--agent-shadow': t.isDark ? '0 8px 32px rgba(0,0,0,0.35)' : '0 8px 32px rgba(0,0,0,0.08)',
  } as CSSProperties;
}

export interface AgentDockProps {
  /** 当前画布/项目 ID（透传给后端会话与任务） */
  projectId?: string;
}

/**
 * AgentDockSkeleton - 打开动画期间的骨架屏
 *
 * 复用 AgentDock.css 已有的 .agent-shimmer（Plan#43 生成中微光骨架行，shimmer-sweep 动画），
 * 不新增动画定义。作用有二：
 * 1) 避免 0.35s 展开动画期间面板空白——空面板会放大卡顿感；
 * 2) 把 DockContent 的挂载推迟到动画结束后，消除与每帧 layout 的同帧竞争。
 */
function AgentDockSkeleton(): React.ReactElement {
  const barHeights = [72, 44, 96, 60, 44];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 16,
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {barHeights.map((h, i) => (
        <div
          key={i}
          className="agent-shimmer"
          style={{ height: h, borderRadius: 10, flexShrink: 0 }}
        />
      ))}
    </div>
  );
}

export function AgentDock({ projectId }: AgentDockProps): React.ReactElement {
  const dockOpen = useCanvasAgentStore((s) => s.dockOpen);
  const t = useAgentTheme();

  // 宽度状态：默认 460，持久化到 localStorage
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(WIDTH_STORAGE_KEY);
      return saved ? clampWidth(Number(saved)) : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  /** 拖拽调宽中：挂起宽度过渡，否则每帧 setState 都被过渡平滑，手感拖沓 */
  const [isResizing, setIsResizing] = useState(false);

  // 注入当前项目 ID 到真连层
  useEffect(() => {
    setSessionProjectId(projectId ?? null);
  }, [projectId]);

  // 持久化宽度
  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
    } catch {
      // 隐私模式等场景静默
    }
  }, [width]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    // 分隔条位于面板左缘：向左拖 = 变宽
    setWidth(clampWidth(drag.startWidth + (drag.startX - e.clientX)));
  }, []);

  const handleResizeUp = useCallback(() => {
    dragRef.current = null;
    setIsResizing(false);
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', handleResizeUp);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, [handleResizeMove]);

  const handleResizeDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsResizing(true);
      dragRef.current = { startX: e.clientX, startWidth: width };
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    },
    [width, handleResizeMove, handleResizeUp],
  );

  // 主题 CSS 变量（分层背景色，代替磨砂玻璃与内部边线）
  const themeVars = getAgentThemeVars(t);

  // 2026-08-30 打开性能:0.35s width 过渡期间不挂载 DockContent 重组件。
  // 复刻资产抽屉(Plan#48-T6)的做法——先出骨架屏,动画结束后再挂载真实内容,
  // 避免「每帧 layout」与「消息列表/antd 控件挂载」同帧竞争导致的明显卡顿。
  // 注意:关闭时不回退 contentReady —— 否则 0.35s 收起动画期间会闪出骨架屏。
  // 且再次打开时 DockContent 已挂载过(组件始终挂载,仅靠外层 width 裁剪),
  // 无重复挂载开销,直接显示即可。
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    if (!dockOpen || contentReady) return;
    const timer = window.setTimeout(() => setContentReady(true), CONTENT_MOUNT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dockOpen, contentReady]);

  return (
    <div
      style={{
        width: dockOpen ? width : 0,
        minWidth: dockOpen ? width : 0,
        overflow: 'hidden',
        background: t.background,
        // 2026-08-30 一致性修复:原先 dockOpen 时 transition 为 'none',
        // 导致面板「打开瞬间弹出、只有关闭有动画」。现改为常驻过渡
        // (仅拖拽调宽时挂起),节奏与资产抽屉统一。
        transition: isResizing
          ? 'none'
          : `width ${DOCK_TRANSITION}, min-width ${DOCK_TRANSITION}`,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      {/* 左缘拖拽分隔条（R2-8 美化：透明命中区 + 发丝线 + hover/拖拽手柄） */}
      <div
        onMouseDown={handleResizeDown}
        className="agent-dock-resizer"
        style={{
          width: RESIZER_WIDTH,
          flexShrink: 0,
          cursor: 'col-resize',
          background: 'transparent',
          position: 'relative',
          opacity: dockOpen ? 1 : 0,
        }}
        title="拖拽调整面板宽度"
      >
        {/* 中央发丝线 */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '50%',
            width: 1,
            transform: 'translateX(-0.5px)',
            background: t.border,
          }}
        />
        {/* hover/拖拽时的主题色手柄指示器 */}
        <div
          className="agent-dock-resizer-handle"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 3,
            height: 36,
            borderRadius: 2,
            background: t.accent,
            opacity: 0,
            transition: 'opacity 0.15s',
          }}
        />
      </div>

      {/* 聊天面板内容
          2026-08-30 性能修复:内层不再做 width 过渡(原先内外双层同时动画,
          每帧触发 2 次 layout)。改为固定宽度,靠外层 width + overflow:hidden 裁剪,
          展开/收起期间内层内容完全不重排。 */}
      <div
        style={{
          ...themeVars,
          width: width - RESIZER_WIDTH,
          minWidth: width - RESIZER_WIDTH,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* R2：顶部工具行已移除（渠道选择迁入输入框附件旁） */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {contentReady ? <DockContent projectId={projectId} /> : <AgentDockSkeleton />}
        </div>
      </div>
    </div>
  );
}

/**
 * MobileAgentDrawer - 移动端全屏 Agent 面板（Drawer 承载 DockContent）
 *
 * 移动端屏幕窄，侧边 Dock（默认 460px）不可用，改为全屏 Drawer；
 * 开闭仍由 store.dockOpen 单一状态源驱动（抽屉/顶栏按钮/TopBar 高亮同步）。
 */
export function MobileAgentDrawer({ projectId }: AgentDockProps): React.ReactElement {
  const dockOpen = useCanvasAgentStore((s) => s.dockOpen);
  const t = useAgentTheme();

  return (
    <Drawer
      open={dockOpen}
      onClose={() => useCanvasAgentStore.getState().setDockOpen(false)}
      placement="right"
      size="100%"
      closable={false}
      styles={{
        body: { padding: 0, ...getAgentThemeVars(t) },
      }}
    >
      <div style={{ height: '100dvh', minHeight: 0 }}>
        <DockContent projectId={projectId} />
      </div>
    </Drawer>
  );
}
