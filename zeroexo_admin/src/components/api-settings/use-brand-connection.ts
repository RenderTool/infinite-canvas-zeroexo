/**
 * useBrandConnection - AI 品牌详情页的连接与保存子 Hook
 *
 * 从 useAiBrandState 中拆分出来的连接测试与保存逻辑，包含：
 *   - 测试连接（handleTest）
 *   - 保存品牌配置（handleSave）
 *   - 自动保存（防抖 + 表单/模型状态监听）
 *   - 返回拦截（handleBack，有未保存内容时提示是否保存）
 *   - 测试状态、保存状态、savedProviderId 等状态
 *
 * 该 Hook 不改变原 useAiBrandState 的运行时行为，仅做逻辑迁移。
 *
 * 注意：本文件无 JSX，handleBack 的 Modal.confirm content 为纯文本，故使用 .ts 扩展名。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import { message, Modal } from 'antd';
import type { FormInstance } from 'antd';
import { apiPost, apiPatch, showApiError } from '@/services/api-client';
import { useTranslation } from 'react-i18next';
import type { PersistedParamConfig } from '@/components/ai-test/param-types';
import type { AiBrandDetailProps } from './ai-brand-types';
import { debounce } from './ai-brand-utils';

/** useBrandConnection 入参：均由主 Hook useAiBrandState 传入 */
interface UseBrandConnectionParams {
  /** i18n 翻译函数 */
  t: ReturnType<typeof useTranslation>['t'];
  /** antd 表单实例 */
  form: FormInstance;
  /** 已存在的渠道记录（新建时为 undefined） */
  existingRecord: AiBrandDetailProps['existingRecord'];
  /** 品牌预设配置 */
  brandPreset: AiBrandDetailProps['brandPreset'];
  /** 是否为预设品牌（决定 capabilities 是否可编辑） */
  isPreset: boolean;
  /** 保存成功后通知父组件刷新列表 */
  onSave?: () => void;
  /** 父组件传入的返回回调（未保存时会被拦截） */
  onBack: () => void;
  /** 初始化完成标记 ref（防止初始加载触发自动保存） */
  initializedRef: MutableRefObject<boolean>;
  // ---- 模型状态（来自主 Hook） ----
  enabledModels: Record<string, boolean>;
  setEnabledModels: Dispatch<SetStateAction<Record<string, boolean>>>;
  modelTypes: Record<string, string>;
  modelIcons: Record<string, string>;
  fetchedModels: Record<string, string[]> | null;
  setFetchedModels: Dispatch<SetStateAction<Record<string, string[]> | null>>;
  /** fetchedModels 的 ref，避免闭包过期 */
  fetchedModelsRef: MutableRefObject<Record<string, string[]> | null>;
  /** 已保存的参数 Schema 映射（保存时写入 config） */
  savedSchemaMap: Record<string, PersistedParamConfig>;
  /** 已保存的 provider ID（新建后记录，后续保存走 PATCH） */
  savedProviderId: string | null;
  setSavedProviderId: Dispatch<SetStateAction<string | null>>;
  /** 原始模型 ID 列表 setter（清空模型列表时联动重置） */
  setRawModelIds: Dispatch<SetStateAction<string[] | null>>;
  // ---- 来自 useModelOperations ----
  /** 应用获取到的模型列表（测试连接成功后调用） */
  handleApplyModels: (newModels: Record<string, string[]>, rawIds: string[] | null) => void;
  // ---- 表单值（由 CredentialsForm onValuesChange 提供，替代 Form.useWatch） ----
  /** 当前 apiKey 字段值 */
  watchedApiKey?: string;
  /** 当前所有表单字段值 */
  watchedFormValues?: any;
}

/** useBrandConnection 返回值 */
interface UseBrandConnectionResult {
  // 返回 / 保存
  onBack: () => void;
  saveStatus: 'saved' | 'saving' | 'dirty';
  handleSaveRef: MutableRefObject<(silent?: boolean) => Promise<void>>;
  // 测试
  testing: boolean;
  testResult: { ok: boolean; message: string } | null;
  handleTest: () => Promise<void>;
}

/**
 * 连接与保存子 Hook
 *
 * 接收主 Hook 的状态与 useModelOperations 的 handleApplyModels，
 * 返回测试、保存、返回拦截等处理函数及对应状态。
 */
export function useBrandConnection({
  t,
  form,
  existingRecord,
  brandPreset,
  isPreset,
  onSave,
  onBack: _onBack,
  initializedRef,
  enabledModels,
  setEnabledModels,
  modelTypes,
  modelIcons,
  fetchedModels,
  setFetchedModels,
  fetchedModelsRef,
  savedSchemaMap,
  savedProviderId,
  setSavedProviderId,
  setRawModelIds,
  handleApplyModels,
  watchedApiKey,
  watchedFormValues,
}: UseBrandConnectionParams): UseBrandConnectionResult {
  // 测试状态
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 保存状态
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');

  // ★ 使用 ref 保持最新模型状态，避免 handleSave 闭包过期
  const enabledModelsRef = useRef(enabledModels);
  enabledModelsRef.current = enabledModels;
  const modelTypesRef = useRef(modelTypes);
  modelTypesRef.current = modelTypes;
  const modelIconsRef = useRef(modelIcons);
  modelIconsRef.current = modelIcons;
  const savedProviderIdRef = useRef(savedProviderId);
  savedProviderIdRef.current = savedProviderId;

  // ★ saveStatus ref（供 beforeunload 等场景使用）
  const saveStatusRef = useRef(saveStatus);
  saveStatusRef.current = saveStatus;

  // 最新测试过的 API Key（用于避免重复测试）
  const lastTestedKeyRef = useRef<string>('');

  /** 清空模型列表（获取失败时） */
  const clearModels = useCallback(() => {
    setFetchedModels(null);
    setEnabledModels({});
    setTestResult(null);
    setRawModelIds(null);
    // 不清空 API Key，让用户可重试或修改
    lastTestedKeyRef.current = '';
  }, [form]);

  /* ---------- 测试连接 ---------- */

  const handleTest = async () => {
    try {
      const values = await form.validateFields(['apiKey', 'baseUrl']);
      setTesting(true);
      setTestResult(null);

      const apiKey =
        values.apiKey && String(values.apiKey) !== '已配置 (加密存储)'
          ? values.apiKey
          : undefined;

      // ★ 统一调用方式
      let result: { ok: boolean; message: string; models: Record<string, string[]> };

      if (!apiKey) {
        if (!existingRecord?.id) {
          message.warning(t('ai.enterApiKey'));
          return;
        }
        result = await apiPost<{ ok: boolean; message: string; models: Record<string, string[]> }>(
          `/admin/api-providers/${existingRecord.id}/fetch-models`,
          {
            config: {
              baseUrl: values.baseUrl || brandPreset.defaultBaseUrl,
              apiFormat: values.apiFormat || brandPreset.apiFormat,
            },
          },
        );
      } else {
        result = await apiPost<{ ok: boolean; message: string; models: Record<string, string[]> }>(
          '/admin/api-providers/test-connectivity',
          {
            provider: brandPreset.provider,
            config: {
              baseUrl: values.baseUrl || brandPreset.defaultBaseUrl,
              apiFormat: values.apiFormat || brandPreset.apiFormat,
            },
            credentials: { apiKey },
          },
        );
      }

      setTestResult({ ok: result.ok, message: result.message });
      if (result.ok && result.models) {
        handleApplyModels(result.models, (result as any).rawModelIds ?? null);
      } else {
        clearModels();
      }
    } catch (err) {
      showApiError(err, t('ai.testFailed'));
      clearModels();
    } finally {
      setTesting(false);
    }
  };

  /* ---------- 保存 ---------- */

  const handleSave = async (silent = false) => {
    try {
      const values = form.getFieldsValue();

      // ★ 从 ref 读取最新模型状态，避免闭包过期
      const currentEnabledModels = enabledModelsRef.current;
      const currentModelTypes = modelTypesRef.current;
      const currentModelIcons = modelIconsRef.current;
      const currentFetchedModels = fetchedModelsRef.current;
      const currentSavedProviderId = savedProviderIdRef.current;

      // 新建渠道时若未填 API Key 仅给提示，不阻断保存
      const apiKey =
        values.apiKey && String(values.apiKey) !== '已配置 (加密存储)'
          ? values.apiKey
          : undefined;
      if (!apiKey && !currentSavedProviderId && !silent) {
        message.warning('未设置 API Key，渠道暂不可用');
      }

      const config: Record<string, any> = {
        baseUrl: values.baseUrl || brandPreset.defaultBaseUrl,
        apiFormat: values.apiFormat || brandPreset.apiFormat,
      };
      const logoProvider = values.logoProvider;
      if (logoProvider) {
        config.logoProvider = logoProvider;
      }
      if (values.logoUrl) {
        config.logoUrl = values.logoUrl;
      }

      // ★ 保留已保存的 modelSchemas（从本地映射读取，防止自动保存覆盖）
      if (Object.keys(savedSchemaMap).length > 0) {
        config.modelSchemas = savedSchemaMap as any;
      }

      // 缓存模型列表，避免下次打开页面重新测试
      if (currentFetchedModels) {
        config.fetchedModels = currentFetchedModels;
      }

      // 已启用的模型 ID 列表（始终保存，即使为空）
      const enabledList = Object.entries(currentEnabledModels)
        .filter(([, enabled]) => enabled)
        .map(([id]) => id);
      config.enabledModels = enabledList;

      // 模型类型分类配置
      if (Object.keys(currentModelTypes).length > 0) {
        config.modelTypes = currentModelTypes;
      }

      // 模型图标配置
      if (Object.keys(currentModelIcons).length > 0) {
        config.modelIcons = currentModelIcons;
      }

      const capabilities = !isPreset
        ? (values.capabilities || [])
        : (brandPreset.capabilities || []).filter((t: string) =>
            ['llm', 'image', 'video', 'audio'].includes(t)
          );

      // ★ 也写入 config，作为恢复时的备用数据源
      config.capabilities = capabilities;

      const dto: Record<string, any> = {
        name: values.name || existingRecord?.name || brandPreset.label,
        provider: brandPreset.provider,
        type: 'ai',
        config,
        enabled: existingRecord?.enabled ?? true,
        isDefault: existingRecord?.isDefault ?? false,
        capabilities,
      };
      if (apiKey) {
        dto.credentials = { apiKey };
      }

      if (currentSavedProviderId) {
        await apiPatch(`/admin/api-providers/${currentSavedProviderId}`, dto);
        if (!silent) message.success('已更新');
      } else {
        const result = await apiPost<{ id: string }>('/admin/api-providers', dto);
        setSavedProviderId(result.id);
        if (!silent) message.success('已创建');
      }
      // 自动保存模式下刷新父组件列表
      if (!silent) {
        onSave?.();
      }
    } catch (err) {
      if (!silent) showApiError(err, '保存失败');
    }
  };

  // ★ 使用 ref 存储最新 handleSave，避免 debounce 闭包过期
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const debouncedSave = useMemo(
    () =>
      debounce(async () => {
        setSaveStatus('saving');
        try {
          await handleSaveRef.current(true);
          setSaveStatus('saved');
        } catch {
          setSaveStatus('dirty');
        }
      }, 800),
    [], // ★ 稳定引用，永不重建
  );

  /* ---- 自动触发：当用户填写 API Key 时自动获取模型列表 ---- */

  useEffect(() => {
    if (testing) return; // 正在测试中，跳过
    const key = watchedApiKey as string | undefined;
    if (
      key &&
      String(key) !== '已配置 (加密存储)' &&
      String(key) !== lastTestedKeyRef.current
    ) {
      const timer = setTimeout(() => {
        lastTestedKeyRef.current = String(key);
        handleTest();
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [watchedApiKey]);

  /* ---- 自动保存：监听表单字段变化，延迟保存 ---- */

  useEffect(() => {
    // ★ 初始化完成前不触发自动保存
    if (!initializedRef.current) return;
    if (testing) return;
    setSaveStatus('dirty');
    debouncedSave();
  }, [watchedFormValues]);

  // ★ 合并模型状态变更的自动保存 effect，避免多次独立保存
  useEffect(() => {
    if (!initializedRef.current) return;
    debouncedSave();
  }, [enabledModels, modelTypes, modelIcons, fetchedModels, savedSchemaMap]);

  // ★ 页面关闭/刷新前提示未保存内容
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveStatusRef.current === 'dirty') {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // ★ 拦截返回操作，有未保存内容时提示是否保存
  const handleBack = () => {
    if (saveStatus === 'dirty') {
      Modal.confirm({
        title: t('ai.unsavedChanges'),
        centered: true,
        content: t('ai.saveBeforeLeave'),
        okText: t('ai.saveFirst'),
        cancelText: t('ai.dontSave'),
        onOk: async () => {
          // 保存后返回
          await handleSaveRef.current(false);
        },
        onCancel: () => {
          _onBack();
        },
      });
    } else {
      _onBack();
    }
  };
  const onBack = handleBack;

  return {
    // 返回 / 保存
    onBack,
    saveStatus,
    handleSaveRef,
    // 测试
    testing,
    testResult,
    handleTest,
  };
}
