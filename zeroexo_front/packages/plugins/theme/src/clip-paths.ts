/**
 * 主题切换 clip-path 形状计算(纯函数,可独立测试)
 *
 * 配合 View Transitions API 使用:
 * - from: 起始收缩态(形状坍缩到中心点)
 * - to: 终止扩散态(形状覆盖整个视口)
 *
 * 沿用源项目 7 种形状语义:
 *   circle | square | triangle | diamond | hexagon | rectangle | star
 */

export type TransitionVariant =
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'hexagon'
  | 'rectangle'
  | 'star';

/** 多边形顶点全部坍缩到中心点 (cx, cy) */
function polygonCollapsed(cx: number, cy: number, vertexCount: number): string {
  const pairs: string[] = [];
  for (let i = 0; i < vertexCount; i++) {
    pairs.push(`${cx}px ${cy}px`);
  }
  return `polygon(${pairs.join(', ')})`;
}

export interface ClipPathInput {
  /** 形状 */
  variant: TransitionVariant;
  /** 中心点 X (视口坐标) */
  cx: number;
  /** 中心点 Y (视口坐标) */
  cy: number;
  /** 视口中心到四角的最大距离,用于保证扩散态覆盖整个视口 */
  maxRadius: number;
  /** 视口宽度 */
  viewportWidth: number;
  /** 视口高度 */
  viewportHeight: number;
}

/** 返回 [from, to] 两个 clip-path 字符串 */
export function getThemeTransitionClipPaths(input: ClipPathInput): [string, string] {
  const { variant, cx, cy, maxRadius, viewportWidth, viewportHeight } = input;

  switch (variant) {
    case 'circle':
      return [
        `circle(0px at ${cx}px ${cy}px)`,
        `circle(${maxRadius}px at ${cx}px ${cy}px)`,
      ];

    case 'square': {
      const halfW = Math.max(cx, viewportWidth - cx);
      const halfH = Math.max(cy, viewportHeight - cy);
      const halfSide = Math.max(halfW, halfH) * 1.05;
      const end = [
        `${cx - halfSide}px ${cy - halfSide}px`,
        `${cx + halfSide}px ${cy - halfSide}px`,
        `${cx + halfSide}px ${cy + halfSide}px`,
        `${cx - halfSide}px ${cy + halfSide}px`,
      ].join(', ');
      return [polygonCollapsed(cx, cy, 4), `polygon(${end})`];
    }

    case 'triangle': {
      const scale = maxRadius * 2.2;
      const dx = (Math.sqrt(3) / 2) * scale;
      const verts = [
        `${cx}px ${cy - scale}px`,
        `${cx + dx}px ${cy + 0.5 * scale}px`,
        `${cx - dx}px ${cy + 0.5 * scale}px`,
      ].join(', ');
      return [polygonCollapsed(cx, cy, 3), `polygon(${verts})`];
    }

    case 'diamond': {
      // 略大于 circle 半径,保证轴对齐覆盖等价于圆形扩散
      const R = maxRadius * Math.SQRT2;
      const end = [
        `${cx}px ${cy - R}px`,
        `${cx + R}px ${cy}px`,
        `${cx}px ${cy + R}px`,
        `${cx - R}px ${cy}px`,
      ].join(', ');
      return [polygonCollapsed(cx, cy, 4), `polygon(${end})`];
    }

    case 'hexagon': {
      const R = maxRadius * Math.SQRT2;
      const verts: string[] = [];
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        verts.push(`${cx + R * Math.cos(a)}px ${cy + R * Math.sin(a)}px`);
      }
      return [polygonCollapsed(cx, cy, 6), `polygon(${verts.join(', ')})`];
    }

    case 'rectangle': {
      const halfW = Math.max(cx, viewportWidth - cx);
      const halfH = Math.max(cy, viewportHeight - cy);
      const end = [
        `${cx - halfW}px ${cy - halfH}px`,
        `${cx + halfW}px ${cy - halfH}px`,
        `${cx + halfW}px ${cy + halfH}px`,
        `${cx - halfW}px ${cy + halfH}px`,
      ].join(', ');
      return [polygonCollapsed(cx, cy, 4), `polygon(${end})`];
    }

    case 'star': {
      // 略放大避免最后帧出现 1px 缝隙
      const R = maxRadius * Math.SQRT2 * 1.03;
      const innerRatio = 0.42;
      const starPolygon = (radius: number): string => {
        const verts: string[] = [];
        for (let i = 0; i < 5; i++) {
          const outerA = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          verts.push(`${cx + radius * Math.cos(outerA)}px ${cy + radius * Math.sin(outerA)}px`);
          const innerA = outerA + Math.PI / 5;
          verts.push(
            `${cx + radius * innerRatio * Math.cos(innerA)}px ${cy + radius * innerRatio * Math.sin(innerA)}px`,
          );
        }
        return `polygon(${verts.join(', ')})`;
      };
      const startR = Math.max(2, R * 0.025);
      return [starPolygon(startR), starPolygon(R)];
    }

    default:
      return [
        `circle(0px at ${cx}px ${cy}px)`,
        `circle(${maxRadius}px at ${cx}px ${cy}px)`,
      ];
  }
}
