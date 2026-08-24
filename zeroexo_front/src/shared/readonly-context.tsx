import { createContext, useContext } from 'react';

/**
 * 全局只读模式上下文（协作 viewer / 无 edit 权限，2026-08-25 系统性只读防护引入）。
 *
 * 背景：只读遮罩只能拦截画布内 DOM 事件，管不到三类编辑入口——
 * ① portal 浮层（NodeCapsuleToolbar / NodeGenerateDock 渲染到 body，逃逸遮罩）；
 * ② 画布外组件（层级面板的重命名/拖拽换父）；
 * ③ 键盘快捷键（Delete 删除 / Ctrl+D 复制 / Ctrl+Z 撤销，遮罩拦不住 window 级监听）。
 * 统一方案：editor-page 以 isReadOnlyViewer 提供本上下文，所有编辑入口消费 useReadOnly() 禁用。
 * React Context 可穿透 createPortal——portal 组件仍在原 React 树中，同样受控。
 */
export const ReadOnlyContext = createContext(false);
export const ReadOnlyProvider = ReadOnlyContext.Provider;

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}
