/**
 * 品牌图标系统 - 基于 @lobehub/icons
 *
 * 镜像 zeroexo_admin 的 BRAND_ICONS 映射，确保前端展示的渠道/模型图标
 * 与 admin 配置的图标完全一致。
 *
 * 每个品牌图标组件接受 { size?: number, color?: string } props。
 * BRAND_COLORS 提供各品牌的官方主色，供卡片背景等使用。
 *
 * 渲染查找链:
 *   modelIcons[modelId] → BRAND_ICONS[该值] → BRAND_ICONS[provider] → DefaultBrandIcon
 */
import type { FC } from 'react';
import {
  OpenAI,
  Claude,
  Gemini,
  DeepSeek,
  Stability,
  Volcengine,
  Bailian,
  SiliconCloud,
  Qwen,
  Doubao,
  Zhipu,
  Grok,
  Minimax,
  Moonshot,
  Kimi,
  Hunyuan,
} from '@lobehub/icons';

export interface BrandIconProps {
  size?: number;
  color?: string;
}

/** 默认兜底图标 */
export const DefaultBrandIcon: FC<BrandIconProps> = ({ size = 40, color = '#8c8c8c' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      x="2"
      y="2"
      width="20"
      height="20"
      rx="4"
      fill={color}
      opacity="0.15"
    />
    <path
      d="M12 7L17 12L12 17L7 12L12 7Z"
      fill={color}
    />
  </svg>
);

/** 品牌 → lobe-icons 组件映射 */
export const BRAND_ICONS: Record<string, FC<BrandIconProps>> = {
  openai: OpenAI as unknown as FC<BrandIconProps>,
  anthropic: Claude as unknown as FC<BrandIconProps>,
  gemini: Gemini as unknown as FC<BrandIconProps>,
  deepseek: DeepSeek as unknown as FC<BrandIconProps>,
  stability: Stability as unknown as FC<BrandIconProps>,
  volcengine: Volcengine as unknown as FC<BrandIconProps>,
  bailian: Bailian as unknown as FC<BrandIconProps>,
  siliconflow: SiliconCloud as unknown as FC<BrandIconProps>,
  qwen: Qwen as unknown as FC<BrandIconProps>,
  doubao: Doubao as unknown as FC<BrandIconProps>,
  zhipu: Zhipu as unknown as FC<BrandIconProps>,
  grok: Grok as unknown as FC<BrandIconProps>,
  minimax: Minimax as unknown as FC<BrandIconProps>,
  moonshot: Moonshot as unknown as FC<BrandIconProps>,
  kimi: Kimi as unknown as FC<BrandIconProps>,
  hunyuan: Hunyuan as unknown as FC<BrandIconProps>,
  default: DefaultBrandIcon,
};

/** 品牌主色映射（用于卡片背景、边框等） */
export const BRAND_COLORS: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#d97757',
  gemini: '#4285f4',
  deepseek: '#4d6bfe',
  stability: '#9b51e0',
  volcengine: '#0071e3',
  bailian: '#ff6a00',
  siliconflow: '#1890ff',
  qwen: '#615ced',
  doubao: '#325ab4',
  zhipu: '#3859ff',
  grok: '#1d9bf0',
  minimax: '#ff3d00',
  moonshot: '#000000',
  kimi: '#1c1c1c',
  hunyuan: '#0053e0',
};

/**
 * 根据图标 key 获取对应的品牌图标组件
 *
 * 若未提供 key 或 key 不在 BRAND_ICONS 中，则返回默认品牌图标。
 *
 * @param iconKey 图标 key（与 BRAND_ICONS 的 key 对应，通常是品牌 provider 名）
 */
export function getModelIconComponent(iconKey: string | undefined): FC<BrandIconProps> {
  if (!iconKey) return DefaultBrandIcon;
  return BRAND_ICONS[iconKey] || DefaultBrandIcon;
}