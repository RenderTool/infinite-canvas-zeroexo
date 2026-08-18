/**
 * 模型工具函数 - 从 use-ai-config-store 抽离
 *
 * 包含 ModelConfig 类型定义、模型能力分类、元数据查询等纯函数。
 * 无 store 依赖，可在任何模块中安全使用。
 */

import { encodeChannelModel, decodeChannelModel, modelOptionName } from '../use-ai-config-store.js';
import type { ModelChannel } from '../use-ai-config-store.js';

// ===== 类型 =====

/**
 * 模型能力/模式/规格元数据(与后端 provider-presets.ts 的 ModelConfig 一致)
 * - capabilities: 能力类型 'image' | 'video' | 'audio' | 'text' | 'llm'
 * - supportedModes: 视频模型支持的生成模式
 * - inputTypes: 模型支持的输入类型（如 'text' | 'image' 等）
 * - specs: 规格配置(分辨率/比例/时长/音色等,结构因模型而异)
 */
export interface ModelConfig {
  name: string;
  capabilities: string[];
  supportedModes?: string[];
  inputTypes?: string[];
  specs?: Record<string, unknown>;
}

export type ModelCapability = 'image' | 'video' | 'text' | 'audio';

// ===== 模型能力分类(启发式) =====

export function isVideoModelName(model: string): boolean {
  const value = modelOptionName(model).toLowerCase();
  return (
    value.includes('seedance') ||
    value.includes('video') ||
    value.includes('sora') ||
    value.includes('veo') ||
    value.includes('kling') ||
    value.includes('wan') ||
    value.includes('hailuo')
  );
}

export function isAudioModelName(model: string): boolean {
  const value = modelOptionName(model).toLowerCase();
  return (
    value.includes('audio') ||
    value.includes('tts') ||
    value.includes('speech') ||
    value.includes('voice') ||
    value.includes('music') ||
    value.includes('sound')
  );
}

export function isImageModelName(model: string): boolean {
  const value = modelOptionName(model).toLowerCase();
  return (
    !isVideoModelName(model) &&
    !isAudioModelName(model) &&
    (value.includes('seedream') ||
      value.includes('gpt-image') ||
      value.includes('image') ||
      value.includes('dall-e') ||
      value.includes('dalle') ||
      value.includes('imagen') ||
      value.includes('flux') ||
      value.includes('sdxl') ||
      value.includes('stable-diffusion') ||
      value.includes('midjourney'))
  );
}

export function isTextModelName(model: string): boolean {
  return (
    !isImageModelName(model) &&
    !isVideoModelName(model) &&
    !isAudioModelName(model)
  );
}

export function modelMatchesCapability(
  model: string,
  capability?: ModelCapability,
): boolean {
  if (!capability) return true;
  if (capability === 'image') return isImageModelName(model);
  if (capability === 'video') return isVideoModelName(model);
  if (capability === 'audio') return isAudioModelName(model);
  return isTextModelName(model);
}

export function filterModelsByCapability(
  models: string[],
  capability?: ModelCapability,
): string[] {
  return capability
    ? models.filter((model) => modelMatchesCapability(model, capability))
    : models;
}

// ===== 后端模型元数据查询(优先使用后端 capabilities/specs) =====

/**
 * 在渠道列表中查找指定模型值(编码 "channelId::model")对应的 ModelConfig 元数据
 * @returns ModelConfig 或 undefined(未找到)
 */
export function findModelConfig(
  channels: ModelChannel[],
  modelValue: string,
): ModelConfig | undefined {
  const decoded = decodeChannelModel(modelValue);
  if (!decoded) return undefined;
  const channel = channels.find((ch) => ch.id === decoded.channelId);
  if (!channel?.modelConfigs) return undefined;
  return channel.modelConfigs.find((m) => m.name === decoded.model);
}

/**
 * 判断模型值是否具备指定能力(优先用后端 capabilities,回退启发式)
 * Bug6: 图片节点不出现视频模型,视频节点不出现图片模型
 */
export function modelHasCapability(
  channels: ModelChannel[],
  modelValue: string,
  capability: ModelCapability,
): boolean {
  const cfg = findModelConfig(channels, modelValue);
  if (cfg && Array.isArray(cfg.capabilities) && cfg.capabilities.length > 0) {
    // 归一化：后端分类使用 'llm'，前端统一按 'text' 判定
    return cfg.capabilities.some(
      (c) => c === capability || (capability === 'text' && c === 'llm'),
    );
  }
  // 回退启发式判断
  return modelMatchesCapability(modelValue, capability);
}

/**
 * 获取视频模型支持的生成模式(优先后端 supportedModes,回退默认 5 模式)
 * Bug6: 视频节点根据所选模型的 supportedModes 动态显示模式选择器
 */
export function getVideoSupportedModes(
  channels: ModelChannel[],
  modelValue: string,
): string[] {
  const cfg = findModelConfig(channels, modelValue);
  if (cfg?.supportedModes && cfg.supportedModes.length > 0) {
    return cfg.supportedModes;
  }
  // 回退:返回全部 5 种模式
  return ['text-to-video', 'image-to-video', 'first-last-frame', 'all-reference', 'image-reference'];
}

/**
 * 获取模型的规格配置(优先后端 specs,回退 undefined)
 * Bug6: 规格后台动态配置
 */
export function getModelSpecs(
  channels: ModelChannel[],
  modelValue: string,
): Record<string, unknown> | undefined {
  const cfg = findModelConfig(channels, modelValue);
  return cfg?.specs;
}

/**
 * 获取模型的输入类型列表（如 ['text', 'image']）
 * 优先后端 inputTypes，回退根据 capabilities 推导
 */
export function getModelInputTypes(
  channels: ModelChannel[],
  modelValue: string,
): string[] {
  const cfg = findModelConfig(channels, modelValue);
  if (cfg?.inputTypes && cfg.inputTypes.length > 0) {
    return cfg.inputTypes;
  }
  // 回退：根据 capabilities 推导输入类型
  if (cfg?.capabilities && cfg.capabilities.length > 0) {
    const types: string[] = [];
    // 如果有 llm 或 text 能力，支持 text 输入
    if (cfg.capabilities.some((c) => c === 'llm' || c === 'text')) {
      types.push('text');
    }
    // 如果有 image 能力，支持 image 输入
    if (cfg.capabilities.includes('image')) {
      types.push('image');
    }
    // 如果有 audio 能力，支持 audio 输入
    if (cfg.capabilities.includes('audio')) {
      types.push('audio');
    }
    // 如果有 video 能力，支持 video 输入
    if (cfg.capabilities.includes('video')) {
      types.push('video');
    }
    return types.length > 0 ? types : ['text']; // 默认至少 text
  }
  // 无后端元数据，默认 text
  return ['text'];
}

/**
 * 按能力过滤渠道模型,返回编码后的模型值列表
 * Bug6: 图片节点只显示 image capability 模型,视频节点只显示 video capability
 *
 * 与 modelHasCapability 使用相同的归一化逻辑（'llm' → 'text'）
 */
export function filterChannelModelsByCapability(
  channels: ModelChannel[],
  capability: ModelCapability,
): string[] {
  const result: string[] = [];
  for (const channel of channels) {
    if (channel.modelConfigs && channel.modelConfigs.length > 0) {
      for (const mc of channel.modelConfigs) {
        // 使用与 modelHasCapability 一致的归一化逻辑
        const matched = mc.capabilities.some(
          (c) => c === capability || (capability === 'text' && c === 'llm'),
        );
        if (matched) {
          result.push(encodeChannelModel(channel.id, mc.name));
        }
      }
    } else {
      // 回退启发式
      for (const modelName of channel.models) {
        const encoded = encodeChannelModel(channel.id, modelName);
        if (modelMatchesCapability(encoded, capability)) {
          result.push(encoded);
        }
      }
    }
  }
  return Array.from(new Set(result));
}