/**
 * AI 品牌详情相关常量
 *
 * 包含约束字段、模型类型标签/图标、消费 metric 标签以及已知模型的能力描述映射。
 * 图标组件统一来自 @ant-design/icons（与 API 渠道 Tab 同款），需要在运行时保留为组件引用，因此本文件不导出纯 JSON。
 */
import {
  MessageOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';

/** 约束字段集合 — 这些字段应由 channelConstraints 管理，不作为可编辑参数 */
export const CONSTRAINT_FIELDS = new Set([
  'maxEdgeLength',
  'minTotalPixels',
  'maxTotalPixels',
]);

/** 模型类型 → 友好中文标签 */
export const MODEL_TYPE_LABELS: Record<string, string> = {
  llm: '语言',
  image: '图像',
  video: '视频',
  audio: '音频',
  unclassified: '未分类',
};

/** 模型类型 → 图标组件（与 API 渠道 Tab 同款 @ant-design/icons） */
export const MODEL_TYPE_ICONS: Record<string, any> = {
  llm: MessageOutlined,
  image: PictureOutlined,
  video: VideoCameraOutlined,
  audio: AudioOutlined,
  unclassified: QuestionCircleOutlined,
};

/**
 * 已知模型的额外能力描述标签
 *
 * key: 模型 ID；value: { tags, details }
 * tags 用于在模型列表中展示能力徽标；details 为补充说明文字。
 */
export const MODEL_CAPABILITY_DESCRIPTIONS: Record<
  string,
  { tags: string[]; details?: string }
> = {
  // ─── Seedance 2.0 ───
  'doubao-seedance-2-0-260128': {
    tags: ['有声视频', '无声视频', '多模态参考生视频', '首尾帧', '首帧', '文生视频'],
    details:
      '多模态参考生视频: 输入参考图片(0-9)+参考视频(0-3)+参考音频(0-3)+文本提示词(可选)生成目标视频。支持全新生成、编辑视频、延长视频。',
  },
  'doubao-seedance-2-0-fast-260128': {
    tags: ['有声视频', '无声视频', '首尾帧', '首帧', '文生视频'],
    details: 'Seedance 2.0 Fast, 快速生成视频。',
  },
  // ─── Seedance 1.5 Pro ───
  'doubao-seedance-1-5-pro-251215': {
    tags: ['有声视频', '无声视频', '首尾帧', '首帧', '文生视频'],
  },
  // ─── Seedance 1.0 Pro ───
  'doubao-seedance-1-0-pro-250528': {
    tags: ['首尾帧', '首帧', '文生视频'],
  },
  'doubao-seedance-1-0-pro-fast-251015': {
    tags: ['首帧', '文生视频'],
  },
  // ─── Seedance 1.0 Lite ───
  'doubao-seedance-1-0-lite-i2v-250428': {
    tags: ['首尾帧'],
  },
  // ─── Seedream ───
  'doubao-seedream-3-0-t2i-250415': {
    tags: ['文生图'],
  },
  'doubao-seedream-4-0-250828': {
    tags: ['文生图'],
  },
  'doubao-seedream-4-5-251128': {
    tags: ['文生图', '图生图'],
  },
  'doubao-seedream-5-0-260128': {
    tags: ['文生图', '图生图'],
  },
  'doubao-seedream-5-0-lite-260128': {
    tags: ['文生图', '图生图'],
  },
  // ─── GPT Image ───
  'gptimage2': {
    tags: ['文生图', '图生图'],
  },
};
