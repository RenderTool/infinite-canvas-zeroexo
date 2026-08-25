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
 * draft 状态隔离,确认按钮才应用到画布(预览面板语义)。
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { App, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { PinDefaults, NodeDefaults } from '@zeroexo/plugin-render-react';
import type { GroupDefaults } from '@zeroexo/plugin-group';
import { useTheme } from '@zeroexo/plugin-theme';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { useHintsEnabled, setHintsEnabled } from '@/shared/hints/hints-settings.js';
import { ConfigPreviewHost } from './config-preview-host.js';

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
  // pinColor 契约保留:画布当前未启用配置值(注入层用主题色),启用时删除注入层覆盖即可
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

// ===== 样式映射纯函数(预览与画布真实节点同源,use-editor-interactions 复用) =====

/** 从 CanvasConfig + theme 派生节点全局默认样式(与画布注入同源) */
export function configToNodeDefaults(cfg: CanvasConfig, theme: ThemeConfig): NodeDefaults {
  return {
    borderRadius: cfg.nodeBorderRadius,
    outlineWidth: cfg.nodeOutlineWidth,
    outlineColor: theme.node.outlineColor,
    outlineSelectedColor: theme.node.outlineSelectedColor,
    fillColor: theme.node.fill,
    titleColor: theme.node.titleColor,
    titleSelectedColor: theme.node.outlineSelectedColor,
    titleBackground: theme.node.titleBackground,
    contentTextColor: theme.node.titleColor,
  };
}

/** 从 CanvasConfig + theme 派生组全局默认样式(与画布注入同源) */
export function configToGroupDefaults(cfg: CanvasConfig, theme: ThemeConfig): GroupDefaults {
  return {
    backgroundColor: cfg.groupBackground,
    borderRadius: cfg.groupBorderRadius,
    outlineColor: cfg.groupOutlineColor,
    outlineWidth: cfg.groupOutlineWidth,
    outlineType: cfg.groupOutlineType,
    outlineOffset: cfg.groupOutlineOffset,
    opacity: cfg.groupOpacity,
    titleColor: theme.group.titleColor,
  };
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

// 预览区由 ConfigPreviewHost 承载(Plan#13):真实节点渲染链(ConfigPreviewNodeView +
// GroupItem)替代原手动构造 DIV,样式经 Provider 注入与画布真实节点同源,所见即所得。

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

  // ===== 确认制:draft 镜像,确认才应用到画布(弹窗内 ConfigPreviewHost 实时预览) =====
  const [draft, setDraftState] = useState<CanvasConfig>(config);
  const draftRef = useRef<CanvasConfig>(config);
  const openRef = useRef(open);
  const setDraft = (next: CanvasConfig): void => {
    draftRef.current = next;
    setDraftState(next);
  };
  useEffect(() => {
    // 仅 open false→true 边沿:同步 draft(确认后 config 已更新,重新打开用新值)
    if (open && !openRef.current) {
      setDraft(config);
    }
    openRef.current = open;
  }, [open, config]);

  /** 仅更新本地 draft(弹窗内预览面板实时渲染,画布不受影响) */
  const update = (patch: Partial<CanvasConfig>): void => {
    const next = { ...draftRef.current, ...patch };
    setDraft(next);
  };

  const handleConfirm = (): void => {
    onConfirm(draftRef.current);
    onClose();
  };

  const handleCancel = (): void => {
    // 确认制:画布从未被改动,直接关闭(丢弃 draft)
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
            onClick={() => {
              setDraft(DEFAULT_CANVAS_CONFIG);
            }}>
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
        /* 面板底色只作用于弹窗卡片本身(root,antd 6 已移除 content 键),不再铺满整个 wrapper;mask 保持全透明,露出画布 */
        root: {
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
          {/* Plan#13: 真实节点渲染链预览(配置专用节点 + 真实组单元),与画布同源 */}
          <ConfigPreviewHost
            nodeDefaults={configToNodeDefaults(draft, previewTheme)}
            groupDefaults={configToGroupDefaults(draft, previewTheme)}
            pinDefaults={{ ...configToPinDefaults(draft), color: previewTheme.node.pinDefaultColor }}
            theme={previewTheme}
            isMobile={isMobile}
          />
        </div>
        <div style={configAreaStyle}>
          <div style={subtitleStyle}>{t('settings.subtitle')}</div>
          {/* ===== 操作提示开关卡片(立即生效,不随"重置默认"联动) ===== */}
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