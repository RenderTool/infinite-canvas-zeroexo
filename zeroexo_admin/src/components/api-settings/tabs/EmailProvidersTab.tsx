/**
 * 邮件服务 Tab - 预设卡片网格 → 点击进入详情配置
 *
 * list: 显示预设 + 已配置卡片，支持卡片上启用/禁用（互斥: 仅允许一个启用）
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
  docUrl?: string;
}> = [
  {
    provider: 'smtp',
    labelKey: 'email.smtp',
    descKey: 'email.smtpDesc',
    color: '#52c41a',
    icon: 'bi bi-envelope',
    docUrl: 'https://wx.mail.qq.com/list/readtemplate?name=app_intro.html#/agreement/authorizationCode',
  },
  {
    provider: 'aliyun-dm',
    labelKey: 'email.aliyun',
    descKey: 'email.aliyunDesc',
    color: '#fa8c16',
    icon: 'bi bi-cloud',
  },
  {
    provider: 'tencent-ses',
    labelKey: 'email.tencent',
    descKey: 'email.tencentDesc',
    color: '#722ed1',
    icon: 'bi bi-chat-dots',
  },
  {
    provider: 'sendgrid',
    labelKey: 'email.sendgrid',
    descKey: 'email.sendgridDesc',
    color: '#1890ff',
    icon: 'bi bi-send',
  },
  {
    provider: 'mailgun',
    labelKey: 'email.mailgun',
    descKey: 'email.mailgunDesc',
    color: '#f5222d',
    icon: 'bi bi-rocket-takeoff',
  },
];

const configFields: FieldDef[] = [
  { key: 'host', label: 'email.host', placeholder: 'smtp.example.com', required: true },
  { key: 'port', label: 'email.port', type: 'number', placeholder: '587', required: true },
  { key: 'user', label: 'email.user', placeholder: 'yourname@qq.com' },
  { key: 'pass', label: 'email.pass', type: 'password', placeholder: 'email.passPlaceholder', required: true, sensitive: true },
];

const credentialsFields: FieldDef[] = [];

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

export default function EmailProvidersTab() {
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
        '/admin/api-providers?type=email',
      );
      const items = data.items || [];
      setRecords(items);
      return items;
    } catch (err) {
      showApiError(err, t('error.load'));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

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

  const handleSave = async () => {
    const items = await loadData();
    // 保存后留在详情页，更新记录数据
    if (selectedPreset) {
      const updatedRecord = items.find((r) => r.provider === selectedPreset.provider);
      if (updatedRecord) {
        setSelectedRecord(updatedRecord);
      }
    }
  };

  /** 卡片开关: 互斥,仅允许一个启用 */
  const handleToggleEnabled = async (item: ProviderCardItem, enabled: boolean) => {
    if (!item.id) {
      message.warning(
        `"${item.label}" ${t('error.notConfigured')}`,
      );
      return;
    }
    setTogglingIds((prev) => new Set(prev).add(item.id!));
    try {
      if (enabled) {
        // 启用前先把当前已启用的全部禁用(互斥)
        const enabledRecords = records.filter((r) => r.enabled && r.id !== item.id);
        for (const r of enabledRecords) {
          await apiPatch(`/admin/api-providers/${r.id}`, { enabled: false });
        }
      }
      await apiPatch(`/admin/api-providers/${item.id}`, { enabled });
      setRecords((prev) =>
        prev.map((r) => (r.id === item.id ? { ...r, enabled } : r)),
      );
      if (enabled) {
        // 本地立即同步其他记录的关闭状态
        setRecords((prev) =>
          prev.map((r) => (r.id !== item.id ? { ...r, enabled: false } : r)),
        );
      }
    } catch (err) {
      showApiError(err, '操作失败');
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
    return (
      <ProviderDetailForm
        title={`${t('api.config')} ${t(selectedPreset.labelKey)}`}
        preset={{
          label: t(selectedPreset.labelKey),
          provider: selectedPreset.provider,
          type: 'email',
          icon: selectedPreset.icon,
          defaultConfig: selectedPreset.defaultConfig,
          docUrl: selectedPreset.docUrl,
        }}
        configFields={configFields}
        credentialsFields={credentialsFields}
        configSectionTitle={t('email.configSection')}
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
    return {
      id: match?.id,
      label: match ? match.name : t(preset.labelKey),
      provider: preset.provider,
      description: t(preset.descKey),
      icon: <i className={preset.icon} style={{ fontSize: 20 }} />,
      color: preset.color,
      configured: !!match,
      enabled: match?.enabled ?? false,
      isDefault: match?.isDefault ?? false,
      meta: match
        ? {
            host: match.config?.host,
          }
        : undefined,
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
        emptyText={t('email.empty')}
      />
    </div>
  );
}
