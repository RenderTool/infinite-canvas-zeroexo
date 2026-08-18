/**
 * image-viewer - 全项目统一图片查看框架
 *
 * 收敛三处重复实现:AssetDetailViewer(基准) / PromptCreatePage 预览台 / 节点查看大图。
 * 交互以 AssetDetailViewer 为基准:滚轮缩放(0.25–4) + 拖拽平移(scale>1) + 触摸双指缩放(RAF 批处理)。
 *
 * 设计:
 * - useImagePanZoom:缩放/平移状态与全部手势处理;
 * - ImageViewerStage:舞台容器,**不内置任何工具栏**,children 为绝对定位浮层由调用方自由排版;
 * - ZoomToolbar:预设缩放工具条(缩小/百分比/放大/重置),支持水平/垂直两种排布。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { Tooltip } from 'antd';

// ===== 缩放/平移 Hook =====

export interface ImagePanZoomHandlers {
  onMouseDown: React.MouseEventHandler<HTMLDivElement>;
  onMouseMove: React.MouseEventHandler<HTMLDivElement>;
  onMouseUp: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave: React.MouseEventHandler<HTMLDivElement>;
  onTouchStart: React.TouchEventHandler<HTMLDivElement>;
  onTouchMove: React.TouchEventHandler<HTMLDivElement>;
  onTouchEnd: React.TouchEventHandler<HTMLDivElement>;
}

export interface ImagePanZoom {
  scale: number;
  position: { x: number; y: number };
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /** 绑定到舞台容器(回调 ref,挂载时自动绑定原生 wheel 监听) */
  containerRef: (el: HTMLDivElement | null) => void;
  /** 舞台容器手势事件集 */
  containerHandlers: ImagePanZoomHandlers;
  /** 图片 transform/过渡/光标样式 */
  imgTransformStyle: CSSProperties;
}

export function useImagePanZoom(): ImagePanZoom {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((prev) => Math.min(Math.max(0.25, prev + delta), 4));
  }, []);
  // 用回调 ref 在元素挂载时即绑定原生 wheel 监听,避免依赖 useEffect 时机
  // (StrictMode 双调用 / 调用方覆盖 ref 时也能稳定生效)
  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    const prev = containerRef.current;
    if (prev && prev !== el) prev.removeEventListener('wheel', handleWheel);
    containerRef.current = el;
    if (el) el.addEventListener('wheel', handleWheel, { passive: false });
  }, [handleWheel]);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const touchState = useRef<{
    mode: 'none' | 'pan' | 'pinch';
    distance: number; centerX: number; centerY: number;
    startScale: number; startScaleX: number; startScaleY: number;
    lastX: number; lastY: number;
  }>({ mode: 'none', distance: 0, centerX: 0, centerY: 0, startScale: 1, startScaleX: 0, startScaleY: 0, lastX: 0, lastY: 0 });

  const rafRef = useRef(0);
  const pendingRef = useRef<{ scale: number; x: number; y: number } | null>(null);
  const scaleRef = useRef(scale);
  const positionRef = useRef(position);
  scaleRef.current = scale;
  positionRef.current = position;

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, [scale]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    // 复用 RAF 批处理,避免 mousemove 高频触发 setState 造成重渲染卡顿
    const baseX = pendingRef.current?.x ?? positionRef.current.x;
    const baseY = pendingRef.current?.y ?? positionRef.current.y;
    pendingRef.current = { scale: scaleRef.current, x: baseX + dx, y: baseY + dy };
    if (rafRef.current === 0) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        if (pendingRef.current) { setScale(pendingRef.current.scale); setPosition({ x: pendingRef.current.x, y: pendingRef.current.y }); pendingRef.current = null; }
      });
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    // 触发一次重渲染,使拖拽结束后 transition 恢复(用于缩放/重置缓动)
    setPosition((prev) => ({ ...prev }));
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!e.touches[0]) return;
    if (e.touches.length === 1) {
      touchState.current = { ...touchState.current, mode: 'pan', lastX: e.touches[0].clientX, lastY: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      if (!t1 || !t2) return;
      const dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY;
      touchState.current = {
        mode: 'pinch', distance: Math.hypot(dx, dy),
        centerX: (t1.clientX + t2.clientX) / 2, centerY: (t1.clientY + t2.clientY) / 2,
        startScale: scaleRef.current, startScaleX: positionRef.current.x, startScaleY: positionRef.current.y, lastX: 0, lastY: 0,
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!e.touches[0]) return;
    const ts = touchState.current;
    if (ts.mode === 'pan' && e.touches.length === 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - ts.lastX, dy = e.touches[0].clientY - ts.lastY;
      const baseX = pendingRef.current?.x ?? positionRef.current.x, baseY = pendingRef.current?.y ?? positionRef.current.y;
      pendingRef.current = { scale: scaleRef.current, x: baseX + dx, y: baseY + dy };
      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          if (pendingRef.current) { setScale(pendingRef.current.scale); setPosition({ x: pendingRef.current.x, y: pendingRef.current.y }); pendingRef.current = null; }
        });
      }
      ts.lastX = e.touches[0].clientX; ts.lastY = e.touches[0].clientY;
    } else if (ts.mode === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0], t2 = e.touches[1];
      if (!t1 || !t2) return;
      const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const newCX = (t1.clientX + t2.clientX) / 2, newCY = (t1.clientY + t2.clientY) / 2;
      const factor = newDist / ts.distance;
      const newScale = Math.min(Math.max(ts.startScale * factor, 0.25), 4);
      pendingRef.current = { scale: newScale, x: ts.startScaleX + (newCX - ts.centerX), y: ts.startScaleY + (newCY - ts.centerY) };
      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          if (pendingRef.current) { setScale(pendingRef.current.scale); setPosition({ x: pendingRef.current.x, y: pendingRef.current.y }); pendingRef.current = null; }
        });
      }
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const ts = touchState.current;
    if (e.touches.length === 0) ts.mode = 'none';
    else if (e.touches.length === 1 && e.touches[0]) { ts.mode = 'pan'; ts.lastX = e.touches[0].clientX; ts.lastY = e.touches[0].clientY; }
  }, []);

  const zoomIn = useCallback(() => setScale((p) => Math.min(p + 0.25, 4)), []);
  const zoomOut = useCallback(() => setScale((p) => Math.max(p - 0.25, 0.25)), []);
  const reset = useCallback(() => { setScale(1); setPosition({ x: 0, y: 0 }); }, []);

  const imgTransformStyle: CSSProperties = {
    transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
    // 拖拽平移期间关闭过渡,避免 transform 缓动造成的拖尾呆滞;缩放/重置时保留缓动
    transition: !isDragging.current && (scale > 1 || position.x !== 0 || position.y !== 0) ? 'transform 0.1s ease-out' : 'none',
    cursor: scale > 1 ? (isDragging.current ? 'grabbing' : 'grab') : 'default',
  };

  return {
    scale,
    position,
    zoomIn,
    zoomOut,
    reset,
    containerRef: setContainerRef,
    containerHandlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
    imgTransformStyle,
  };
}

// ===== 舞台组件 =====

export interface ImageViewerStageProps {
  src: string;
  alt?: string;
  panZoom: ImagePanZoom;
  /** 舞台容器附加样式(背景/圆角/尺寸),与默认样式合并 */
  containerStyle?: CSSProperties;
  /** 图片附加样式(objectFit/圆角/阴影等),与 transform 样式合并 */
  imgStyle?: CSSProperties;
  onImgError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  /** 双击重置视角(节点查看大图场景) */
  resetOnDoubleClick?: boolean;
  /** 容器附加属性(onMouseEnter/Leave 等浮层控制),手势事件自动与内部合并 */
  containerProps?: React.HTMLAttributes<HTMLDivElement>;
  /** 绝对定位浮层(工具栏/角标/底部信息),由调用方自由排版 */
  children?: React.ReactNode;
}

export function ImageViewerStage({
  src,
  alt = '',
  panZoom,
  containerStyle,
  imgStyle,
  onImgError,
  resetOnDoubleClick = false,
  containerProps,
  children,
}: ImageViewerStageProps): React.ReactElement {
  const { style: propStyle, onMouseLeave: propMouseLeave, onDoubleClick: propDoubleClick, ...restProps } = containerProps ?? {};
  const h = panZoom.containerHandlers;
  return (
    <div
      {...restProps}
      ref={panZoom.containerRef}
      onMouseDown={h.onMouseDown}
      onMouseMove={h.onMouseMove}
      onMouseUp={h.onMouseUp}
      onMouseLeave={(e) => { h.onMouseLeave(e); propMouseLeave?.(e); }}
      onTouchStart={h.onTouchStart}
      onTouchMove={h.onTouchMove}
      onTouchEnd={h.onTouchEnd}
      onDoubleClick={(e) => { if (resetOnDoubleClick) panZoom.reset(); propDoubleClick?.(e); }}
      style={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        touchAction: 'none',
        userSelect: 'none',
        ...containerStyle,
        ...propStyle,
      }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onError={onImgError}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          ...imgStyle,
          ...panZoom.imgTransformStyle,
        }}
      />
      {children}
    </div>
  );
}

// ===== 预设缩放工具条 =====

export interface ZoomToolbarProps {
  panZoom: ImagePanZoom;
  /** 排布方向:水平(资产查看器)/垂直(提示词预览台) */
  orientation?: 'horizontal' | 'vertical';
  /** 附加样式(定位由调用方决定) */
  style?: CSSProperties;
}

export function ZoomToolbar({ panZoom, orientation = 'horizontal', style }: ZoomToolbarProps): React.ReactElement {
  const { t } = useTranslation();
  const isVertical = orientation === 'vertical';
  const btnStyle: CSSProperties = {
    width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.85)', cursor: 'pointer',
  };
  return (
    <div style={{
      display: 'flex',
      flexDirection: isVertical ? 'column' : 'row',
      alignItems: 'center',
      gap: 2,
      padding: isVertical ? '4px 4px' : '4px 6px',
      borderRadius: 8,
      background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(8px)',
      ...style,
    }}>
      <Tooltip title={t('resourceViewer.zoomOut')}>
        <button type="button" onClick={panZoom.zoomOut} style={btnStyle}><ZoomOut size={13} /></button>
      </Tooltip>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', minWidth: 36, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(panZoom.scale * 100)}%
      </span>
      <Tooltip title={t('resourceViewer.zoomIn')}>
        <button type="button" onClick={panZoom.zoomIn} style={btnStyle}><ZoomIn size={13} /></button>
      </Tooltip>
      <Tooltip title={t('resourceViewer.reset')}>
        <button type="button" onClick={panZoom.reset} style={btnStyle}><Maximize2 size={13} /></button>
      </Tooltip>
    </div>
  );
}
