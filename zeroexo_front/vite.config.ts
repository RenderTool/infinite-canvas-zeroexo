import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // ===== Monorepo 开发模式 alias: 直接指向 workspace 包的 src 目录,
      //       修改 packages/*/src 后 HMR 立即生效(无需手动 tsc build/watch) =====
      '@zeroexo/core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@zeroexo/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      '@zeroexo/plugin-ai-provider': path.resolve(__dirname, './packages/plugins/ai-provider/src/index.ts'),
      '@zeroexo/plugin-connection': path.resolve(__dirname, './packages/plugins/connection/src/index.ts'),
      '@zeroexo/plugin-group': path.resolve(__dirname, './packages/plugins/group/src/index.ts'),
      '@zeroexo/plugin-history': path.resolve(__dirname, './packages/plugins/history/src/index.ts'),
      '@zeroexo/plugin-image-editor': path.resolve(__dirname, './packages/plugins/image-editor/src/index.ts'),
      '@zeroexo/plugin-interaction': path.resolve(__dirname, './packages/plugins/interaction/src/index.ts'),
      '@zeroexo/plugin-keyboard': path.resolve(__dirname, './packages/plugins/keyboard/src/index.ts'),
      '@zeroexo/plugin-layout': path.resolve(__dirname, './packages/plugins/layout/src/index.ts'),
      '@zeroexo/plugin-minimap': path.resolve(__dirname, './packages/plugins/minimap/src/index.ts'),
      '@zeroexo/plugin-node-registry': path.resolve(__dirname, './packages/plugins/node-registry/src/index.ts'),
      '@zeroexo/plugin-nodes': path.resolve(__dirname, './packages/plugins/nodes/src/index.tsx'),
      '@zeroexo/plugin-persistence': path.resolve(__dirname, './packages/plugins/persistence-localforage/src/index.ts'),
      '@zeroexo/plugin-render-react': path.resolve(__dirname, './packages/plugins/render-react/src/index.ts'),
      '@zeroexo/plugin-selection': path.resolve(__dirname, './packages/plugins/selection/src/index.ts'),
      '@zeroexo/plugin-theme': path.resolve(__dirname, './packages/plugins/theme/src/index.ts'),
      '@zeroexo/plugin-upload-queue': path.resolve(__dirname, './packages/plugins/upload-queue/src/index.ts'),
      '@zeroexo/preset-default': path.resolve(__dirname, './packages/presets/default/src/index.ts'),
    },
  },
  server: {
    port: 5180,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
      // Yjs 实时同步 WebSocket 转发到后端
      '/ws-sync': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
      '/ws-sync': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
