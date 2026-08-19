/**
 * useAiBrandState - AI 品牌详情页的状态管理 Hook
 *
 * 将 AiBrandDetail 主组件中的所有状态、副作用、回调函数聚合到此 Hook，
 * 主组件仅负责 JSX 组合，便于拆分与维护。
 *
 * 该 Hook 不改变原 AiBrandDetail 的运行时行为，仅做逻辑迁移。
 *
 * 为进一步降低单文件复杂度，处理逻辑已按职责拆分为两个子 Hook：
 *   - useModelOperations  模型获取/分类/删除/图标/参数弹窗
 *   - useBrandConnection  测试连接/保存/自动保存/返回拦截
 * 本文件仅保留核心状态声明、派生 Memo 与初始化/消费副作用，并编排子 Hook。
 *
 * 注意：本文件本身不再包含 JSX，但保留 .tsx 扩展名以避免改动引用方导入路径。
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Form } from 'antd';
import { useTranslation } from 'react-i18next';
import { BRAND_ICONS, DefaultBrandIcon } from './brand-icons';
import type { PersistedParamConfig } from '@/components/ai-test/param-types';
import type { ModelEntry, AiBrandDetailProps } from './ai-brand-types';
import { useModelOperations } from './use-model-operations';
import { useBrandConnection } from './use-brand-connection';

/**
 * Hook 入参与 AiBrandDetailProps 一致
 */
export function useAiBrandState({
  brandPreset,
  existingRecord,
  logoUrl: propLogoUrl,
  onBack: _onBack,
  onSave,
  watchedApiKey,
  watchedFormValues,
}: AiBrandDetailProps & { watchedApiKey?: string; watchedFormValues?: any }) {
  const { t } = useTranslation();
  const [form] = Form.useForm();

  // ★ 初始化完成标记：防止初始加载时自动触发保存
  const initializedRef = useRef(false);

  // 原始模型 ID 列表（由 useModelOperations / useBrandConnection 通过 setter 写入）
  const [rawModelIds, setRawModelIds] = useState<string[] | null>(null);
  // 跟踪已保存的 provider ID（新建后记录，后续保存走 PATCH）
  const [savedProviderId, setSavedProviderId] = useState<string | null>(existingRecord?.id || null);

  // 模型列表
  const [fetchedModels, setFetchedModels] = useState<Record<string, string[]> | null>(null);
  const [enabledModels, setEnabledModels] = useState<Record<string, boolean>>({});
  // 模型列表搜索与分页
  const [searchKeyword, setSearchKeyword] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterEnabled, setFilterEnabled] = useState<string>('all');
  const [currentModelPage, setCurrentModelPage] = useState(1);
  const modelPageSize = 15;

  // ★ 累计保存的 modelSchemas（持久化保障：本地同步 + handleSave 引用）
  const [savedSchemaMap, setSavedSchemaMap] = useState<Record<string, PersistedParamConfig>>({});

  // 模型手动分类（用户自定义归类）
  const [modelTypes, setModelTypes] = useState<Record<string, string>>({});
  // 模型图标配置（key: modelId, value: iconProvider）
  const [modelIcons, setModelIcons] = useState<Record<string, string>>({});
  // 批量选择模型（未分类 Tab 下）
  const [selectedModels, setSelectedModels] = useState<string[]>([]);

  // 模板导入
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateJson, setTemplateJson] = useState('');

  const isPreset = brandPreset.provider in BRAND_ICONS;
  const initLogoUrl = existingRecord?.config?.logoUrl || propLogoUrl || '';
  const initLogoProvider = existingRecord?.config?.logoProvider || '';
  const [logoUrlValue, setLogoUrlValue] = useState(initLogoUrl);
  const [logoProviderValue, setLogoProviderValue] = useState(initLogoProvider);
  const [deletingChannel, setDeletingChannel] = useState(false);
  const brandColor = brandPreset.color || '#1890ff';
  const BrandIconComponent = BRAND_ICONS[brandPreset.provider] || DefaultBrandIcon;

  // 初始化 savedSchemaMap
  useEffect(() => {
    if (existingRecord?.config?.modelSchemas) {
      setSavedSchemaMap(existingRecord.config.modelSchemas as Record<string, PersistedParamConfig>);
    }
  }, [existingRecord]);

  // 从 fetchedModels 构建打平的模型列表（带类型、图标、启用状态）
  const flatModelList: ModelEntry[] = useMemo(() => {
    if (!fetchedModels) return [];
    const result: ModelEntry[] = [];
    for (const [type, ids] of Object.entries(fetchedModels)) {
      for (const id of ids) {
        const icon = modelIcons[id.toLowerCase()] || brandPreset.provider;
        // 优先使用用户自定义分类，其次使用 fetchedModels 中的类型
        const userType = modelTypes[id.toLowerCase()];
        const displayType = userType || type;
        result.push({
          id,
          name: id,
          icon,
          type: displayType,
          enabled: enabledModels[id] !== false,
        });
      }
    }
    return result;
  }, [fetchedModels, modelIcons, enabledModels, modelTypes, brandPreset.provider]);

  // 全部类型（用于筛选器）
  const allModelTypes = useMemo(() => {
    if (!fetchedModels) return [];
    return Object.keys(fetchedModels).filter((t) => fetchedModels[t].length > 0);
  }, [fetchedModels]);

  // 经过筛选的模型列表
  const filteredAllModels: ModelEntry[] = useMemo(() => {
    let result = flatModelList;

    // 类型筛选
    if (filterType !== 'all') {
      result = result.filter((m) => m.type === filterType);
    }

    // 启用状态筛选
    if (filterEnabled === 'enabled') {
      result = result.filter((m) => m.enabled);
    } else if (filterEnabled === 'disabled') {
      result = result.filter((m) => !m.enabled);
    }

    // 关键词搜索
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase();
      result = result.filter(
        (m) =>
          m.id.toLowerCase().includes(kw) ||
          m.name.toLowerCase().includes(kw),
      );
    }

    return result;
  }, [flatModelList, filterType, filterEnabled, searchKeyword]);

  // 当前模型总数（搜索/筛选后）
  const currentModelTotal = useMemo(() => {
    return filteredAllModels.length;
  }, [filteredAllModels]);

  // 当前分页的模型列表
  const currentModels: ModelEntry[] = useMemo(() => {
    const start = (currentModelPage - 1) * modelPageSize;
    return filteredAllModels.slice(start, start + modelPageSize);
  }, [filteredAllModels, currentModelPage]);

  // 筛选条件变化时重置分页
  useEffect(() => {
    setCurrentModelPage(1);
  }, [filterType, filterEnabled, searchKeyword]);

  // 初始加载：恢复已缓存的模型列表 + enabledModels + modelTypes
  useEffect(() => {
    if (existingRecord?.config?.fetchedModels) {
      const cached = existingRecord.config.fetchedModels as Record<string, string[]>;
      setFetchedModels(cached);

      // 如果有已保存的 enabledModels 列表，只启用列表中的模型；否则全部默认启用
      const savedList = existingRecord.config.enabledModels as string[] | undefined;
      const savedSet = savedList ? new Set(savedList) : null;

      const enabledMap: Record<string, boolean> = {};
      for (const [, ids] of Object.entries(cached)) {
        ids.forEach((id) => {
          enabledMap[id] = savedSet ? savedSet.has(id) : true;
        });
      }
      setEnabledModels(enabledMap);

      // 恢复用户手动分类
      const savedTypes = existingRecord.config.modelTypes as Record<string, string> | undefined;
      if (savedTypes) {
        setModelTypes(savedTypes);
      }

      // 恢复模型图标配置
      const savedIcons = existingRecord.config.modelIcons as Record<string, string> | undefined;
      if (savedIcons) {
        setModelIcons(savedIcons);
      }
    }

    // ★ 标记初始化完成（所有状态恢复完毕）
    // 使用 requestAnimationFrame 确保本轮 React 批量更新完成后再标记
    requestAnimationFrame(() => {
      initializedRef.current = true;
    });
  }, [existingRecord]);

  /* ---------- 切换模型启用状态 ---------- */

  const toggleModel = useCallback((modelId: string) => {
    setEnabledModels((prev) => ({
      ...prev,
      [modelId]: !prev[modelId],
    }));
  }, []);

  /* ---------- 批量选择（未分类 Tab） ---------- */

  const toggleSelectModel = (modelId: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId],
    );
  };

  const toggleSelectAll = () => {
    if (selectedModels.length === filteredAllModels.length) {
      setSelectedModels([]);
    } else {
      setSelectedModels(filteredAllModels.map((m) => m.id));
    }
  };

  // ★ fetchedModels 的 ref，避免 handleApplyModels / handleSave 闭包过期
  const fetchedModelsRef = useRef(fetchedModels);
  fetchedModelsRef.current = fetchedModels;

  /* ---------- 模型操作子 Hook（获取/分类/删除/图标/参数弹窗） ---------- */

  const modelOperations = useModelOperations({
    t,
    existingRecord,
    fetchedModels,
    setFetchedModels,
    enabledModels,
    setEnabledModels,
    modelTypes,
    setModelTypes,
    modelIcons,
    setModelIcons,
    savedSchemaMap,
    setSavedSchemaMap,
    fetchedModelsRef,
    setSelectedModels,
    setRawModelIds,
  });

  /* ---------- 连接与保存子 Hook（测试/保存/自动保存/返回拦截） ---------- */

  const brandConnection = useBrandConnection({
    t,
    form,
    existingRecord,
    brandPreset,
    isPreset,
    onSave,
    onBack: _onBack,
    initializedRef,
    enabledModels,
    modelTypes,
    modelIcons,
    fetchedModels,
    fetchedModelsRef,
    savedSchemaMap,
    savedProviderId,
    setSavedProviderId,
    handleApplyModels: modelOperations.handleApplyModels,
    watchedApiKey,
    watchedFormValues,
  });

  return {
    // 翻译 & 表单
    t,
    form,
    // 标识 / 派生
    isPreset,
    brandColor,
    BrandIconComponent,
    // 返回 / 保存
    onBack: brandConnection.onBack,
    saveStatus: brandConnection.saveStatus,
    handleSaveRef: brandConnection.handleSaveRef,
    // 测试
    testing: brandConnection.testing,
    testResult: brandConnection.testResult,
    rawModelIds,
    handleTest: brandConnection.handleTest,
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
    // 模型删除
    handleDeleteModel: modelOperations.handleDeleteModel,
    handleBatchDeleteModels: modelOperations.handleBatchDeleteModels,
    // 分类弹窗
    classifyModalOpen: modelOperations.classifyModalOpen,
    setClassifyModalOpen: modelOperations.setClassifyModalOpen,
    classifyModelIds: modelOperations.classifyModelIds,
    selectedClassifyType: modelOperations.selectedClassifyType,
    setSelectedClassifyType: modelOperations.setSelectedClassifyType,
    classifyTemplateId: modelOperations.classifyTemplateId,
    setClassifyTemplateId: modelOperations.setClassifyTemplateId,
    templateList: modelOperations.templateList,
    recommendedTemplate: modelOperations.recommendedTemplate,
    openClassifyModal: modelOperations.openClassifyModal,
    handleClassify: modelOperations.handleClassify,
    handleAutoClassify: modelOperations.handleAutoClassify,
    // 图标弹窗
    iconModalOpen: modelOperations.iconModalOpen,
    setIconModalOpen: modelOperations.setIconModalOpen,
    iconModalModelId: modelOperations.iconModalModelId,
    setIconModalModelId: modelOperations.setIconModalModelId,
    iconModalCurrentIcon: modelOperations.iconModalCurrentIcon,
    handleIconSelect: modelOperations.handleIconSelect,
    handleIconReset: modelOperations.handleIconReset,
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
    schemaModalOpen: modelOperations.schemaModalOpen,
    setSchemaModalOpen: modelOperations.setSchemaModalOpen,
    selectedModelId: modelOperations.selectedModelId,
    selectedModelType: modelOperations.selectedModelType,
    customSchema: modelOperations.customSchema,
    setCustomSchema: modelOperations.setCustomSchema,
    handleSchemaSaved: modelOperations.handleSchemaSaved,
    handleOpenSchemaModal: modelOperations.handleOpenSchemaModal,
    // 手动添加模型
    addModelModalOpen: modelOperations.addModelModalOpen,
    setAddModelModalOpen: modelOperations.setAddModelModalOpen,
    handleAddModels: modelOperations.handleAddModels,
    // savedProviderId（供主组件判断是否已创建）
    savedProviderId,
  };
}
