import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vitest 单元测试配置
 *
 * 仅用于 ChatArea 拆分后的组件单元测试（jsdom 环境）。
 * 与 vite.config.ts 共享相同的 @ → ./src 别名。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@zeroexo/core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@zeroexo/plugin-persistence': path.resolve(
        __dirname,
        './packages/plugins/persistence-localforage/src/index.ts',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(__dirname, './vitest.setup.ts')],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'packages/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/**',
        'packages/core/src/**',
      ],
    },
  },
});
