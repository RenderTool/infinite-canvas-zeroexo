/**
 * UpscaleDialog - 图片放大对话框
 *
 * - 自研 Modal/Button + Segmented(零 antd)
 * - 3 档目标像素(1K/2K/4K)+ 3 算法(high/bilinear/nearest)
 * - 自动选择默认目标(源图长边 < 档位 的第一档)
 * - canUpscale 判断(源图已达标时禁用按钮)
 *
 * 放大操作由外部用 upscaleDataUrl 纯函数完成,本组件只负责参数收集。
 */

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Modal, Button } from './modal.js';
import { readImageMeta } from '../utils/image-meta.js';
import { resolveUpscaleSize } from '../utils/image-ops.js';
import {
  UPSCALE_TARGETS,
  UPSCALE_ALGORITHMS,
  MAX_UPSCALE_LONG_EDGE,
} from '../types.js';
import type { UpscaleParams, UpscaleAlgorithm, ImageMeta } from '../types.js';

export interface UpscaleDialogProps {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (params: UpscaleParams) => void;
}

const DEFAULT_PARAMS: UpscaleParams = {
  targetLongEdge: 2048,
  algorithm: 'high',
};

export function UpscaleDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
}: UpscaleDialogProps): React.ReactElement | null {
  const [params, setParams] = useState<UpscaleParams>(DEFAULT_PARAMS);
  const [image, setImage] = useState<ImageMeta | null>(null);

  const sourceLongEdge = image ? Math.max(image.width, image.height) : 0;
  const outputSize = useMemo(
    () =>
      image
        ? resolveUpscaleSize(image.width, image.height, params.targetLongEdge)
        : null,
    [image, params.targetLongEdge],
  );
  const canUpscale = Boolean(
    image &&
      sourceLongEdge < params.targetLongEdge &&
      params.targetLongEdge <= MAX_UPSCALE_LONG_EDGE,
  );
  const reachedMax = Boolean(image && sourceLongEdge >= MAX_UPSCALE_LONG_EDGE);

  // 重置 + 读取图片
  useEffect(() => {
    if (!open) return;
    setParams(DEFAULT_PARAMS);
    setImage(null);
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

  // 自动选择默认目标(源图长边 < 档位 的第一档)
  useEffect(() => {
    if (!image) return;
    const nextTarget =
      UPSCALE_TARGETS.find((option) => sourceLongEdge < option.value)?.value ??
      MAX_UPSCALE_LONG_EDGE;
    setParams((current) => ({ ...current, targetLongEdge: nextTarget }));
  }, [image, sourceLongEdge]);

  return (
    <Modal
      open={open && Boolean(dataUrl)}
      onClose={onClose}
      title="图片放大"
      width={760}
      footer={
        <>
          <Button variant="default" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!canUpscale}
            onClick={() => onConfirm(params)}
          >
            生成放大图
          </Button>
        </>
      }
    >
      <div style={layoutStyle}>
        {/* 左侧:源图预览 */}
        <div style={previewBoxStyle}>
          <div style={previewInnerStyle}>
            <img
              src={dataUrl}
              alt=""
              draggable={false}
              style={{
                display: 'block',
                maxHeight: 320,
                maxWidth: '100%',
                objectFit: 'contain',
                borderRadius: 8,
              }}
            />
          </div>
          <div style={metaRowStyle}>
            <span>源图</span>
            <span style={{ fontWeight: 600 }}>
              {image ? `${image.width} × ${image.height} px` : '读取中'}
            </span>
          </div>
        </div>
        {/* 右侧:参数 */}
        <div style={paramsColStyle}>
          <div>
            <div style={fieldLabelStyle}>目标像素</div>
            <Segmented
              value={params.targetLongEdge}
              options={UPSCALE_TARGETS.map((option) => ({
                label: `${option.label} · ${option.value}px`,
                value: option.value,
                disabled: Boolean(image && sourceLongEdge >= option.value),
              }))}
              onChange={(value) =>
                setParams((current) => ({ ...current, targetLongEdge: value }))
              }
            />
            {image && !canUpscale ? (
              <div style={warnStyle}>
                {reachedMax ? '图片已达到 4K,无需放大' : '图片已达到当前目标像素,无需放大'}
              </div>
            ) : null}
          </div>
          <div>
            <div style={fieldLabelStyle}>放大算法</div>
            <Segmented
              value={params.algorithm}
              options={UPSCALE_ALGORITHMS.map((item) => ({
                label: (
                  <span style={algoLabelStyle}>
                    <span style={{ fontWeight: 600 }}>{item.title}</span>
                    <span style={algoDescStyle}>{item.description}</span>
                  </span>
                ),
                value: item.value,
              }))}
              onChange={(value) =>
                setParams((current) => ({
                  ...current,
                  algorithm: value as UpscaleAlgorithm,
                }))
              }
            />
          </div>
          <div style={summaryBoxStyle}>
            <div style={summaryRowStyle}>
              <span>输出尺寸</span>
              <span style={{ fontWeight: 600 }}>
                {outputSize ? `${outputSize.width} × ${outputSize.height} px` : '未知'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ===== 自研 Segmented(分段选择器,零 antd) =====

interface SegmentedOption<T> {
  label: ReactNode;
  value: T;
  disabled?: boolean;
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}): React.ReactElement {
  return (
    <div style={segmentedContainerStyle}>
      {options.map((option) => {
        const active = option.value === value;
        const disabled = option.disabled;
        return (
          <button
            key={String(option.value)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            style={{
              ...segmentedItemStyle,
              ...(active ? segmentedActiveStyle : {}),
              ...(disabled ? segmentedDisabledStyle : {}),
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ===== 样式 =====

const layoutStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 1fr) 320px',
  gap: 24,
};

const previewBoxStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  padding: 16,
};

const previewInnerStyle: CSSProperties = {
  display: 'grid',
  minHeight: 280,
  placeItems: 'center',
  borderRadius: 8,
  background: 'rgba(0,0,0,0.3)',
};

const metaRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 13,
  color: '#a0a0c0',
  marginTop: 12,
};

const paramsColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 13,
  color: '#a0a0c0',
  marginBottom: 8,
};

const warnStyle: CSSProperties = {
  fontSize: 12,
  color: '#ef4444',
  marginTop: 8,
  fontWeight: 500,
};

const summaryBoxStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  padding: '12px 14px',
  fontSize: 13,
  color: '#a0a0c0',
};

const summaryRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const algoLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  textAlign: 'left' as const,
  lineHeight: 1.4,
  padding: '6px 0',
};

const algoDescStyle: CSSProperties = {
  fontSize: 11,
  opacity: 0.6,
  marginTop: 2,
};

const segmentedContainerStyle: CSSProperties = {
  display: 'flex',
  gap: 2,
  background: 'rgba(255,255,255,0.05)',
  borderRadius: 8,
  padding: 2,
};

const segmentedItemStyle: CSSProperties = {
  flex: 1,
  border: 'none',
  background: 'transparent',
  color: '#a0a0c0',
  padding: '8px 12px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  transition: 'all 0.15s',
};

const segmentedActiveStyle: CSSProperties = {
  background: 'rgba(233, 69, 96, 0.15)',
  color: '#e94560',
  fontWeight: 600,
};

const segmentedDisabledStyle: CSSProperties = {
  opacity: 0.4,
  cursor: 'not-allowed',
};
