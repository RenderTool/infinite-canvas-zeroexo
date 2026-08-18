/**
 * MaskEditDialog - 局部蒙版编辑对话框(antd Modal + ThemeConfig 主题令牌)
 *
 * - 双 canvas 架构:maskCanvas(隐藏二值)+ previewCanvas(可见蓝色遮罩 + 虚线边)
 * - antd Slider/Input.TextArea + lucide 图标
 * - buildEditMask 生成 AI 所需格式(白底 + 透明孔 = 修改区)
 *
 * AI 调用由外部注入,本组件只负责蒙版绘制 + prompt 收集。
 */

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Modal, Button, Slider, Input } from 'antd';
import { Brush, Eraser, RotateCcw, Sparkles } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { readImageMeta } from '../utils/image-meta.js';
import type { MaskEditPayload, ImageMeta } from '../types.js';

export interface MaskEditDialogProps {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: MaskEditPayload) => void;
  theme: ThemeConfig;
}

type DrawMode = 'paint' | 'erase';

const DEFAULT_BRUSH_SIZE = 100;
const MASK_FILL_COLOR = 'rgba(37, 99, 235, 0.38)';
const MASK_BORDER_COLOR = 'rgba(255, 255, 255, 0.72)';

export function MaskEditDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
  theme,
}: MaskEditDialogProps): React.ReactElement | null {
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<{
    active: boolean;
    last: { x: number; y: number } | null;
  }>({ active: false, last: null });
  const [image, setImage] = useState<ImageMeta | null>(null);
  const [prompt, setPrompt] = useState('');
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [mode, setMode] = useState<DrawMode>('paint');
  const [error, setError] = useState('');

  // 重置 + 读取图片
  useEffect(() => {
    if (!open) return;
    setPrompt('');
    setBrushSize(DEFAULT_BRUSH_SIZE);
    setMode('paint');
    setError('');
    let cancelled = false;
    readImageMeta(dataUrl)
      .then((meta) => {
        if (!cancelled) setImage(meta);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dataUrl, open]);

  // 图片加载后清空 canvas
  useEffect(() => {
    clearCanvas(maskCanvasRef.current);
    clearCanvas(previewCanvasRef.current);
  }, [image]);

  const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
    const maskCanvas = maskCanvasRef.current;
    const context = maskCanvas?.getContext('2d');
    if (!context || !maskCanvas) return;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = brushSize;
    context.globalCompositeOperation =
      mode === 'paint' ? 'source-over' : 'destination-out';
    context.strokeStyle = '#000';
    context.fillStyle = '#000';
    if (!drawingRef.current.last) {
      drawMaskStroke(context, point, point, brushSize);
    } else {
      drawMaskStroke(context, drawingRef.current.last, point, brushSize);
    }
    renderMaskPreview(maskCanvas, previewCanvasRef.current);
    drawingRef.current.last = point;
    if (mode === 'paint') setError('');
  };

  const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = { active: true, last: null };
    if (maskCanvasRef.current) {
      renderMaskPreview(maskCanvasRef.current, previewCanvasRef.current);
    }
    draw(event);
  };

  const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current.active) return;
    event.preventDefault();
    draw(event);
  };

  const stopDraw = () => {
    drawingRef.current = { active: false, last: null };
    const maskCanvas = maskCanvasRef.current;
    if (maskCanvas) {
      renderMaskPreview(
        maskCanvas,
        previewCanvasRef.current,
        canvasHasPaint(maskCanvas),
      );
    }
  };

  const resetMask = () => {
    clearCanvas(maskCanvasRef.current);
    clearCanvas(previewCanvasRef.current);
    setError('');
  };

  const submit = () => {
    const nextPrompt = prompt.trim();
    const canvas = maskCanvasRef.current;
    if (!nextPrompt) {
      setError('请输入修改要求');
      return;
    }
    if (!canvas) return;
    if (!canvasHasPaint(canvas)) {
      setError('请先涂抹局部区域');
      return;
    }
    onConfirm({ prompt: nextPrompt, maskDataUrl: buildEditMask(canvas) });
  };

  const modeBtnStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    border: `1px solid ${active ? theme.toolbar.accent : 'transparent'}`,
    background: active ? `${theme.toolbar.accent}22` : theme.toolbar.editorSurface,
    color: active ? theme.toolbar.accent : theme.toolbar.textMuted,
    padding: '8px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    transition: 'all 0.15s',
  });

  return (
    <Modal
      open={open && Boolean(dataUrl)}
      onCancel={onClose}
      title="局部遮罩编辑"
      width={980}
      centered
      destroyOnHidden
      styles={{
        header: { borderBottom: 'none', marginBottom: 0, paddingBottom: 8 },
        footer: { borderTop: 'none', paddingTop: 4 },
      }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button icon={<RotateCcw size={13} />} onClick={resetMask}>重置</Button>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" icon={<Sparkles size={13} />} onClick={submit}>AI 修改</Button>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1fr) 300px', gap: 20 }}>
        {/* 左侧:图片 + 双 canvas 蒙版 */}
        <div style={{ display: 'flex', minHeight: 360, alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: theme.toolbar.editorSurface, padding: 12 }}>
          <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', userSelect: 'none' }}>
            <img
              src={dataUrl}
              alt=""
              draggable={false}
              style={{ display: 'block', maxHeight: '68vh', maxWidth: '100%' }}
            />
            {image ? (
              <>
                <canvas
                  ref={maskCanvasRef}
                  width={image.width}
                  height={image.height}
                  style={{ display: 'none' }}
                />
                <canvas
                  ref={previewCanvasRef}
                  width={image.width}
                  height={image.height}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair', touchAction: 'none' }}
                  onPointerDown={startDraw}
                  onPointerMove={moveDraw}
                  onPointerUp={stopDraw}
                  onPointerCancel={stopDraw}
                />
              </>
            ) : null}
          </div>
        </div>

        {/* 右侧:工具 + 参数 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 360 }}>
          <div style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
            {image ? `${image.width} × ${image.height} px` : '读取中'}
          </div>

          {/* 画笔/橡皮擦切换 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" onClick={() => setMode('paint')} style={modeBtnStyle(mode === 'paint')}>
              <Brush size={13} /> 画笔
            </button>
            <button type="button" onClick={() => setMode('erase')} style={modeBtnStyle(mode === 'erase')}>
              <Eraser size={13} /> 擦除
            </button>
          </div>

          {/* 笔刷大小 */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: theme.toolbar.textMuted, marginBottom: 4 }}>
              <span>笔刷大小</span>
              <span style={{ fontWeight: 600, color: theme.toolbar.text }}>{brushSize}px</span>
            </div>
            <Slider min={8} max={160} step={2} value={brushSize} onChange={(v) => setBrushSize(v)} />
          </div>

          {/* 修改要求 */}
          <div>
            <div style={{ fontSize: 12, color: theme.toolbar.textMuted, marginBottom: 6 }}>修改要求</div>
            <Input.TextArea
              rows={6}
              value={prompt}
              placeholder="例如:把选中区域改成金属材质,保持原图光影"
              onChange={(e) => {
                setPrompt(e.target.value);
                setError('');
              }}
              status={error && !prompt.trim() ? 'error' : undefined}
            />
            {error ? (
              <div style={{ fontSize: 12, color: theme.toolbar.danger, marginTop: 6, fontWeight: 500 }}>{error}</div>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ===== Canvas 辅助函数(纯逻辑,无 React 依赖) =====

function readCanvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
    y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
  };
}

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawMaskStroke(
  context: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
): void {
  if (from.x === to.x && from.y === to.y) {
    context.beginPath();
    context.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
}

function canvasHasPaint(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d');
  if (!context) return false;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < data.length; index += 4) {
    const v = data[index];
    if (v !== undefined && v > 0) return true;
  }
  return false;
}

function renderMaskPreview(
  maskCanvas: HTMLCanvasElement,
  previewCanvas: HTMLCanvasElement | null,
  withBorder = false,
): void {
  const context = previewCanvas?.getContext('2d');
  if (!previewCanvas || !context) return;
  context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  context.fillStyle = MASK_FILL_COLOR;
  context.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(maskCanvas, 0, 0);
  context.globalCompositeOperation = 'source-over';
  if (withBorder) drawDashedMaskBorder(context, maskCanvas);
}

function drawDashedMaskBorder(
  context: CanvasRenderingContext2D,
  maskCanvas: HTMLCanvasElement,
): void {
  const maskContext = maskCanvas.getContext('2d');
  if (!maskContext) return;
  const { width, height } = maskCanvas;
  const data = maskContext.getImageData(0, 0, width, height).data;
  const step = Math.max(1, Math.round(Math.max(width, height) / 1200));
  const dash = step * 8;
  const gap = step * 5;
  const period = dash + gap;

  context.save();
  context.fillStyle = MASK_BORDER_COLOR;
  context.shadowColor = 'rgba(0, 0, 0, 0.24)';
  context.shadowBlur = step * 1.5;
  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const offset = (y * width + x) * 4 + 3;
      if (data[offset] === 0 || !isMaskEdge(data, width, x, y, step)) continue;
      if ((x + y) % period > dash) continue;
      context.fillRect(x - step / 2, y - step / 2, Math.max(1.5, step), Math.max(1.5, step));
    }
  }
  context.restore();
}

function isMaskEdge(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  step: number,
): boolean {
  return (
    data[((y - step) * width + x) * 4 + 3] === 0 ||
    data[((y + step) * width + x) * 4 + 3] === 0 ||
    data[(y * width + x - step) * 4 + 3] === 0 ||
    data[(y * width + x + step) * 4 + 3] === 0
  );
}

function buildEditMask(selectionCanvas: HTMLCanvasElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = selectionCanvas.width;
  canvas.height = selectionCanvas.height;
  const context = canvas.getContext('2d');
  if (!context) return selectionCanvas.toDataURL('image/png');
  const selectionContext = selectionCanvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!selectionContext) return canvas.toDataURL('image/png');
  const selection = selectionContext.getImageData(0, 0, canvas.width, canvas.height);
  const mask = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < mask.data.length; index += 4) {
    const sel = selection.data[index];
    if (sel !== undefined && sel > 0) mask.data[index] = 0;
  }
  context.putImageData(mask, 0, 0);
  return canvas.toDataURL('image/png');
}
