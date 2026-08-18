import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': {
        translation: zhCN,
      },
      'en-US': {
        translation: enUS,
      },
    },
    fallbackLng: 'zh-CN',
    debug: false,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      lookupLocalStorage: 'i18n-lang',
      caches: ['localStorage'],
    },
  });

export default i18n;
