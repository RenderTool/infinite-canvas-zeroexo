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
import { ZoomIn, ZoomOut, Scan } from 'lucide-react';
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
  /** 平滑聚焦到世界坐标内的某矩形区域(节点双击聚焦):中心对齐视口中心 + 按比例缩放,
   *  公式与主画布 focus-geometry computeFocusTarget 一致(占视口约 paddingRatio,上限 2.0) */
  focusOnWorldRect: (rect: { x: number; y: number; width: number; height: number }, paddingRatio?: number) => void;
  /** 绑定到舞台容器(回调 ref,挂载时自动绑定原生 wheel 监听) */
  containerRef: (el: HTMLDivElement | null) => void;
  /** 绑定到图片元素:高频拖拽/缩放直接写 DOM transform,绕开 React 重渲染 */
  imgRef: (el: HTMLImageElement | null) => void;
  /** 舞台容器手势事件集 */
  containerHandlers: ImagePanZoomHandlers;
  /** 图片 transform/过渡/光标样式 */
  imgTransformStyle: CSSProperties;
}

export function useImagePanZoom(options?: { panAlways?: boolean }): ImagePanZoom {
  // panAlways(征集 #78 验收拍板):任意缩放级别都允许拖拽平移(默认仅 scale>1)
  const panAlways = options?.panAlways ?? false;
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const pendingRef = useRef<{ scale: number; x: number; y: number } | null>(null);
  const scaleRef = useRef(scale);
  const positionRef = useRef(position);
  scaleRef.current = scale;
  positionRef.current = position;
  // 图片元素 ref:高频拖拽/缩放直接写 style.transform,绕开 React 重渲染(消除主线程长任务卡顿)
  const imgRef = useRef<HTMLImageElement | null>(null);
  // 把当前 scale/position 直接写入 DOM(RAF 每帧调用,0 次 setState)
  const applyTransform = useCallback((s: number, x: number, y: number) => {
    const el = imgRef.current;
    if (el) el.style.transform = `scale(${s}) translate(${x / s}px, ${y / s}px)`;
  }, []);
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const s = Math.min(Math.max(scaleRef.current + delta, 0.25), 4);
    scaleRef.current = s; setScale(s);
    applyTransform(s, positionRef.current.x, positionRef.current.y);
  }, [applyTransform]);
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

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); if (focusAnimRef.current) cancelAnimationFrame(focusAnimRef.current); }, []);

  // 双击聚焦动画帧句柄(独立于拖拽 RAF,避免相互覆盖)
  const focusAnimRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!panAlways && scale <= 1) return;
    // 阻止浏览器默认行为(图片原生拖拽 / 文本选择),否则 pointermove 会被浏览器长任务阻塞主线程
    e.preventDefault();
    isDragging.current = true;
    // 拖拽期间临时开启 GPU 合成层,结束后移除(避免超大图常驻纹理层导致重传卡顿)
    if (imgRef.current) imgRef.current.style.willChange = 'transform';
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, [scale, panAlways]);

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
        if (pendingRef.current) {
          // 直接写 DOM,0 次 setState,彻底绕开 React 重渲染导致的长任务卡顿
          scaleRef.current = pendingRef.current.scale;
          positionRef.current = { x: pendingRef.current.x, y: pendingRef.current.y };
          applyTransform(pendingRef.current.scale, pendingRef.current.x, pendingRef.current.y);
          pendingRef.current = null;
        }
      });
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    // 拖拽结束移除 will-change,避免超大图常驻 GPU 纹理层导致后续重传卡顿
    if (imgRef.current) imgRef.current.style.willChange = 'auto';
    // 拖拽结束同步一次 React state(低频),供工具栏显示缩放值/恢复 transition 缓动
    setScale(scaleRef.current);
    setPosition({ x: positionRef.current.x, y: positionRef.current.y });
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
          if (pendingRef.current) {
            scaleRef.current = pendingRef.current.scale;
            positionRef.current = { x: pendingRef.current.x, y: pendingRef.current.y };
            applyTransform(pendingRef.current.scale, pendingRef.current.x, pendingRef.current.y);
            pendingRef.current = null;
          }
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
          if (pendingRef.current) {
            scaleRef.current = pendingRef.current.scale;
            positionRef.current = { x: pendingRef.current.x, y: pendingRef.current.y };
            applyTransform(pendingRef.current.scale, pendingRef.current.x, pendingRef.current.y);
            pendingRef.current = null;
          }
        });
      }
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const ts = touchState.current;
    if (e.touches.length === 0) ts.mode = 'none';
    else if (e.touches.length === 1 && e.touches[0]) { ts.mode = 'pan'; ts.lastX = e.touches[0].clientX; ts.lastY = e.touches[0].clientY; }
  }, []);

  const zoomIn = useCallback(() => {
    const s = Math.min(scaleRef.current + 0.25, 4);
    scaleRef.current = s; setScale(s);
    applyTransform(s, positionRef.current.x, positionRef.current.y);
  }, [applyTransform]);
  const zoomOut = useCallback(() => {
    const s = Math.max(scaleRef.current - 0.25, 0.25);
    scaleRef.current = s; setScale(s);
    applyTransform(s, positionRef.current.x, positionRef.current.y);
  }, [applyTransform]);
  const reset = useCallback(() => {
    scaleRef.current = 1; positionRef.current = { x: 0, y: 0 };
    setScale(1); setPosition({ x: 0, y: 0 });
    applyTransform(1, 0, 0);
  }, [applyTransform]);

  // 聚焦到世界坐标矩形(节点双击聚焦):中心对齐视口中心 + 按比例缩放 + 400ms 缓动。
  // 变换模型 transform=scale(s)translate(x/s,y/s)、origin 为元素中心且元素 flex 居中于容器,
  // 故世界点 P 映射到视口(以容器中心为原点)为 s·(P−C)+(x,y);令节点中心 N 归零得 (x,y)=k·(C−N)。
  const focusOnWorldRect = useCallback((rect: { x: number; y: number; width: number; height: number }, paddingRatio = 0.82) => {
    const el = imgRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const cw = container.clientWidth, ch = container.clientHeight;
    if (cw <= 0 || ch <= 0 || rect.width <= 0 || rect.height <= 0) return;
    const Cx = el.offsetWidth / 2, Cy = el.offsetHeight / 2;
    // 与主画布 computeFocusTarget 同基准:占视口约 paddingRatio(默认 0.82),上限 2.0 防小节点过度放大
    const k = Math.min((cw / rect.width) * paddingRatio, (ch / rect.height) * paddingRatio, 2.0);
    const targetX = k * (Cx - (rect.x + rect.width / 2));
    const targetY = k * (Cy - (rect.y + rect.height / 2));
    const startS = scaleRef.current, startX = positionRef.current.x, startY = positionRef.current.y;
    if (focusAnimRef.current) cancelAnimationFrame(focusAnimRef.current);
    const DUR = 400, t0 = performance.now();
    const ease = (p: number) => 1 - Math.pow(1 - p, 3);
    const step = (now: number) => {
      const p = Math.min((now - t0) / DUR, 1);
      const e = ease(p);
      const s = startS + (k - startS) * e;
      const x = startX + (targetX - startX) * e;
      const y = startY + (targetY - startY) * e;
      scaleRef.current = s; positionRef.current = { x, y };
      applyTransform(s, x, y);
      if (p < 1) focusAnimRef.current = requestAnimationFrame(step);
      else { focusAnimRef.current = 0; setScale(k); setPosition({ x: targetX, y: targetY }); }
    };
    focusAnimRef.current = requestAnimationFrame(step);
  }, [applyTransform]);

  const imgTransformStyle: CSSProperties = {
    transform: `scale(${scaleRef.current}) translate(${positionRef.current.x / scaleRef.current}px, ${positionRef.current.y / scaleRef.current}px)`,
    // 拖拽平移期间关闭过渡,避免 transform 缓动造成的拖尾呆滞;缩放/重置时保留缓动
    transition: !isDragging.current && (scaleRef.current > 1 || positionRef.current.x !== 0 || positionRef.current.y !== 0) ? 'transform 0.1s ease-out' : 'none',
    cursor: scaleRef.current > 1 ? (isDragging.current ? 'grabbing' : 'grab') : 'default',
  };

  return {
    scale,
    position,
    zoomIn,
    zoomOut,
    reset,
    focusOnWorldRect,
    containerRef: setContainerRef,
    imgRef: (el: HTMLImageElement | null) => { imgRef.current = el; },
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
  /** 图片加载完成回调(blur-up 场景:调用方据此淡出占位层) */
  onImgLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
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
  onImgLoad,
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
        ref={panZoom.imgRef}
        src={src}
        alt={alt}
        draggable={false}
        onError={onImgError}
        onLoad={onImgLoad}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          // 注意:超大图不要常驻 will-change:transform,会让浏览器永久分配 GPU 纹理层,
          // transform 变化时触发纹理重传导致秒级长帧。仅在拖拽/缩放期间由 JS 临时设置。
          backfaceVisibility: 'hidden',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          // 彻底禁止浏览器对图片的原生拖拽/手势,避免拖拽时 pointermove 长任务阻塞主线程
          pointerEvents: 'auto',
          msTouchAction: 'none',
          touchAction: 'none',
          // @ts-expect-error 非标准属性,用于禁用浏览器图片拖拽 ghost
          WebkitUserDrag: 'none',
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
        {/* 重置/适配图标改用 Scan(取景框语义):原 Maximize2 与全屏按钮视觉撞车(征集 #78 验收) */}
        <button type="button" onClick={panZoom.reset} style={btnStyle}><Scan size={13} /></button>
      </Tooltip>
    </div>
  );
}
