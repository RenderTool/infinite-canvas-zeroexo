import { useState, useEffect, useCallback } from 'react';
import { StatisticCard } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Tag,
  message,
  Row,
  Col,
  Descriptions,
  Divider,
  Typography,
  Tabs,
  Dropdown,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CalculatorOutlined,
  ThunderboltOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  ReloadOutlined,
  DollarOutlined,
  StarOutlined,
  InfoCircleOutlined,
  EllipsisOutlined,
  SearchOutlined,
  CrownOutlined,
} from '@ant-design/icons';
import PlanManagement from './plans-settings';
import { apiGet, apiPost } from '@/services/api-client';
import { color as themeColor } from '@/design-tokens';
import type { ColumnsType } from 'antd/es/table';
import { AutoComplete } from 'antd';

const { Text } = Typography;

type ModelType = 'llm' | 'image' | 'video' | 'audio';

interface PricingConfig {
  id: string;
  modelType: ModelType;
  provider: string;
  modelId: string;
  unitType: string;
  modelMultiplier: number;
  completionMultiplier: number;
  creditPerUnit: number;
  creditUnitSize: number;
  enabled: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface PricingCatalogEntry {
  modelType: string;
  provider: string;
  modelId: string;
  pricing: {
    mode: string;
    inputPerMillion?: number;
    outputPerMillion?: number;
    flatAmount?: number;
  };
}

interface CostEstimate {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  totalCostCny: number;
  creditsConsumed: number;
  creditValueCny: number;
  multiplier: {
    modelMultiplier: number;
    completionMultiplier: number;
    creditPerUnit: number;
    creditUnitSize: number;
    unitType: string;
  };
}



const UNIT_TYPE_MAP: Record<ModelType, string> = {
  llm: 'token',
  image: 'image',
  video: 'video',
  audio: 'audio',
};

interface ApiProviderItem {
  id: string;
  name: string;
  provider: string;
  type: string;
  enabled: boolean;
  capabilities: string[];
  /** 渠道配置（含 fetchedModels: { llm: string[]; image: string[]; video: string[]; audio: string[] }） */
  config?: Record<string, any>;
}

export default function PricingSettings() {
  const { t } = useTranslation();
  const MODEL_TYPE_TABS: { key: ModelType; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'llm', label: t('pricing.modelType.llm'), icon: <ThunderboltOutlined />, color: themeColor.primary },
    { key: 'image', label: t('pricing.modelType.image'), icon: <PictureOutlined />, color: themeColor.success },
    { key: 'video', label: t('pricing.modelType.video'), icon: <VideoCameraOutlined />, color: themeColor.ai },
    { key: 'audio', label: t('pricing.modelType.audio'), icon: <AudioOutlined />, color: themeColor.warning },
  ];
  const [pageTab, setPageTab] = useState<'pricing' | 'plans'>('pricing');
  const [activeType, setActiveType] = useState<ModelType>('llm');
  const [loading, setLoading] = useState(false);
  const [configs, setConfigs] = useState<PricingConfig[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [catalog, setCatalog] = useState<PricingCatalogEntry[]>([]);
  const [apiProviders, setApiProviders] = useState<ApiProviderItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<PricingConfig | null>(null);
  const [estimateResult, setEstimateResult] = useState<CostEstimate | null>(null);
  const [estimateModalOpen, setEstimateModalOpen] = useState(false);
  const [form] = Form.useForm();
  const selectedProvider = Form.useWatch('provider', form);
  const selectedModelType = (Form.useWatch('modelType', form) as ModelType) || activeType;

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<PricingConfig[]>('/admin/billing/pricing-config');
      setConfigs(Array.isArray(data) ? data : []);
    } catch {
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCatalog = useCallback(async () => {
    try {
      const data = await apiGet<{ items: PricingCatalogEntry[] }>('/admin/pricing/catalog');
      setCatalog(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setCatalog([]);
    }
  }, []);

  const fetchApiProviders = useCallback(async () => {
    try {
      // 仅加载已配置且启用的 AI 渠道
      const data = await apiGet<{ items: ApiProviderItem[] }>('/admin/api-providers?type=ai&enabled=true');
      setApiProviders(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setApiProviders([]);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
    fetchCatalog();
    fetchApiProviders();
  }, [fetchConfigs, fetchCatalog, fetchApiProviders]);

  const filteredConfigs = configs
    .filter((c) => c.modelType === activeType)
    .filter((c) => {
      if (!searchKeyword) return true;
      const kw = searchKeyword.toLowerCase();
      return c.modelId.toLowerCase().includes(kw) || c.provider.toLowerCase().includes(kw);
    });
  const filteredCatalog = catalog.filter((c) => c.modelType === activeType);

  const openCreateModal = () => {
    setEditingConfig(null);
    form.resetFields();
    form.setFieldsValue({
      modelType: activeType,
      unitType: UNIT_TYPE_MAP[activeType],
      modelMultiplier: 1,
      completionMultiplier: activeType === 'llm' ? 1 : 1,
      creditPerUnit: 0,
      creditUnitSize: activeType === 'llm' ? 1000 : 1,
      enabled: true,
    });
    // 每次打开弹窗刷新渠道列表，确保模型 ID 下拉显示最新缓存
    fetchApiProviders();
    setModalOpen(true);
  };

  const openEditModal = (config: PricingConfig) => {
    setEditingConfig(config);
    form.setFieldsValue({
      modelType: config.modelType,
      provider: config.provider,
      modelId: config.modelId,
      unitType: config.unitType,
      modelMultiplier: config.modelMultiplier,
      completionMultiplier: config.completionMultiplier,
      creditPerUnit: config.creditPerUnit,
      creditUnitSize: config.creditUnitSize,
      enabled: config.enabled,
      notes: config.notes,
    });
    // 每次打开弹窗刷新渠道列表，确保模型 ID 下拉显示最新缓存
    fetchApiProviders();
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingConfig) {
        await apiPost(`/admin/billing/pricing-config/${editingConfig.id}`, values);
        message.success(t('pricing.message.updated'));
      } else {
        await apiPost('/admin/billing/pricing-config', values);
        message.success(t('pricing.message.created'));
      }
      setModalOpen(false);
      fetchConfigs();
    } catch {
      message.error(t('pricing.message.saveFailed'));
    }
  };

  const handleDelete = async (id: string) => {
    Modal.confirm({
      title: t('pricing.confirm.disableTitle'),
      content: t('pricing.confirm.disableContent'),
      centered: true,
      okType: 'danger',
      okText: t('pricing.confirm.confirmDisable'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await apiPost(`/admin/billing/pricing-config/${id}`, { enabled: false });
          message.success(t('pricing.message.disabled'));
          fetchConfigs();
        } catch {
          message.error(t('pricing.message.operationFailed'));
        }
      },
    });
  };

  const handleBatchDisable = () => {
    const ids = [...selectedRowKeys] as string[];
    if (ids.length === 0) return;
    Modal.confirm({
      title: t('pricing.confirm.batchDisableTitle'),
      content: t('pricing.confirm.batchDisableContent', { count: ids.length }),
      centered: true,
      okType: 'danger',
      okText: t('pricing.confirm.confirmDisable'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await Promise.all(ids.map((id) => apiPost(`/admin/billing/pricing-config/${id}`, { enabled: false })));
          message.success(t('pricing.message.batchDisabled', { count: ids.length }));
          setSelectedRowKeys([]);
          fetchConfigs();
        } catch {
          message.error(t('pricing.message.batchDisableFailed'));
        }
      },
    });
  };

  const openEstimateModal = () => {
    setEstimateResult(null);
    setEstimateModalOpen(true);
  };
  const handleEstimate = async (values: {
    modelType: string;
    provider: string;
    modelId: string;
    usageAmount: number;
    inputTokens?: number;
    outputTokens?: number;
  }) => {
    try {
      const result = await apiPost<CostEstimate>('/admin/billing/estimate', values);
      setEstimateResult(result);
    } catch {
      message.error(t('pricing.message.estimateFailed'));
    }
  };

  const configColumns: ColumnsType<PricingConfig> = [
    {
      title: t('pricing.column.model'),
      dataIndex: 'modelId',
      key: 'modelId',
      sorter: (a, b) => a.modelId.localeCompare(b.modelId),
      render: (name: string, record) => (
        <div>
          <Text strong>{name}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>{record.provider}</Text>
        </div>
      ),
    },
    {
      title: t('pricing.column.unitType'),
      dataIndex: 'unitType',
      key: 'unitType',
      render: (type: string) => {
        const colorMap: Record<string, string> = { token: 'blue', image: 'green', video: 'purple', audio: 'orange' };
        const labelMap: Record<string, string> = { token: 'Token', image: t('pricing.unit.image'), video: t('pricing.unit.video'), audio: t('pricing.unit.audio') };
        return <Tag color={colorMap[type] || 'default'} style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{labelMap[type] || type}</Tag>;
      },
    },
    {
      title: t('pricing.column.modelMultiplier'),
      dataIndex: 'modelMultiplier',
      key: 'modelMultiplier',
      sorter: (a, b) => a.modelMultiplier - b.modelMultiplier,
      render: (v: number) => <Text style={{ color: v < 1 ? themeColor.success : v > 1 ? themeColor.error : undefined }}>{v.toFixed(2)}x</Text>,
    },
    {
      title: t('pricing.column.completionMultiplier'),
      dataIndex: 'completionMultiplier',
      key: 'completionMultiplier',
      sorter: (a, b) => a.completionMultiplier - b.completionMultiplier,
      render: (v: number) => <Text>{v.toFixed(2)}x</Text>,
    },
    {
      title: t('pricing.column.creditPerUnit'),
      key: 'creditPerUnit',
      render: (_, record) => (
        <div>
          <Text>{record.creditPerUnit.toFixed(2)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}> / {record.creditUnitSize} {record.unitType === 'token' ? 'tokens' : 'unit'}</Text>
        </div>
      ),
    },
    {
      title: t('pricing.column.status'),
      dataIndex: 'enabled',
      key: 'enabled',
      sorter: (a, b) => Number(a.enabled) - Number(b.enabled),
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'} style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{v ? t('pricing.status.enabled') : t('pricing.status.disabled')}</Tag>,
    },
    {
      title: t('pricing.column.actions'),
      key: 'actions',
      width: 48,
      fixed: 'right',
      render: (_, record) => (
        <div className="row-actions">
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'edit', icon: <EditOutlined />, label: t('pricing.action.edit') },
                { key: 'disable', icon: <DeleteOutlined />, label: t('pricing.action.disable') },
              ],
              onClick: ({ key }) => {
                if (key === 'edit') openEditModal(record);
                if (key === 'disable') handleDelete(record.id);
              },
            }}
          >
            <Button type="primary" icon={<EllipsisOutlined />} style={{ width: 32, height: 32, padding: 0 }} />
          </Dropdown>
        </div>
      ),
    },
  ];

  return (
    <BreadcrumbLayout items={[{ title: t('nav.siteOperations') }, { title: t('nav.pricingManagement') }]}>
      {/* 页面级 Tab：定价配置 | 定价分组 */}
      <Tabs
        activeKey={pageTab}
        onChange={(key) => setPageTab(key as 'pricing' | 'plans')}
        items={[
          {
            key: 'pricing',
            label: (
              <span>
                <DollarOutlined style={{ marginRight: 4, verticalAlign: -2 }} />
                {t('pricing.tab.pricingConfig')}
              </span>
            ),
          },
          {
            key: 'plans',
            label: (
              <span>
                <CrownOutlined style={{ marginRight: 4, verticalAlign: -2 }} />
                {t('pricing.tab.pricingPlans')}
              </span>
            ),
          },
        ]}
      />
      {pageTab === 'pricing' ? (
        <>
          {/* 定价说明 */}
          <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={6}>
            <StatisticCard
              statistic={{
                title: t('pricing.stats.twoTierSystem'),
                value: 2,
                suffix: t('pricing.stats.tier'),
                prefix: <StarOutlined style={{ color: themeColor.warning }} />,
              }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <StatisticCard
              statistic={{
                title: t('pricing.stats.configuredModels'),
                value: filteredConfigs.length,
                prefix: <ThunderboltOutlined style={{ color: themeColor.primary }} />,
              }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <StatisticCard
              statistic={{
                title: t('pricing.stats.catalogEntries'),
                value: filteredCatalog.length,
                prefix: <DollarOutlined style={{ color: themeColor.success }} />,
              }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <StatisticCard
              statistic={{
                title: t('pricing.stats.enabledConfigs'),
                value: filteredConfigs.filter((c) => c.enabled).length,
                prefix: <InfoCircleOutlined style={{ color: themeColor.ai }} />,
              }}
            />
          </Col>
        </Row>
        <Divider style={{ margin: '16px 0' }} />
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <AlertBox
              title={t('pricing.alert.modelMultiplierTitle')}
              desc={t('pricing.alert.modelMultiplierDesc')}
              color={themeColor.primary}
            />
          </Col>
          <Col xs={24} md={12}>
            <AlertBox
              title={t('pricing.alert.completionMultiplierTitle')}
              desc={t('pricing.alert.completionMultiplierDesc')}
              color={themeColor.warning}
            />
          </Col>
        </Row>
      </Card>

      {/* Tab 切换（与 API 渠道同款，模型分类统一使用 Tab） */}
      <Card>
        <Tabs
          style={{ marginBottom: 0 }}
          activeKey={activeType}
          onChange={(key) => setActiveType(key as ModelType)}
          items={MODEL_TYPE_TABS.map((tab) => ({
            key: tab.key,
            label: (
              <span>
                <span style={{ marginRight: 4, verticalAlign: -2 }}>{tab.icon}</span>
                {tab.label}
              </span>
            ),
          }))}
        />

        {/* 搜索 + 操作（Tab 下方） */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input
            placeholder={t('pricing.search.placeholder')}
            prefix={<SearchOutlined />}
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            allowClear
            style={{ width: 240 }}
          />
          <div style={{ flex: 1 }} />
          <Button icon={<CalculatorOutlined />} onClick={openEstimateModal}>
            {t('pricing.action.costEstimate')}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchConfigs}>
            {t('common.refresh')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            {t('pricing.action.createConfig')}
          </Button>
        </div>

        {/* 批量操作（带统计） */}
        {selectedRowKeys.length > 0 && (
          <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: 'var(--color-text-secondary, #8c8c8c)', fontSize: 13 }}>
              {t('pricing.batch.selectedItems', { count: selectedRowKeys.length })}
            </span>
            <span style={{ color: 'var(--color-text-secondary, #8c8c8c)', fontSize: 13 }}>
              {t('pricing.batch.pageInfo', { current: filteredConfigs.length, total: configs.filter((c) => c.modelType === activeType).length })}
            </span>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={handleBatchDisable}>
              {t('pricing.action.batchDisable')}
            </Button>
          </div>
        )}

        {/* 定价目录 (只读参考) */}
        {filteredCatalog.length > 0 && (
          <Descriptions
            title={<Text strong>{t('pricing.catalog.title')}</Text>}
            column={2}
            size="small"
            style={{ marginBottom: 16 }}
            bordered
          >
            {filteredCatalog.map((entry) => (
              <Descriptions.Item key={`${entry.provider}-${entry.modelId}`} label={`${entry.provider} / ${entry.modelId}`}>
                {entry.pricing.mode === 'flat' ? (
                  entry.pricing.inputPerMillion !== undefined ? (
                    <span>
                      输入 ${entry.pricing.inputPerMillion}/M tokens
                      {entry.pricing.outputPerMillion !== undefined && (
                        <span> | 输出 ${entry.pricing.outputPerMillion}/M tokens</span>
                      )}
                    </span>
                  ) : (
                    <span>${entry.pricing.flatAmount?.toFixed(4) || 'N/A'} / 次</span>
                  )
                ) : (
                  <span>{t('pricing.catalog.tieredPricing')}</span>
                )}
              </Descriptions.Item>
            ))}
          </Descriptions>
        )}

        {/* 配置表格 */}
        <Table
          className="data-table resource-table"
          rowKey="id"
          loading={loading}
          columns={configColumns}
          dataSource={filteredConfigs}
          pagination={false}
          bordered
          sticky
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
          }}
          locale={{ emptyText: t('pricing.empty.noConfigs') }}
        />
      </Card>
        </>
      ) : (
        <PlanManagement />
      )}

      {/* 创建/编辑弹窗 */}
      <Modal
        title={editingConfig ? t('pricing.modal.editTitle') : t('pricing.modal.createTitle')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        width={680}
        centered
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="modelType" label={t('pricing.form.modelType')} rules={[{ required: true }]}>
                <Select disabled={!!editingConfig}>
                  {MODEL_TYPE_TABS.map((t) => (
                    <Select.Option key={t.key} value={t.key}>{t.label}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="provider" label={t('pricing.form.provider')} rules={[{ required: true }]}>
                <Select
                  showSearch
                  placeholder={t('pricing.form.providerPlaceholder')}
                  onChange={() => {
                    form.setFieldValue('modelId', undefined);
                  }}
                >
                  {(() => {
                    // 仅已配置且启用的渠道服务商
                    const configuredProviders = Array.from(
                      new Set(apiProviders.map((p) => p.provider)),
                    ).sort();
                    return configuredProviders.map((p) => {
                      const channels = apiProviders.filter((ap) => ap.provider === p);
                      const modelCount = channels.reduce((sum, c) => {
                        const fetched = (c.config?.fetchedModels as Record<string, string[]> | undefined);
                        return sum + (fetched ? Object.values(fetched).reduce((a, arr) => a + arr.length, 0) : 0);
                      }, 0);
                      return (
                        <Select.Option key={p} value={p}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {p}
                            <Tag color="green" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}>
                              {t('pricing.form.configuredChannels', { count: channels.length })}
                            </Tag>
                            {modelCount > 0 && (
                              <span style={{ color: 'var(--color-text-secondary, #999)', fontSize: 12 }}>{t('pricing.form.modelCount', { count: modelCount })}</span>
                            )}
                          </span>
                        </Select.Option>
                      );
                    });
                  })()}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="modelId" label={t('pricing.form.modelId')} rules={[{ required: true }]}>
            {(() => {
              // 从已配置渠道的 fetchedModels 中按当前模型类型加载模型列表（与表单 modelType 联动）
              const fetchedModels = apiProviders
                .filter((p) => p.provider === selectedProvider)
                .flatMap((p) => {
                  const fetched = (p.config?.fetchedModels as Record<string, string[]> | undefined);
                  if (!fetched) return [];
                  const list = fetched[selectedModelType] || [];
                  return list.filter(Boolean).map((id) => id.trim());
                });
              const channelModels = Array.from(new Set(fetchedModels)).map((value) => ({
                value,
                label: value,
              }));
              // 定价目录作为补充（渠道尚未拉取到模型时仍可手输官方模型）
              const catalogModels = catalog
                .filter((c) => c.modelType === selectedModelType && c.provider === selectedProvider)
                .map((c) => ({
                  value: c.modelId,
                  label: `${c.modelId}  ${c.pricing.mode === 'flat' ? `$${c.pricing.flatAmount?.toFixed(4) || '?'}/次` : `$${c.pricing.inputPerMillion?.toFixed(2) || '?'}/M输入`}`,
                }));
              const options = [...channelModels, ...catalogModels.filter((cm) => !channelModels.some((m) => m.value === cm.value))];
              return (
                <AutoComplete
                  placeholder={channelModels.length > 0 ? t('pricing.form.modelIdPlaceholder') : t('pricing.form.modelIdFallbackPlaceholder')}
                  options={options.length > 0 ? options : undefined}
                  filterOption={(inputValue, option) =>
                    option!.value.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
                  }
                />
              );
            })()}
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="unitType" label={t('pricing.form.unitType')} rules={[{ required: true }]}>
                <Select>
                  <Select.Option value="token">Token</Select.Option>
                  <Select.Option value="image">{t('pricing.unit.image')}</Select.Option>
                  <Select.Option value="video">{t('pricing.unit.video')}</Select.Option>
                  <Select.Option value="audio">{t('pricing.unit.audio')}</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="enabled" label={t('pricing.form.enabled')} valuePropName="checked" initialValue={true}>
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Divider titlePlacement="start">{t('pricing.form.multiplierConfig')}</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="modelMultiplier" label={t('pricing.form.modelMultiplier')} rules={[{ required: true }]} initialValue={1}>
                <InputNumber min={0} max={100} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="completionMultiplier" label={t('pricing.form.completionMultiplier')} rules={[{ required: true }]} initialValue={1}>
                <InputNumber min={0} max={100} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider titlePlacement="start">{t('pricing.form.creditConfig')}</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="creditPerUnit" label={t('pricing.form.creditPerUnit')} rules={[{ required: true }]} initialValue={0}>
                <InputNumber min={0} max={100000} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="creditUnitSize" label={t('pricing.form.creditUnitSize')} rules={[{ required: true }]} initialValue={1000}>
                <InputNumber min={1} max={1000000} step={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="notes" label={t('pricing.form.notes')}>
            <Input.TextArea rows={2} placeholder={t('pricing.form.notesPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 成本估算弹窗 */}
      <Modal
        title={t('pricing.estimate.title')}
        open={estimateModalOpen}
        onCancel={() => setEstimateModalOpen(false)}
        footer={null}
        width={680}
        centered
      >
        <CostEstimator onEstimate={handleEstimate} result={estimateResult} />
      </Modal>
    </BreadcrumbLayout>
  );
}

function AlertBox({ title, desc, color }: { title: string; desc: string; color: string }) {
  return (
    <div style={{
      padding: '12px 16px',
      borderRadius: 'var(--radius-sm, 4px)',
      background: `${color}08`,
      borderLeft: `3px solid ${color}`,
    }}>
      <Text strong style={{ color, display: 'block', marginBottom: 4 }}>{title}</Text>
      <Text type="secondary" style={{ fontSize: 13 }}>{desc}</Text>
    </div>
  );
}

const PROVIDER_OPTIONS = ['OpenAI', 'Anthropic', 'Google', 'DeepSeek', 'Moonshot', 'Baichuan'];

function CostEstimator({
  onEstimate,
  result,
}: {
  onEstimate: (values: any) => void;
  result: CostEstimate | null;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm();

  return (
    <div>
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => onEstimate(values)}
        initialValues={{ modelType: 'llm', modelMultiplier: 1, completionMultiplier: 1 }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="modelType" label={t('pricing.estimate.modelType')}>
              <Select>
                <Select.Option value="llm">{t('pricing.estimate.textGeneration')}</Select.Option>
                <Select.Option value="image">{t('pricing.estimate.imageGeneration')}</Select.Option>
                <Select.Option value="video">{t('pricing.estimate.videoGeneration')}</Select.Option>
                <Select.Option value="audio">{t('pricing.estimate.audioGeneration')}</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="provider" label={t('pricing.estimate.provider')}>
              <Select showSearch placeholder={t('pricing.estimate.providerPlaceholder')}>
                {PROVIDER_OPTIONS.map((p) => (
                  <Select.Option key={p} value={p}>{p}</Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="modelId" label={t('pricing.estimate.modelId')} rules={[{ required: true }]}>
          <Input placeholder={t('pricing.estimate.modelIdPlaceholder')} />
        </Form.Item>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="usageAmount" label={t('pricing.estimate.usage')} rules={[{ required: true }]} initialValue={1000}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="inputTokens" label={t('pricing.estimate.inputTokens')}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="outputTokens" label={t('pricing.estimate.outputTokens')}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Button type="primary" htmlType="submit" block>
          {t('pricing.estimate.calculate')}
        </Button>
      </Form>

      {result && (
        <Card
          style={{ marginTop: 16, borderRadius: 'var(--radius-sm, 4px)' }}
          size="small"
          title={<Text strong>{t('pricing.estimate.result')}</Text>}
        >
          <Descriptions column={1} size="small">
            <Descriptions.Item label={t('pricing.estimate.modelMultiplier')}>
              {result.multiplier.modelMultiplier}x 输入 / {result.multiplier.completionMultiplier}x 输出
            </Descriptions.Item>
            <Descriptions.Item label={t('pricing.estimate.upstreamCostUsd')}>
              ${result.totalCostUsd.toFixed(4)}
            </Descriptions.Item>
            <Descriptions.Item label={t('pricing.estimate.upstreamCostCny')}>
              ¥{result.totalCostCny.toFixed(4)}
            </Descriptions.Item>
            <Descriptions.Item label={t('pricing.estimate.creditsConsumed')}>
              <Text strong style={{ color: themeColor.warning }}>{result.creditsConsumed}</Text> 积分
            </Descriptions.Item>
            <Descriptions.Item label={t('pricing.estimate.creditValue')}>
              ¥{result.creditValueCny.toFixed(4)}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}
    </div>
  );
}
