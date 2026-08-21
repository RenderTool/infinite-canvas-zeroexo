/**
 * production-editor-styles - 统筹编辑器样式（Plan#29 V3）
 *
 * 本文件 1:1 迁移自已打磨的 subject-editor-styles（Plan#20 多轮验收成果），
 * 统筹编辑器必须复用同一套视觉体系，禁止自由发挥：
 * - 输入框/表单/图片查看器 = 与 asset-library/prompt-create-page.tsx 1:1 同款
 * - 网格卡片 = 与 asset-library/cards/asset-card.tsx 1:1 同款（封面 239.2/135.4 + cover 填充 + 底部信息 + hover 浮条）
 * - 块间分隔：背景分层 + 阴影，慎用边框；控件（输入框/按钮）按提示词页面保留边框
 */

import type { CSSProperties } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';

type Theme = ThemeConfig;

// ===== 提示词页面同款：标题栏 / 页脚 =====
// 来源 prompt-create-page.tsx modalHeaderStyle / modalFooterStyle

export function modalHeaderStyle(theme: Theme): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 18px',
    borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    flexShrink: 0,
  };
}

export function modalHeaderIconStyle(theme: Theme): CSSProperties {
  return {
    width: 34,
    height: 34,
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: theme.mode === 'dark' ? 'rgba(233,69,96,0.12)' : 'rgba(233,69,96,0.08)',
    color: theme.toolbar.accent ?? '#e94560',
    flexShrink: 0,
  };
}

// 来源 prompt-create-page.tsx modalTitleInputStyle
export function modalTitleInputStyle(theme: Theme): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    flex: 1,
    minWidth: 0,
    height: 36,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontFamily: "'DM Sans', system-ui, sans-serif",
    fontSize: 16,
    fontWeight: 600,
    color: isDark ? '#f5f5f4' : '#1c1917',
    padding: 0,
  };
}

// 来源 prompt-create-page.tsx modalIconBtnStyle
export function modalIconBtnStyle(theme: Theme, active: boolean): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: 'none',
    background: active ? 'rgba(233,69,96,0.12)' : 'transparent',
    color: active ? '#e94560' : (isDark ? '#a8a29e' : '#57534e'),
    cursor: 'pointer',
    transition: 'all 0.15s',
  };
}

// 来源 prompt-create-page.tsx ghostHoverHandlers
export function ghostHoverHandlers(theme: Theme): {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => void;
} {
  const hoverBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  return {
    onMouseEnter: (e) => { e.currentTarget.style.background = hoverBg; },
    onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent'; },
  };
}

// 来源 prompt-create-page.tsx modalEditBtnStyle
export function modalEditBtnStyle(theme: Theme): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    padding: '0 14px',
    background: 'transparent',
    color: theme.toolbar.text,
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
    borderRadius: 8,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
  };
}

// ===== 提示词页面同款：图片预览区（大图舞台 + 胶卷条） =====
// 来源 prompt-create-page.tsx previewStageStyle / previewImageStyle / coverBadgeStyle /
// imageCounterStyle / emptyPreviewStyle / filmstripStyle / thumbItemStyle /
// thumbImageStyle / thumbCoverBadgeStyle / thumbHoverOverlayStyle / thumbActionBtnStyle / uploadTileStyle

export function previewStageStyle(theme: Theme): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    flex: 1,
    minHeight: 340,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: isDark ? '#1c1917' : '#f5f5f4',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    backgroundImage: isDark
      ? `linear-gradient(45deg, #211d1a 25%, transparent 25%), linear-gradient(-45deg, #211d1a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #211d1a 75%), linear-gradient(-45deg, transparent 75%, #211d1a 75%)`
      : `linear-gradient(45deg, #e8e6e3 25%, transparent 25%), linear-gradient(-45deg, #e8e6e3 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e8e6e3 75%), linear-gradient(-45deg, transparent 75%, #e8e6e3 75%)`,
    backgroundSize: '20px 20px',
    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  };
}

export const previewImageStyle: CSSProperties = {
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  display: 'block',
  borderRadius: 4,
  filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.15))',
};

export const coverBadgeStyle: CSSProperties = {
  position: 'absolute',
  top: 10,
  left: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 9px',
  borderRadius: 6,
  background: 'rgba(233,69,96,0.92)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.02em',
  backdropFilter: 'blur(6px)',
  boxShadow: '0 2px 8px rgba(233,69,96,0.3)',
};

export const imageCounterStyle: CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  padding: '3px 8px',
  borderRadius: 5,
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 500,
  fontFamily: "'JetBrains Mono', monospace",
  backdropFilter: 'blur(4px)',
};

export const emptyPreviewStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 48,
  color: '#78716c',
};

export function filmstripStyle(): CSSProperties {
  return {
    display: 'flex',
    gap: 8,
    overflowX: 'auto',
    overflowY: 'hidden',
    padding: '4px 0 6px',
    minHeight: 84,
    alignItems: 'center',
    scrollbarWidth: 'thin',
  };
}

export function thumbItemStyle(theme: Theme, isActive: boolean, isCover: boolean): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    position: 'relative',
    width: 76,
    height: 76,
    borderRadius: 8,
    overflow: 'hidden',
    flexShrink: 0,
    cursor: 'pointer',
    background: isDark ? '#211d1a' : '#e8e6e3',
    border: isActive
      ? '2px solid #e94560'
      : isCover
        ? '2px solid rgba(233,69,96,0.4)'
        : `2px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    transition: 'border-color 0.15s, transform 0.15s',
  };
}

export const thumbImageStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

export const thumbCoverBadgeStyle: CSSProperties = {
  position: 'absolute',
  bottom: 3,
  left: 3,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: 'rgba(233,69,96,0.92)',
  color: '#fff',
};

export const thumbHoverOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'flex-end',
  gap: 3,
  padding: 4,
  opacity: 0,
  transition: 'opacity 0.15s',
  background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 55%)',
};

export const thumbActionBtnStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 5,
  border: 'none',
  background: 'rgba(0,0,0,0.7)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
  backdropFilter: 'blur(4px)',
};

export function uploadTileStyle(theme: Theme): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    width: 76,
    height: 76,
    borderRadius: 8,
    border: `1.5px dashed ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    cursor: 'pointer',
    flexShrink: 0,
    background: 'transparent',
    color: isDark ? '#78716c' : '#a8a29e',
    transition: 'all 0.15s',
  };
}

// ===== 提示词页面同款：表单区 =====
// 来源 prompt-create-page.tsx formPanelStyle / formSectionStyle / formLabelStyle /
// formLabelRowStyle / copyBtnStyle / noteInputStyle / promptBlockStyle / promptTextareaStyle

export function formSectionStyle(): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
  };
}

export function formLabelStyle(theme: Theme): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: isDark ? '#a8a29e' : '#78716c',
    marginBottom: 8,
  };
}

export function formLabelRowStyle(): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 8,
  };
}

export function copyBtnStyle(theme: Theme): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'transparent',
    border: 'none',
    color: isDark ? '#a8a29e' : '#78716c',
    cursor: 'pointer',
    fontSize: 11,
    padding: 0,
    transition: 'color 0.15s',
  };
}

export function noteInputStyle(theme: Theme): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    width: '100%',
    minHeight: 56,
    maxHeight: 100,
    background: isDark ? '#211d1a' : '#f5f5f4',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    borderRadius: 8,
    outline: 'none',
    padding: '8px 12px',
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    color: isDark ? '#d6d3d1' : '#44403c',
    resize: 'none',
    transition: 'border-color 0.15s',
  };
}

export function promptBlockStyle(theme: Theme): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    background: isDark ? '#161412' : '#fafaf9',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    borderRadius: 10,
    padding: '12px 14px',
    flex: 1,
    minHeight: 160,
    overflow: 'auto',
    resize: 'none',
  };
}

export function promptTextareaStyle(theme: Theme): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    width: '100%',
    minHeight: 136,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    fontSize: 12,
    lineHeight: 1.65,
    color: isDark ? '#d6d3d1' : '#44403c',
    resize: 'vertical',
    padding: 0,
  };
}

// 来源 prompt-create-page.tsx tagInputStyle（别名/标签等单行输入）
export function tagInputStyle(theme: Theme): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    width: '100%',
    height: 34,
    background: isDark ? '#211d1a' : '#f5f5f4',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    borderRadius: 8,
    outline: 'none',
    padding: '0 12px',
    fontFamily: 'inherit',
    fontSize: 13,
    color: isDark ? '#f5f5f4' : '#1c1917',
    transition: 'border-color 0.15s',
  };
}

// ===== 资产浏览器同款：网格卡片（来源 asset-card.tsx AssetCardGrid 内联值） =====

export function cardCoverBg(theme: Theme): string {
  return theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : '#ffffff';
}

export function cardCoverBorder(theme: Theme): string {
  return theme.mode === 'dark' ? '1px solid rgba(255,255,255,0.06)' : '1px solid #e5e7eb';
}

export function cardCoverStyle(theme: Theme): CSSProperties {
  return {
    position: 'relative',
    width: '100%',
    aspectRatio: '239.2 / 135.4',
    borderRadius: 12,
    overflow: 'hidden',
    background: cardCoverBg(theme),
    border: cardCoverBorder(theme),
  };
}

// ===== 编辑器特有（无边线：背景分层 + 阴影，块间不用边框） =====

/** 左栏导航条目：选中态用背景分层 + 左侧色块指示，不用边框 */
export function stateNavItemStyle(active: boolean, accent: string, surfaceBg: string): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 10px',
    borderRadius: 10,
    cursor: 'pointer',
    background: active ? `${accent}14` : surfaceBg,
    transition: 'background 0.15s',
    ...(active ? { boxShadow: `inset 3px 0 0 0 ${accent}` } : {}),
  };
}

/** 视图切换（网格/图册）：背景分层 + 选中实心 */
export function viewSwitchBtnStyle(active: boolean, accent: string, textMuted: string): CSSProperties {
  return {
    width: 30,
    height: 28,
    border: 'none',
    borderRadius: 7,
    cursor: 'pointer',
    background: active ? accent : 'transparent',
    color: active ? '#fff' : textMuted,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
  };
}

export function voiceCardStyle(surfaceBg: string): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    borderRadius: 10,
    background: surfaceBg,
  };
}

export function pickerPanelStyle(bg: string): CSSProperties {
  return {
    width: 400,
    maxHeight: '60vh',
    display: 'flex',
    flexDirection: 'column',
    background: bg,
    borderRadius: 14,
    boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
    overflow: 'hidden',
  };
}
