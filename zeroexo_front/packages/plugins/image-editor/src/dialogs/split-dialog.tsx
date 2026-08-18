/**
 * SplitDialog - 图片切分对话框(antd Modal + ThemeConfig 主题令牌)
 *
 * - 均匀网格 + 手动拖拽分割线微调(columnBreaks/rowBreaks 归一化)
 * - 无边框设计:预览/摘要用背景分层表达
 * - 切分操作由外部用 splitDataUrl 纯函数完成,本组件只负责参数收集
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Modal, Button, InputNumber } from 'antd';
import { RotateCcw } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { readImageMeta } from '../utils/image-meta.js';
import type { SplitParams, ImageMeta } from '../types.js';

export interface SplitDialogProps {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (params: SplitParams) => void;
  theme: ThemeConfig;
}

const MAX_GRID_SIZE = 12;
/** 相邻分割线最小间距(归一化) */
const MIN_GAP = 0.04;

function uniformBreaks(count: number): number[] {
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) => (i + 1) / count);
}

function isUniform(breaks: number[], count: number): boolean {
  const u = uniformBreaks(count);
  return breaks.length === u.length && breaks.every((b, i) => Math.abs(b - (u[i] ?? 0)) < 0.001);
}

function clampGrid(value: number): number {
  const n = Number.isFinite(value) ? Math.round(value) : 1;
  return Math.min(MAX_GRID_SIZE, Math.max(1, n));
}

export function SplitDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
  theme,
}: SplitDialogProps): React.ReactElement | null {
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(2);
  const [columnBreaks, setColumnBreaks] = useState<number[]>(() => uniformBreaks(2));
  const [rowBreaks, setRowBreaks] = useState<number[]>(() => uniformBreaks(2));
  const [image, setImage] = useState<ImageMeta | null>(null);
  const imgBoxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ axis: 'col' | 'row'; index: number } | null>(null);

  const total = rows * columns;
  const nonUniform = !isUniform(columnBreaks, columns) || !isUniform(rowBreaks, rows);
  const pieceSize: ImageMeta | null = image
    ? {
        width: Math.max(1, Math.floor(image.width / columns)),
        height: Math.max(1, Math.floor(image.height / rows)),
      }
    : null;

  // 重置参数 + 读取图片元信息
  useEffect(() => {
    if (!open) return;
    setRows(2);
    setColumns(2);
    setColumnBreaks(uniformBreaks(2));
    setRowBreaks(uniformBreaks(2));
    setImage(null);
    let cancelled = false;
    readImageMeta(dataUrl)
      .then((meta) => {
        if (!cancelled) setImage(meta);
      })
      .catch(() => {
        // 图片读取失败,忽略(pieceSize 显示未知)
      });
    return () => {
      cancelled = true;
    };
  }, [dataUrl, open]);

  const updateRows = useCallback((value: number) => {
    const next = clampGrid(value);
    setRows(next);
    setRowBreaks(uniformBreaks(next));
  }, []);

  const updateColumns = useCallback((value: number) => {
    const next = clampGrid(value);
    setColumns(next);
    setColumnBreaks(uniformBreaks(next));
  }, []);

  const resetUniform = useCallback(() => {
    setColumnBreaks(uniformBreaks(columns));
    setRowBreaks(uniformBreaks(rows));
  }, [columns, rows]);

  /** clamp 单条分割线到相邻线之间 */
  const clampBreak = useCallback((breaks: number[], index: number, pos: number): number[] => {
    const min = index === 0 ? MIN_GAP : (breaks[index - 1] ?? 0) + MIN_GAP;
    const max = index === breaks.length - 1 ? 1 - MIN_GAP : (breaks[index + 1] ?? 1) - MIN_GAP;
    const next = [...breaks];
    next[index] = Math.min(Math.max(pos, min), max);
    return next;
  }, []);

  const startDrag = useCallback(
    (axis: 'col' | 'row', index: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { axis, index };

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current;
        const box = imgBoxRef.current;
        if (!drag || !box) return;
        const rect = box.getBoundingClientRect();
        const pos =
          drag.axis === 'col'
            ? (ev.clientX - rect.left) / Math.max(1, rect.width)
            : (ev.clientY - rect.top) / Math.max(1, rect.height);
        if (drag.axis === 'col') {
          setColumnBreaks((prev) => clampBreak(prev, drag.index, pos));
        } else {
          setRowBreaks((prev) => clampBreak(prev, drag.index, pos));
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
    [clampBreak],
  );

  // ===== 派生样式(主题感知,无边框) =====
  const surface = theme.toolbar.editorSurface;
  const labelStyle: CSSProperties = { fontSize: 12, color: theme.toolbar.textMuted, marginBottom: 6, display: 'block' };
  const summaryRowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };

  return (
    <Modal
      open={open && Boolean(dataUrl)}
      onCancel={onClose}
      title="切分图片"
      width={760}
      centered
      destroyOnHidden
      styles={{
        header: { borderBottom: 'none', marginBottom: 0, paddingBottom: 8 },
        footer: { borderTop: 'none', paddingTop: 4 },
      }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {nonUniform && (
            <Button icon={<RotateCcw size={13} />} onClick={resetUniform}>
              重置为均匀
            </Button>
          )}
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={() => onConfirm({ rows, columns, columnBreaks, rowBreaks })}>
            确认切分({total})
          </Button>
        </div>
      }
    >
      <div style={{ fontSize: 12, color: theme.toolbar.textMuted, marginBottom: 12 }}>
        按网格拆分,子节点自动排列到画布 · 可拖拽分割线微调
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 220px', gap: 20 }}>
        {/* 左侧:图片 + 可拖拽网格预览 */}
        <div>
          <div
            style={{
              display: 'grid',
              minHeight: 300,
              placeItems: 'center',
              borderRadius: 10,
              background: surface,
              padding: 16,
            }}
          >
            <div ref={imgBoxRef} style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', userSelect: 'none' }}>
              <img
                src={dataUrl}
                alt=""
                draggable={false}
                style={{ display: 'block', maxHeight: 340, maxWidth: '100%', objectFit: 'contain' }}
              />
              {/* 列分割线(可拖拽) */}
              <div style={{ position: 'absolute', inset: 0 }}>
                {columnBreaks.map((b, i) => (
                  <div key={`col-${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${b * 100}%`, width: 0 }}>
                    <div
                      style={{
                        position: 'absolute', top: 0, bottom: 0, left: -1, width: 2,
                        background: 'rgba(255,255,255,0.9)', boxShadow: '0 0 0 1px rgba(0,0,0,0.35)', pointerEvents: 'none',
                      }}
                    />
                    <div
                      onPointerDown={startDrag('col', i)}
                      style={{ position: 'absolute', top: 0, bottom: 0, left: -6, width: 12, cursor: 'col-resize', touchAction: 'none' }}
                    />
                  </div>
                ))}
                {rowBreaks.map((b, i) => (
                  <div key={`row-${i}`} style={{ position: 'absolute', left: 0, right: 0, top: `${b * 100}%`, height: 0 }}>
                    <div
                      style={{
                        position: 'absolute', left: 0, right: 0, top: -1, height: 2,
                        background: 'rgba(255,255,255,0.9)', boxShadow: '0 0 0 1px rgba(0,0,0,0.35)', pointerEvents: 'none',
                      }}
                    />
                    <div
                      onPointerDown={startDrag('row', i)}
                      style={{ position: 'absolute', left: 0, right: 0, top: -6, height: 12, cursor: 'row-resize', touchAction: 'none' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: theme.toolbar.textMuted, marginTop: 10 }}>
            <span>原图</span>
            <span style={{ fontWeight: 600, color: theme.toolbar.text }}>
              {image ? `${image.width} × ${image.height} px` : '读取中'}
            </span>
          </div>
        </div>

        {/* 右侧:参数 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <span style={labelStyle}>行数</span>
            <InputNumber min={1} max={MAX_GRID_SIZE} step={1} value={rows} onChange={(v) => updateRows(Number(v ?? 1))} style={{ width: '100%' }} />
          </div>
          <div>
            <span style={labelStyle}>列数</span>
            <InputNumber min={1} max={MAX_GRID_SIZE} step={1} value={columns} onChange={(v) => updateColumns(Number(v ?? 1))} style={{ width: '100%' }} />
          </div>
          <div style={{ background: surface, borderRadius: 10, padding: '12px 14px', fontSize: 13, color: theme.toolbar.textMuted, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={summaryRowStyle}>
              <span>子节点</span>
              <span style={{ fontWeight: 600, color: theme.toolbar.text }}>{total} 个</span>
            </div>
            <div style={summaryRowStyle}>
              <span>单块约</span>
              <span style={{ fontWeight: 600, color: theme.toolbar.text }}>
                {pieceSize ? `${pieceSize.width} × ${pieceSize.height}` : '未知'}
              </span>
            </div>
            {nonUniform && (
              <div style={{ fontSize: 11, color: theme.toolbar.accent }}>已手动微调分割线</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
