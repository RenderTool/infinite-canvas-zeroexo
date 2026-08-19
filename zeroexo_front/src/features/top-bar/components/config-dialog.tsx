/**
 * ConfigDialog - 画布样式设置弹窗
 *
 * 标题区:标题("配置") + 右侧"重置默认"按钮
 * 主体区:左侧预览(分组卡片 + 节点卡片)+ 右侧配置卡片(节点/分组/引脚)
 *
 * mask 完全透明,面板底色只作用于 content,画布依然可见。
 *
 * 节点统一使用 theme.node.fill(dark/light 主题切换),移除按类型独立配色。
 *
 * draft 状态隔离,实时同步到全局。
 */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { App, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { PinDefaults } from '@zeroexo/plugin-render-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { useHintsEnabled, setHintsEnabled } from '@/shared/hints/hints-settings.js';

// ===== 配置数据模型 =====

export interface CanvasConfig {
  // 节点样式(共享圆角/轮廓;颜色由主题统一管理)
  nodeBorderRadius: number;
  nodeOutlineWidth: number;
  // Group 样式默认
  groupBackground: string;
  groupBorderRadius: number;
  groupOutlineWidth: number;
  groupOutlineColor: string;
  groupOutlineType: 'solid' | 'dashed';
  groupOutlineOffset: number;
  groupOpacity: number;
  // Pin 默认(独立透明度,不受分组透明度影响)
  pinColor: string;
  pinShape: 'circle' | 'square';
  pinSize: number;
  pinOpacity: number;
}

export const DEFAULT_CANVAS_CONFIG: CanvasConfig = {
  nodeBorderRadius: 2,
  nodeOutlineWidth: 0,
  groupBackground: 'rgba(255,255,255,0.04)',
  groupBorderRadius: 2,
  groupOutlineWidth: 1,
  groupOutlineColor: 'rgba(233,69,96,0.5)',
  groupOutlineType: 'dashed',
  groupOutlineOffset: 3,
  groupOpacity: 1,
  pinColor: '#78716c',
  pinShape: 'circle',
  pinSize: 14,
  pinOpacity: 1,
};

export function configToPinDefaults(cfg: CanvasConfig): PinDefaults {
  return { color: cfg.pinColor, shape: cfg.pinShape, size: cfg.pinSize, opacity: cfg.pinOpacity };
}

// ===== 配置持久化(localStorage) =====
// 参考 image-tool-definitions.tsx 的 loadImageToolbarConfig/saveImageToolbarConfig 模式

const CANVAS_CONFIG_STORAGE_KEY = 'zeroexo:canvas-config-v1';

/** 从 localStorage 读取画布配置(合并 DEFAULT_CANVAS_CONFIG,缺失字段用默认值补齐) */
export function loadCanvasConfig(): CanvasConfig {
  try {
    const raw = localStorage.getItem(CANVAS_CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CANVAS_CONFIG };
    const parsed = JSON.parse(raw) as Partial<CanvasConfig>;
    return { ...DEFAULT_CANVAS_CONFIG, ...parsed };
  } catch {
    try { localStorage.removeItem(CANVAS_CONFIG_STORAGE_KEY); } catch { /* noop */ }
    return { ...DEFAULT_CANVAS_CONFIG };
  }
}

/** 保存画布配置到 localStorage(localStorage 不可用时静默忽略) */
export function saveCanvasConfig(config: CanvasConfig): void {
  try {
    localStorage.setItem(CANVAS_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage 不可用时静默忽略
  }
}

// ===== 预览组件 =====

/** 预览分组宽度(包裹节点) */
const PREVIEW_GROUP_WIDTH = 460;

/**
 * 画布样式预览:一个分组卡片,中间放置一个节点卡片
 *
 * 同时展示分组样式(背景/轮廓/圆角)+ 节点样式(底色/轮廓/圆角)+ 引脚(左右两侧)。
 * 节点居中显示在分组内,便于观察分组轮廓与节点的关系。
 * 移动端使用更紧凑的尺寸避免溢出。
 */
function CanvasPreview({
  draft, theme, isMobile,
}: { draft: CanvasConfig; theme: ThemeConfig; isMobile: boolean }): React.ReactElement {
  const { t } = useTranslation();
  const groupWidth = isMobile ? 300 : PREVIEW_GROUP_WIDTH;
  const nodeWidth = isMobile ? 180 : 280;
  const wrapStyle: CSSProperties = {
    flex: 1, minWidth: 0, minHeight: 0,
    background: theme.canvas.background,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: isMobile ? '16px 16px' : '24px 40px',
    overflow: 'hidden', pointerEvents: 'none',
  };
  const pinContainerStyle: CSSProperties = {
    position: 'absolute', top: '50%',
    width: draft.pinSize, height: draft.pinSize,
    borderRadius: draft.pinShape === 'circle' ? '50%' : 2,
    border: `2px solid ${draft.pinColor}`,
    background: 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: draft.pinOpacity,
    marginTop: -draft.pinSize / 2,
  };
  const pinIconSize = draft.pinSize * 0.5;
  // 节点卡片使用 theme.node.fill(所有类型共用)
  const nodeStyle: CSSProperties = {
    width: nodeWidth,
    background: theme.node.fill,
    borderRadius: draft.nodeBorderRadius,
    outline: `${draft.nodeOutlineWidth}px solid ${theme.node.outlineColor}`,
    padding: isMobile ? '14px 16px' : '20px 24px',
    display: 'flex', alignItems: 'center', gap: 10,
    color: theme.node.titleColor,
    position: 'relative',
  };
  // 分组卡片包裹节点,16:10 比例(更接近实际画布分组的视觉比例)
  const groupHeight = (groupWidth * 10) / 16;
  const groupStyle: CSSProperties = {
    width: groupWidth,
    height: groupHeight,
    borderRadius: draft.groupBorderRadius,
    outline: `${draft.groupOutlineWidth}px ${draft.groupOutlineType} ${draft.groupOutlineColor}`,
    outlineOffset: draft.groupOutlineOffset,
    padding: isMobile ? '10px 12px' : '14px 16px',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  };
  const titleStyle: CSSProperties = {
    fontSize: isMobile ? 11 : 13, color: theme.group.titleColor, opacity: 0.8, fontWeight: 600,
    position: 'absolute', top: isMobile ? 8 : 10, left: isMobile ? 10 : 14,
  };
  return (
    <div style={wrapStyle}>
      <div style={groupStyle}>
        {/* 背景层(独立 opacity,不影响内部节点/引脚) */}
        <div style={{
          position: 'absolute', inset: 0,
          background: draft.groupBackground,
          borderRadius: draft.groupBorderRadius,
          opacity: draft.groupOpacity,
          pointerEvents: 'none',
        }} />
        <span style={titleStyle}>{t('group.previewTitle')}</span>
        {/* 节点居中 */}
        <div style={nodeStyle}>
          {/* input pin(左) - 空心圆环/方块 + "+" 号 */}
          <span style={{ ...pinContainerStyle, left: -draft.pinSize / 2 }}>
            <svg width={pinIconSize} height={pinIconSize} viewBox="0 0 24 24" fill="none">
              <line x1="12" y1="4" x2="12" y2="20" stroke={draft.pinColor} strokeWidth="2.5" strokeLinecap="round" />
              <line x1="4" y1="12" x2="20" y2="12" stroke={draft.pinColor} strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </span>
          {/* output pin(右) - 空心圆环/方块 + "+" 号 */}
          <span style={{ ...pinContainerStyle, right: -draft.pinSize / 2 }}>
            <svg width={pinIconSize} height={pinIconSize} viewBox="0 0 24 24" fill="none">
              <line x1="12" y1="4" x2="12" y2="20" stroke={draft.pinColor} strokeWidth="2.5" strokeLinecap="round" />
              <line x1="4" y1="12" x2="20" y2="12" stroke={draft.pinColor} strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </span>
          <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 500 }}>{t('settings.nodePreviewLabel')}</span>
          <span style={{ marginLeft: 'auto', fontSize: isMobile ? 10 : 11, opacity: 0.55 }}>
            {theme.mode === 'dark' ? t('settings.darkTheme') : t('settings.lightTheme')}
          </span>
        </div>
      </div>
    </div>
  );
}

// ===== 配置弹窗 =====

export interface ConfigDialogProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeConfig;
  config: CanvasConfig;
  /** 确认时提交全量配置,立即全局生效 */
  onConfirm: (config: CanvasConfig) => void;
}

export function ConfigDialog({
  open, onClose, theme, config, onConfirm,
}: ConfigDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { theme: currentTheme } = useTheme();
  const isMobile = useIsMobile();
  // 教育提示开关(localStorage 持久化,切换立即生效)
  const hintsEnabled = useHintsEnabled();
  // 节点样式预览使用当前实际主题(而非 dialog props 中的 theme,后者可能是传入的旧主题)
  const previewTheme = currentTheme;
  const [draft, setDraft] = useState<CanvasConfig>(config);
  useEffect(() => { if (open) setDraft(config); }, [open, config]);

  // 仅更新本地 draft，不立即应用（避免滑块拖动时频繁触发全局 re-render）
  const update = (patch: Partial<CanvasConfig>): void => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleConfirm = (): void => {
    onConfirm(draft);
    onClose();
  };

  const handleCancel = (): void => {
    setDraft(config);
    onClose();
  };

  /** 教育提示开关:切换立即生效,并用 toast 明示当前状态 */
  const toggleHints = (next: boolean): void => {
    setHintsEnabled(next);
    message.success(next ? t('config.hintsEnabledToast') : t('config.hintsDisabledToast'));
  };

  // 移动端:上下布局(预览在上,配置在下);桌面端:左右布局(预览在左,配置在右)
  const configBodyStyle: CSSProperties = {
    flex: 1, display: 'flex',
    flexDirection: isMobile ? 'column' as const : 'row' as const,
    minHeight: 0, overflow: 'hidden',
  };
  // 预览区(分组包裹节点,节点居中)
  const previewAreaWrapperStyle: CSSProperties = {
    flex: isMobile ? '0 0 auto' : 5,
    minWidth: 0,
    minHeight: isMobile ? 220 : 0,
    display: 'flex',
  };
  const configAreaStyle: CSSProperties = {
    flex: 2, padding: 20, overflowY: 'auto', minWidth: 0,
  };

  const cardStyle: CSSProperties = {
    marginBottom: 10, padding: 14, borderRadius: 10,
    background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
  };
  const cardTitleStyle: CSSProperties = {
    fontSize: 13, fontWeight: 600, marginBottom: 8, color: theme.toolbar.text,
  };
  const rowStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6, fontSize: 13, gap: 6,
  };
  const labelStyle: CSSProperties = { color: theme.toolbar.text, flexShrink: 0, minWidth: 52 };
  const valueStyle: CSSProperties = {
    color: theme.toolbar.textMuted, fontSize: 12, fontVariantNumeric: 'tabular-nums',
    minWidth: 30, textAlign: 'right',
  };
  const colorInputStyle: CSSProperties = {
    width: 32, height: 24, padding: 0, border: 'none',
    borderRadius: 4, cursor: 'pointer', background: 'transparent', flexShrink: 0,
  };
  const sliderStyle: CSSProperties = {
    flex: 1, margin: '0 6px', accentColor: theme.toolbar.accent, minWidth: 0,
  };
  const shapeBtnStyle = (active: boolean): CSSProperties => ({
    padding: '3px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
    border: 'none',
    background: active
      ? (theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)')
      : 'transparent',
    color: active ? theme.toolbar.text : theme.toolbar.textMuted,
  });

  const resetBtnStyle: CSSProperties = {
    padding: '4px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
    border: 'none', background: 'transparent',
    color: theme.toolbar.textMuted, transition: 'color 0.15s',
  };
  // 副标题:与多语言弹窗的 sectionLabel 风格保持一致
  const subtitleStyle: CSSProperties = {
    fontSize: 11, color: theme.toolbar.textMuted, marginBottom: 12,
    textTransform: 'uppercase', letterSpacing: 0.5,
  };

  /**
   * 渲染"画布样式"弹窗主体
   *
   * 桌面端:左侧预览(3/5)+ 右侧配置(2/5)
   * 移动端:上方预览 + 下方配置(上下布局)
   * 预览统一显示分组包裹节点的合并视图(节点居中)。
   */
  const modalWidth = isMobile ? '100vw' : 1200;
  const bodyHeight = isMobile ? 'auto' : 680;

  return (
    <Modal
      open={open}
      title={(
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingRight: 8 }}>
          <span>{t('settings.title')}</span>
          <button type="button" style={resetBtnStyle}
            onClick={() => setDraft(DEFAULT_CANVAS_CONFIG)}>
            {t('common.reset')}
          </button>
        </div>
      )}
      centered
      onCancel={handleCancel}
      width={modalWidth}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={handleCancel}
            style={{
              padding: '6px 16px', borderRadius: 6, border: 'none',
              background: 'transparent', color: theme.toolbar.textMuted,
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            style={{
              padding: '6px 20px', borderRadius: 6, border: 'none',
              background: theme.toolbar.accent, color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t('common.confirm')}
          </button>
        </div>
      }
      styles={{
        mask: { background: 'transparent' },
        body: {
          padding: 0,
          height: isMobile ? 'auto' : `calc(${bodyHeight}px - 55px)`,
          maxHeight: 'calc(100vh - 32px - 55px)',
          display: 'flex',
          flexDirection: 'column',
        },
        wrapper: {
          padding: 0,
        },
        /* 面板底色只作用于弹窗卡片本身(content),不再铺满整个 wrapper;mask 保持全透明,露出画布 */
        content: {
          background: theme.toolbar.panel,
          color: theme.toolbar.text,
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
        },
        header: {
          padding: isMobile ? '14px 16px' : '18px 32px',
          background: theme.toolbar.panel,
        },
      }}
    >
      {/* 主体:画布样式左预览(3) + 右配置(1) */}
      <div style={configBodyStyle}>
        <div style={previewAreaWrapperStyle}>
          <CanvasPreview draft={draft} theme={previewTheme} isMobile={isMobile} />
        </div>
        <div style={configAreaStyle}>
          <div style={subtitleStyle}>{t('settings.subtitle')}</div>
          {/* ===== 操作提示开关卡片(立即生效,不随“重置默认”联动) ===== */}
          <div style={cardStyle}>
            <div style={cardTitleStyle}>{t('config.hints')}</div>
            <div style={{ ...rowStyle, marginBottom: 0 }}>
              <span style={labelStyle}>{t('config.hintsEnabled')}</span>
              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                <button type="button" style={shapeBtnStyle(hintsEnabled)}
                  onClick={() => toggleHints(true)}>{t('common.on')}</button>
                <button type="button" style={shapeBtnStyle(!hintsEnabled)}
                  onClick={() => toggleHints(false)}>{t('common.off')}</button>
              </div>
            </div>
          </div>

          {/* ===== 节点配置卡片 ===== */}
          <div style={cardStyle}>
            <div style={cardTitleStyle}>{t('config.nodeStyle')}</div>
            <div style={rowStyle}>
              <span style={labelStyle}>{t('config.radius')}</span>
              <input type="range" min={0} max={20} value={draft.nodeBorderRadius}
                onChange={(e) => update({ nodeBorderRadius: +e.target.value })}
                style={sliderStyle} />
              <span style={valueStyle}>{draft.nodeBorderRadius}px</span>
            </div>
            <div style={{ ...rowStyle, marginBottom: 0 }}>
              <span style={labelStyle}>{t('config.outline')}</span>
              <input type="range" min={0} max={8} value={draft.nodeOutlineWidth}
                onChange={(e) => update({ nodeOutlineWidth: +e.target.value })}
                style={sliderStyle} />
              <span style={valueStyle}>{draft.nodeOutlineWidth}px</span>
            </div>
          </div>

          {/* ===== 分组配置卡片 ===== */}
          <div style={cardStyle}>
            <div style={cardTitleStyle}>{t('config.groupStyle')}</div>
            {/* 分组背景色 */}
            <div style={rowStyle}>
              <span style={labelStyle}>{t('config.background')}</span>
              <input type="color" value={rgbaToHex(draft.groupBackground)}
                onChange={(e) => update({ groupBackground: hexToRgba(e.target.value, 0.06) })}
                style={colorInputStyle} />
            </div>
            {/* 分组圆角 */}
            <div style={rowStyle}>
              <span style={labelStyle}>{t('config.radius')}</span>
              <input type="range" min={0} max={20} value={draft.groupBorderRadius}
                onChange={(e) => update({ groupBorderRadius: +e.target.value })}
                style={sliderStyle} />
              <span style={valueStyle}>{draft.groupBorderRadius}px</span>
            </div>
            {/* 分组轮廓宽度 */}
            <div style={rowStyle}>
              <span style={labelStyle}>{t('config.outline')}</span>
              <input type="range" min={0} max={8} value={draft.groupOutlineWidth}
                onChange={(e) => update({ groupOutlineWidth: +e.target.value })}
                style={sliderStyle} />
              <span style={valueStyle}>{draft.groupOutlineWidth}px</span>
            </div>
            {/* 分组轮廓颜色 */}
            <div style={rowStyle}>
              <span style={labelStyle}>{t('config.outlineColor')}</span>
              <input type="color" value={rgbaToHex(draft.groupOutlineColor)}
                onChange={(e) => update({ groupOutlineColor: hexToRgba(e.target.value, 0.5) })}
                style={colorInputStyle} />
            </div>
            {/* 分组轮廓类型 */}
            <div style={{ ...rowStyle }}>
              <span style={labelStyle}>{t('config.outlineType')}</span>
              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                <button type="button" style={shapeBtnStyle(draft.groupOutlineType === 'solid')}
                  onClick={() => update({ groupOutlineType: 'solid' })}>{t('config.outlineSolid')}</button>
                <button type="button" style={shapeBtnStyle(draft.groupOutlineType === 'dashed')}
                  onClick={() => update({ groupOutlineType: 'dashed' })}>{t('config.outlineDashed')}</button>
              </div>
            </div>
            {/* 分组轮廓偏移 */}
            <div style={rowStyle}>
              <span style={labelStyle}>{t('config.outlineOffset')}</span>
              <input type="range" min={-10} max={10} value={draft.groupOutlineOffset}
                onChange={(e) => update({ groupOutlineOffset: +e.target.value })}
                style={sliderStyle} />
              <span style={valueStyle}>{draft.groupOutlineOffset}px</span>
            </div>
            {/* 分组不透明度 */}
            <div style={{ ...rowStyle, marginBottom: 0 }}>
              <span style={labelStyle}>{t('config.opacity')}</span>
              <input type="range" min={0} max={1} step={0.05} value={draft.groupOpacity}
                onChange={(e) => update({ groupOpacity: +e.target.value })}
                style={sliderStyle} />
              <span style={valueStyle}>{Math.round(draft.groupOpacity * 100)}%</span>
            </div>
          </div>

          {/* ===== 引脚配置卡片 ===== */}
          <div style={{ ...cardStyle, marginBottom: 0 }}>
            <div style={cardTitleStyle}>{t('config.pinDefault')}</div>
            {/* 引脚形状 */}
            <div style={rowStyle}>
              <span style={labelStyle}>{t('config.shape')}</span>
              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                <button type="button" style={shapeBtnStyle(draft.pinShape === 'circle')}
                  onClick={() => update({ pinShape: 'circle' })}>{t('config.shapeCircle')}</button>
                <button type="button" style={shapeBtnStyle(draft.pinShape === 'square')}
                  onClick={() => update({ pinShape: 'square' })}>{t('config.shapeSquare')}</button>
              </div>
            </div>
            {/* 引脚大小 */}
            <div style={rowStyle}>
              <span style={labelStyle}>{t('config.size')}</span>
              <input type="range" min={4} max={24} value={draft.pinSize}
                onChange={(e) => update({ pinSize: +e.target.value })}
                style={sliderStyle} />
              <span style={valueStyle}>{draft.pinSize}px</span>
            </div>
            {/* 引脚透明度 */}
            <div style={{ ...rowStyle, marginBottom: 0 }}>
              <span style={labelStyle}>{t('config.opacity')}</span>
              <input type="range" min={0} max={1} step={0.05} value={draft.pinOpacity}
                onChange={(e) => update({ pinOpacity: +e.target.value })}
                style={sliderStyle} />
              <span style={valueStyle}>{Math.round(draft.pinOpacity * 100)}%</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ===== 辅助函数 =====

function rgbaToHex(rgba: string): string {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m || !m[1] || !m[2] || !m[3]) return '#e94560';
  const r = parseInt(m[1], 10).toString(16).padStart(2, '0');
  const g = parseInt(m[2], 10).toString(16).padStart(2, '0');
  const b = parseInt(m[3], 10).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}