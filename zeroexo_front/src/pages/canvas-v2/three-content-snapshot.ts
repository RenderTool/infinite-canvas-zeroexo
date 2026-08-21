/**
 * 内容快照器（Plan#27 T4R 全面 Three.js；T0-A POC 管线生产化）
 *
 * 把「隐藏容器中真实渲染的节点内容 DOM」截为 canvas：
 * - clone + computed style 白名单内联 → foreignObject SVG（跨文档样式丢失修复）
 * - img src 绝对化（foreignObject 中相对 URL 相对 data: 解析失效）
 * - canvas 元素内容兜底重绘（clone 后画布内容丢失）
 * - 采样倍率 scale：低缩放低分辨率（省显存/快照耗时），放大重拍高清
 */

/** 关键样式属性白名单（覆盖快照所需，避免全量 ~300 属性导致 SVG 臃肿） */
const STYLE_KEYS = [
  'display', 'position', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
  'borderWidth', 'borderStyle', 'borderColor', 'borderRadius',
  'background', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  'color', 'font', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'textAlign',
  'textDecoration', 'textOverflow', 'whiteSpace', 'wordBreak', 'overflow', 'overflowWrap',
  'boxShadow', 'opacity', 'flex', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'gap',
  'transform', 'transformOrigin', 'verticalAlign', 'letterSpacing', 'tableLayout', 'borderCollapse',
  'cursor', 'pointerEvents', 'userSelect', 'textTransform',
];

function inlineStyles(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const elements: Element[] = [];
  let el = walker.currentNode as Element | null;
  do {
    if (el) elements.push(el);
  } while ((el = walker.nextNode() as Element | null));
  for (const e of elements) {
    const cs = getComputedStyle(e);
    for (const key of STYLE_KEYS) {
      const v = cs.getPropertyValue(key);
      if (v) (e as HTMLElement).style.setProperty(key, v);
    }
  }
}

function absolutizeImages(root: HTMLElement): void {
  const imgs = root.querySelectorAll('img');
  for (const img of imgs) {
    // clone 后 .src 已按主文档解析为绝对 URL；无 src 的占位图跳过
    if (img.getAttribute('src')) img.src = img.src;
    if (img.getAttribute('srcset')) img.srcset = img.srcset; // srcset 同理会解析为绝对
  }
}

function redrawCanvases(srcRoot: HTMLElement, cloneRoot: HTMLElement): void {
  const srcs = srcRoot.querySelectorAll('canvas');
  const clones = cloneRoot.querySelectorAll('canvas');
  for (let i = 0; i < srcs.length && i < clones.length; i++) {
    const s = srcs[i];
    const c = clones[i];
    if (!s || !c || s.width === 0 || s.height === 0) continue;
    c.width = s.width;
    c.height = s.height;
    const ctx = c.getContext('2d');
    if (ctx) ctx.drawImage(s, 0, 0);
  }
}

/**
 * 离屏 DOM → canvas（foreignObject SVG → Image 管线）
 * @returns 快照 canvas（sw×sh，scale 采样倍率）；失败返回 null（调用方重试或跳过）
 */
export function snapshotElementToCanvas(el: HTMLElement, scale: number): Promise<HTMLCanvasElement | null> {
  const rect = el.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const sw = Math.min(2048, Math.max(1, Math.round(w * scale)));
  const sh = Math.min(2048, Math.max(1, Math.round(h * scale)));
  if (sw * sh > 2048 * 2048) return Promise.resolve(null); // 超限快照跳过（等同 LOD 降级）

  const clone = el.cloneNode(true) as HTMLElement;
  inlineStyles(clone);
  absolutizeImages(clone);
  redrawCanvases(el, clone);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${sw}px;height:${sh}px;overflow:hidden">${clone.outerHTML}</div>` +
    `</foreignObject></svg>`;
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, sw, sh);
        resolve(canvas);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
