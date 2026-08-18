/**
 * GroupStyleDialog - 组样式设置弹窗(苹果扁平风格)
 *
 * - 透明背景，用户可看到画布
 * - 支持渐变预设（线性/径向/锥形）+ 纯色
 * - 渐变方向选择 + 主流渐变预设色板
 * - 干净、极简的苹果风格 UI
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { Modal, InputNumber } from 'antd';

// ===== 渐变类型 =====
type GradientType = 'solid' | 'linear' | 'radial' | 'conic';

// ===== 线性方向 =====
const LINEAR_DIRECTIONS = [
  { label: '↓', value: 'to bottom' },
  { label: '↑', value: 'to top' },
  { label: '→', value: 'to right' },
  { label: '←', value: 'to left' },
  { label: '↘', value: 'to bottom right' },
  { label: '↙', value: 'to bottom left' },
  { label: '↗', value: 'to top right' },
  { label: '↖', value: 'to top left' },
];

// ===== 径向方向 =====
const RADIAL_DIRECTIONS = [
  { label: '○', value: 'circle' },
  { label: '◯', value: 'ellipse' },
  { label: '◐', value: 'circle at top left' },
  { label: '◑', value: 'circle at bottom right' },
  { label: '●', value: 'circle at center' },
];

// ===== 锥形方向 =====
const CONIC_DIRECTIONS = [
  { label: '12', value: 'from 0deg' },
  { label: '3', value: 'from 90deg' },
  { label: '6', value: 'from 180deg' },
  { label: '9', value: 'from 270deg' },
];

// ===== 渐变预设 =====
interface GradientPreset {
  name: string;
  colors: string[];
  type: GradientType;
}

const GRADIENT_PRESETS: GradientPreset[] = [
  { name: 'Sunset', colors: ['#ff6b6b', '#feca57'], type: 'linear' },
  { name: 'Ocean', colors: ['#4facfe', '#00f2fe'], type: 'linear' },
  { name: 'Forest', colors: ['#43e97b', '#38f9d7'], type: 'linear' },
  { name: 'Lavender', colors: ['#a18cd1', '#fbc2eb'], type: 'linear' },
  { name: 'Midnight', colors: ['#0f0c29', '#302b63', '#24243e'], type: 'linear' },
  { name: 'Aurora', colors: ['#00b4db', '#0083b0', '#00d2ff'], type: 'linear' },
  { name: 'Rose', colors: ['#ff9a9e', '#fad0c4'], type: 'linear' },
  { name: 'Cosmos', colors: ['#2d1b69', '#1a0a3e'], type: 'radial' },
  { name: 'Peach', colors: ['#ffecd2', '#fcb69f'], type: 'linear' },
  { name: 'Mint', colors: ['#c1f1c6', '#a8edea'], type: 'linear' },
  { name: 'Twilight', colors: ['#a18cd1', '#4facfe'], type: 'linear' },
  { name: 'Sunrise', colors: ['#f093fb', '#f5576c'], type: 'linear' },
];

// ===== 纯色预设 =====
const SOLID_COLORS: readonly string[] = [
  '#1c1917', '#44403c', '#78716c', '#a8a29e',
  '#e94560', '#f97316', '#facc15', '#10b981',
  '#3b82f6', '#8b5cf6', '#ec4899', '#64748b',
];

/**
 * 构建 CSS 渐变字符串
 */
function buildGradientCss(type: GradientType, direction: string, colors: string[]): string {
  if (type === 'solid' || colors.length === 0) return colors[0] ?? '#1c1917';
  const stops = colors.join(', ');
  switch (type) {
    case 'linear':
      return `linear-gradient(${direction}, ${stops})`;
    case 'radial':
      return `radial-gradient(${direction}, ${stops})`;
    case 'conic':
      return `conic-gradient(${direction}, ${stops})`;
    default:
      return colors[0] ?? '#1c1917';
  }
}

/** 将 hex 颜色转为 rgba 字符串 */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}

export interface GroupStyleDialogProps {
  currentBgColor: string | undefined;
  currentOpacity: number | undefined;
  currentRadius: number | undefined;
  onApply: (bgColor: string | undefined, opacity: number | undefined, radius: number | undefined) => void;
  onClose: () => void;
  theme: ThemeConfig;
}

export function GroupStyleDialog({
  currentBgColor,
  currentOpacity,
  currentRadius,
  onApply,
  onClose,
  theme,
}: GroupStyleDialogProps): React.ReactElement {
  const { t } = useTranslation();

  // 检测当前是否为渐变
  const isCurrentGradient = typeof currentBgColor === 'string' && currentBgColor.includes('gradient');

  const [gradientType, setGradientType] = useState<GradientType>(isCurrentGradient ? 'linear' : 'solid');
  const [direction, setDirection] = useState('to bottom');
  const [color1, setColor1] = useState('#4facfe');
  const [color2, setColor2] = useState('#00f2fe');
  const [color3, setColor3] = useState<string | undefined>(undefined);
  const [solidColor, setSolidColor] = useState<string>(
    typeof currentBgColor === 'string' && !currentBgColor.includes('gradient') && currentBgColor
      ? currentBgColor
      : '#1c1917',
  );
  const [opacityValue, setOpacityValue] = useState<number>(
    typeof currentOpacity === 'number' && !isNaN(currentOpacity) ? Math.round(currentOpacity * 100) : 100,
  );
  const [radiusValue, setRadiusValue] = useState<number>(
    typeof currentRadius === 'number' && !isNaN(currentRadius) ? currentRadius : 8,
  );

  const getCurrentBgCss = (): string => {
    if (gradientType === 'solid') {
      return solidColor;
    }
    const colors = [color1, color2, ...(color3 ? [color3] : [])];
    return buildGradientCss(gradientType, direction, colors);
  };

  /** 预览背景（含透明度） */
  const getPreviewBgCss = (): string => {
    const alpha = opacityValue / 100;
    if (gradientType === 'solid') {
      return hexToRgba(solidColor, alpha);
    }
    const colors = [
      hexToRgba(color1, alpha),
      hexToRgba(color2, alpha),
      ...(color3 ? [hexToRgba(color3, alpha)] : []),
    ];
    return buildGradientCss(gradientType, direction, colors);
  };

  const handleApply = () => {
    const bg = getCurrentBgCss();
    const opacity = isNaN(opacityValue) ? undefined : opacityValue / 100;
    onApply(bg || undefined, opacity, isNaN(radiusValue) ? undefined : radiusValue);
    onClose();
  };

  const handleClear = () => {
    onApply(undefined, undefined, undefined);
    onClose();
  };

  const handlePreset = (preset: GradientPreset) => {
    setGradientType(preset.type);
    setColor1(preset.colors[0] ?? '#4facfe');
    setColor2(preset.colors[1] ?? preset.colors[0] ?? '#00f2fe');
    setColor3(preset.colors[2]);
    setDirection('to bottom');
  };

  const handleSolidPreset = (c: string) => {
    setGradientType('solid');
    setSolidColor(c);
  };

  // 样式
  const labelStyle: CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: theme.toolbar.text,
    letterSpacing: 0.3,
    marginBottom: 8,
  };

  const tabRowStyle: CSSProperties = {
    display: 'flex',
    gap: 4,
    marginBottom: 12,
  };

  const tabStyle = (active: boolean): CSSProperties => ({
    flex: 1,
    padding: '5px 0',
    borderRadius: 6,
    border: 'none',
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    color: active ? '#fff' : theme.toolbar.textMuted,
    background: active ? theme.toolbar.accent : 'transparent',
    cursor: 'pointer',
    transition: 'all 0.15s',
    textAlign: 'center' as const,
  });

  const dirBtnStyle = (active: boolean): CSSProperties => ({
    width: 32,
    height: 28,
    borderRadius: 6,
    border: active ? `1px solid ${theme.toolbar.accent}` : `1px solid ${theme.toolbar.border}`,
    background: active ? `${theme.toolbar.accent}15` : 'transparent',
    color: active ? theme.toolbar.accent : theme.toolbar.textMuted,
    fontSize: 11,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
  });

  const colorInputStyle: CSSProperties = {
    width: 36,
    height: 28,
    padding: 0,
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    background: 'transparent',
    flexShrink: 0,
  };

  const inputStyle: CSSProperties = {
    flex: 1,
    height: 28,
    padding: '0 8px',
    borderRadius: 6,
    border: `1px solid ${theme.toolbar.border}`,
    background: 'transparent',
    color: theme.toolbar.text,
    fontSize: 11,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    outline: 'none',
  };

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  };

  return (
    <Modal
      open={true}
      title={<span style={{ fontSize: 14, fontWeight: 600, color: theme.toolbar.text }}>{t('groupTools.backgroundTitle')}</span>}
      centered
      onCancel={onClose}
      width={340}
      destroyOnHidden
      styles={{
        mask: { background: 'transparent' },
        body: { padding: '16px 20px 20px' },
        wrapper: {
          background: 'transparent',
          color: theme.toolbar.text,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          borderRadius: 14,
          border: `1px solid ${theme.toolbar.border}55`,
        },
        container: {
          background: 'transparent',
          borderRadius: 14,
          boxShadow: 'none',
        },
        header: { display: 'none' },
      }}
      closeIcon={null}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
          <button
            type="button"
            onClick={handleClear}
            style={{
              padding: '5px 14px',
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: theme.toolbar.textMuted,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t('groupTools.clear')}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '5px 14px',
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: theme.toolbar.textMuted,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleApply}
            style={{
              padding: '5px 16px',
              borderRadius: 6,
              border: 'none',
              background: theme.toolbar.accent,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('groupTools.apply')}
          </button>
        </div>
      }
    >
      {/* 预览条（含透明度 + 棋盘格背景） */}
      <div
        style={{
          width: '100%',
          height: 48,
          borderRadius: 10,
          marginBottom: 14,
          border: `1px solid ${theme.toolbar.border}44`,
          background: `
            repeating-conic-gradient(rgba(128,128,128,0.15) 0% 25%, transparent 0% 50%) 0 0 / 12px 12px,
            ${getPreviewBgCss()}
          `,
        }}
      />

      {/* 渐变类型切换 */}
      <div style={tabRowStyle}>
        {(['solid', 'linear', 'radial', 'conic'] as GradientType[]).map((gt) => (
          <button
            key={gt}
            type="button"
            onClick={() => setGradientType(gt)}
            style={tabStyle(gradientType === gt)}
          >
            {gt === 'solid' ? '纯色' : gt === 'linear' ? '线性' : gt === 'radial' ? '径向' : '锥形'}
          </button>
        ))}
      </div>

      {gradientType !== 'solid' ? (
        <>
          {/* 方向选择 */}
          <div style={{ ...labelStyle, marginTop: 0 }}>{t('config.direction')}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
            {(gradientType === 'linear' ? LINEAR_DIRECTIONS : gradientType === 'radial' ? RADIAL_DIRECTIONS : CONIC_DIRECTIONS).map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDirection(d.value)}
                style={dirBtnStyle(direction === d.value)}
                title={d.value}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* 颜色选择 */}
          <div style={{ ...labelStyle }}>{t('config.colors')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            <div style={rowStyle}>
              <input type="color" value={color1} onChange={(e) => setColor1(e.target.value)} style={colorInputStyle} />
              <input type="text" value={color1} onChange={(e) => setColor1(e.target.value)} style={inputStyle} />
              <span style={{ fontSize: 10, color: theme.toolbar.textMuted, width: 16, textAlign: 'right' }}>1</span>
            </div>
            <div style={rowStyle}>
              <input type="color" value={color2} onChange={(e) => setColor2(e.target.value)} style={colorInputStyle} />
              <input type="text" value={color2} onChange={(e) => setColor2(e.target.value)} style={inputStyle} />
              <span style={{ fontSize: 10, color: theme.toolbar.textMuted, width: 16, textAlign: 'right' }}>2</span>
            </div>
            {color3 !== undefined && (
              <div style={rowStyle}>
                <input type="color" value={color3} onChange={(e) => setColor3(e.target.value)} style={colorInputStyle} />
                <input type="text" value={color3} onChange={(e) => setColor3(e.target.value)} style={inputStyle} />
                <button
                  type="button"
                  onClick={() => setColor3(undefined)}
                  style={{
                    width: 28, height: 28, borderRadius: 6, border: 'none',
                    background: 'transparent', color: theme.toolbar.textMuted,
                    fontSize: 14, cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {color3 === undefined && (
              <button
                type="button"
                onClick={() => setColor3('#ffffff')}
                style={{
                  width: '100%', height: 24, borderRadius: 6, border: `1px dashed ${theme.toolbar.border}`,
                  background: 'transparent', color: theme.toolbar.textMuted,
                  fontSize: 10, cursor: 'pointer',
                }}
              >
                + {t('config.addColor')}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {/* 纯色模式 */}
          <div style={{ ...labelStyle, marginTop: 0 }}>{t('config.background')}</div>
          <div style={rowStyle}>
            <input
              type="color"
              value={solidColor}
              onChange={(e) => setSolidColor(e.target.value)}
              style={{ ...colorInputStyle, width: 36, height: 28 }}
            />
            <input
              type="text"
              value={solidColor}
              onChange={(e) => setSolidColor(e.target.value)}
              style={inputStyle}
            />
          </div>
          {/* 纯色预设色板 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginTop: 10, marginBottom: 12 }}>
            {SOLID_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => handleSolidPreset(c)}
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: 6,
                  background: c,
                  border: '1px solid rgba(128,128,128,0.2)',
                  cursor: 'pointer',
                  padding: 0,
                  outline: solidColor.toLowerCase() === c.toLowerCase() ? `2px solid ${theme.toolbar.accent}` : 'none',
                  outlineOffset: 1,
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* 渐变预设色板 */}
      {gradientType !== 'solid' && (
        <>
          <div style={{ ...labelStyle }}>{t('config.presets')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
            {GRADIENT_PRESETS.map((preset) => {
              const css = buildGradientCss(preset.type, 'to bottom', preset.colors);
              return (
                <button
                  key={preset.name}
                  type="button"
                  title={preset.name}
                  onClick={() => handlePreset(preset)}
                  style={{
                    width: '100%',
                    aspectRatio: '1 / 1',
                    borderRadius: 8,
                    background: css,
                    border: '1px solid rgba(128,128,128,0.2)',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      fontSize: 8,
                      color: '#fff',
                      textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                      padding: '2px 0',
                      fontWeight: 500,
                      lineHeight: 1,
                    }}
                  >
                    {preset.name}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* 透明度 */}
      <div style={{ ...labelStyle }}>{t('config.opacity')}</div>
      <div style={rowStyle}>
        <InputNumber
          min={0}
          max={100}
          step={1}
          value={opacityValue}
          onChange={(val) => setOpacityValue(val ?? 100)}
          size="small"
          style={{ width: 80 }}
          variant="outlined"
          formatter={(v) => `${v}%`}
          parser={(v) => parseInt(v?.replace('%', '') ?? '100', 10)}
        />
        <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>0-100%</span>
      </div>

      {/* 圆角 */}
      <div style={{ ...labelStyle, marginTop: 10 }}>{t('config.radius')}</div>
      <div style={rowStyle}>
        <InputNumber
          min={0}
          max={60}
          value={radiusValue}
          onChange={(val) => setRadiusValue(val ?? 0)}
          size="small"
          style={{ width: 80 }}
          variant="outlined"
        />
        <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>px</span>
      </div>
    </Modal>
  );
}