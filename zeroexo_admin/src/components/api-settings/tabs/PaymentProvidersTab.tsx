/**
 * 支付服务 Tab - 预设卡片网格 → 点击进入详情配置
 *
 * list: 显示预设 + 已配置卡片
 * detail: ProviderDetailForm 编辑
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPatch, showApiError } from '@/services/api-client';
import ProviderCardGrid from '../ProviderCardGrid';
import ProviderDetailForm from '../ProviderDetailForm';
import type { ProviderCardItem } from '../ProviderCardGrid';
import type { FieldDef } from '../ProviderDetailForm';
import { message } from 'antd';

const PRESETS: Array<{
  provider: string;
  labelKey: string;
  descKey: string;
  color: string;
  icon: string;
  defaultConfig?: Record<string, any>;
}> = [
  {
    provider: 'stripe',
    labelKey: 'payment.stripe',
    descKey: 'payment.stripeDesc',
    color: '#6772e5',
    icon: 'bi bi-credit-card-2-front',
    defaultConfig: { mode: 'test' },
  },
  {
    provider: 'alipay',
    labelKey: 'payment.alipay',
    descKey: 'payment.alipayDesc',
    color: '#1677ff',
    icon: 'bi bi-alipay',
  },
  {
    provider: 'wechat-pay',
    labelKey: 'payment.wechat',
    descKey: 'payment.wechatDesc',
    color: '#52c41a',
    icon: 'bi bi-wechat',
  },
];

/** Stripe 配置字段 */
const stripeConfigFields: FieldDef[] = [
  {
    key: 'mode',
    label: 'payment.mode',
    type: 'select' as const,
    placeholder: 'payment.modePlaceholder',
    required: true,
    options: [
      { value: 'test', label: 'payment.mode.test' },
      { value: 'live', label: 'payment.mode.live' },
    ],
  },
  { key: 'webhookSecret', label: 'payment.webhook', placeholder: 'whsec_...' },
  { key: 'successUrl', label: 'payment.successUrl', placeholder: 'https://example.com/payment/success' },
  { key: 'cancelUrl', label: 'payment.cancelUrl', placeholder: 'https://example.com/payment/cancel' },
];

const stripeCredentialsFields: FieldDef[] = [
  { key: 'apiKey', label: 'payment.apiKey', type: 'password' as const, placeholder: 'sk_test_... / sk_live_...', required: true },
];

/** 支付宝/微信支付预留字段 */
const placeholderConfigFields: FieldDef[] = [
  { key: 'merchantId', label: 'payment.merchantId', placeholder: 'payment.merchantIdPlaceholder' },
  { key: 'notifyUrl', label: 'payment.notifyUrl', placeholder: 'https://example.com/payment/callback' },
];

const placeholderCredentialsFields: FieldDef[] = [
  { key: 'appId', label: 'payment.appId', type: 'password' as const, placeholder: 'payment.appIdPlaceholder' },
  { key: 'privateKey', label: 'payment.privateKey', type: 'password' as const, placeholder: 'payment.privateKeyPlaceholder' },
];

interface ProviderRecord {
  id: string;
  name: string;
  provider: string;
  config?: Record<string, any>;
  credentials?: Record<string, any>;
  credentialsMask?: string;
  health?: string;
  enabled: boolean;
  isDefault: boolean;
}

export default function PaymentProvidersTab() {
  const { t } = useTranslation();
  const [subView, setSubView] = useState<'list' | 'detail'>('list');
  const [records, setRecords] = useState<ProviderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<(typeof PRESETS)[0] | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<ProviderRecord | undefined>(undefined);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ items?: ProviderRecord[] }>(
        '/admin/api-providers?type=payment',
      );
      setRecords(data.items || []);
    } catch (err) {
      showApiError(err, t('error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectCard = (item: ProviderCardItem) => {
    const preset = PRESETS.find((p) => p.provider === item.provider) || PRESETS[0];
    const record = records.find((r) => r.id === item.id);
    setSelectedPreset(preset);
    setSelectedRecord(record);
    setSubView('detail');
  };

  const handleSave = () => {
    setSubView('list');
    loadData();
  };

  const handleToggleEnabled = async (item: ProviderCardItem, enabled: boolean) => {
    if (!item.id) {
      message.warning(
        `"${item.label}" ${t('error.notConfigured')}`,
      );
      return;
    }
    setTogglingIds((prev) => new Set(prev).add(item.id!));
    try {
      await apiPatch(`/admin/api-providers/${item.id}`, { enabled });
      setRecords((prev) =>
        prev.map((r) => (r.id === item.id ? { ...r, enabled } : r)),
      );
    } catch (err) {
      showApiError(err, t('error.operation'));
    } finally {
      setTogglingIds(new Set());
    }
  };

  /** 设为默认渠道 */
  const handleSetDefault = async (item: ProviderCardItem) => {
    if (!item.id) return;
    try {
      await apiPatch(`/admin/api-providers/${item.id}`, { isDefault: true });
      setRecords((prev) =>
        prev.map((r) => ({ ...r, isDefault: r.id === item.id })),
      );
      message.success(t('api.defaultSet'));
    } catch (err) {
      showApiError(err, t('error.operation'));
    }
  };

  if (subView === 'detail' && selectedPreset) {
    const isStripe = selectedPreset.provider === 'stripe';
    const iconMap: Record<string, string> = {
      stripe: 'bi bi-credit-card-2-front',
      alipay: 'bi bi-alipay',
      'wechat-pay': 'bi bi-wechat',
    };
    return (
      <ProviderDetailForm
        title={`${t('api.config')} ${t(selectedPreset.labelKey)}`}
        preset={{
          label: t(selectedPreset.labelKey),
          provider: selectedPreset.provider,
          type: 'payment',
          icon: iconMap[selectedPreset.provider] || 'bi bi-credit-card',
          defaultConfig: selectedPreset.defaultConfig,
        }}
        configFields={isStripe ? stripeConfigFields : placeholderConfigFields}
        credentialsFields={isStripe ? stripeCredentialsFields : placeholderCredentialsFields}
        configSectionTitle={t('payment.configSection')}
        existingRecord={selectedRecord}
        onBack={() => {
          setSubView('list');
          setSelectedPreset(null);
          setSelectedRecord(undefined);
        }}
        onSave={handleSave}
      />
    );
  }

  // 构建卡片: 预设 + 已配置合并
  const cards: ProviderCardItem[] = PRESETS.map((preset) => {
    const match = records.find((r) => r.provider === preset.provider);
    const iconMap: Record<string, string> = {
      stripe: 'bi bi-credit-card-2-front',
      alipay: 'bi bi-alipay',
      'wechat-pay': 'bi bi-wechat',
    };
    return {
      id: match?.id,
      label: match ? match.name : t(preset.labelKey),
      provider: preset.provider,
      description: t(preset.descKey),
      icon: <i className={iconMap[preset.provider] || 'bi bi-credit-card'} style={{ fontSize: 20 }} />,
      color: preset.color,
      configured: !!match,
      enabled: match?.enabled ?? false,
      isDefault: match?.isDefault ?? false,
    };
  });

  return (
    <div>
      <ProviderCardGrid
        items={cards}
        loading={loading}
        onSelect={handleSelectCard}
        onToggleEnabled={handleToggleEnabled}
        onSetDefault={handleSetDefault}
        togglingIds={togglingIds}
        emptyText={t('payment.empty')}
      />
    </div>
  );
}
