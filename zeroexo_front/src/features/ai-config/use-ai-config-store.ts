/**
 * AiConfig 多渠道模型 Store(Phase VI.3 + Bug6 后端化)
 *
 * 范围: 仅多渠道机制(channels + 编解码 + resolveModelRequestConfig + buildApiUrl)
 * 其他配置字段(audioVoice/videoSeconds 等)留给 Phase VII.9 节点配置 Popover
 *
 * 多渠道机制:
 * - 渠道由后端 admin 管理页面统一配置,前端通过 GET /api/ai/channels 拉取
 * - 每个渠道独立 {id, name, baseUrl, apiKey, apiFormat, models[], modelConfigs?[]}
 * - 模型编码 `"channelId::modelName"`,`decodeChannelModel` 解码
 * - `resolveModelRequestConfig` 解码为真实 {baseUrl, apiKey, apiFormat, model}
 * - `buildApiUrl` 自动加 /v1,识别 /api/plan/v3(火山引擎 Ark Plan)
 *
 * Bug6: channels 不再 persist 到 localStorage(含 apiKey),仅 persist 默认模型选择
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { apiGet } from '@/services/api-client.js';
import i18n from '@/i18n/config';

// ===== 常量 =====

export const AI_CONFIG_STORE_KEY = 'zeroexo:ai_config_store';
const CHANNEL_MODEL_SEPARATOR = '::';
const OPENAI_BASE_URL = 'https://api.openai.com';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

// ===== 类型 =====

export type ApiCallFormat = 'openai' | 'gemini';

/**
 * 模型能力/模式/规格元数据(与后端 provider-presets.ts 的 ModelConfig 一致)
 * - capabilities: 能力类型 'image' | 'video' | 'audio' | 'text'
 * - supportedModes: 视频模型支持的生成模式
 * - specs: 规格配置(分辨率/比例/时长/音色等,结构因模型而异)
 */
export interface ModelConfig {
  name: string;
  capabilities: string[];
  supportedModes?: string[];
  specs?: Record<string, unknown>;
}

export type ModelChannel = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiFormat: ApiCallFormat;
  /** 品牌标识（如 "openai"、"deepseek"、"volcengine"），用于查找默认品牌图标 */
  provider: string;
  /** 模型名列表(从 modelConfigs 提取或独立声明) */
  models: string[];
  /** 模型能力/模式/规格元数据(来自后端 config.models,可选) */
  modelConfigs?: ModelConfig[];
  /** 模型图标映射（modelId → provider key），由 admin 配置，与 BRAND_ICONS 配合使用 */
  modelIcons?: Record<string, string>;
};

export type ModelCapability = 'image' | 'video' | 'text' | 'audio';

/** 多渠道配置状态(最小集,仅多渠道机制) */
export type AiConfig = {
  channels: ModelChannel[];
  /** 默认模型(编码后的 "channelId::model" 格式) */
  imageModel: string;
  videoModel: string;
  textModel: string;
  audioModel: string;
};

type AiConfigStore = {
  config: AiConfig;
  isConfigOpen: boolean;
  shouldPromptContinue: boolean;
  /** Bug6: channels 是否已从后端加载完成 */
  loaded: boolean;
  /** Bug6: channels 加载错误(供 UI 提示) */
  loadError: string | null;
  /** channels 是否正在加载中(防重入) */
  isLoading: boolean;
  /** 全局选中的渠道 ID（用于 AI Think 等全局操作） */
  selectedChannelId: string;
  /** 全局选中的模型名（用于 AI Think 等全局操作） */
  selectedModel: string;
  updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
  openConfigDialog: (shouldPromptContinue?: boolean) => void;
  setConfigDialogOpen: (isOpen: boolean) => void;
  clearPromptContinue: () => void;
  /** Bug6: 从后端 GET /api/ai/channels 加载 channels(替代 localStorage) */
  loadChannels: (capability?: string) => Promise<void>;
  /** Bug6: 重置 channels(登出时调用) */
  resetChannels: () => void;
  /** BUG8.6: 添加渠道(保留供测试/迁移,生产环境由后端管理) */
  addChannel: (channel: ModelChannel) => void;
  /** BUG8.6: 更新渠道(按 id 匹配) */
  updateChannel: (id: string, patch: Partial<ModelChannel>) => void;
  /** BUG8.6: 删除渠道(按 id) */
  removeChannel: (id: string) => void;
  /** 设置全局选中的渠道和模型 */
  setSelectedChannel: (channelId: string, model?: string) => void;
};

// ===== 默认值 =====

export const defaultAiConfig: AiConfig = {
  channels: [
    {
      id: 'default',
      name: '默认渠道',
      provider: '',
      baseUrl: OPENAI_BASE_URL,
      apiKey: '',
      apiFormat: 'openai',
      models: [],
      modelIcons: {},
    },
  ],
  imageModel: '',
  videoModel: '',
  textModel: '',
  audioModel: '',
};

// ===== 渠道 / 模型编解码 =====

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
  const apiFormat = normalizeApiFormat(channel?.apiFormat);
  const modelConfigs = Array.isArray(channel?.modelConfigs) ? channel!.modelConfigs : undefined;
  // 优先从 modelConfigs 提取模型名,兼容旧 models 字段
  const models = modelConfigs && modelConfigs.length > 0
    ? uniqueRawModels(modelConfigs.map((m) => m.name))
    : uniqueRawModels(channel?.models || []);
  return {
    id: channel?.id?.trim() || nanoid(),
    name: channel?.name?.trim() || '新渠道',
    provider: channel?.provider?.trim() || '',
    baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
    apiKey: channel?.apiKey || '',
    apiFormat,
    models,
    modelIcons: channel?.modelIcons || {},
    ...(modelConfigs ? { modelConfigs } : {}),
  };
}

/** 编码 `"channelId::model"` */
export function encodeChannelModel(channelId: string, model: string): string {
  return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

/** 是否为渠道编码格式(含 `::`) */
export function isChannelModelValue(value: string): boolean {
  return value.includes(CHANNEL_MODEL_SEPARATOR);
}

/** 解码 `"channelId::model"` → `{channelId, model}`,非编码格式返回 null */
export function decodeChannelModel(value: string): { channelId: string; model: string } | null {
  const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
  if (index < 0) return null;
  return {
    channelId: value.slice(0, index),
    model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length),
  };
}

/** 取模型名(剥离渠道前缀) */
export function modelOptionName(value: string): string {
  return decodeChannelModel(value)?.model || value;
}

/** 显示标签 `"model (channelName)"` */
export function modelOptionLabel(config: AiConfig, value: string): string {
  const decoded = decodeChannelModel(value);
  if (!decoded) return value;
  const channel = config.channels.find((item) => item.id === decoded.channelId);
  return channel ? `${decoded.model}(${channel.name})` : decoded.model;
}

/** 从渠道列表生成所有模型选项(编码后) */
export function modelOptionsFromChannels(channels: ModelChannel[]): string[] {
  return uniqueModelOptions(
    channels.flatMap((channel) =>
      channel.models.map((model) => encodeChannelModel(channel.id, model)),
    ),
  );
}

/**
 * 规范化模型选项值
 * - 已编码且渠道存在 → 原样返回
 * - 未编码但某渠道含此模型 → 编码为该渠道的模型
 * - 未编码且无渠道含此模型 → 原样返回(允许自定义模型名)
 */
export function normalizeModelOptionValue(
  value: string | undefined,
  channels: ModelChannel[],
): string {
  const model = (value || '').trim();
  if (!model) return '';
  const decoded = decodeChannelModel(model);
  if (decoded) {
    const channel = channels.find((item) => item.id === decoded.channelId);
    return channel && channel.models.includes(decoded.model) ? model : '';
  }
  const channel =
    channels.find((item) => item.models.includes(model)) || channels[0];
  return channel && channel.models.includes(model)
    ? encodeChannelModel(channel.id, model)
    : model;
}

/** 解析模型值所属渠道(找不到则回退到第一个渠道或构造默认渠道) */
export function resolveModelChannel(config: AiConfig, value: string): ModelChannel {
  const decoded = decodeChannelModel(value);
  const model = decoded?.model || value;
  const matched = decoded
    ? config.channels.find((channel) => channel.id === decoded.channelId)
    : config.channels.find((channel) => channel.models.includes(model));
  return (
    matched ||
    config.channels[0] ||
    createModelChannel({
      id: 'default',
      name: '默认渠道',
      baseUrl: OPENAI_BASE_URL,
      apiKey: '',
      apiFormat: 'openai',
      models: [],
    })
  );
}

/**
 * 解析模型值 → 真实请求配置
 * @returns 合并后的配置(含真实 baseUrl/apiKey/apiFormat/model)
 */
export function resolveModelRequestConfig(
  config: AiConfig,
  value: string,
): {
  baseUrl: string;
  apiKey: string;
  apiFormat: ApiCallFormat;
  model: string;
} {
  const channel = resolveModelChannel(config, value);
  return {
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    apiFormat: channel.apiFormat,
    model: modelOptionName(value || ''),
  };
}

/** 配置是否就绪(模型非空 + 渠道 baseUrl/apiKey 非空) */
export function isAiConfigReady(config: AiConfig, model: string): boolean {
  const channel = resolveModelChannel(config, model);
  return Boolean(model.trim() && channel.baseUrl.trim());
}

/**
 * BUG8.3: 判断模型值是否走 Seedance 视频流程
 *
 * 与 ai-provider/video-api.ts 的 isSeedanceVideoConfig 逻辑一致:
 * 模型名含 seedance/doubao-seedance,或渠道 baseUrl 含 /api/plan/v3(火山方舟 Agent Plan)。
 * 供 VideoSettingsPopover 在 app 层判断显示 Seedance 还是 OpenAI 分支。
 */
export function isSeedanceModelValue(config: AiConfig, modelValue: string): boolean {
  const resolved = resolveModelRequestConfig(config, modelValue);
  const modelName = resolved.model.toLowerCase();
  return modelName.includes('seedance') || modelName.includes('doubao-seedance') ||
    resolved.baseUrl.toLowerCase().includes('/api/plan/v3');
}

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

// ===== Bug6: 后端模型元数据查询(优先使用后端 capabilities/specs)=====

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
 * 按能力过滤渠道模型,返回编码后的模型值列表
 * Bug6: 图片节点只显示 image capability 模型,视频节点只显示 video capability
 */
export function filterChannelModelsByCapability(
  channels: ModelChannel[],
  capability: ModelCapability,
): string[] {
  const result: string[] = [];
  for (const channel of channels) {
    // 优先用 modelConfigs 的 capabilities 精确匹配
    if (channel.modelConfigs && channel.modelConfigs.length > 0) {
      for (const mc of channel.modelConfigs) {
        if (mc.capabilities.includes(capability)) {
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

// ===== URL 构建 =====

/**
 * 构建 API URL(自动加 /v1,识别 /api/plan/v3)
 * @param baseUrl 渠道 baseUrl
 * @param path API 路径(如 '/images/generations')
 * @returns 完整 URL
 *
 * 规则:
 * - baseUrl 已以 /v1, /api/v3, /api/plan/v3 结尾 → 不再加 /v1
 * - 火山引擎 Ark Plan(/api/plan/v3)→ 截断到 /api/plan/v3
 * - 其他 → 末尾加 /v1
 */
export function buildApiUrl(baseUrl: string, path: string): string {
  let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
  const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
  const apiBaseUrl =
    lowerBaseUrl.endsWith('/v1') ||
    lowerBaseUrl.endsWith('/api/v3') ||
    lowerBaseUrl.endsWith('/api/plan/v3')
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1`;
  return `${apiBaseUrl}${path}`;
}

/** 火山引擎 Ark Plan baseUrl 规范化(截断到 /api/plan/v3) */
function normalizeArkPlanBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, '');
    const lowerPath = path.toLowerCase();
    const arkPlanIndex = lowerPath.indexOf('/api/plan/v3');
    if (arkPlanIndex < 0) return baseUrl;
    const end = arkPlanIndex + '/api/plan/v3'.length;
    if (lowerPath.length !== end && lowerPath[end] !== '/') return baseUrl;
    url.pathname = path.slice(0, end);
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return baseUrl;
  }
}

// ===== 内部辅助 =====

function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat): string {
  return apiFormat === 'gemini' ? GEMINI_BASE_URL : OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
  return apiFormat === 'gemini' ? 'gemini' : 'openai';
}

function uniqueRawModels(models: string[]): string[] {
  return Array.from(
    new Set(
      (models || [])
        .map((model) => modelOptionName(model).trim())
        .filter(Boolean),
    ),
  );
}

function uniqueModelOptions(models: string[]): string[] {
  return Array.from(
    new Set((models || []).map((model) => model.trim()).filter(Boolean)),
  );
}

// ===== Store =====

/** 后端 /api/ai/channels 返回项(Stage E - 取代旧的 /api/ai-providers/resolved) */
interface ResolvedProviderItem {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  enabled: boolean;
  isDefault: boolean;
  apiFormat: string;
  modelIcons: Record<string, string>;
  models: ModelConfig[];
}

export const useAiConfigStore = create<AiConfigStore>()(
  persist(
    (set, get) => ({
      config: defaultAiConfig,
      isConfigOpen: false,
      shouldPromptContinue: false,
      loaded: false,
      loadError: null,
      isLoading: false,
      selectedChannelId: '',
      selectedModel: '',
      updateConfig: (key, value) =>
        set((state) => ({
          config: { ...state.config, [key]: value },
        })),
      openConfigDialog: (shouldPromptContinue = false) =>
        set({ isConfigOpen: true, shouldPromptContinue }),
      setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
      clearPromptContinue: () => set({ shouldPromptContinue: false }),
      /** Bug6: 从后端加载 channels(登录后由 auth-store 调用) */
      loadChannels: async (capability?: string) => {
        const state = get();
        if (state.isLoading) return;
        set({ isLoading: true });
        try {
          const query = capability ? `?capability=${encodeURIComponent(capability)}` : '';
          const res = await apiGet<{ items: ResolvedProviderItem[] }>(`/ai/channels${query}`);
          const items = Array.isArray(res?.items) ? res.items : [];
          const channels: ModelChannel[] = items.map((item) =>
            createModelChannel({
              id: item.id,
              name: item.name,
              provider: item.provider,
              baseUrl: item.baseUrl,
              apiFormat: normalizeApiFormat(item.apiFormat),
              modelConfigs: Array.isArray(item.models) ? item.models : [],
              models: Array.isArray(item.models) ? item.models.map((m) => m.name) : [],
              modelIcons: item.modelIcons || {},
            }),
          );
          set((state) => {
            const config = { ...state.config, channels };
            // 自动选择第一个渠道(若当前未选中或选中渠道失效)
            const currentSelectedId = state.selectedChannelId;
            const channelExists = channels.some((ch) => ch.id === currentSelectedId);
            let selectedChannelId = channelExists ? currentSelectedId : (channels[0]?.id ?? '');
            let selectedModel = state.selectedModel;
            // 如果渠道变了但没有指定模型，取该渠道的第一个模型
            if (selectedChannelId && !channelExists) {
              const ch = channels.find((c) => c.id === selectedChannelId);
              selectedModel = ch?.models[0] ?? '';
            } else if (selectedChannelId && !selectedModel) {
              const ch = channels.find((c) => c.id === selectedChannelId);
              selectedModel = ch?.models[0] ?? '';
            }
            return {
              config: {
                ...config,
                // 规范化默认模型值(若已失效则清空)
                imageModel: normalizeModelOptionValue(config.imageModel, channels),
                videoModel: normalizeModelOptionValue(config.videoModel, channels),
                textModel: normalizeModelOptionValue(config.textModel, channels),
                audioModel: normalizeModelOptionValue(config.audioModel, channels),
              },
              loaded: true,
              loadError: null,
              isLoading: false,
              selectedChannelId,
              selectedModel,
            };
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const userMessage = message.includes('fetch') || message.includes('Network') || message.includes('Failed to fetch')
            ? i18n.t('aiConfig.loadChannelsNetworkError')
            : i18n.t('aiConfig.loadChannelsError', { message });
          set({ loaded: true, loadError: userMessage, isLoading: false });
        }
      },
      /** Bug6: 重置 channels(登出时调用) */
      resetChannels: () => {
        set({
          config: { ...defaultAiConfig },
          loaded: false,
          loadError: null,
          isLoading: false,
          selectedChannelId: '',
          selectedModel: '',
        });
      },
      addChannel: (channel) =>
        set((state) => ({
          config: { ...state.config, channels: [...state.config.channels, channel] },
        })),
      updateChannel: (id, patch) =>
        set((state) => ({
          config: {
            ...state.config,
            channels: state.config.channels.map((ch) =>
              ch.id === id ? { ...ch, ...patch } : ch,
            ),
          },
        })),
      removeChannel: (id) =>
        set((state) => ({
          config: {
            ...state.config,
            channels: state.config.channels.filter((ch) => ch.id !== id),
          },
        })),
      /** 设置全局选中的渠道和模型 */
      setSelectedChannel: (channelId: string, model?: string) => {
        const state = get();
        const channel = state.config.channels.find((ch) => ch.id === channelId);
        const selectedModel = model ?? channel?.models[0] ?? '';
        set({ selectedChannelId: channelId, selectedModel });
      },
    }),
    {
      name: AI_CONFIG_STORE_KEY,
      // Bug6: 仅 persist 默认模型选择,不 persist channels(含 apiKey,需从后端加载)
      partialize: (state) => ({
        config: {
          imageModel: state.config.imageModel,
          videoModel: state.config.videoModel,
          textModel: state.config.textModel,
          audioModel: state.config.audioModel,
        } as AiConfig,
        selectedChannelId: state.selectedChannelId,
        selectedModel: state.selectedModel,
      }),
      merge: (persisted, current) => {
        const persistedState = (persisted || {}) as Partial<AiConfigStore>;
        const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
        // channels 初始为空,等 loadChannels() 从后端拉取
        const channels: ModelChannel[] = [];
        return {
          ...current,
          config: {
            ...defaultAiConfig,
            ...persistedConfig,
            channels,
            imageModel: persistedConfig.imageModel ?? '',
            videoModel: persistedConfig.videoModel ?? '',
            textModel: persistedConfig.textModel ?? '',
            audioModel: persistedConfig.audioModel ?? '',
          },
          selectedChannelId: persistedState.selectedChannelId ?? '',
          selectedModel: persistedState.selectedModel ?? '',
        };
      },
    },
  ),
);

/** 获取生效配置(channelMode 固定 local,前端直连) */
export function useEffectiveConfig(): AiConfig {
  return useAiConfigStore((state) => state.config);
}
