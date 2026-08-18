/**
 * AI 品牌详情相关类型定义
 *
 * 仅包含 AiBrandDetail 及其子组件共享的类型。
 * 注意：ParameterDef / PersistedParamConfig 已在 @/components/ai-test/param-types 中定义，
 * 此处不重复声明，使用方按需从该路径导入。
 */

/** 模型条目（打平后的模型列表元素） */
export interface ModelEntry {
  id: string;
  name: string;
  icon?: string;
  type?: string;
  enabled?: boolean;
}

/** AiBrandDetail 主组件 Props */
export interface AiBrandDetailProps {
  brandPreset: {
    provider: string;
    label: string;
    official: boolean;
    apiFormat: string;
    defaultBaseUrl: string;
    color: string;
    description: string;
    capabilities: string[];
  };
  existingRecord?: {
    id: string;
    name: string;
    provider: string;
    config?: Record<string, any>;
    credentials?: Record<string, any>;
    credentialsMask?: string;
    hasCredentials?: boolean; // 后端 maskProvider 返回
    health?: string;
    enabled: boolean;
    isDefault: boolean;
    capabilities?: string[];
  };
  logoUrl?: string;
  onBack: () => void;
  onSave: () => void;
  /** 删除渠道（仅非预设品牌传递） */
  onDelete?: (item: { id: string; label: string }) => void;
}
