/**
 * AI 渠道 Tab - 品牌卡片网格 → 点击进入品牌详情
 *
 * list: 品牌卡片列表（预设 + 自定义品牌合并）
 * detail: AiBrandDetail 品牌详情页（Tab 切换模型类型）
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { PlusOutlined, DeleteOutlined, BarsOutlined, MessageOutlined, PictureOutlined, VideoCameraOutlined, AudioOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Modal, Input, message, Space, Pagination, Tabs } from 'antd';
import { apiGet, apiPost, apiPatch, apiDelete, showApiError } from '@/services/api-client';
import { useTranslation } from 'react-i18next';
import ProviderCardGrid from '../ProviderCardGrid';
import AiBrandDetail from '../AiBrandDetail';
import { BRAND_ICONS, DefaultBrandIcon } from '../brand-icons';
import type { ProviderCardItem } from '../ProviderCardGrid';
import { HooksErrorBoundary } from './HooksErrorBoundary';
import CustomBrandModal, { type CustomBrandModalRef } from './CustomBrandModal';
import TemplateImportModal from './TemplateImportModal';
import ModelTemplateLibrary from './ModelTemplateLibrary';
import {
  STORAGE_KEY,
  MODEL_TYPE_LABELS,
  resolveBalanceDisplay,
  type BalanceRefreshResponse,
  type BrandPreset,
  type ProviderRecord,
} from './api-providers-types';

export default function AiProvidersTab() {
  const { t } = useTranslation();
  const [subView, setSubView] = useState<'list' | 'detail'>('list');
  const [presets, setPresets] = useState<BrandPreset[]>([]);
  const [records, setRecords] = useState<ProviderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<BrandPreset | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<ProviderRecord | undefined>(undefined);
  // 自定义品牌弹窗
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customSubmitting, setCustomSubmitting] = useState(false);
  const customModalRef = useRef<CustomBrandModalRef>(null);
  // 模板导入
  const [templateOpen, setTemplateOpen] = useState(false);
  // 正在切换启用状态的渠道 id 集合（Switch loading 态）
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  // 正在刷新余额的渠道 id 集合（Plan#17）
  const [refreshingBalanceIds, setRefreshingBalanceIds] = useState<Set<string>>(new Set());
  // 入口分类筛选: '' = 全部, llm/image/video/audio
  const [typeFilter, setTypeFilter] = useState<string>('');
  // 搜索关键词
  const [searchKeyword, setSearchKeyword] = useState('');
  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  // 批量删除
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [presetData, recordData] = await Promise.all([
        apiGet<{ items: BrandPreset[] }>('/admin/api-providers/presets'),
        apiGet<{ items?: ProviderRecord[] }>('/admin/api-providers?type=ai'),
      ]);
      const aiBrands = (presetData.items || []).filter((p) => p.type === 'ai');
      setPresets(aiBrands);
      setRecords(recordData.items || []);

      // ★ 尝试从 sessionStorage 恢复详情页视图
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const { provider } = JSON.parse(saved);
          const preset = aiBrands.find((p) => p.provider === provider);
          const record = (recordData.items || []).find((r) => r.provider === provider);
          if (preset) {
            setSelectedPreset(preset);
            setSelectedRecord(record);
            setSubView('detail');
            sessionStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch {
        // 静默失败，不影响主流程
      }
    } catch (err) {
      showApiError(err, '加载 AI 渠道失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectCard = (item: ProviderCardItem) => {
    if (batchMode) {
      handleToggleSelect(item);
      return;
    }

    const record = records.find((r) => r.id === item.id);

    let preset: BrandPreset | null = presets.find((p) => p.provider === item.provider) || null;

    if (!preset && item.isPreset === false && record) {
      preset = {
        provider: item.provider,
        label: item.label,
        type: 'ai',
        official: false,
        apiFormat: record.config?.apiFormat || 'openai',
        defaultBaseUrl: record.config?.baseUrl || '',
        color: item.color || '#8c8c8c',
        description: t('ai.customBrand'),
        capabilities: record.capabilities || [],
      };
    }

    setSelectedPreset(preset);
    setSelectedRecord(record);
    setSubView('detail');
    // ★ 保存详情页状态到 sessionStorage（刷新后恢复）
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: preset?.provider }));
  };

  const handleSave = () => {
    // ★ 保存后停留在详情页，仅刷新列表数据（由返回拦截中的保存负责跳回列表）
    loadData();
  };

  // 渠道级启用/禁用切换：局部更新 records，避免整表刷新
  const handleToggleEnabled = async (item: ProviderCardItem, enabled: boolean) => {
    if (batchMode) {
      message.warning(t('ai.batchModeWarning'));
      return;
    }

    if (!item.id) {
      message.warning(t('ai.configureFirst'));
      return;
    }

    setTogglingIds((prev) => new Set(prev).add(item.id!));
    try {
      if (enabled) {
        // 启用前尝试获取模型列表验证连通性
        // 注意：如果渠道未配置 API Key 或网络不通，会返回错误
        const testResult = await apiPost<{ ok: boolean; message: string }>(
          `/admin/api-providers/${item.id}/fetch-models`,
        );
        if (!testResult.ok) {
          message.error(`启用失败：${testResult.message || t('ai.apiConnectionError')}`);
          return;
        }
      }

      await apiPatch(`/admin/api-providers/${item.id}`, { enabled });
      setRecords((prev) => prev.map((r) => (r.id === item.id ? { ...r, enabled } : r)));
      message.success(enabled ? t('ai.enabled') : t('ai.disabled'));
    } catch (err) {
      showApiError(err, enabled ? '启用失败' : '禁用失败');
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id!);
        return next;
      });
    }
  };

  /** 设为默认渠道 */
  const handleSetDefault = async (item: ProviderCardItem) => {
    if (batchMode) {
      message.warning(t('ai.batchModeWarning'));
      return;
    }
    if (!item.id) {
      message.warning(t('ai.configureFirst'));
      return;
    }
    try {
      await apiPatch(`/admin/api-providers/${item.id}`, { isDefault: true });
      setRecords((prev) => prev.map((r) => ({ ...r, isDefault: r.id === item.id })));
      message.success(t('api.defaultSet'));
    } catch (err) {
      showApiError(err, '设为默认失败');
    }
  };

  /** 刷新渠道余额（Plan#17：调后端余额端点 → 局部更新 records） */
  const handleRefreshBalance = async (item: ProviderCardItem) => {
    if (!item.id) {
      message.warning(t('ai.configureFirst'));
      return;
    }
    setRefreshingBalanceIds((prev) => new Set(prev).add(item.id!));
    try {
      const res = await apiPost<BalanceRefreshResponse>(`/admin/api-providers/${item.id}/balance`);
      setRecords((prev) =>
        prev.map((r) =>
          r.id === item.id
            ? {
                ...r,
                balance: res.ok ? (res.balance ?? null) : null,
                balanceCurrency: res.ok ? (res.currency ?? null) : null,
                balanceCheckedAt: res.balanceCheckedAt,
                balanceError: res.ok ? null : (res.message ?? null),
              }
            : r,
        ),
      );
      if (res.ok) {
        message.success(t('ai.balance.refreshSuccess'));
      } else if (!res.supported) {
        message.info(t('ai.balance.unsupportedDesc'));
      } else {
        message.warning(res.message || t('ai.balance.queryFailed'));
      }
    } catch (err) {
      showApiError(err, '刷新余额失败');
    } finally {
      setRefreshingBalanceIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id!);
        return next;
      });
    }
  };

  // 自定义品牌提交：由 CustomBrandModal 完成 validateFields 后传入 values
  // 抛出异常时 CustomBrandModal 会保持弹窗打开
  const handleCreateCustom = async (values: any) => {
    setCustomSubmitting(true);
    try {
      const config: Record<string, any> = {
        apiKey: '',
        baseUrl: values.baseUrl || '',
        apiFormat: values.apiFormat || 'openai',
        official: false,
        models: {},
      };

      const logoProvider = values.logoProvider;
      const logoUrl = values.logoUrl;
      if (logoProvider && logoProvider !== 'custom') {
        config.logoProvider = logoProvider;
      }
      if (logoUrl) {
        config.logoUrl = logoUrl;
        config.logoProvider = 'custom';
      }

      await apiPost<{ id: string }>('/admin/api-providers', {
        name: values.name,
        // provider 必须是后端支持的分发标识(openai/anthropic/gemini/custom...),
        // 中转/兼容 OpenAI 协议的服务商统一使用 'custom',由 name 字段区分品牌
        provider: 'custom',
        type: 'ai',
        config,
        capabilities: values.capabilities || [],
        enabled: true,
        isDefault: false,
      });
      message.success(t('ai.customBrandCreated'));
      await loadData();
      // 成功后由 CustomBrandModal 重置表单并关闭弹窗
    } catch (err) {
      // 与原行为一致：校验错误和 API 错误（ApiError extends Error）均不展示额外错误
      // 仅对非 Error 异常展示 showApiError
      if (!(err instanceof Error)) {
        showApiError(err, '创建失败');
      }
      // 重新抛出，让 CustomBrandModal 保持弹窗打开
      throw err;
    } finally {
      setCustomSubmitting(false);
    }
  };

  // 模板导入：解析 JSON 字符串后回填自定义品牌表单
  const handleImportTemplate = async (json: string) => {
    const parsed = JSON.parse(json);
    const fields: Record<string, any> = {};
    if (parsed.name) fields.name = parsed.name;
    if (parsed.baseUrl) fields.baseUrl = parsed.baseUrl;
    if (parsed.apiFormat) fields.apiFormat = parsed.apiFormat;
    if (parsed.capabilities && Array.isArray(parsed.capabilities)) {
      const validTypes = ['llm', 'image', 'video', 'audio'];
      const valid = parsed.capabilities.filter((c: string) => validTypes.includes(c));
      if (valid.length > 0) fields.capabilities = valid;
    }
    customModalRef.current?.setFieldsValue(fields);

    const capMsg = parsed.capabilities?.length
      ? `，能力标签: ${parsed.capabilities.join(', ')}`
      : '';
    message.success(`模板已应用${capMsg}`);
  };

  // 单个删除
  const handleDelete = (item: { id: string; label: string }) => {
    const record = records.find((r) => r.id === item.id);

    // 预设品牌渠道不支持删除
    const isPresetChannel = presets.some((p) => p.provider === record?.provider);
    if (isPresetChannel) {
      message.info(`${t('ai.presetChannelInfo')} "${item.label}"`);
      return;
    }

    if (record?.isDefault) {
      message.warning(`${t('ai.defaultChannelWarning')} "${item.label}"`);
      return;
    }
    Modal.confirm({
      title: t('ai.confirmDeleteChannel'),
      content: t('ai.deleteWarning'),
      centered: true,
      okText: t('ai.confirmDelete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!item.id) return;
        try {
          await apiDelete(`/admin/api-providers/${item.id}`);
          message.success(t('ai.channelDeleted'));
          // ★ 删除成功后返回列表页
          setSubView('list');
          setSelectedPreset(null);
          setSelectedRecord(undefined);
          loadData();
        } catch (err) {
          showApiError(err, '删除失败');
        }
      },
    });
  };

  // 批量删除
  const handleBatchDelete = () => {
    const defaultIds = new Set(records.filter((r) => r.isDefault).map((r) => r.id));
    const deletableIds = [...selectedIds].filter((id) => !defaultIds.has(id));
    const skippedCount = selectedIds.size - deletableIds.length;

    if (deletableIds.length === 0) {
      message.warning(t('ai.allDefaultWarning'));
      return;
    }

    let content = `${t('ai.batchDeleteContent', { count: deletableIds.length })}`;
    if (skippedCount > 0) {
      content += `\n${t('ai.batchDeleteSkipped', { count: skippedCount })}`;
    }

    Modal.confirm({
      title: t('ai.confirmBatchDelete'),
      content,
      centered: true,
      okText: t('ai.confirmDelete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          for (const id of deletableIds) {
            await apiDelete(`/admin/api-providers/${id}`);
          }
          message.success(
            `${t('ai.batchDeleteSuccess', { count: deletableIds.length })}${
              skippedCount > 0 ? `，${t('ai.batchDeleteSkipped', { count: skippedCount })}` : ''
            }`,
          );
          setSelectedIds(new Set());
          setBatchMode(false);
          loadData();
        } catch (err) {
          showApiError(err, '批量删除失败');
        }
      },
    });
  };

  // 切换选中（默认配置渠道和预设渠道不可选）
  const handleToggleSelect = (item: ProviderCardItem) => {
    if (!item.id) {
      // 未配置的预设品牌卡片，在批量模式下提示配置
      if (item.isPreset) {
        message.info(t('ai.presetConfigFirst'));
      }
      return;
    }
    const record = records.find((r) => r.id === item.id);
    if (record?.isDefault) {
      message.warning(t('ai.defaultChannelWarning'));
      return;
    }
    // 预设品牌渠道不支持批量删除，提示用户
    if (item.isPreset) {
      message.info(t('ai.presetNoBatchDelete'));
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id!)) {
        next.delete(item.id!);
      } else {
        next.add(item.id!);
      }
      return next;
    });
  };

  // 品牌详情视图
  if (subView === 'detail' && selectedPreset) {
    return (
      <HooksErrorBoundary>
        <AiBrandDetail
          brandPreset={selectedPreset}
          existingRecord={selectedRecord}
          onBack={() => {
            setSubView('list');
            setSelectedPreset(null);
            setSelectedRecord(undefined);
          }}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      </HooksErrorBoundary>
    );
  }

  // 构建品牌卡片（按类型筛选）
  const presetCards: ProviderCardItem[] = presets
    .filter((preset) => !typeFilter || preset.capabilities.includes(typeFilter))
    .map((preset) => {
      const match = records.find((r) => r.provider === preset.provider);
      const IconComponent = BRAND_ICONS[preset.provider] || DefaultBrandIcon;
      const modelTypeLabels: string[] = preset.capabilities.map((cap: string) => {
        return t(MODEL_TYPE_LABELS[cap]) || cap;
      });
      // 检查记录是否有自定义 LOGO
      const recordLogoUrl = match?.config?.logoUrl;
      const recordLogoProvider = match?.config?.logoProvider;

      return {
        id: match?.id,
        label: match ? match.name : preset.label,
        provider: preset.provider,
        description: preset.description,
        icon: recordLogoUrl ? (
          <img src={recordLogoUrl} width={20} height={20} style={{ borderRadius: 4, objectFit: 'cover' }} />
        ) : recordLogoProvider ? (
          (() => {
            const Icon = BRAND_ICONS[recordLogoProvider] || DefaultBrandIcon;
            return <Icon size={20} />;
          })()
        ) : (
          <IconComponent size={20} />
        ),
        color: preset.color,
        configured: !!match,
        enabled: match?.enabled,
        isDefault: match?.isDefault,
        isPreset: true,
        meta: {
          models: modelTypeLabels.join(' / '),
          official: preset.official,
          balance: match ? resolveBalanceDisplay(match) : undefined,
        },
      };
    });

  // 自定义品牌卡片（已配置但不在预设中）
  const customCards: ProviderCardItem[] = records
    .filter((r) => !presets.some((p) => p.provider === r.provider))
    .map((r) => {
      const recordLogoUrl = r.config?.logoUrl;
      const recordLogoProvider = r.config?.logoProvider;
      return {
        id: r.id,
        label: r.name,
        provider: r.provider,
        description: t('ai.customBrand'),
        icon: recordLogoUrl ? (
          <img src={recordLogoUrl} width={20} height={20} style={{ borderRadius: 4, objectFit: 'cover' }} />
        ) : recordLogoProvider ? (
          (() => {
            const Icon = BRAND_ICONS[recordLogoProvider] || DefaultBrandIcon;
            return <Icon size={20} />;
          })()
        ) : (
          <DefaultBrandIcon size={20} />
        ),
        color: '#8c8c8c',
        configured: true,
        enabled: r.enabled,
        isDefault: r.isDefault,
        isPreset: false,
        meta: {
          models: (r.capabilities || [])
            .map((c) => t(MODEL_TYPE_LABELS[c]) || c)
            .join(' / '),
          official: false,
          balance: resolveBalanceDisplay(r),
        },
      };
    });

  const hasPresetCards = presetCards.length > 0;
  const hasCustomCards = customCards.length > 0;
  const allCards = (() => {
    const cards = [...presetCards, ...customCards];
    if (!searchKeyword.trim()) return cards;
    const kw = searchKeyword.trim().toLowerCase();
    return cards.filter(
      (c) =>
        c.label.toLowerCase().includes(kw) ||
        c.provider.toLowerCase().includes(kw) ||
        (c.description || '').toLowerCase().includes(kw),
    );
  })();
  const totalCards = allCards.length;
  const paginatedCards = allCards.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // 分页偏移：预设卡片占前部，自定义卡片在后
  const paginatedPreset = paginatedCards.filter((c) => c.isPreset);
  const paginatedCustom = paginatedCards.filter((c) => !c.isPreset);

  return (
    <div>
      {/* 工具栏：类别切换(Tab) 在顶部，搜索 + 操作按钮在 Tab 下方 */}
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* 类别切换：与 AI 测试页同款 Tab 样式 */}
        <Tabs
          style={{ marginBottom: 0 }}
          activeKey={typeFilter || 'all'}
          onChange={(key) => {
            setTypeFilter(key === 'all' ? '' : key);
            setCurrentPage(1);
          }}
          items={[
            { key: 'all', label: <span><BarsOutlined style={{ marginRight: 4, verticalAlign: -2 }} />{t('ai.all')}</span> },
            { key: 'llm', label: <span><MessageOutlined style={{ marginRight: 4, verticalAlign: -2 }} />{t('ai.type.llm')}</span> },
            { key: 'image', label: <span><PictureOutlined style={{ marginRight: 4, verticalAlign: -2 }} />{t('ai.type.image')}</span> },
            { key: 'video', label: <span><VideoCameraOutlined style={{ marginRight: 4, verticalAlign: -2 }} />{t('ai.type.video')}</span> },
            { key: 'audio', label: <span><AudioOutlined style={{ marginRight: 4, verticalAlign: -2 }} />{t('ai.type.audio')}</span> },
          ]}
        />
        {/* 搜索 + 操作按钮一行：尺寸与布局同用户列表同款（搜索 240 + 默认尺寸 + gap 12 紧缩） */}
        <div style={{ marginBottom: 0, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input
            placeholder={t('ai.searchChannel')}
            prefix={<SearchOutlined />}
            value={searchKeyword}
            onChange={(e) => {
              setSearchKeyword(e.target.value);
              setCurrentPage(1);
            }}
            allowClear
            style={{ width: 240 }}
          />
          <div style={{ flex: 1 }} />
          <Space>
            <Button
              icon={<PlusOutlined />}
              onClick={() => {
                customModalRef.current?.resetFields();
                setCustomModalOpen(true);
              }}
            >
              {t('ai.addChannel')}
            </Button>
            <Button
              icon={<DeleteOutlined />}
              type={batchMode ? 'primary' : 'default'}
              onClick={() => {
                setBatchMode(!batchMode);
                if (batchMode) setSelectedIds(new Set());
              }}
            >
              {batchMode ? t('ai.exitBatch') : t('ai.batchDelete')}
            </Button>
            {batchMode && selectedIds.size > 0 && (
              <Button danger icon={<DeleteOutlined />} onClick={handleBatchDelete}>
                {t('ai.deleteSelected', { count: selectedIds.size })}
              </Button>
            )}
          </Space>
        </div>
      </div>
      {/* 预设品牌卡片 */}
      {hasPresetCards && (
        <div style={{ marginBottom: hasCustomCards ? 24 : 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: '#595959',
              marginBottom: 12,
              paddingLeft: 4,
            }}
          >
            {t('ai.presetBrands')}
          </div>
          <ProviderCardGrid
            items={paginatedPreset}
            loading={loading}
            onSelect={handleSelectCard}
            onToggleEnabled={handleToggleEnabled}
            onSetDefault={handleSetDefault}
            togglingIds={togglingIds}
            onRefreshBalance={handleRefreshBalance}
            refreshingBalanceIds={refreshingBalanceIds}
            emptyText={t('ai.noPresetBrands')}
            batchMode={batchMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
          />
        </div>
      )}

      {/* 自定义品牌卡片 */}
      {hasCustomCards && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: '#595959',
              marginBottom: 12,
              paddingLeft: 4,
            }}
          >
            {t('ai.customBrands')}
          </div>
          <ProviderCardGrid
            items={paginatedCustom}
            loading={loading}
            onSelect={handleSelectCard}
            onToggleEnabled={handleToggleEnabled}
            onSetDefault={handleSetDefault}
            togglingIds={togglingIds}
            onRefreshBalance={handleRefreshBalance}
            refreshingBalanceIds={refreshingBalanceIds}
            emptyText={t('ai.noCustomBrands')}
            batchMode={batchMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
          />
        </div>
      )}

      {/* 全部分页（只有两种卡片合并后超过 pageSize 时才显示） */}
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={totalCards}
          onChange={(page) => setCurrentPage(page)}
          showSizeChanger={false}
          showTotal={(total, range) => `${range[0]}-${range[1]} / 共 ${total} 条`}
        />
      </div>

      {/* 模型模板库（系统级模板：内置 + 用户导入） */}
      <ModelTemplateLibrary />

      {/* 自定义品牌弹窗 */}
      <CustomBrandModal
        ref={customModalRef}
        open={customModalOpen}
        onClose={() => setCustomModalOpen(false)}
        onSubmit={handleCreateCustom}
        submitting={customSubmitting}
        presets={presets}
        onOpenTemplate={() => setTemplateOpen(true)}
      />

      {/* 模板导入弹窗 */}
      <TemplateImportModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onImport={handleImportTemplate}
        importing={false}
      />
    </div>
  );
}
