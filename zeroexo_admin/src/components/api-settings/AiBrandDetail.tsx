/**
 * AiBrandDetail - AI 品牌详情配置页面
 *
 * 品牌级别的 API 凭证/地址配置，以及按模型类型分 Tab 的模型列表。
 * 预设品牌仅允许填写 API Key，自定义品牌所有字段可编辑。
 * 填写 API Key 后自动触发"获取列表"获取模型并自动保存。
 *
 * 状态与业务逻辑由 useAiBrandState Hook 管理，本组件仅负责 JSX 组合。
 * 子组件：
 *   - BrandHeader        品牌头部 + 消费 + 测试结果
 *   - CredentialsForm    凭证配置表单（内含 ModelListSection）
 *   - ModelListSection   模型列表区
 *   - ClassifyModal      模型归类弹窗
 *   - TemplateEditor     模板导入/导出弹窗
 *   - AiBrandSchemaModal 模型参数配置弹窗
 *   - IconSelectModal    模型图标选择弹窗
 */
import { useState } from 'react';
import { Card, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { apiPost, showApiError } from '@/services/api-client';
import type { AiBrandDetailProps } from './ai-brand-types';
import DetailBreadcrumb from './DetailBreadcrumb';
import AiBrandSchemaModal from './AiBrandSchemaModal';
import TemplateEditor from './TemplateEditor';
import ModelListSection from './ModelListSection';
import ClassifyModal from './ClassifyModal';
import AddModelModal from './AddModelModal';
import IconSelectModal from './IconSelectModal';
import BrandHeader from './BrandHeader';
import CredentialsForm from './CredentialsForm';
import { useAiBrandState } from './use-ai-brand-state';
import {
  resolveBalanceDisplay,
  type BalanceRefreshResponse,
} from './tabs/api-providers-types';

export default function AiBrandDetail(props: AiBrandDetailProps) {
  const { t } = useTranslation();
  const { brandPreset, existingRecord } = props;
  const [watchedApiKey, setWatchedApiKey] = useState<string | undefined>(undefined);
  const [watchedFormValues, setWatchedFormValues] = useState<any>(undefined);
  // 余额刷新（Plan#17）：本地覆盖层避免等待父级 records 刷新
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const [balanceOverride, setBalanceOverride] = useState<{
    balance?: number | null;
    balanceCurrency?: string | null;
    balanceCheckedAt?: string | null;
    balanceError?: string | null;
  }>({});
  const handleFormChange = (_: Record<string, any>, allValues: Record<string, any>) => {
    setWatchedApiKey(allValues.apiKey);
    setWatchedFormValues(allValues);
  };

  /** 刷新余额：调后端端点 → 更新本地覆盖层 + 通知父级刷新卡片列表 */
  const handleRefreshBalance = async () => {
    if (!existingRecord?.id) {
      message.warning(t('ai.saveChannelFirst'));
      return;
    }
    setBalanceRefreshing(true);
    try {
      const res = await apiPost<BalanceRefreshResponse>(
        `/admin/api-providers/${existingRecord.id}/balance`,
      );
      setBalanceOverride({
        balance: res.ok ? (res.balance ?? null) : null,
        balanceCurrency: res.ok ? (res.currency ?? null) : null,
        balanceCheckedAt: res.balanceCheckedAt,
        balanceError: res.ok ? null : (res.message ?? null),
      });
      if (res.ok) {
        message.success(t('ai.balance.refreshSuccess'));
      } else if (!res.supported) {
        message.info(t('ai.balance.unsupportedDesc'));
      } else {
        message.warning(res.message || t('ai.balance.queryFailed'));
      }
      props.onSave();
    } catch (err) {
      showApiError(err, '刷新余额失败');
    } finally {
      setBalanceRefreshing(false);
    }
  };

  const effectiveRecord = existingRecord
    ? { ...existingRecord, ...balanceOverride }
    : undefined;
  const balanceDisplay = effectiveRecord
    ? resolveBalanceDisplay(effectiveRecord)
    : undefined;
  const {
    // 表单 & 派生
    form,
    isPreset,
    brandColor,
    BrandIconComponent,
    // 返回 / 保存
    onBack,
    saveStatus,
    handleSaveRef,
    // 测试
    testing,
    testResult,
    rawModelIds,
    // 模型列表
    fetchedModels,
    flatModelList,
    filteredAllModels,
    allModelTypes,
    filterType,
    setFilterType,
    filterEnabled,
    setFilterEnabled,
    searchKeyword,
    setSearchKeyword,
    currentModelPage,
    setCurrentModelPage,
    modelPageSize,
    currentModels,
    currentModelTotal,
    selectedModels,
    toggleSelectModel,
    toggleSelectAll,
    toggleModel,
    handleDeleteModel,
    handleBatchDeleteModels,
    // 分类弹窗
    classifyModalOpen,
    setClassifyModalOpen,
    classifyModelIds,
    selectedClassifyType,
    setSelectedClassifyType,
    classifyTemplateId,
    setClassifyTemplateId,
    templateList,
    recommendedTemplate,
    openClassifyModal,
    handleClassify,
    handleAutoClassify,
    // 图标弹窗
    iconModalOpen,
    setIconModalOpen,
    iconModalModelId,
    setIconModalModelId,
    iconModalCurrentIcon,
    handleIconSelect,
    handleIconReset,
    // Logo
    logoUrlValue,
    setLogoUrlValue,
    logoProviderValue,
    setLogoProviderValue,
    // 删除渠道
    deletingChannel,
    setDeletingChannel,
    // 模板编辑器
    templateOpen,
    setTemplateOpen,
    templateJson,
    setTemplateJson,
    // 参数配置弹窗
    schemaModalOpen,
    setSchemaModalOpen,
    selectedModelId,
    selectedModelType,
    customSchema,
    setCustomSchema,
    handleSchemaSaved,
    handleOpenSchemaModal,
    // 手动添加模型
    addModelModalOpen,
    setAddModelModalOpen,
    handleAddModels,
    // 测试连接
    handleTest,
  } = useAiBrandState({ ...props, watchedApiKey, watchedFormValues });

  return (
    <>
      <DetailBreadcrumb
        onBack={onBack}
        detailName={existingRecord ? brandPreset.label : `配置 ${brandPreset.label}`}
      />
      <Card styles={{ body: { paddingTop: 8 } }}>
        {/* ─── 品牌头部 + 测试结果 ─── */}
        <BrandHeader
          brandPreset={brandPreset}
          isPreset={isPreset}
          brandColor={brandColor}
          logoUrlValue={logoUrlValue}
          logoProviderValue={logoProviderValue}
          BrandIconComponent={BrandIconComponent}
          saveStatus={saveStatus}
          existingRecord={existingRecord}
          onDelete={props.onDelete}
          deletingChannel={deletingChannel}
          setDeletingChannel={setDeletingChannel}
          onOpenTemplate={() => setTemplateOpen(true)}
          testResult={testResult}
          rawModelIds={rawModelIds}
          balanceDisplay={balanceDisplay}
          balanceCheckedAt={effectiveRecord?.balanceCheckedAt}
          onRefreshBalance={handleRefreshBalance}
          balanceRefreshing={balanceRefreshing}
        />

        {/* ─── 凭证表单 + 模型列表 ─── */}
        <CredentialsForm
          form={form}
          brandPreset={brandPreset}
          existingRecord={existingRecord}
          isPreset={isPreset}
          saveStatus={saveStatus}
          onSave={() => handleSaveRef.current(false)}
          onFormChange={handleFormChange}
          onLogoProviderChange={(value) => {
            setLogoUrlValue('');
            setLogoProviderValue(value);
          }}
        >
          <ModelListSection
            fetchedModels={fetchedModels}
            flatModelList={flatModelList}
            filteredAllModels={filteredAllModels}
            allModelTypes={allModelTypes}
            filterType={filterType}
            onFilterTypeChange={setFilterType}
            filterEnabled={filterEnabled}
            onFilterEnabledChange={setFilterEnabled}
            searchKeyword={searchKeyword}
            onSearchKeywordChange={setSearchKeyword}
            currentModelPage={currentModelPage}
            onCurrentModelPageChange={setCurrentModelPage}
            modelPageSize={modelPageSize}
            currentModels={currentModels}
            currentModelTotal={currentModelTotal}
            testing={testing}
            selectedModels={selectedModels}
            onToggleSelectModel={toggleSelectModel}
            onToggleSelectAll={toggleSelectAll}
            onToggleModel={toggleModel}
            onOpenClassifyModal={openClassifyModal}
            onOpenSchemaModal={handleOpenSchemaModal}
            onDeleteModel={handleDeleteModel}
            onBatchDeleteModels={handleBatchDeleteModels}
            onOpenIconModal={(modelId) => {
              setIconModalModelId(modelId);
              setIconModalOpen(true);
            }}
            onRefreshModels={handleTest}
            onOpenAddModel={() => setAddModelModalOpen(true)}
          />
        </CredentialsForm>

        {/* ─── 模型归类 Modal ─── */}
        <ClassifyModal
          open={classifyModalOpen}
          classifyModelIds={classifyModelIds}
          selectedClassifyType={selectedClassifyType}
          classifyTemplateId={classifyTemplateId}
          templateList={templateList}
          recommendedTemplate={recommendedTemplate}
          onClose={() => setClassifyModalOpen(false)}
          onSelectType={(type) => {
            setSelectedClassifyType(type);
            setClassifyTemplateId('');
          }}
          onSelectTemplate={setClassifyTemplateId}
          onConfirm={handleClassify}
          onAutoMatch={handleAutoClassify}
        />

        {/* ─── 模板管理 ─── */}
        <TemplateEditor
          open={templateOpen}
          onClose={() => { setTemplateOpen(false); setTemplateJson(''); }}
          onApply={(parsed) => {
            const fields: Record<string, any> = {};
            if (parsed.baseUrl) fields.baseUrl = parsed.baseUrl;
            if (parsed.apiFormat) fields.apiFormat = parsed.apiFormat;
            if (parsed.capabilities && Array.isArray(parsed.capabilities)) {
              const validTypes = ['llm', 'image', 'video', 'audio'];
              const valid = parsed.capabilities.filter((c: string) => validTypes.includes(c));
              if (valid.length > 0) fields.capabilities = valid;
            }
            form.setFieldsValue(fields);
            setTemplateJson('');

            const capMsg = parsed.capabilities?.length
              ? `，能力标签: ${parsed.capabilities.join(', ')}`
              : '';
            message.success(`模板已应用${capMsg}`);
          }}
          presetJson={templateJson}
          title="模板管理"
          exampleJson={{
            baseUrl: 'https://api.example.com/v1',
            apiFormat: 'openai',
            capabilities: ['llm', 'image'],
          }}
        />

        <AiBrandSchemaModal
          open={schemaModalOpen}
          onClose={() => setSchemaModalOpen(false)}
          onSaved={(config) => selectedModelId && handleSchemaSaved(selectedModelId, config)}
          existingRecordId={existingRecord?.id}
          selectedModelId={selectedModelId}
          modelType={selectedModelType}
          customSchema={customSchema}
          setCustomSchema={setCustomSchema}
        />

        {/* 模型图标选择弹窗 */}
        <IconSelectModal
          open={iconModalOpen}
          modelId={iconModalModelId}
          currentIcon={iconModalCurrentIcon}
          onClose={() => { setIconModalOpen(false); setIconModalModelId(null); }}
          onSelect={handleIconSelect}
          onReset={handleIconReset}
        />

        {/* 手动添加模型弹窗（服务商 /models 端点不可用时的兜底录入） */}
        <AddModelModal
          open={addModelModalOpen}
          onClose={() => setAddModelModalOpen(false)}
          onConfirm={handleAddModels}
        />
      </Card>
    </>
  );
}
