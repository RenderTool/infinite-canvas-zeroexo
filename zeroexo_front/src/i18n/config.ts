/**
 * i18n - 多语言初始化配置
 *
 * 资源内联(JSON 直接 import),fallbackLng: 'zh',支持 zh/en/ja。
 * 初始语言从 localStorage('zeroexo:lang')读取,缺失时回落到 fallbackLng。
 * 在 main.tsx 中以副作用方式 import './i18n/config.ts' 完成初始化。
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
// resolveJsonModule 已启用,可直接 import JSON;Vite 原生支持 JSON 模块
import zh from './zh.json';
import en from './en.json';
import ja from './ja.json';

/** localStorage 存储 LanguageSwitcher 选定语言的 key */
export const LANG_STORAGE_KEY = 'zeroexo:lang';

/** 支持的语言列表(LanguageSwitcher 用于渲染下拉项) */
export const SUPPORTED_LANGS = ['zh', 'en', 'ja'] as const;
export type AppLang = (typeof SUPPORTED_LANGS)[number];

/** 从 localStorage 读取初始语言,无效值回落到 fallbackLng */
function detectInitialLang(): AppLang {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved && (SUPPORTED_LANGS as readonly string[]).includes(saved)) {
      return saved as AppLang;
    }
  } catch {
    // localStorage 不可用(SSR / 隐私模式)时静默回落
  }
  return 'zh';
}

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
    ja: { translation: ja },
  },
  lng: detectInitialLang(),
  fallbackLng: 'zh',
  interpolation: {
    // React 已转义,关闭 i18next 默认转义避免双重处理
    escapeValue: false,
  },
  returnNull: false,
});

export default i18n;
