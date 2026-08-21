/**
 * ConnectionDropMenu - 连线释放菜单
 * 从 Pin 拖拽到空白区域松手时弹出(标题"引用该节点生成"),创建节点后自动连接源 Pin。
 * 视觉与 NodeCreateMenu 完全一致:Logo 下拉(antd Dropdown)同款卡片风格 + slide-up 动画,
 * 分组短虚线分隔;菜单内滚动用原生捕获隔离,不穿透画布。
 */

import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Type, Image as ImageIcon, Sparkles, FileText, Aperture, Film } from 'lucide-react';
import type { CommandQueue, NodeRecord } from '@zeroexo/core';
import { AddNodeCommand, AddEdgeCommand } from '@zeroexo/core';
import type { ThemeConfig } from '@zeroexo/shared';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { AddNodeType } from '@/shared/components/node-create-menu.js';
import { canConnect } from '@/shared/connection-rules.js';

export interface ConnectionDropMenuProps {
  commandQueue: CommandQueue;
  source: { nodeId: string; nodeType: string; pinId: string; direction: 'input' | 'output' };
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  theme: ThemeConfig;
  onClose: () => void;
  connectionController?: ConnectionController | null;
}

/** 节点类型定义(与 NodeCreateMenu 保持一致) */
interface NodeTypeDef {
  type: AddNodeType;
  icon: React.ReactNode;
  labelKey: string;
  category: 'generate' | 'media' | 'creation';
}

/** 分类顺序(与 NodeCreateMenu 一致) */
const CATEGORY_ORDER: Array<'generate' | 'media' | 'creation'> = ['generate', 'media', 'creation'];

/** 节点类型定义列表 */
function createNodeTypeDefs(): NodeTypeDef[] {
  return [
    { type: 'generator', icon: <Sparkles size={14} />, labelKey: 'toolbar.generator', category: 'generate' },
    { type: 'text', icon: <Type size={14} />, labelKey: 'toolbar.text', category: 'media' },
    { type: 'image', icon: <ImageIcon size={14} />, labelKey: 'toolbar.image', category: 'media' },
    { type: 'video', icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z"/><path d="M7 21h10"/><rect width="20" height="14" x="2" y="3" rx="2"/></svg>, labelKey: 'toolbar.video', category: 'media' },
    { type: 'audio', icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>, labelKey: 'toolbar.audio', category: 'media' },
    { type: 'script', icon: <FileText size={14} />, labelKey: 'canvasNodes.stage.script', category: 'creation' },
    { type: 'storyboard', icon: <Aperture size={14} />, labelKey: 'canvasNodes.stage.storyboard', category: 'creation' },
    { type: 'workbench', icon: <Film size={14} />, labelKey: 'canvasNodes.stage.workbench', category: 'creation' },
  ];
}

export const ConnectionDropMenu = memo(function ConnectionDropMenu({
  commandQueue,
  source,
  screenX,
  screenY,
  worldX,
  worldY,
  theme,
  onClose,
  connectionController,
}: ConnectionDropMenuProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeTypes = useMemo(() => createNodeTypeDefs(), []);

  const isDark = theme.mode === 'dark';
  const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const disabledColor = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  // 与 AntdThemeProvider 映射一致:亮色下拉=#fff/#e7e5e4,暗色=toolbar.panel/border
  const panelBg = isDark ? theme.toolbar.panel : '#ffffff';
  const panelBorder = isDark ? theme.toolbar.border : '#e7e5e4';
  // antd Dropdown slide-up 动画曲线(平滑缓出,非弹性回弹)
  const motion = 'opacity 0.2s cubic-bezier(0.08, 0.82, 0.17, 1), transform 0.2s cubic-bezier(0.08, 0.82, 0.17, 1)';
  // 分组分隔线:短虚线(与右键菜单 ContextMenu 一致)
  const dividerStyle: React.CSSProperties = {
    height: 0,
    border: 'none',
    borderTop: `1px dashed ${theme.toolbar.border}`,
    margin: '4px 8px',
  };

  // 菜单内滚动隔离:原生捕获阶段拦截 wheel,阻止穿透到画布(配合 overscroll-behavior:contain)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const stopWheel = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stopWheel, { capture: true, passive: true });
    return () => el.removeEventListener('wheel', stopWheel, { capture: true } as EventListenerOptions);
  }, []);

  // 弹出动画 - useLayoutEffect 确保在 paint 前触发,生产模式更流畅
  useLayoutEffect(() => {
    let raf2: number;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setVisible(true));
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, []);

  // 面板打开后更新预览线终点 → 固定锚定到面板左上角
  useEffect(() => {
    if (!connectionController || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const anchorX = rect.left + 2;
    const anchorY = rect.top + 2;
    connectionController.updatePendingEndpoint(anchorX, anchorY);
  }, [connectionController]);

  const handleClose = useCallback(() => {
    connectionController?.cancel();
    onClose();
  }, [connectionController, onClose]);

  // 点击外部 / ESC 关闭
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('[data-connection-drop-menu]')) return;
      handleClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [handleClose]);

  const createAndConnect = useCallback(
    (type: AddNodeType) => {
      const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const data = { label: t(`toolbar.${type}`) };
      const node: NodeRecord = {
        id: nodeId,
        type,
        position: { x: worldX, y: worldY },
        data,
      };
      commandQueue.execute(new AddNodeCommand(node));

      // 创建边:统一为 output → input 方向
      const [edgeSource, edgeTarget] = source.direction === 'output'
        ? [{ nodeId: source.nodeId, pinId: source.pinId }, { nodeId, pinId: 'input' }]
        : [{ nodeId, pinId: 'output' }, { nodeId: source.nodeId, pinId: source.pinId }];
      commandQueue.execute(
        new AddEdgeCommand({
          id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: edgeSource,
          target: edgeTarget,
        }),
      );

      handleClose();
    },
    [commandQueue, worldX, worldY, source, handleClose, t],
  );

  return (
    <div
      data-connection-drop-menu
      ref={panelRef}
      style={{
        position: 'fixed',
        left: screenX,
        top: screenY,
        zIndex: 1000,
        minWidth: 200,
        maxWidth: 260,
        background: panelBg,
        border: `1px solid ${panelBorder}`,
        borderRadius: 8,
        boxShadow: '0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)',
        padding: '4px 0',
        display: 'flex',
        flexDirection: 'column',
        color: theme.toolbar.text,
        transform: visible ? 'scaleY(1)' : 'scaleY(0.8)',
        opacity: visible ? 1 : 0,
        transformOrigin: 'top center',
        transition: motion,
      }}
    >
      <div style={{
        padding: '5px 12px 3px',
        fontSize: 11,
        fontWeight: 600,
        color: theme.toolbar.textMuted,
        letterSpacing: 0.3,
        userSelect: 'none',
      }}>
        引用该节点生成
      </div>
      <div ref={scrollRef} style={{ overflowY: 'auto', flex: 1, maxHeight: 320, overscrollBehavior: 'contain' }}>
        {CATEGORY_ORDER.map((cat, catIdx) => {
          const groupDefs = nodeTypes.filter((d) => d.category === cat);
          if (groupDefs.length === 0) return null;
          return (
            <div key={cat}>
              {catIdx > 0 && <div style={dividerStyle} />}
              {groupDefs.map((def) => {
                // 统一规则: 与手动拖拽连线验证共用 canConnect()
                // direction='output': 源节点→新节点 (正向)
                // direction='input': 新节点→源节点 (反向)
                const enabled = source.direction === 'output'
                  ? canConnect(source.nodeType, def.type)
                  : canConnect(def.type, source.nodeType);
                return (
                  <button
                    key={def.type}
                    type="button"
                    disabled={!enabled}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      padding: '5px 12px', border: 'none', borderRadius: 0,
                      background: 'transparent',
                      color: enabled ? theme.toolbar.text : disabledColor,
                      fontSize: 13, textAlign: 'left',
                      cursor: enabled ? 'pointer' : 'not-allowed',
                      fontFamily: 'inherit', transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { if (enabled) e.currentTarget.style.background = hoverBg; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    onClick={() => { if (enabled) { createAndConnect(def.type); onClose(); } }}
                  >
                    <span style={{ width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {def.icon}
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t(def.labelKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
});