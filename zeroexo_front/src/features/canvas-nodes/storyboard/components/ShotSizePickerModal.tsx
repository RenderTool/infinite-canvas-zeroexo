/**
 * ShotSizePickerModal - 景别取景器弹窗
 *
 * 可视化取景器，直观预览每种景别的构图范围。
 * 使用 antd Modal 组件，通过 @zeroexo/plugin-theme 的 useTheme 适配暗色/亮色主题。
 */
import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { X, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { Z_INDEX } from '@/shared/constants/z-index.js';

// ========== 景别数据 ==========
const SHOTS = [
  {
    id: 'els', name: '超远景', en: 'Extreme Long Shot \u00B7 ELS',
    color: '#ef4444', light: 'rgba(239,68,68,0.12)',
    personScale: 0.28, personY: 0,
    crop: { top: 0, bottom: 0.08, left: 0.18, right: 0.18 },
    desc: '人物在画面中占比极小，环境占据绝大部分空间。常用于影片开场建立地点、时间氛围，或表现人物的渺小与孤独感。',
    usages: ['开场建置', '宏大场景', '孤独感', '环境交代'],
    ranges: ['全身极小', '环境主导'],
    focusPoint: '全身',
  },
  {
    id: 'ls', name: '远景 / 全景', en: 'Long Shot / Wide Shot \u00B7 LS / WS',
    color: '#f59e0b', light: 'rgba(245,158,11,0.12)',
    personScale: 0.55, personY: 0,
    crop: { top: 0.02, bottom: 0.06, left: 0.12, right: 0.12 },
    desc: '人物全身可见，头顶和脚底均留有空间。展示人物与环境的关系，常用于入出场或行走镜头。',
    usages: ['入出场', '行走镜头', '环境关系', '群像'],
    ranges: ['全身可见', '头顶脚底留空间'],
    focusPoint: '全身',
  },
  {
    id: 'mls', name: '中远景', en: 'Medium Long Shot \u00B7 MLS',
    color: '#a855f7', light: 'rgba(168,85,247,0.12)',
    personScale: 0.8, personY: 3,
    crop: { top: 0.04, bottom: 0.22, left: 0.08, right: 0.08 },
    desc: '人物大约膝盖以上入画。介于全景与中景之间，既能看到动作又能辨认表情。',
    usages: ['动作展示', '双人对峙', '过肩镜头'],
    ranges: ['膝盖以上', '动作+表情兼顾'],
    focusPoint: '膝盖以上',
  },
  {
    id: 'ms', name: '近景', en: 'Medium Shot \u00B7 MS',
    color: '#ec4899', light: 'rgba(236,72,153,0.12)',
    personScale: 1.1, personY: 8,
    crop: { top: 0.06, bottom: 0.34, left: 0.06, right: 0.06 },
    desc: '人物腰部以上入画，面部表情清晰可辨。叙事中最常用的景别，兼顾环境与人物情绪。',
    usages: ['对话场景', '情绪表达', '叙事推进'],
    ranges: ['腰部以上', '头部完整'],
    focusPoint: '腰部以上',
  },
  {
    id: 'cu', name: '特写', en: 'Close Up \u00B7 CU',
    color: '#3b82f6', light: 'rgba(59,130,246,0.12)',
    personScale: 1.5, personY: 12,
    crop: { top: 0.08, bottom: 0.48, left: 0.04, right: 0.04 },
    desc: '人物胸部以上充满画面，面部细节成为绝对主体。用于强调情绪、反应或传递关键信息。',
    usages: ['情绪特写', '反应镜头', '关键信息'],
    ranges: ['胸部以上', '面部主导'],
    focusPoint: '头部',
  },
  {
    id: 'ecu', name: '大特写', en: 'Extreme Close Up \u00B7 ECU',
    color: '#22c55e', light: 'rgba(34,197,94,0.12)',
    personScale: 2.0, personY: 22,
    crop: { top: 0.12, bottom: 0.58, left: 0.02, right: 0.02 },
    desc: '仅截取面部局部——眼睛、嘴唇或微表情，或某个物件细节。最具冲击力，用于高潮与转折。',
    usages: ['高潮爆发', '转折时刻', '微表情', '物件细节'],
    ranges: ['仅面部局部', '眼睛/嘴唇/微表情'],
    focusPoint: '眼睛',
  },
];

// ========== 人物 SVG 组件 ==========
function PersonSvg(): React.ReactElement {
  return (
    <svg className="person-svg" width="80" height="180" viewBox="0 0 80 180" fill="none" style={{ display: 'block', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.4))' }}>
      {/* 阴影 */}
      <ellipse cx="40" cy="178" rx="22" ry="3" fill="#000" opacity="0.4" />
      {/* 头部 */}
      <ellipse cx="40" cy="22" rx="14" ry="16" fill="#c4c4c4" />
      {/* 头发 */}
      <path d="M26 18 Q30 4 40 6 Q52 4 54 20 Q54 10 48 8 Q40 2 32 10 Q28 14 26 18Z" fill="#3a3a3a" />
      {/* 刘海 */}
      <path d="M28 12 Q34 6 40 8 Q46 6 52 12 Q46 4 40 6 Q34 4 28 12Z" fill="#2e2e2e" />
      {/* 眉毛 */}
      <line x1="34" y1="20" x2="38" y2="20.5" stroke="#444" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="42" y1="20.5" x2="46" y2="20" stroke="#444" strokeWidth="1.2" strokeLinecap="round" />
      {/* 眼睛 */}
      <ellipse cx="36" cy="23" rx="1.8" ry="2" fill="#222" />
      <ellipse cx="44" cy="23" rx="1.8" ry="2" fill="#222" />
      {/* 瞳孔高光 */}
      <circle cx="36.5" cy="22.4" r="0.6" fill="#999" />
      <circle cx="44.5" cy="22.4" r="0.6" fill="#999" />
      {/* 鼻子 */}
      <path d="M40 24 L38.5 28 L40 28.5" fill="none" stroke="#555" strokeWidth="0.8" strokeLinecap="round" />
      {/* 嘴 */}
      <path d="M37 31 Q40 33 43 31" fill="none" stroke="#555" strokeWidth="1" strokeLinecap="round" />
      {/* 耳朵 */}
      <ellipse cx="27" cy="24" rx="2.5" ry="3.5" fill="#b0b0b0" />
      <ellipse cx="53" cy="24" rx="2.5" ry="3.5" fill="#b0b0b0" />
      {/* 脖子 */}
      <rect x="35" y="36" width="10" height="10" rx="2" fill="#b8b8b8" />
      {/* 躯干（上衣） */}
      <path d="M22 46 Q20 44 20 50 L24 90 Q24 96 30 96 L50 96 Q56 96 56 90 L60 50 Q60 44 58 46 Z" fill="#888888" />
      {/* 领口 */}
      <path d="M35 46 Q40 52 45 46" fill="none" stroke="#666" strokeWidth="1" />
      {/* 手臂 */}
      <path d="M22 50 Q14 70 16 100 Q17 104 20 102 L24 90" fill="#999999" />
      <path d="M58 50 Q66 70 64 100 Q63 104 60 102 L56 90" fill="#999999" />
      {/* 手 */}
      <circle cx="17" cy="103" r="5" fill="#c4c4c4" />
      <circle cx="63" cy="103" r="5" fill="#c4c4c4" />
      {/* 腰/胯 */}
      <path d="M28 96 L28 110 Q28 114 32 114 L48 114 Q52 114 52 110 L52 96 Z" fill="#666666" />
      {/* 左腿 */}
      <path d="M30 114 L28 168 Q28 172 32 172 L40 172 Q42 172 42 168 L40 114 Z" fill="#777777" />
      {/* 右腿 */}
      <path d="M42 114 L40 168 Q40 172 44 172 L52 172 Q54 172 54 168 L46 114 Z" fill="#777777" />
      {/* 鞋 */}
      <ellipse cx="35" cy="174" rx="8" ry="4" fill="#444" />
      <ellipse cx="49" cy="174" rx="8" ry="4" fill="#444" />
    </svg>
  );
}

// ========== Props ==========
export interface ShotSizePickerModalProps {
  open: boolean;
  currentValue?: string;
  onClose: () => void;
  onConfirm: (shotType: string) => void;
  /** 取景框宽高比，默认 16/9，例如 1.778 */
  aspectRatio?: number;
}

// ========== Component ==========
export function ShotSizePickerModal({
  open,
  currentValue,
  onClose,
  onConfirm,
  aspectRatio = 16 / 9,
}: ShotSizePickerModalProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';

  const getInitialIdx = useCallback((): number => {
    if (currentValue) {
      const idx = SHOTS.findIndex((s) => s.name === currentValue);
      if (idx >= 0) return idx;
    }
    return 3; // 默认近景
  }, [currentValue]);

  const [currentIdx, setCurrentIdx] = useState<number>(getInitialIdx);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setCurrentIdx(getInitialIdx());
    }
  }, [open, getInitialIdx]);

  const currentShot = SHOTS[currentIdx];

  if (!currentShot) return null;

  // ─── Keyboard navigation ───
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCurrentIdx((prev) => (prev + 1) % SHOTS.length);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrentIdx((prev) => (prev - 1 + SHOTS.length) % SHOTS.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirmClick();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentIdx]);

  const handleConfirmClick = () => {
    onConfirm(currentShot.name);
    onClose();
  };

  // ─── Theme-derived colors ───
  const bg = theme.toolbar.background;
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;
  const accent = theme.toolbar.accent;

  // ─── Crop overlay ───
  const c = currentShot.crop;
  const cropPct = (val: number) => `${(val * 100).toFixed(1)}%`;

  // ─── Styles ───
  const modalContentStyle: CSSProperties = {
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 16,
    boxShadow: isDark
      ? '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)'
      : '0 24px 64px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
    padding: 0,
    overflow: 'hidden',
  };

  const modalBodyStyle: CSSProperties = {
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
  };

  const modalMaskStyle: CSSProperties = {
    background: 'transparent',
  };

  // Header
  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 24px',
    borderBottom: `1px solid ${border}`,
    background: isDark ? '#1f1f1f' : '#fafaf7',
  };

  const closeBtnStyle: CSSProperties = {
    width: 32,
    height: 32,
    border: 'none',
    borderRadius: 8,
    background: 'transparent',
    color: textMuted,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
    fontSize: 18,
  };

  // Body grid — fixed height 520 ensures modal height is consistent across all shot types
  const bodyGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 320px',
    gap: 0,
    height: 520,
    overflow: 'hidden',
  };

  // Viewer area
  const viewerAreaStyle: CSSProperties = {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    background: isDark ? '#111' : '#f0ece4',
    borderRight: `1px solid ${border}`,
    minHeight: 420,
  };

  // Viewer frame — uses aspectRatio prop (default 16/9)
  const viewerFrameStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    maxWidth: 480,
    aspectRatio: `${aspectRatio}`,
    background: isDark ? '#0a0a0a' : '#e8e4dc',
    borderRadius: 10,
    overflow: 'hidden',
    border: `2px solid ${isDark ? '#333' : '#c8c4bc'}`,
    boxShadow: isDark
      ? '0 0 0 1px #000, inset 0 0 40px rgba(0,0,0,0.5)'
      : '0 0 0 1px rgba(0,0,0,0.08), inset 0 0 40px rgba(0,0,0,0.08)',
  };

  const viewerBgStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: isDark
      ? 'radial-gradient(ellipse at 50% 65%, rgba(80,80,80,0.25) 0%, transparent 60%), linear-gradient(180deg, #151515 0%, #0d0d0d 100%)'
      : 'radial-gradient(ellipse at 50% 65%, rgba(160,160,160,0.15) 0%, transparent 60%), linear-gradient(180deg, #e0dcd4 0%, #d8d4cc 100%)',
    overflow: 'hidden',
  };

  const gridOverlayStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundImage: isDark
      ? 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)'
      : 'linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)',
    backgroundSize: '40px 40px',
  };

  const groundStyle: CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '28%',
    background: isDark
      ? 'linear-gradient(180deg, rgba(40,40,40,0.5) 0%, rgba(20,20,20,0.8) 100%)'
      : 'linear-gradient(180deg, rgba(180,176,168,0.5) 0%, rgba(160,156,148,0.8) 100%)',
    borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)'}`,
  };

  // Deco lines
  const decoLine1Style: CSSProperties = {
    position: 'absolute',
    bottom: '28%',
    left: '12%',
    width: 2,
    height: '35%',
    background: isDark ? 'linear-gradient(180deg, #1a1a1a, #111)' : 'linear-gradient(180deg, #d0ccc4, #c8c4bc)',
  };
  const decoLine2Style: CSSProperties = {
    position: 'absolute',
    bottom: '28%',
    right: '18%',
    width: 2,
    height: '45%',
    background: isDark ? 'linear-gradient(180deg, #1a1a1a, #111)' : 'linear-gradient(180deg, #d0ccc4, #c8c4bc)',
  };
  const decoCircleStyle: CSSProperties = {
    position: 'absolute',
    top: '15%',
    right: '22%',
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: `1px solid ${isDark ? '#161616' : '#c8c4bc'}`,
    background: isDark ? '#0d0d0d' : '#e0dcd4',
  };

  // Person wrapper
  const personWrapperStyle: CSSProperties = {
    position: 'absolute',
    bottom: '14%',
    left: '50%',
    transform: `translateX(-50%) translateY(-${currentShot.personY}px) scale(${currentShot.personScale})`,
    transition: 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
    transformOrigin: 'center center',
    zIndex: Z_INDEX.INLINE,
  };

  // Crop overlay
  const cropOverlayStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: Z_INDEX.FLOATING,
    pointerEvents: 'none',
    transition: 'opacity 0.3s',
  };

  const maskBaseStyle: CSSProperties = {
    position: 'absolute',
    background: isDark ? 'rgba(0,0,0,0.58)' : 'rgba(0,0,0,0.35)',
    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
  };

  const cropFrameStyle: CSSProperties = {
    position: 'absolute',
    top: cropPct(c.top),
    bottom: cropPct(c.bottom),
    left: cropPct(c.left),
    right: cropPct(c.right),
    border: `2.5px solid ${currentShot.color}`,
    borderRadius: 2,
    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    color: currentShot.color,
  };

  const cropFrameOuterStyle: CSSProperties = {
    position: 'absolute',
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    border: '1px solid currentColor',
    opacity: 0.25,
    borderRadius: 3,
  };

  const cornerBase: CSSProperties = {
    position: 'absolute',
    width: 12,
    height: 12,
    borderColor: 'inherit',
    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
  };

  const crosshairHStyle: CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '8%',
    right: '8%',
    height: 1,
    background: 'currentColor',
    opacity: 0.12,
    transition: 'color 0.4s',
  };

  const crosshairVStyle: CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '8%',
    bottom: '8%',
    width: 1,
    background: 'currentColor',
    opacity: 0.12,
    transition: 'color 0.4s',
  };

  // Info panel
  const infoPanelStyle: CSSProperties = {
    padding: '28px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    overflowY: 'auto',
    background: isDark ? '#121212' : '#f8f6f2',
  };

  const infoScrollbarStyle = `
    .shot-info-panel::-webkit-scrollbar { width: 4px; }
    .shot-info-panel::-webkit-scrollbar-thumb { background: ${border}; border-radius: 2px; }
  `;

  const shotNameStyle: CSSProperties = {
    fontSize: 24,
    fontWeight: 700,
    lineHeight: 1.2,
    marginBottom: 4,
    color: currentShot.color,
    transition: 'color 0.3s',
  };

  const shotEnStyle: CSSProperties = {
    fontSize: 13,
    color: textMuted,
    marginBottom: 20,
    letterSpacing: '0.5px',
  };

  const shotDescStyle: CSSProperties = {
    fontSize: 14,
    lineHeight: 1.7,
    color: isDark ? '#bbb' : '#57534e',
    marginBottom: 28,
    padding: '14px 16px',
    background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    borderRadius: 8,
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`,
  };

  const usageSectionStyle: CSSProperties = {
    marginBottom: 24,
  };

  const usageTitleStyle: CSSProperties = {
    fontSize: 11,
    color: textMuted,
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    marginBottom: 10,
  };

  const usageTagsWrapStyle: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  };

  const usageTagStyle: CSSProperties = {
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 6,
    background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
    color: isDark ? '#aaa' : '#57534e',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
  };

  const statusBarStyle: CSSProperties = {
    marginTop: 'auto',
    padding: '14px 16px',
    borderRadius: 10,
    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  };

  const statusDotStyle: CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: currentShot.color,
    flexShrink: 0,
    transition: 'background 0.3s',
  };

  const statusTextStyle: CSSProperties = {
    fontSize: 13,
    color: isDark ? '#999' : '#78716c',
  };

  // Shot list section
  const shotListSectionStyle: CSSProperties = {
    borderTop: `1px solid ${border}`,
    padding: '16px 24px',
    background: isDark ? '#181818' : '#f5f4f2',
  };

  const shotListLabelStyle: CSSProperties = {
    fontSize: 11,
    color: textMuted,
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginBottom: 10,
  };

  const shotOptionsStyle: CSSProperties = {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  };

  const shotOptionBase: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    padding: '10px 16px',
    borderRadius: 10,
    border: '1.5px solid',
    cursor: 'pointer',
    transition: 'all 0.2s',
    minWidth: 100,
    userSelect: 'none' as const,
    background: 'transparent',
    fontFamily: 'inherit',
  };

  const shotOptionNormal: CSSProperties = {
    ...shotOptionBase,
    borderColor: isDark ? '#2e2e2e' : '#d0ccc4',
    background: isDark ? '#1f1f1f' : '#f0ece4',
    color: isDark ? '#888' : '#78716c',
  };

  const shotOptionActive: CSSProperties = {
    ...shotOptionBase,
    borderColor: currentShot.color,
    background: isDark ? currentShot.light : `${currentShot.color}15`,
    color: isDark ? '#fff' : '#292524',
  };

  const optDotStyle = (color: string): CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: color,
    marginBottom: 2,
  });

  const optNameStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
  };

  const optEnStyle: CSSProperties = {
    fontSize: 10,
    color: textMuted,
  };

  // Footer
  const footerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 24px',
    borderTop: `1px solid ${border}`,
    background: isDark ? '#1f1f1f' : '#fafaf7',
  };

  const footerHintStyle: CSSProperties = {
    fontSize: 11.5,
    color: isDark ? '#666' : '#a8a29e',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  };

  const kbdStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
    height: 20,
    padding: '0 6px',
    fontSize: 11,
    fontWeight: 600,
    color: isDark ? '#ccc' : '#57534e',
    background: isDark ? '#2a2a2a' : '#e8e4dc',
    border: `1px solid ${isDark ? '#3a3a3a' : '#d0ccc4'}`,
    borderRadius: 4,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  };

  const confirmBtnStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '9px 22px',
    border: 'none',
    borderRadius: 10,
    background: accent,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'inherit',
  };

  // Get short EN tag for option buttons
  const getShortEn = (en: string): string => {
    const parts = en.split('\u00B7');
    if (parts.length > 1) {
      return parts[1]?.trim().split(' ')[0] || parts[0]?.trim().split(' ')[0] || '';
    }
    return en.split(' ')[0] ?? '';
  };

  return (
    <>
      <style>{infoScrollbarStyle}</style>
      <Modal
        open={open}
        onCancel={onClose}
        centered
        width={920}
        footer={null}
        destroyOnHidden
        closeIcon={null}
        zIndex={Z_INDEX.FULLSCREEN_DROPDOWN}
        styles={{
          container: modalContentStyle,
          body: modalBodyStyle,
          mask: modalMaskStyle,
        }}
      >
        {/* ─── Header ─── */}
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: text, letterSpacing: '0.3px' }}>{t('storyboard.selectShotSize')}</div>
            <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>{t('storyboard.shotPickerDesc')}</div>
          </div>
          <button
            type="button"
            style={closeBtnStyle}
            onClick={onClose}
            aria-label={t('common.close')}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
              e.currentTarget.style.color = text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = textMuted;
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ─── Body ─── */}
        <div style={bodyGridStyle}>
          {/* 左侧：取景器 */}
          <div style={viewerAreaStyle}>
            <div style={viewerFrameStyle}>
              {/* 背景 */}
              <div style={viewerBgStyle}>
                <div style={gridOverlayStyle} />
              </div>
              <div style={groundStyle} />

              {/* 场景装饰 */}
              <div style={{ position: 'absolute', inset: 0, zIndex: Z_INDEX.BASE, pointerEvents: 'none' }}>
                <div style={decoLine1Style} />
                <div style={decoLine2Style} />
                <div style={decoCircleStyle} />
              </div>

              {/* 人物 */}
              <div style={personWrapperStyle}>
                <PersonSvg />
              </div>

              {/* 取景遮罩 + 框线 */}
              <div style={cropOverlayStyle}>
                <div style={{ ...maskBaseStyle, top: 0, left: 0, right: 0, height: cropPct(c.top) }} />
                <div style={{ ...maskBaseStyle, bottom: 0, left: 0, right: 0, height: cropPct(c.bottom) }} />
                <div style={{ ...maskBaseStyle, top: 0, bottom: 0, left: 0, width: cropPct(c.left) }} />
                <div style={{ ...maskBaseStyle, top: 0, bottom: 0, right: 0, width: cropPct(c.right) }} />
                <div style={cropFrameStyle}>
                  <div style={cropFrameOuterStyle} />
                  <div style={{ ...cornerBase, top: -2, left: -2, borderTop: '2px solid', borderLeft: '2px solid' }} />
                  <div style={{ ...cornerBase, top: -2, right: -2, borderTop: '2px solid', borderRight: '2px solid' }} />
                  <div style={{ ...cornerBase, bottom: -2, left: -2, borderBottom: '2px solid', borderLeft: '2px solid' }} />
                  <div style={{ ...cornerBase, bottom: -2, right: -2, borderBottom: '2px solid', borderRight: '2px solid' }} />
                  <div style={crosshairHStyle} />
                  <div style={crosshairVStyle} />
                </div>
              </div>
            </div>
          </div>

          {/* 右侧：详情面板 */}
          <div className="shot-info-panel" style={infoPanelStyle}>
            <div style={shotNameStyle}>{currentShot.name}</div>
            <div style={shotEnStyle}>{currentShot.en}</div>
            <div style={shotDescStyle}>{currentShot.desc}</div>

            <div style={usageSectionStyle}>
              <div style={usageTitleStyle}>{t('storyboard.commonUsages')}</div>
              <div style={usageTagsWrapStyle}>
                {currentShot.usages.map((u) => (
                  <span key={u} style={usageTagStyle}>{u}</span>
                ))}
              </div>
            </div>

            <div style={usageSectionStyle}>
              <div style={usageTitleStyle}>{t('storyboard.framingRange')}</div>
              <div style={usageTagsWrapStyle}>
                {currentShot.ranges.map((r) => (
                  <span key={r} style={usageTagStyle}>{r}</span>
                ))}
              </div>
            </div>

            {/* 焦点提示 */}
            <div style={usageSectionStyle}>
              <div style={usageTitleStyle}>{t('storyboard.focusArea')}</div>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                background: currentShot.light,
                border: `1px solid ${currentShot.color}40`,
                fontSize: 13,
                fontWeight: 600,
                color: currentShot.color,
              }}>
                <span>{currentShot.focusPoint}</span>
              </div>
            </div>

            <div style={statusBarStyle}>
              <div style={statusDotStyle} />
              <div style={statusTextStyle}>
                {t('storyboard.selectedShot', { name: currentShot.name, en: currentShot.en.split('\u00B7')[1]?.trim() || '' })}
              </div>
            </div>
          </div>
        </div>

        {/* ─── 底部选项栏 ─── */}
        <div style={shotListSectionStyle}>
          <div style={shotListLabelStyle}>{t('storyboard.shotListLabel')}</div>
          <div style={shotOptionsStyle}>
            {SHOTS.map((s, idx) => {
              const isActive = idx === currentIdx;
              return (
                <button
                  key={s.id}
                  type="button"
                  style={isActive
                    ? { ...shotOptionActive, borderColor: s.color, background: isDark ? `${s.color}22` : `${s.color}15` }
                    : shotOptionNormal
                  }
                  onClick={() => setCurrentIdx(idx)}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
                      e.currentTarget.style.color = isDark ? '#ccc' : '#57534e';
                      e.currentTarget.style.borderColor = isDark ? '#444' : '#b8b4ac';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = isDark ? '#1f1f1f' : '#f0ece4';
                      e.currentTarget.style.color = isDark ? '#888' : '#78716c';
                      e.currentTarget.style.borderColor = isDark ? '#2e2e2e' : '#d0ccc4';
                    }
                  }}
                >
                  <div style={optDotStyle(s.color)} />
                  <div style={optNameStyle}>{s.name}</div>
                  <div style={optEnStyle}>{getShortEn(s.en)}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── Footer ─── */}
        <div style={footerStyle}>
          <div style={footerHintStyle}>
            <span style={kbdStyle}><ArrowLeft size={11} /></span>
            <span style={kbdStyle}><ArrowRight size={11} /></span>
            <span>{t('storyboard.switchShot')}</span>
            <span style={{ margin: '0 8px', color: isDark ? '#444' : '#c8c4bc' }}>|</span>
            <span style={kbdStyle}>Enter</span>
            <span>{t('common.confirm')}</span>
            <span style={{ margin: '0 8px', color: isDark ? '#444' : '#c8c4bc' }}>|</span>
            <span style={kbdStyle}>Esc</span>
            <span>{t('common.close')}</span>
          </div>
          <button
            type="button"
            style={confirmBtnStyle}
            onClick={handleConfirmClick}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.9';
              e.currentTarget.style.transform = 'scale(1.02)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
              e.currentTarget.style.transform = 'scale(1)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.98)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1.02)';
            }}
          >
            {t('common.confirm')}
            <Check size={14} />
          </button>
        </div>
      </Modal>
    </>
  );
}