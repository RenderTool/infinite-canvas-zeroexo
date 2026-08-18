/**
 * Vitest 测试环境初始化
 *
 * - 导入 jest-dom 自定义匹配器（toBeInTheDocument 等）
 * - mock 浏览器 API（matchMedia / IntersectionObserver / scrollTo 等）
 */

import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// mock matchMedia（Ant Design / 部分组件依赖）
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = '';
  thresholds = [];
}
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

// mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
});

// mock scrollTo（jsdom 不支持平滑滚动）
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.scrollTo = vi.fn();
window.scrollTo = vi.fn();

// mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(() => Promise.resolve()),
    readText: vi.fn(() => Promise.resolve('')),
  },
});

// mock URL.createObjectURL / revokeObjectURL
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'mock://blob');
  URL.revokeObjectURL = vi.fn();
}
