/**
 * CropDialog - 图片裁剪对话框(antd Modal + ThemeConfig 主题令牌)
 * 特性: 8 手柄拖拽 + 锁比例 + 九宫格辅助线 + 归一化 0-1 比例
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Modal, Button } from 'antd';
import { Lock, Unlock } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { readImageMeta } from '../utils/image-meta.js';
import type { CropRect, ImageMeta } from '../types.js';

export interface CropDialogProps {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (crop: CropRect) => void;
  theme: ThemeConfig;
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];
type DragMode = 'move' | 'resize';

const MIN_SIZE = 0.06;
const DEFAULT_CROP: CropRect = { x: 0.12, y: 0.12, width: 0.76, height: 0.76 };

export function CropDialog({ dataUrl, open, onClose, onConfirm, theme }: CropDialogProps): React.ReactElement {
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP);
  const [locked, setLocked] = useState(true);
  const [image, setImage] = useState<ImageMeta | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: DragMode;
    handle?: Handle;
    startX: number;
    startY: number;
    startCrop: CropRect;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setCrop(DEFAULT_CROP);
    setLocked(true);
    readImageMeta(dataUrl).then(setImage).catch(() => setImage(null));
  }, [open, dataUrl]);

  const startDrag = useCallback(
    (mode: DragMode, e: React.PointerEvent, handle?: Handle) => {
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = {
        mode,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startCrop: { ...crop },
      };

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || !boxRef.current) return;
        const rect = boxRef.current.getBoundingClientRect();
        const dx = (ev.clientX - drag.startX) / rect.width;
        const dy = (ev.clientY - drag.startY) / rect.height;

        if (drag.mode === 'move') {
          setCrop({
            ...drag.startCrop,
            x: Math.max(0, Math.min(1 - drag.startCrop.width, drag.startCrop.x + dx)),
            y: Math.max(0, Math.min(1 - drag.startCrop.height, drag.startCrop.y + dy)),
          });
        } else if (drag.handle) {
          resizeCrop(drag.handle, dx, dy, drag.startCrop, locked);
        }
      };

      const onUp = () => {
        dragRef.current = null;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [crop, locked],
  );

  function resizeCrop(
    handle: Handle,
    dx: number,
    dy: number,
    start: CropRect,
    isLocked: boolean,
  ): void {
    let { x, y, width, height } = start;

    if (handle.includes('e')) width = Math.max(MIN_SIZE, start.width + dx);
    if (handle.includes('s')) height = Math.max(MIN_SIZE, start.height + dy);
    if (handle.includes('w')) {
      const newWidth = Math.max(MIN_SIZE, start.width - dx);
      x = start.x + (start.width - newWidth);
      width = newWidth;
    }
    if (handle.includes('n')) {
      const newHeight = Math.max(MIN_SIZE, start.height - dy);
      y = start.y + (start.height - newHeight);
      height = newHeight;
    }

    // 锁比例: 取变化较大的维度作基准
    if (isLocked) {
      const ratio = start.width / start.height;
      if (Math.abs(width - start.width) > Math.abs(height - start.height)) {
        height = width / ratio;
        if (handle.includes('n')) y = start.y + (start.height - height);
      } else {
        width = height * ratio;
        if (handle.includes('w')) x = start.x + (start.width - width);
      }
    }

    // clamp 到 [0,1] 边界
    x = Math.max(0, x);
    y = Math.max(0, y);
    if (x + width > 1) width = 1 - x;
    if (y + height > 1) height = 1 - y;
    width = Math.max(MIN_SIZE, width);
    height = Math.max(MIN_SIZE, height);

    setCrop({ x, y, width, height });
  }

  // 裁剪尺寸(像素)
  const cropWidthPx = image ? Math.round(crop.width * image.width) : 0;
  const cropHeightPx = image ? Math.round(crop.height * image.height) : 0;

  // 比例最简比
  function formatRatio(w: number, h: number): string {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(w, h) || 1;
    return `${w / g}:${h / g}`;
  }

  // 手柄位置样式
  function handleStyle(handle: Handle): React.CSSProperties {
    const s: React.CSSProperties = {
      position: 'absolute',
      width: 12,
      height: 12,
      background: '#fff',
      borderRadius: '50%',
      border: `2px solid ${theme.toolbar.accent}`,
      cursor: `${handle}-resize`,
      touchAction: 'none',
    };
    if (handle.includes('n')) s.top = -6;
    if (handle.includes('s')) s.top = 'calc(100% - 6px)';
    if (handle.includes('w')) s.left = -6;
    if (handle.includes('e')) s.left = 'calc(100% - 6px)';
    if (handle === 'n' || handle === 's') s.left = 'calc(50% - 6px)';
    if (handle === 'w' || handle === 'e') s.top = 'calc(50% - 6px)';
    return s;
  }

  const infoRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
    color: theme.toolbar.textMuted,
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="裁剪图片"
      width={800}
      centered
      destroyOnHidden
      styles={{
        header: { borderBottom: 'none', marginBottom: 0, paddingBottom: 8 },
        footer: { borderTop: 'none', paddingTop: 4 },
      }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={() => setCrop(DEFAULT_CROP)}>重置</Button>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={() => onConfirm(crop)}>确认裁剪</Button>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* 图片 + 裁剪框 */}
        <div
          ref={boxRef}
          style={{
            position: 'relative',
            display: 'inline-block',
            overflow: 'hidden',
            borderRadius: 10,
            background: theme.toolbar.editorSurface,
            userSelect: 'none',
            maxWidth: 540,
            flex: 1,
            minWidth: 0,
          }}
        >
          <img
            src={dataUrl}
            alt="crop"
            draggable={false}
            style={{ display: 'block', maxWidth: '100%', maxHeight: '60vh' }}
          />
          {/* 4 块遮罩(裁剪框外) */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: `${crop.y * 100}%`, background: 'rgba(0,0,0,0.55)' }} />
            <div style={{ position: 'absolute', left: 0, bottom: 0, right: 0, height: `${(1 - crop.y - crop.height) * 100}%`, background: 'rgba(0,0,0,0.55)' }} />
            <div style={{ position: 'absolute', left: 0, top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%`, background: 'rgba(0,0,0,0.55)' }} />
            <div style={{ position: 'absolute', right: 0, top: `${crop.y * 100}%`, width: `${(1 - crop.x - crop.width) * 100}%`, height: `${crop.height * 100}%`, background: 'rgba(0,0,0,0.55)' }} />
          </div>
          {/* 裁剪框 */}
          <div
            style={{
              position: 'absolute',
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.width * 100}%`,
              height: `${crop.height * 100}%`,
              border: '2px solid #fff',
              boxSizing: 'border-box',
              cursor: 'move',
              touchAction: 'none',
            }}
            onPointerDown={(e) => startDrag('move', e)}
          >
            {/* 九宫格辅助线 */}
            <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, borderLeft: '1px solid rgba(255,255,255,0.4)' }} />
            <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, borderLeft: '1px solid rgba(255,255,255,0.4)' }} />
            <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.4)' }} />
            <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.4)' }} />
            {/* 8 手柄 */}
            {HANDLES.map((h) => (
              <div
                key={h}
                style={handleStyle(h)}
                onPointerDown={(e) => startDrag('resize', e, h)}
              />
            ))}
          </div>
        </div>

        {/* 信息面板 — 无边框,背景分层 */}
        <div style={{ width: 200, display: 'flex', flexDirection: 'column', gap: 10, background: theme.toolbar.editorSurface, borderRadius: 10, padding: '14px 16px', flexShrink: 0 }}>
          <div style={infoRowStyle}>
            <span>裁剪尺寸</span>
            <span style={{ fontWeight: 600, color: theme.toolbar.text }}>{cropWidthPx} × {cropHeightPx}</span>
          </div>
          <div style={infoRowStyle}>
            <span>比例</span>
            <span style={{ fontWeight: 600, color: theme.toolbar.text }}>
              {cropWidthPx > 0 && cropHeightPx > 0 ? formatRatio(cropWidthPx, cropHeightPx) : '-'}
            </span>
          </div>
          {image && (
            <div style={infoRowStyle}>
              <span>原图</span>
              <span style={{ fontWeight: 600, color: theme.toolbar.text }}>{image.width} × {image.height}</span>
            </div>
          )}
          <Button
            type={locked ? 'primary' : 'default'}
            icon={locked ? <Lock size={13} /> : <Unlock size={13} />}
            onClick={() => setLocked(!locked)}
            style={{ marginTop: 4 }}
          >
            {locked ? '锁比例' : '自由比例'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
