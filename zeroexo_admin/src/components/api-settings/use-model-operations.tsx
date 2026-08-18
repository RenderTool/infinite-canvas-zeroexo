/**
 * useModelOperations - AI 品牌详情页的模型操作子 Hook
 *
 * 从 useAiBrandState 中拆分出来的模型相关处理逻辑，包含：
 *   - 模型列表获取后的应用与差异比对（handleApplyModels）
 *   - 模型手动分类（handleClassify）
 *   - 自定义模型删除（handleDeleteModel）
 *   - 参数配置弹窗（handleOpenSchemaModal）
 *   - 模型图标选择（handleIconSelect / handleIconReset）
 *   - 归类弹窗 / 图标弹窗 / 参数弹窗的局部状态
 *
 * 该 Hook 不改变原 useAiBrandState 的运行时行为，仅做逻辑迁移。
 *
 * 注意：handleApplyModels 中 Modal.confirm 的 content 包含 JSX，因此使用 .tsx 扩展名。
 */
import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import { message, Modal, Tag } from 'antd';
import { apiGet, apiPost, apiDelete, showApiError } from '@/services/api-client';
import { useTranslation } from 'react-i18next';
import type { ParameterDef, PersistedParamConfig } from '@/components/ai-test/param-types';
import type { AiBrandDetailProps } from './ai-brand-types';
import { CONSTRAINT_FIELDS, MODEL_TYPE_LABELS } from './ai-brand-constants';

/** useModelOperations 入参：均由主 Hook useAiBrandState 传入 */
interface UseModelOperationsParams {
  /** i18n 翻译函数 */
  t: ReturnType<typeof useTranslation>['t'];
  /** 已存在的渠道记录（新建时为 undefined） */
  existingRecord: AiBrandDetailProps['existingRecord'];
  /** 当前已获取的模型列表（按类型分组） */
  fetchedModels: Record<string, string[]> | null;
  setFetchedModels: Dispatch<SetStateAction<Record<string, string[]> | null>>;
  /** 模型启用状态映射 */
  enabledModels: Record<string, boolean>;
  setEnabledModels: Dispatch<SetStateAction<Record<string, boolean>>>;
  /** 模型手动分类映射（key 为模型 ID 小写） */
  modelTypes: Record<string, string>;
  setModelTypes: Dispatch<SetStateAction<Record<string, string>>>;
  /** 模型图标配置映射（key 为模型 ID 小写） */
  modelIcons: Record<string, string>;
  setModelIcons: Dispatch<SetStateAction<Record<string, string>>>;
  /** 已保存的参数 Schema 映射（持久化保障） */
  savedSchemaMap: Record<string, PersistedParamConfig>;
  setSavedSchemaMap: Dispatch<SetStateAction<Record<string, PersistedParamConfig>>>;
  /** fetchedModels 的 ref，避免闭包过期 */
  fetchedModelsRef: MutableRefObject<Record<string, string[]> | null>;
  /** 批量选择模型（未分类 Tab 下） */
  setSelectedModels: Dispatch<SetStateAction<string[]>>;
  /** 原始模型 ID 列表 setter */
  setRawModelIds: Dispatch<SetStateAction<string[] | null>>;
}

/** useModelOperations 返回值 */
interface UseModelOperationsResult {
  // 分类弹窗
  classifyModalOpen: boolean;
  setClassifyModalOpen: Dispatch<SetStateAction<boolean>>;
  classifyModelIds: string[];
  selectedClassifyType: string;
  setSelectedClassifyType: Dispatch<SetStateAction<string>>;
  classifyTemplateId: string;
  setClassifyTemplateId: Dispatch<SetStateAction<string>>;
  templateList: any[];
  recommendedTemplate: any;
  openClassifyModal: (modelIds: string[]) => Promise<void>;
  handleClassify: () => Promise<void>;
  handleAutoClassify: () => Promise<void>;
  // 模型删除
  handleDeleteModel: (modelId: string) => Promise<void>;
  // 图标弹窗
  iconModalOpen: boolean;
  setIconModalOpen: Dispatch<SetStateAction<boolean>>;
  iconModalModelId: string | null;
  setIconModalModelId: Dispatch<SetStateAction<string | null>>;
  iconModalCurrentIcon: string;
  handleIconSelect: (key: string) => void;
  handleIconReset: () => void;
  // 参数配置弹窗
  schemaModalOpen: boolean;
  setSchemaModalOpen: Dispatch<SetStateAction<boolean>>;
  selectedModelId: string | null;
  selectedModelType: string;
  customSchema: ParameterDef[];
  setCustomSchema: Dispatch<SetStateAction<ParameterDef[]>>;
  handleSchemaSaved: (modelId: string, persistedConfig: PersistedParamConfig) => void;
  handleOpenSchemaModal: (modelId: string, modelType?: string) => void;
  // 模型应用
  handleApplyModels: (newModels: Record<string, string[]>, rawIds: string[] | null) => void;
}

/**
 * 模型操作子 Hook
 *
 * 接收主 Hook 的状态作为入参，返回模型相关的处理函数与弹窗状态。
 * 不持有任何需要被主 Hook 直接读写的模型列表/启用状态，这些均由主 Hook 管理。
 */
export function useModelOperations({
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
}: UseModelOperationsParams): UseModelOperationsResult {
  // 归类弹窗状态
  const [classifyModalOpen, setClassifyModalOpen] = useState(false);
  const [classifyModelIds, setClassifyModelIds] = useState<string[]>([]);
  const [selectedClassifyType, setSelectedClassifyType] = useState<string>('');
  const [classifyTemplateId, setClassifyTemplateId] = useState<string>('');
  const [templateList, setTemplateList] = useState<any[]>([]);
  const [recommendedTemplate, setRecommendedTemplate] = useState<any>(null);

  // 模型图标选择弹窗
  const [iconModalOpen, setIconModalOpen] = useState(false);
  const [iconModalModelId, setIconModalModelId] = useState<string | null>(null);

  // 参数配置弹窗
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedModelType, setSelectedModelType] = useState<string>('image');
  const [customSchema, setCustomSchema] = useState<ParameterDef[]>([]);

  // schema 保存成功回调 → 更新本地映射
  const handleSchemaSaved = (modelId: string, persistedConfig: PersistedParamConfig) => {
    setSavedSchemaMap((prev) => ({ ...prev, [modelId.toLowerCase()]: persistedConfig }));
  };

  /* ---------- 手动归类模型 ---------- */

  const openClassifyModal = async (modelIds: string[]) => {
    setClassifyModelIds(modelIds);
    setSelectedClassifyType('');
    setClassifyTemplateId('');
    setTemplateList([]);
    setRecommendedTemplate(null);
    setClassifyModalOpen(true);
  };

  // 当分类改变时，加载对应类型的模板
  useEffect(() => {
    if (!selectedClassifyType || !classifyModalOpen) return;

    const loadTemplates = async () => {
      try {
        const templates = await apiGet<any[]>(
          `/admin/api-providers/templates?type=${selectedClassifyType}`,
        );
        setTemplateList(templates || []);

        // 如果只有一个模型，尝试推荐模板
        if (classifyModelIds.length === 1) {
          const rec = await apiGet<any>(
            `/admin/api-providers/templates/recommend?modelId=${encodeURIComponent(classifyModelIds[0])}&type=${selectedClassifyType}`,
          );
          setRecommendedTemplate(rec);
          if (rec?.id) {
            setClassifyTemplateId(rec.id);
          }
        }
      } catch (err) {
        console.warn('加载模板列表失败', err);
      }
    };

    loadTemplates();
  }, [selectedClassifyType, classifyModalOpen]);

  const handleClassify = async () => {
    if (!selectedClassifyType || classifyModelIds.length === 0) return;
    if (!existingRecord?.id) {
      message.warning(t('ai.saveChannelFirst'));
      return;
    }

    try {
      const typesToUpdate: Record<string, string> = {};
      classifyModelIds.forEach((id) => {
        typesToUpdate[id] = selectedClassifyType;
      });

      const result = await apiPost<{ ok: boolean; message: string }>(
        `/admin/api-providers/${existingRecord.id}/model-types`,
        { modelTypes: typesToUpdate },
      );

      if (result.ok) {
        // 更新本地 modelTypes
        const newModelTypes = { ...modelTypes };
        classifyModelIds.forEach((id) => {
          newModelTypes[id.toLowerCase()] = selectedClassifyType;
        });
        setModelTypes(newModelTypes);

        // 更新 fetchedModels（移动模型到对应分类或移回未分类）
        if (fetchedModels) {
          const newModels = { ...fetchedModels };
          // 从所有分类中移除这些模型
          for (const type of Object.keys(newModels)) {
            newModels[type] = newModels[type].filter(
              (id) => !classifyModelIds.includes(id),
            );
          }
          // 添加到目标分类（含未分类）
          if (!newModels[selectedClassifyType]) {
            newModels[selectedClassifyType] = [];
          }
          newModels[selectedClassifyType].push(...classifyModelIds);
          setFetchedModels(newModels);
        }

        setSelectedModels([]);
        setClassifyModalOpen(false);
        message.success(
          selectedClassifyType === 'unclassified'
            ? t('ai.movedToUnclassified', { count: classifyModelIds.length })
            : t('ai.classifiedTo', { count: classifyModelIds.length, type: t(MODEL_TYPE_LABELS[selectedClassifyType]) }),
        );
        // ★ 由 useEffect([modelTypes, fetchedModels]) 自动保存
      } else {
        message.error(result.message || t('ai.classifyFailed'));
      }
    } catch (err) {
      showApiError(err, t('ai.classifyFailed'));
    }
  };

  /* ---------- 自动归类模型 ---------- */

  const handleAutoClassify = async () => {
    if (classifyModelIds.length === 0) return;
    if (!existingRecord?.id) {
      message.warning(t('ai.saveChannelFirst'));
      return;
    }

    try {
      const result = await apiPost<{ classifications: Record<string, string>; message: string }>(
        `/admin/api-providers/${existingRecord.id}/auto-classify`,
        { modelIds: classifyModelIds },
      );

      if (result.classifications) {
        // 更新本地 modelTypes
        const newModelTypes = { ...modelTypes };
        for (const [modelId, type] of Object.entries(result.classifications)) {
          if (type !== 'unclassified') {
            newModelTypes[modelId.toLowerCase()] = type;
          }
        }
        setModelTypes(newModelTypes);

        // 更新 fetchedModels
        if (fetchedModels) {
          const newModels = { ...fetchedModels };
          // 从所有分类中移除这些模型
          for (const type of Object.keys(newModels)) {
            newModels[type] = newModels[type].filter(
              (id) => !classifyModelIds.includes(id),
            );
          }
          // 按自动匹配结果重新分配
          for (const [modelId, type] of Object.entries(result.classifications)) {
            const targetType = type !== 'unclassified' ? type : 'unclassified';
            if (!newModels[targetType]) {
              newModels[targetType] = [];
            }
            newModels[targetType].push(modelId);
          }
          setFetchedModels(newModels);
        }

        setSelectedModels([]);
        setClassifyModalOpen(false);
        message.success(result.message || t('ai.autoClassifySuccess'));
      }
    } catch (err) {
      showApiError(err, t('ai.autoClassifyFailed'));
    }
  };

  /* ---------- 删除自定义模型 ---------- */

  const handleDeleteModel = async (modelId: string) => {
    if (!existingRecord?.id) return;
    try {
      const result = await apiDelete<{ ok: boolean; message: string }>(
        `/admin/api-providers/${existingRecord.id}/custom-models/${encodeURIComponent(modelId)}`,
      );
      if (result.ok) {
        // 从 fetchedModels 中移除
        if (fetchedModels) {
          const newModels = { ...fetchedModels };
          for (const type of Object.keys(newModels)) {
            newModels[type] = newModels[type].filter((id) => id !== modelId);
          }
          setFetchedModels(newModels);
        }
        // 移除启用状态、类型、图标
        setEnabledModels((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
        setModelTypes((prev) => {
          const next = { ...prev };
          delete next[modelId.toLowerCase()];
          return next;
        });
        setModelIcons((prev) => {
          const next = { ...prev };
          delete next[modelId.toLowerCase()];
          return next;
        });
        message.success(t('ai.modelDeleted'));
      } else {
        message.error(result.message || t('ai.deleteFailed'));
      }
    } catch (err) {
      showApiError(err, t('ai.deleteFailed'));
    }
  };

  /** 应用模型列表：已有模型保留原启用状态，新增模型默认关闭 */
  const applyFetchedModels = (models: Record<string, string[]>) => {
    setFetchedModels(models);
    // 保留已有的启用状态，只对新出现的模型设为禁用
    setEnabledModels((prev) => {
      const next = { ...prev };
      for (const [, ids] of Object.entries(models)) {
        ids.forEach((id) => {
          if (!(id in next)) {
            next[id] = false;
          }
        });
      }
      return next;
    });
    const totalCount = Object.values(models).flat().length;
    const prevCount = Object.keys(models).reduce(
      (sum, key) => sum + models[key].filter((id) => id in (enabledModels ?? {})).length,
      0,
    );
    message.info(t('ai.modelsFetched', { total: totalCount, newCount: totalCount - prevCount }));
  };

  /** 获取列表后比对缓存，一致则跳过，不一致则弹窗提示用户确认 */
  const handleApplyModels = (newModels: Record<string, string[]>, rawIds: string[] | null) => {
    const currentFetched = fetchedModelsRef.current;

    // ★ 扁平化新旧模型 ID 集合用于比对
    const currentIds = new Set(
      Object.values(currentFetched || {}).flat().map((id) => id.toLowerCase()),
    );
    const newIds = new Set(
      Object.values(newModels).flat().map((id) => id.toLowerCase()),
    );

    const isSame =
      currentIds.size === newIds.size &&
      [...currentIds].every((id) => newIds.has(id));

    if (isSame && currentFetched !== null) {
      // ★ 完全一致 → 不触发任何 state 变更，不触发自动保存
      setRawModelIds(rawIds);
      message.success(t('ai.modelsNoChange'));
      return;
    }

    // ★ 不一致 → 计算差异
    const added = [...newIds].filter((id) => !currentIds.has(id));
    const removed = [...currentIds].filter((id) => !newIds.has(id));

    Modal.confirm({
        title: t('ai.modelsUpdated'),
        centered: true,
        content: (
          <div>
            <div style={{ marginBottom: 8 }}>
              {t('ai.modelsDiffTitle')}：
              {added.length > 0 && <Tag color="green" style={{ marginLeft: 6 }}>{t('ai.added', { count: added.length })}</Tag>}
              {removed.length > 0 && <Tag color="red" style={{ marginLeft: 6 }}>{t('ai.removed', { count: removed.length })}</Tag>}
            </div>
            {added.length > 0 && (
              <div style={{ fontSize: 12, color: '#52c41a', marginBottom: 4 }}>
                <span style={{ color: '#52c41a' }}>▲</span> {t('ai.added')}：{added.slice(0, 6).join(', ')}{added.length > 6 ? ` ${t('ai.etc', { count: added.length })}` : ''}
              </div>
            )}
            {removed.length > 0 && (
              <div style={{ fontSize: 12, color: '#ff4d4f' }}>
                <span style={{ color: '#ff4d4f' }}>▼</span> {t('ai.removed')}：{removed.slice(0, 6).join(', ')}{removed.length > 6 ? ` ${t('ai.etc', { count: removed.length })}` : ''}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 8 }}>
              {t('ai.modelsUpdateConfirm')}
            </div>
          </div>
        ),
        okText: t('ai.confirmUpdate'),
        cancelText: t('ai.keepCurrent'),
      onOk: () => {
        applyFetchedModels(newModels);
        setRawModelIds(rawIds);
        message.success(t('ai.modelsUpdatedSuccess'));
      },
    });
  };

  /* ---------- 参数配置弹窗 ---------- */

  const handleOpenSchemaModal = (modelId: string, modelType?: string) => {
    setSelectedModelId(modelId);
    setSelectedModelType(modelType || 'image');
    // ★ 优先从本地同步的 savedSchemaMap 读取（包含最新保存状态）
    const savedFromMap = savedSchemaMap[modelId.toLowerCase()];
    if (savedFromMap) {
      // PersistedParamConfig 格式 —— 过滤掉约束字段
      setCustomSchema((savedFromMap.parameters ?? []).filter((p) => !CONSTRAINT_FIELDS.has(p.name)));
    } else {
      // ★ 降级从 existingRecord 读取（初始加载数据/旧格式兼容）
      const existingSchemas = existingRecord?.config?.modelSchemas as Record<string, any> | undefined;
      const saved = existingSchemas?.[modelId.toLowerCase()];
      if (saved) {
        let params: ParameterDef[] = [];
        if (Array.isArray(saved)) {
          // 旧格式：ParamField[] → 格式不兼容，清空让用户重新选择模板
          params = [];
        } else if (saved.parameters && Array.isArray(saved.parameters)) {
          // PersistedParamConfig 格式 — 过滤掉约束字段
          params = saved.parameters.filter((p: ParameterDef) => !CONSTRAINT_FIELDS.has(p.name));
        } else if (saved.schema && Array.isArray(saved.schema)) {
          // 旧格式 { schema, capability } → 格式不兼容，清空
          params = [];
        }
        setCustomSchema(params);
      } else {
        setCustomSchema([]);
      }
    }
    setSchemaModalOpen(true);
  };

  /* ---------- 图标选择弹窗回调 ---------- */

  const handleIconSelect = (key: string) => {
    if (!iconModalModelId) return;
    if (key === 'default') {
      // 选择 default 等同于恢复默认
      setModelIcons((prev) => {
        const next = { ...prev };
        delete next[iconModalModelId.toLowerCase()];
        return next;
      });
    } else {
      setModelIcons((prev) => ({
        ...prev,
        [iconModalModelId.toLowerCase()]: key,
      }));
    }
    setIconModalOpen(false);
    setIconModalModelId(null);
  };

  const handleIconReset = () => {
    if (iconModalModelId) {
      setModelIcons((prev) => {
        const next = { ...prev };
        delete next[iconModalModelId.toLowerCase()];
        return next;
      });
    }
    setIconModalOpen(false);
    setIconModalModelId(null);
  };

  const iconModalCurrentIcon = iconModalModelId
    ? (modelIcons[iconModalModelId.toLowerCase()] || '')
    : '';

  return {
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
    // 模型删除
    handleDeleteModel,
    // 图标弹窗
    iconModalOpen,
    setIconModalOpen,
    iconModalModelId,
    setIconModalModelId,
    iconModalCurrentIcon,
    handleIconSelect,
    handleIconReset,
    // 参数配置弹窗
    schemaModalOpen,
    setSchemaModalOpen,
    selectedModelId,
    selectedModelType,
    customSchema,
    setCustomSchema,
    handleSchemaSaved,
    handleOpenSchemaModal,
    // 模型应用
    handleApplyModels,
  };
}
