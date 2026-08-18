/**
 * registry-factory — 注册表工厂
 *
 * 创建标准化的注册表实例供不同场景使用。
 */
import { ParamRendererRegistry } from './ParamRendererRegistry';
import {
  EnumRenderer,
  NumberRenderer,
  BooleanRenderer,
  StringRenderer,
  ImagesRenderer,
} from './base-renderers';
import { SizeRenderer } from './SizeRenderer';

/** 默认渲染器映射（共享给所有注册表） */
export const DEFAULT_RENDERER_MAP = {
  enum: EnumRenderer,
  number: NumberRenderer,
  boolean: BooleanRenderer,
  string: StringRenderer,
  images: ImagesRenderer,
  size: SizeRenderer,
};

/** 渠道参数配置弹窗注册表（每行一个参数 + Switch 开关） */
export function createSchemaRegistry(): ParamRendererRegistry {
  const registry = new ParamRendererRegistry();
  registry.registerAll(DEFAULT_RENDERER_MAP);
  return registry;
}

/** AI 测试参数弹窗注册表（原生交互面板 + 联动） */
export function createWorkbenchRegistry(): ParamRendererRegistry {
  const registry = new ParamRendererRegistry();
  registry.registerAll(DEFAULT_RENDERER_MAP);
  return registry;
}
