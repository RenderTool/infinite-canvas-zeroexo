import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@zeroexo/plugin-theme';
import { App } from './app.js';
// TailwindCSS 全局样式 (必须在 React render 之前执行)
import './app.css';
// 副作用初始化 i18n(必须在 React render 之前执行)
import './i18n/config.js';
// Tailwind CSS v4 已通过 app.css 接管全局样式(字体/动画/滚动条)
// global-styles.ts 已迁移到 app.css 并删除
// 启动定期清理服务(每24小时清理一次未被引用的离散资源)
import { startPeriodicCleanup } from '@zeroexo/plugin-persistence';

startPeriodicCleanup(24 * 60);

const root = createRoot(document.getElementById('root')!);
root.render(
  <ThemeProvider initialMode="dark">
    <App />
  </ThemeProvider>,
);
