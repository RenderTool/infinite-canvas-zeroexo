/**
 * HintCapsule - 画布锚定教育提示胶囊
 *
 * 世界坐标定位,字号乘 invK 保持视觉恒定。
 * 渲染于目标组标题栏上方,pointer-events:none 不干扰交互。
 */

import React from 'react';

export function HintCapsule({ x, y, invK, text, accent }: {
  x: number;
  y: number;
  invK: number;
  text: string;
  /** 强调色(加入组用绿色,移出组用默认白底黑字) */
  accent?: string;
}): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translateX(-50%)',
        padding: `${3 * invK}px ${8 * invK}px`,
        borderRadius: 999 * invK,
        backgroundColor: accent ?? 'rgba(28, 25, 23, 0.92)',
        color: '#fff',
        fontSize: 11 * invK,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        boxShadow: `0 ${2 * invK}px ${6 * invK}px rgba(0, 0, 0, 0.25)`,
        pointerEvents: 'none',
        zIndex: 20,
        userSelect: 'none',
      }}
    >
      {text}
    </div>
  );
}
