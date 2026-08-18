/**
 * LanguageDialog - 统一语言切换对话框(antd Modal 居中弹窗)
 *
 * 与 AppearanceDialog 同款,屏幕居中显示,统一尺寸 360px。
 * 支持 zh / en / ja 三种语言切换,持久化到 localStorage。
 */

import { useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { Check, Languages } from 'lucide-react';
import { LANG_STORAGE_KEY, SUPPORTED_LANGS } from '@/i18n/config.js';
import type { AppLang } from '@/i18n/config.js';

export interface LanguageDialogProps {
  theme: ThemeConfig;
  currentLang: AppLang;
  onClose: () => void;
}

const LANG_META: Record<AppLang, { nativeName: string; flag: string }> = {
  zh: { nativeName: '简体中文', flag: '🇨🇳' },
  en: { nativeName: 'English', flag: '🇺🇸' },
  ja: { nativeName: '日本語', flag: '🇯🇵' },
};

export function LanguageDialog({
  theme,
  currentLang,
  onClose,
}: LanguageDialogProps): React.ReactElement {
  const { t, i18n } = useTranslation();

  const handleSelectLang = useCallback(
    (lang: AppLang) => {
      void i18n.changeLanguage(lang);
      try {
        localStorage.setItem(LANG_STORAGE_KEY, lang);
      } catch {
        // localStorage 不可用时静默忽略
      }
      onClose();
    },
    [i18n, onClose],
  );

  const sectionLabelStyle: CSSProperties = {
    fontSize: 11,
    color: theme.toolbar.textMuted,
    marginBottom: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  };

  const listStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  };

  const langItemStyle = (active: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 14px',
    borderRadius: 8,
    border: 'none',
    background: active
      ? theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'
      : 'transparent',
    color: theme.toolbar.text,
    cursor: 'pointer',
    transition: 'background 0.15s',
    fontSize: 14,
    fontFamily: 'inherit',
    textAlign: 'left',
  });

  return (
    <Modal
      open={true}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Languages size={16} />
          <span>{t('languageDialog.title')}</span>
        </div>
      }
      centered
      onCancel={onClose}
      footer={null}
      width={360}
      destroyOnHidden
      styles={{
        mask: { background: 'transparent' },
      }}
    >
      <div style={sectionLabelStyle}>{t('languageDialog.subtitle')}</div>
      <div style={listStyle}>
        {SUPPORTED_LANGS.map((lang) => {
          const isActive = currentLang === lang;
          return (
            <button
              key={lang}
              type="button"
              onClick={() => handleSelectLang(lang)}
              style={langItemStyle(isActive)}
            >
              <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>
                {LANG_META[lang].flag}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {LANG_META[lang].nativeName}
                </div>
                <div style={{ fontSize: 11, color: theme.toolbar.textMuted, marginTop: 2 }}>
                  {t(`language.${lang}`)}
                </div>
              </div>
              {isActive ? <Check size={16} /> : <span style={{ width: 16 }} />}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
