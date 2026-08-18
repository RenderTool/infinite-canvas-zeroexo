import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*'],
      // 排除: 测试文件、barrel 导出、纯类型定义文件(无可执行代码)
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/extensions/types.ts',
        'src/model/types.ts',
        'src/model/geometry.ts',
      ],
    },
  },
});
