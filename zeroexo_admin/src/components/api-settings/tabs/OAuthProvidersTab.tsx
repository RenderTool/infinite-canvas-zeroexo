/**
 * 第三方登录 Tab - OAuth 提供商管理
 *
 * list: 显示预设卡片网格
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

// OAuth 品牌图标 (bootstrap-icons class name 映射)
const BRAND_ICON_CLASSES: Record<string, string> = {
  qq: 'bi bi-tencent-qq',
  wechat: 'bi bi-wechat',
  'wechat-mp': 'bi bi-wechat',
  github: 'bi bi-github',
  google: 'bi bi-google',
  dingtalk: 'bi bi-chat-square-dots',
  feishu: 'bi bi-send',
};

const PRESETS: Array<{
  provider: string;
  labelKey: string;
  descKey: string;
  color: string;
}> = [
  { provider: 'qq', labelKey: 'oauth.qq', descKey: 'oauth.qqDesc', color: '#1890ff' },
  { provider: 'wechat', labelKey: 'oauth.wechat', descKey: 'oauth.wechatDesc', color: '#52c41a' },
  { provider: 'wechat-mp', labelKey: 'oauth.wechatMp', descKey: 'oauth.wechatMpDesc', color: '#52c41a' },
  { provider: 'github', labelKey: 'oauth.github', descKey: 'oauth.githubDesc', color: '#262626' },
  { provider: 'google', labelKey: 'oauth.google', descKey: 'oauth.googleDesc', color: '#fa8c16' },
  { provider: 'dingtalk', labelKey: 'oauth.dingtalk', descKey: 'oauth.dingtalkDesc', color: '#1890ff' },
  { provider: 'feishu', labelKey: 'oauth.feishu', descKey: 'oauth.feishuDesc', color: '#722ed1' },
];

const configFields: FieldDef[] = [
  {
    key: 'appId',
    label: 'oauth.clientId',
    placeholder: 'oauth.clientIdPlaceholder',
    required: true,
  },
  {
    key: 'appSecret',
    label: 'oauth.clientSecret',
    placeholder: 'oauth.clientSecretPlaceholder',
    type: 'password',
    required: true,
  },
  {
    key: 'redirectUri',
    label: 'oauth.redirectUrl',
    placeholder: 'https://example.com/oauth/callback',
    description: 'oauth.redirectUrlDesc',
    required: true,
  },
  {
    key: 'scope',
    label: 'oauth.scope',
    placeholder: 'oauth.scopePlaceholder',
  },
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

export default function OAuthProvidersTab() {
  const { t } = useTranslation();
  const [subView, setSubView] = useState<'list' | 'detail'>('list');
  const [records, setRecords] = useState<ProviderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<(typeof PRESETS)[0] | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<ProviderRecord | undefined>(undefined);
  // 卡片切换启用 loading
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ items?: ProviderRecord[] }>(
        '/admin/api-providers?type=oauth',
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

  /** 卡片开关: 简单切换禁用,无需互斥 */
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
    const iconClass = BRAND_ICON_CLASSES[selectedPreset.provider] || 'bi bi-shield';
    return (
      <ProviderDetailForm
        title={`${t('api.config')} ${t(selectedPreset.labelKey)}`}
        preset={{
          label: t(selectedPreset.labelKey),
          provider: selectedPreset.provider,
          type: 'oauth',
          icon: iconClass,
        }}
        configFields={configFields}
        credentialsFields={[]}
        configSectionTitle={t('oauth.configSection')}
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

  const cards: ProviderCardItem[] = PRESETS.map((preset) => {
    const match = records.find((r) => r.provider === preset.provider);
    const iconClass = BRAND_ICON_CLASSES[preset.provider] || 'bi bi-shield';
    return {
      id: match?.id,
      label: match ? match.name : t(preset.labelKey),
      provider: preset.provider,
      description: t(preset.descKey),
      icon: (
        <i
          className={iconClass}
          style={{ fontSize: 18, color: preset.color }}
        />
      ),
      color: preset.color,
      configured: !!match,
      enabled: match?.enabled ?? false,
      isDefault: match?.isDefault ?? false,
    };
  });

  return (
    <ProviderCardGrid
      items={cards}
      loading={loading}
      onSelect={handleSelectCard}
      onToggleEnabled={handleToggleEnabled}
      onSetDefault={handleSetDefault}
      togglingIds={togglingIds}
      emptyText={t('oauth.empty')}
    />
  );
}
