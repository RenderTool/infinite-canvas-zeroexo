/**
 * AppearanceDialog - 统一换肤对话框(antd Modal 居中弹窗)
 *
 * 主页和画布共用同一组件,确保文案和交互一致。
 * 使用 antd Modal 组件实现居中弹窗效果。
 */

import { useCallback } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { AnimatedThemeToggler, useTheme } from '@zeroexo/plugin-theme';
import type { ThemeConfig, ThemeMode } from '@zeroexo/shared';
import { CircleDot, Grid2x2, Square } from 'lucide-react';

export type GridStyle = 'dots' | 'lines' | 'none';

export interface AppearanceDialogProps {
  theme: ThemeConfig;
  currentMode: ThemeMode;
  onClose: () => void;
  /** 画布专用:网格样式(主页不传时隐藏网格选项) */
  gridStyle?: GridStyle;
  onGridStyleChange?: (style: GridStyle) => void;
}

export function AppearanceDialog({
  theme,
  currentMode,
  onClose,
  gridStyle,
  onGridStyleChange,
}: AppearanceDialogProps): React.ReactElement {
  const { setMode } = useTheme();
  const { t } = useTranslation();

  const sectionLabelStyle: CSSProperties = {
    fontSize: 11,
    color: theme.toolbar.textMuted,
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  };

  const themeModeGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginBottom: 14,
  };

  const themeBtnStyle = (active: boolean): CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    padding: '10px 0',
    borderRadius: 8,
    border: 'none',
    background: active ? (theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)') : 'transparent',
    color: theme.toolbar.text,
    cursor: 'pointer',
    transition: 'background 0.15s',
    fontSize: 12,
  });

  const gridOptions: { key: GridStyle; label: string; icon: ReactNode }[] = [
    { key: 'dots', label: t('appearance.gridDots'), icon: <CircleDot size={16} /> },
    { key: 'lines', label: t('appearance.gridLines'), icon: <Grid2x2 size={16} /> },
    { key: 'none', label: t('appearance.gridNone'), icon: <Square size={16} /> },
  ];

  const segmentedStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 4,
    padding: 3,
    borderRadius: 8,
    background: theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
  };

  const segmentBtnStyle = (active: boolean): CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '6px 0',
    borderRadius: 6,
    border: 'none',
    background: active ? theme.toolbar.background : 'transparent',
    color: active ? theme.toolbar.text : theme.toolbar.textMuted,
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
    fontSize: 11,
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
  });

  const handleLightClick = useCallback(() => {
    setMode('light');
  }, [setMode]);

  const handleDarkClick = useCallback(() => {
    setMode('dark');
  }, [setMode]);

  return (
    <Modal
      open={true}
      title={t('appearance.title')}
      centered
      onCancel={onClose}
      footer={null}
      width={360}
      destroyOnHidden
      styles={{
        mask: { background: 'transparent' },
      }}
    >
      {/* 主题模式 */}
      <div style={sectionLabelStyle}>{t('appearance.themeMode')}</div>
      <div style={themeModeGridStyle}>
        <AnimatedThemeToggler
          targetTheme="light"
          theme={currentMode}
          onThemeChange={handleLightClick}
          variant="circle"
          duration={400}
          style={themeBtnStyle(currentMode === 'light')}
          aria-label={t('appearance.lightMode')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2"/>
            <path d="M12 20v2"/>
            <path d="m4.93 4.93 1.41 1.41"/>
            <path d="m17.66 17.66 1.41 1.41"/>
            <path d="M2 12h2"/>
            <path d="M20 12h2"/>
            <path d="m6.34 17.66-1.41 1.41"/>
            <path d="m19.07 4.93-1.41 1.41"/>
          </svg>
          <span>{t('common.light')}</span>
        </AnimatedThemeToggler>
        <AnimatedThemeToggler
          targetTheme="dark"
          theme={currentMode}
          onThemeChange={handleDarkClick}
          variant="circle"
          duration={400}
          style={themeBtnStyle(currentMode === 'dark')}
          aria-label={t('appearance.darkMode')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
          </svg>
          <span>{t('common.dark')}</span>
        </AnimatedThemeToggler>
      </div>

      {/* 网格样式(仅画布场景) */}
      {gridStyle !== undefined && onGridStyleChange && (
        <>
          <div style={{ ...sectionLabelStyle, marginTop: 8 }}>{t('appearance.gridStyle')}</div>
          <div style={segmentedStyle}>
            {gridOptions.map((opt) => (
              <button
                key={opt.key}
                type="button"
                style={segmentBtnStyle(gridStyle === opt.key)}
                onClick={() => onGridStyleChange(opt.key)}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}