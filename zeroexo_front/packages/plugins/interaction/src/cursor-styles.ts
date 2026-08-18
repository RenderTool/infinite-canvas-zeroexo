/**
 * 拖拽光标 CSS 注入(模块级单次)
 *
 * [data-canvas-dragging] 和 [data-canvas-space] 属性选择器优先级高于 React 内联样式,
 * 保证平移/拖拽期间光标一致为 grab/grabbing。
 */

/** 标记是否已注入 cursor CSS(模块级,只注入一次) */
let cursorStylesInjected = false;

/** 注入拖拽光标 CSS: [data-canvas-dragging] 和 [data-canvas-space] 优先级高于 React 内联样式 */
export function ensureCursorStyles(): void {
  if (cursorStylesInjected) return;
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-zeroexo-interaction-cursor', '');
  style.textContent = `
    [data-canvas-viewport][data-canvas-dragging="pan"] { cursor: grabbing !important; }
    [data-canvas-viewport][data-canvas-dragging="node"] { cursor: grabbing !important; }
    [data-canvas-viewport][data-canvas-space="true"] { cursor: grab !important; }
  `;
  document.head.appendChild(style);
  cursorStylesInjected = true;
}
