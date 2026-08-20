/**
 * AI 渠道 Tab 相关类型与常量
 *
 * 仅包含 ApiProvidersTab 及其子组件共享的类型定义与常量。
 *
 * 注意：
 * - `MODEL_TYPE_LABELS` 在本文件中使用 i18n 翻译键（如 'ai.type.llm'），
 *   通过 `t()` 函数调用以获得本地化文本；这与 ai-brand-constants.ts 中的
 *   `MODEL_TYPE_LABELS`（直接中文字符串）语义不同，因此在此独立维护，
 *   不复用 ai-brand-constants.ts 中的定义。
 */

/** sessionStorage key，用于在刷新后恢复详情视图状态 */
export const STORAGE_KEY = 'ai_detail_view_state';

/**
 * 模型类型 → i18n 翻译键
 *
 * 使用方式：`t(MODEL_TYPE_LABELS[cap])`，例如 `t('ai.type.llm')` → '语言模型'。
 */
export const MODEL_TYPE_LABELS: Record<string, string> = {
  llm: 'ai.type.llm',
  image: 'ai.type.image',
  video: 'ai.type.video',
  audio: 'ai.type.audio',
};

/** 品牌预设（来自后端 /admin/api-providers/presets） */
export interface BrandPreset {
  provider: string;
  label: string;
  type: string;
  official: boolean;
  apiFormat: string;
  defaultBaseUrl: string;
  color: string;
  description: string;
  capabilities: string[];
}

/** 渠道记录（来自后端 /admin/api-providers?type=ai） */
export interface ProviderRecord {
  id: string;
  name: string;
  provider: string;
  config?: Record<string, any>;
  credentials?: Record<string, any>;
  credentialsMask?: string;
  health?: string;
  enabled: boolean;
  isDefault: boolean;
  capabilities?: string[];
  /** 账户余额（Plan#17；null = 未查询或不支持） */
  balance?: number | null;
  /** 余额币种（CNY / USD / credits 等） */
  balanceCurrency?: string | null;
  /** 上次余额查询时间 */
  balanceCheckedAt?: string | null;
  /** 余额查询错误（UNSUPPORTED 哨兵 = 无官方余额接口） */
  balanceError?: string | null;
}

/** 刷新余额端点响应（POST /admin/api-providers/:id/balance） */
export interface BalanceRefreshResponse {
  supported: boolean;
  ok?: boolean;
  balance?: number;
  currency?: string;
  message?: string;
  balanceCheckedAt: string;
}

/** 余额展示级别（三态 + 警示分级） */
export type BalanceLevel = 'ok' | 'warning' | 'danger' | 'error' | 'unsupported' | 'unknown';

/** 余额展示态（数值文本由组件侧套 i18n 标签） */
export interface BalanceDisplay {
  level: BalanceLevel;
  /** 成功查询到的余额文本（仅 ok/warning/danger 有值） */
  text?: string;
  /** 悬浮提示详情（查询时间 / 错误原因） */
  detail?: string;
}

/** 低余额预警阈值 */
export const BALANCE_LOW_THRESHOLD = 10;

/** 币种符号映射（未命中的币种直接展示代码） */
const CURRENCY_SYMBOLS: Record<string, string> = { CNY: '¥', USD: '$' };

/** 格式化余额数值（币种符号 + 两位小数） */
export function formatBalance(balance: number, currency?: string | null): string {
  const symbol = CURRENCY_SYMBOLS[currency ?? ''] ?? (currency ? `${currency} ` : '');
  return `${symbol}${balance.toFixed(2)}`;
}

/**
 * 解析渠道余额展示态（Plan#17 三态）
 * - unknown:     未查询（balanceCheckedAt 为空）
 * - unsupported: 渠道无官方余额 API（balanceError = UNSUPPORTED）
 * - error:       查询失败（其他 balanceError）
 * - ok/warning/danger: 查询成功，按余额分级（≤0 欠费红 / ≤10 低额橙）
 */
export function resolveBalanceDisplay(record: {
  balance?: number | null;
  balanceCurrency?: string | null;
  balanceCheckedAt?: string | null;
  balanceError?: string | null;
}): BalanceDisplay {
  if (!record.balanceCheckedAt) {
    return { level: 'unknown' };
  }
  if (record.balanceError === 'UNSUPPORTED') {
    return { level: 'unsupported' };
  }
  if (record.balanceError) {
    return { level: 'error', detail: record.balanceError };
  }
  if (record.balance == null) {
    return { level: 'unknown' };
  }
  const level: BalanceLevel =
    record.balance <= 0 ? 'danger' : record.balance <= BALANCE_LOW_THRESHOLD ? 'warning' : 'ok';
  return {
    level,
    text: formatBalance(record.balance, record.balanceCurrency),
  };
}
