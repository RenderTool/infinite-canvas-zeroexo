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

function clampWidth(w: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));
}

/** 主题 CSS 变量（分层背景色，代替磨砂玻璃与内部边线）——桌面 Dock 与移动端 Drawer 共用 */
export function getAgentThemeVars(t: ReturnType<typeof useAgentTheme>): CSSProperties {
  return {
    '--agent-bg': t.isDark ? '#161412' : '#ffffff',
    '--agent-panel': t.isDark ? 'rgba(22,20,18,0.97)' : 'rgba(248,246,242,0.97)',
    '--agent-surface': t.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    '--agent-surface-2': t.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
    '--agent-border': t.border,
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
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', handleResizeUp);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, [handleResizeMove]);

  const handleResizeDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
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

  return (
    <div
      style={{
        width: dockOpen ? width : 0,
        minWidth: dockOpen ? width : 0,
        overflow: 'hidden',
        background: t.isDark ? '#161412' : '#ffffff',
        transition: dockOpen
          ? 'none'
          : 'width 0.32s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
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

      {/* 聊天面板内容 */}
      <div
        style={{
          ...themeVars,
          width: dockOpen ? width - RESIZER_WIDTH : 0,
          minWidth: dockOpen ? width - RESIZER_WIDTH : 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* R2：顶部工具行已移除（渠道选择迁入输入框附件旁） */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <DockContent projectId={projectId} />
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
