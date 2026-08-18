/**
 * ai-config feature 导出(Phase VI.3 + Bug6 后端化)
 *
 * 多渠道 AI 配置:渠道管理 + 模型编解码 + 请求配置解析 + URL 构建
 * Bug6: channels 由后端 admin 管理页面统一配置,前端通过 /api/ai/channels 拉取
 */
export type {
  ApiCallFormat,
  ModelChannel,
  ModelCapability,
  ModelConfig,
  AiConfig,
} from './use-ai-config-store.js';

export {
  AI_CONFIG_STORE_KEY,
  defaultAiConfig,
  useAiConfigStore,
  useEffectiveConfig,
  // 渠道 / 模型编解码
  createModelChannel,
  encodeChannelModel,
  isChannelModelValue,
  decodeChannelModel,
  modelOptionName,
  modelOptionLabel,
  modelOptionsFromChannels,
  normalizeModelOptionValue,
  resolveModelChannel,
  resolveModelRequestConfig,
  isAiConfigReady,
  isSeedanceModelValue,
  // 模型能力分类
  isVideoModelName,
  isAudioModelName,
  isImageModelName,
  isTextModelName,
  modelMatchesCapability,
  filterModelsByCapability,
  // Bug6: 后端模型元数据查询
  findModelConfig,
  modelHasCapability,
  getVideoSupportedModes,
  getModelSpecs,
  filterChannelModelsByCapability,
  // URL 构建
  buildApiUrl,
} from './use-ai-config-store.js';

// 品牌图标系统（镜像 admin 图标映射）
export type { BrandIconProps } from './brand-icons';
export {
  BRAND_ICONS,
  BRAND_COLORS,
  DefaultBrandIcon,
  getModelIconComponent,
} from './brand-icons';
