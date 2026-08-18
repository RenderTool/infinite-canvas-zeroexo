/**
 * AngleDialog - AI 多角度生成对话框
 *
 * - 自研 Modal/Button + 原生 range slider(零 antd Slider/Segmented)
 * - CSS perspective 3D 预览(perspective(520px) rotateY rotateX scale)
 * - 系数:rotateY = horizontalAngle * -0.45, rotateX = pitchAngle * 0.35
 *         scale = 1.08 - cameraDistance * 0.035 + (wideAngle ? -0.08 : 0),clamp [0.72, 1.08]
 *
 * AI 调用由外部注入,本组件只负责参数收集。
 */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Modal, Button } from './modal.js';
import type { AngleParams } from '../types.js';

export interface AngleDialogProps {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (params: AngleParams) => void;
}

const DEFAULT_PARAMS: AngleParams = {
  horizontalAngle: 0,
  pitchAngle: 9,
  cameraDistance: 4.8,
  wideAngle: false,
};

export function AngleDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
}: AngleDialogProps): React.ReactElement | null {
  const [params, setParams] = useState<AngleParams>(DEFAULT_PARAMS);

  useEffect(() => {
    if (open) setParams(DEFAULT_PARAMS);
  }, [dataUrl, open]);

  const update = <K extends keyof AngleParams>(
    key: K,
    value: AngleParams[K],
  ): void => {
    setParams((current) => ({ ...current, [key]: value }));
  };

  return (
    <Modal
      open={open && Boolean(dataUrl)}
      onClose={onClose}
      title="AI 多角度"
      width={820}
      footer={
        <>
          <Button variant="default" onClick={() => setParams(DEFAULT_PARAMS)}>
            重置
          </Button>
          <Button variant="default" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => onConfirm(params)}>
            AI 生成
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 13, color: '#a0a0c0', marginBottom: 16 }}>
        左侧只预览方向,结果会基于原图重新生成
      </div>
      <div style={layoutStyle}>
        {/* 左侧:3D 预览 */}
        <div style={previewBoxStyle}>
          <div style={previewInnerStyle}>
            <div style={{ position: 'relative' }}>
              <img
                src={dataUrl}
                alt=""
                draggable={false}
                style={{
                  width: 192,
                  height: 192,
                  borderRadius: 16,
                  objectFit: 'cover',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                  transform: previewTransform(params),
                }}
              />
              <div style={shadowStyle} />
            </div>
          </div>
        </div>

        {/* 右侧:参数 */}
        <div style={paramsColStyle}>
          <AngleSlider
            label="左右角度"
            value={params.horizontalAngle}
            min={-60}
            max={60}
            step={1}
            suffix="°"
            onChange={(v) => update('horizontalAngle', v)}
          />
          <AngleSlider
            label="俯仰角度"
            value={params.pitchAngle}
            min={-45}
            max={45}
            step={1}
            suffix="°"
            onChange={(v) => update('pitchAngle', v)}
          />
          <AngleSlider
            label="镜头距离"
            value={params.cameraDistance}
            min={1}
            max={10}
            step={0.1}
            onChange={(v) => update('cameraDistance', v)}
          />
          <div style={fieldRowStyle}>
            <span style={fieldLabelTextStyle}>广角镜头</span>
            <div style={segmentedStyle}>
              <button
                type="button"
                onClick={() => update('wideAngle', false)}
                style={{
                  ...segBtnStyle,
                  ...(!params.wideAngle ? segBtnActiveStyle : {}),
                }}
              >
                标准
              </button>
              <button
                type="button"
                onClick={() => update('wideAngle', true)}
                style={{
                  ...segBtnStyle,
                  ...(params.wideAngle ? segBtnActiveStyle : {}),
                }}
              >
                广角
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ===== 子组件 =====

function AngleSlider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}): React.ReactElement {
  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelTextStyle}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: '#e94560' }}
      />
      <span style={valueTextStyle}>
        {Number.isInteger(value) ? value : value.toFixed(1)}
        {suffix}
      </span>
    </div>
  );
}

// ===== 辅助 =====

function previewTransform(params: AngleParams): string {
  const scale =
    1.08 - params.cameraDistance * 0.035 + (params.wideAngle ? -0.08 : 0);
  return `perspective(520px) rotateY(${params.horizontalAngle * -0.45}deg) rotateX(${params.pitchAngle * 0.35}deg) scale(${Math.max(0.72, Math.min(1.08, scale))})`;
}

// ===== 样式 =====

const layoutStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 1fr) 340px',
  gap: 24,
};

const previewBoxStyle: CSSProperties = {
  display: 'flex',
  minHeight: 300,
  flexDirection: 'column',
  justifyContent: 'space-between',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  padding: 16,
};

const previewInnerStyle: CSSProperties = {
  display: 'grid',
  flex: 1,
  placeItems: 'center',
};

const shadowStyle: CSSProperties = {
  position: 'absolute',
  bottom: -24,
  left: '50%',
  width: 96,
  height: 40,
  transform: 'translateX(-50%)',
  borderRadius: '50%',
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(0,0,0,0.2)',
  backdropFilter: 'blur(4px)',
};

const paramsColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  padding: '8px 0',
};

const fieldRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '88px 1fr 72px',
  alignItems: 'center',
  gap: 16,
};

const fieldLabelTextStyle: CSSProperties = {
  fontSize: 13,
  color: '#a0a0c0',
};

const valueTextStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  textAlign: 'right',
  whiteSpace: 'nowrap',
};

const segmentedStyle: CSSProperties = {
  display: 'flex',
  gap: 2,
  background: 'rgba(255,255,255,0.05)',
  borderRadius: 6,
  padding: 2,
  width: 'fit-content',
};

const segBtnStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#a0a0c0',
  padding: '6px 14px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};

const segBtnActiveStyle: CSSProperties = {
  background: 'rgba(233, 69, 96, 0.15)',
  color: '#e94560',
  fontWeight: 600,
};
