import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const contentType = proxyRes.headers['content-type'] || '';
            if (contentType.includes('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no';
              proxyRes.headers['cache-control'] = 'no-cache';
            }
          });
        },
      },
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const contentType = proxyRes.headers['content-type'] || '';
            if (contentType.includes('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no';
              proxyRes.headers['cache-control'] = 'no-cache';
            }
          });
        },
      },
    },
  },
})