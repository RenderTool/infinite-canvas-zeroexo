/**
 * HomeTestCanvas - 主页临时测试画布(Plan#19 验证用,用户验收后删除)
 *
 * 演示内容(全部走 @zeroexo/plugin-render-react 新契约):
 * - ContextMenu:下沉后的右键菜单(节点右键/空白右键,亮暗主题自适应)
 * - focusOnNode:双击节点 / 右键菜单「聚焦」项(平滑缩放动画,统一几何公式)
 * - 视口外节点(演示聚焦跳转)
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactElement } from 'react';
import { createElement } from 'react';
import { createDefaultEditor } from '@zeroexo/preset-default';
import type { DefaultEditor } from '@zeroexo/preset-default';
import { CanvasView, ContextMenu } from '@zeroexo/plugin-render-react';
import type { ContextMenuItem } from '@zeroexo/plugin-render-react';
import { AddNodeCommand, DuplicateNodeCommand, RemoveNodeCommand } from '@zeroexo/core';
import type { NodeRecord } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { Copy, Crosshair, Pencil, RotateCcw, Trash2 } from 'lucide-react';

export function HomeTestCanvas(): ReactElement {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<DefaultEditor | null>(null);
  const [menu, setMenu] = useState<{ items: ContextMenuItem[]; position: { x: number; y: number } } | null>(null);

  // 初始化编辑器(最小装配:关持久化/键盘/小地图)
  useEffect(() => {
    if (!containerRef.current) return;
    const ed = createDefaultEditor({
      container: containerRef.current,
      enablePersistence: false,
      enableKeyboard: false,
      enableMinimap: false,
    });
    const q = ed.core.commandQueue;
    // 演示节点:2 个在初始视口内,2 个在视口外(演示聚焦跳转)
    const demos: NodeRecord[] = [
      { id: 'demo-a', type: 'text', title: '双击我 → 聚焦', position: { x: 80, y: 60 }, size: { width: 240, height: 100 }, data: { content: '双击节点触发 focusOnNode 平滑聚焦', prompt: '', status: 'idle' } },
      { id: 'demo-b', type: 'text', title: '右键我 → 菜单', position: { x: 380, y: 220 }, size: { width: 240, height: 100 }, data: { content: '右键节点打开下沉后的 ContextMenu', prompt: '', status: 'idle' } },
      { id: 'demo-c', type: 'text', title: '视口外节点 1', position: { x: 1500, y: 300 }, size: { width: 240, height: 100 }, data: { content: '在初始视口外,用菜单「聚焦」跳过来', prompt: '', status: 'idle' } },
      { id: 'demo-d', type: 'text', title: '视口外节点 2', position: { x: 1600, y: 900 }, size: { width: 240, height: 100 }, data: { content: '远距离聚焦演示', prompt: '', status: 'idle' } },
    ];
    for (const n of demos) q.execute(new AddNodeCommand(n));
    ed.store.setViewport({ x: 0, y: 0, k: 0.9 });
    setEditor(ed);
    return () => ed.cleanup();
  }, []);

  const extensions = editor ? new Map(editor.plugins.nodes.all().map((e) => [e.type, e])) : new Map();

  const getContainerSize = (): { width: number; height: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 800, height: rect?.height ?? 460 };
  };

  const focusNode = (nodeId: string): void => {
    if (!editor) return;
    const node = editor.store.getNode(nodeId);
    editor.store.focusOnNode(nodeId, getContainerSize(), node?.size?.width, node?.size?.height, 400, 51);
  };

  // 右键菜单:检测节点 → 节点菜单;空白 → 重置视口
  const handleCanvasContextMenu = (e: MouseEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (!editor) return;
    const target = e.target as HTMLElement;
    const nodeEl = target.closest('[data-node-id]');
    const nodeId = nodeEl?.getAttribute('data-node-id') ?? null;
    if (nodeId) {
      setMenu({
        position: { x: e.clientX, y: e.clientY },
        items: [
          { key: 'focus', label: '聚焦此节点', icon: createElement(Crosshair, { size: 14 }), onClick: () => focusNode(nodeId) },
          { key: 'rename', label: '重命名(演示聚焦)', icon: createElement(Pencil, { size: 14 }), onClick: () => {
            focusNode(nodeId);
            const node = editor.store.getNode(nodeId);
            if (node) editor.store.renameNode(nodeId, `${node.title ?? '节点'} ✎`);
          } },
          { key: 'copy', label: '复制', icon: createElement(Copy, { size: 14 }), onClick: () => {
            editor.core.commandQueue.execute(new DuplicateNodeCommand(nodeId));
          } },
          { key: 'delete', label: '删除', icon: createElement(Trash2, { size: 14 }), danger: true, onClick: () => {
            editor.core.commandQueue.execute(new RemoveNodeCommand(nodeId));
            setMenu(null);
          } },
        ],
      });
      return;
    }
    // 空白区域:重置视口 + 提示
    setMenu({
      position: { x: e.clientX, y: e.clientY },
      items: [
        { key: 'reset', label: '重置视口', icon: createElement(RotateCcw, { size: 14 }), onClick: () => {
          editor.store.setViewport({ x: 0, y: 0, k: 0.9 });
          setMenu(null);
        } },
      ],
    });
  };

  const handleNodeDoubleClick = (nodeId: string, width: number, height: number): void => {
    if (!editor) return;
    editor.store.focusOnNode(nodeId, getContainerSize(), width, height, 400, 51);
  };

  return (
    <div style={wrapStyle(theme.mode === 'dark')}>
      <div style={titleStyle(theme.mode === 'dark')}>测试画布 · 临时（验证 ContextMenu 下沉 + 聚焦统一，双击节点 / 右键节点）</div>
      <div ref={containerRef} style={canvasBoxStyle}>
        {editor ? (
          <CanvasView
            store={editor.store}
            extensions={extensions}
            containerRef={containerRef}
            background="dots"
            backgroundColor={theme.mode === 'dark' ? '#151a24' : '#f7f8fa'}
            gridDotColor={theme.mode === 'dark' ? '#2a3444' : '#d8dee8'}
            welcomeHint="双击节点聚焦 · 右键节点菜单"
            contextMenuItems={menu?.items ?? null}
            onCanvasContextMenu={handleCanvasContextMenu}
            onNodeDoubleClick={handleNodeDoubleClick}
          />
        ) : null}
      </div>
      {menu ? <ContextMenu items={menu.items} position={menu.position} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

// ===== 样式 =====
const wrapStyle = (isDark: boolean): CSSProperties => ({
  marginTop: 32,
  border: `1px solid ${isDark ? '#2a3444' : '#e2e8f0'}`,
  borderRadius: 12,
  overflow: 'hidden',
  background: isDark ? '#151a24' : '#f7f8fa',
});

const titleStyle = (isDark: boolean): CSSProperties => ({
  padding: '8px 14px',
  fontSize: 12,
  color: isDark ? '#9aa7b8' : '#64748b',
  borderBottom: `1px solid ${isDark ? '#2a3444' : '#e2e8f0'}`,
  background: isDark ? '#1a2130' : '#ffffff',
});

const canvasBoxStyle: CSSProperties = {
  position: 'relative',
  height: 460,
  overflow: 'hidden',
};
