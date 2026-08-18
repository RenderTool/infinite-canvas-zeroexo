/**
 * ParamRendererRegistry — 参数渲染器注册表
 *
 * 装配模式的核心：通过 type 字符串找到对应的 React 组件。
 * 新增一种参数类型只需写一个组件并 register 即可。
 *
 * 用法：
 *   const registry = new ParamRendererRegistry();
 *   registry.register('enum', EnumRenderer);
 *   const Renderer = registry.resolve('enum');  // 返回已注册的组件
 *   registry.resolve('unknown');                 // 返回 FallbackRenderer
 */
import React from 'react';
import type { ParamRenderer } from './param-types';

/** 默认兜底渲染器（在 base-renderers 中定义，此处 forwardRef 避免循环依赖） */
let defaultFallback: ParamRenderer | null = null;

export function setDefaultFallback(fb: ParamRenderer): void {
  defaultFallback = fb;
}

export function getDefaultFallback(): ParamRenderer {
  return defaultFallback ?? UnknownTypeRenderer;
}

/** 未知类型的兜底 */
const UnknownTypeRenderer: ParamRenderer = ({ param }) =>
  React.createElement('div', { style: { fontSize: 11, color: '#bfbfbf' } },
    `未支持的类型: ${param.type}（参数: ${param.name}）`,
  );

export class ParamRendererRegistry {
  private renderers = new Map<string, ParamRenderer>();

  /** 注册一个参数类型的渲染器 */
  register(type: string, renderer: ParamRenderer): void {
    this.renderers.set(type, renderer);
  }

  /** 注册多个渲染器 */
  registerAll(map: Record<string, ParamRenderer>): void {
    for (const [type, renderer] of Object.entries(map)) {
      this.renderers.set(type, renderer);
    }
  }

  /** 解析 type 对应的渲染器，未知 type 返回 FallbackRenderer */
  resolve(type: string): ParamRenderer {
    const renderer = this.renderers.get(type);
    if (renderer) return renderer;
    return getDefaultFallback();
  }

  /** 是否已注册 */
  has(type: string): boolean {
    return this.renderers.has(type);
  }
}
