/**
 * AiBrandSchemaModal — 模型参数配置弹窗
 *
 * 功能变更（2026-07）：
 *   1. 移除自动匹配模板 → 改为手动"自动匹配"按钮
 *   2. 新增"模板"按钮，打开 TemplateEditor 编辑参数模板
 *   3. 自定义模板支持持久化（localStorage）和删除
 *   4. 官方模板只读不可删除
 *
 * 功能变更（2026-08，模板库统一）：
 *   - 导入入口统一为 ImportTemplateModal（与模板库卡片同一套导入 UI/示例/错误展示）
 *   - 导入成功后回填参数并刷新「预设模板」（模板库内置 + 用户导入）
 *   - 旧版 localStorage 模板一次性迁移到模板库（sessionStorage 标记，避免重复）
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, Button, Select, message, Space, Alert, Tooltip } from 'antd';
import { Trash2, FileText } from 'lucide-react';
import { apiGet, apiPost, apiDelete, showApiError } from '@/services/api-client';
import type { ParameterDef, ChannelConstraints } from '../ai-test/param-types';
import type { PersistedParamConfig } from '../ai-test/param-types';
import ParamForm from '../ai-test/ParamForm';
import { createSchemaRegistry } from '../ai-test/registry-factory';
import ImportTemplateModal from './ImportTemplateModal';

interface AiBrandSchemaModalProps {
  open: boolean;
  onClose: () => void;
  /** 保存成功回调，返回完整的 PersistedParamConfig 供父组件缓存 */
  onSaved?: (config: PersistedParamConfig) => void;
  existingRecordId: string | undefined;
  selectedModelId: string | null;
  /** 模型类型（image/video/audio/llm），用于加载对应类型的模板 */
  modelType?: string;
  /** 已保存的参数定义列表（用于恢复状态） */
  customSchema: ParameterDef[];
  setCustomSchema: (schema: ParameterDef[]) => void;
}

/** 模板选项类型 */
interface TemplateOption {
  id: string;
  name: string;
  parameters: ParameterDef[];
  channelConstraints?: ChannelConstraints;
  matchKeywords: string[];
  /** 是否内置（模板库标记；false = 用户导入，可删除） */
  isBuiltIn?: boolean;
}

/** 旧版自定义模板类型（localStorage，迁移用） */
interface CustomParamTemplate {
  id: string;
  name: string;
  parameters: ParameterDef[];
  channelConstraints?: ChannelConstraints;
  createdAt: string;
}

/** 约束字段集合 */
const CONSTRAINT_FIELDS = new Set(['maxEdgeLength', 'minTotalPixels', 'maxTotalPixels']);

/** localStorage key 前缀 */
const CUSTOM_TEMPLATES_KEY = 'custom-param-templates';

const schemaRegistry = createSchemaRegistry();

export default function AiBrandSchemaModal({
  open,
  onClose,
  onSaved,
  existingRecordId,
  selectedModelId,
  modelType = 'image',
  customSchema,
  setCustomSchema,
}: AiBrandSchemaModalProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateOptions, setTemplateOptions] = useState<TemplateOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);

  // 模板库导入弹窗（与模板库卡片同一套 UI）
  const [importModalOpen, setImportModalOpen] = useState(false);

  // 模板库中的自定义模板（isBuiltIn=false，随 loadTemplates 一起刷新）
  const [customTemplates, setCustomTemplates] = useState<TemplateOption[]>([]);

  /** 模板的 constraints（从选中的模板提取） */
  const templateConstraints = useMemo(() => {
    if (!selectedTemplateId) return undefined;
    const tpl = templateOptions.find((t) => t.id === selectedTemplateId);
    return tpl?.channelConstraints;
  }, [selectedTemplateId, templateOptions]);

  /** 当前模板的 parameters（选中模板时使用，否则用已保存的 customSchema 推导） */
  const templateParameters = useMemo(() => {
    const source = !selectedTemplateId
      ? customSchema
      : (templateOptions.find((t) => t.id === selectedTemplateId)?.parameters ?? customSchema);
    return source.filter((p) => !CONSTRAINT_FIELDS.has(p.name));
  }, [selectedTemplateId, templateOptions, customSchema]);

  /** 当前参数默认值（从 customSchema 推导，使修改后的默认值在渲染器中可见） */
  const schemaValues = useMemo(() => {
    const result: Record<string, any> = {};
    for (const p of customSchema) {
      result[p.name] = p.default;
    }
    return result;
  }, [customSchema]);
  const enabledParamNames = useMemo(
    () => customSchema.map((p) => p.name),
    [customSchema],
  );

  /** 切换参数启用/禁用 */
  const handleToggleParam = useCallback(
    (name: string, enabled: boolean) => {
      if (enabled) {
        const paramDef = templateParameters.find((p) => p.name === name);
        if (paramDef) {
          setCustomSchema([...customSchema, { ...paramDef }]);
        }
      } else {
        setCustomSchema(customSchema.filter((p) => p.name !== name));
      }
    },
    [templateParameters, customSchema, setCustomSchema],
  );

  /** 覆盖默认值 */
  const handleOverrideDefault = useCallback(
    (name: string, value: any) => {
      setCustomSchema(
        customSchema.map((p) =>
          p.name === name ? { ...p, default: value } : p,
        ),
      );
    },
    [customSchema, setCustomSchema],
  );

  // ──────────────────────────────────────────────────────
  // 加载预设模板（仅加载，不做自动匹配）
  // ──────────────────────────────────────────────────────
  useEffect(() => {
    setSelectedTemplateId('');
    if (open && selectedModelId) {
      loadTemplates();
    }
  }, [open, selectedModelId]);

  const loadTemplates = async () => {
    try {
      const result = await apiGet<any>(`/admin/api-providers/templates?type=${modelType}`);
      const templates = result.data || result;
      if (templates && Array.isArray(templates)) {
        const options: TemplateOption[] = templates.map((t: any) => ({
          id: t.id,
          name: t.name,
          parameters: t.parameters || [],
          channelConstraints: t.channelConstraints || undefined,
          matchKeywords: t.matchKeywords || [],
          isBuiltIn: t.isBuiltIn !== undefined ? t.isBuiltIn : undefined,
        }));
        setTemplateOptions(options);
        // 自定义模板（用户导入模板库的）单独列出，支持加载/删除
        setCustomTemplates(options.filter((t) => t.isBuiltIn === false));
        setLoadError(null);
      }
    } catch {
      setTemplateOptions([]);
      setLoadError('加载参数模板失败');
    }
  };

  // ──────────────────────────────────────────────────────
  // 旧版 localStorage 参数模板 → 模板库 一次性迁移（2026-08 模板库统一）
  // ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const MIGRATED_KEY = 'custom-param-templates:migrated';
    if (sessionStorage.getItem(MIGRATED_KEY)) return;
    let legacy: CustomParamTemplate[] = [];
    try {
      const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
      legacy = raw ? JSON.parse(raw) : [];
    } catch {
      /* 忽略损坏数据 */
    }
    if (legacy.length === 0) {
      sessionStorage.setItem(MIGRATED_KEY, '1');
      return;
    }
    (async () => {
      for (const tpl of legacy) {
        try {
          await apiPost('/admin/model-templates', {
            id: `legacy-${tpl.id}`,
            name: tpl.name,
            modelType,
            parameters: tpl.parameters,
            channelConstraints: tpl.channelConstraints,
            matchKeywords: [],
          });
        } catch {
          // 单条失败（如 id 冲突）跳过，不阻塞其余迁移
        }
      }
      localStorage.removeItem(CUSTOM_TEMPLATES_KEY);
      sessionStorage.setItem(MIGRATED_KEY, '1');
      loadTemplates();
      message.info(`已迁移 ${legacy.length} 个旧版本地模板到模板库`);
    })();
  }, [open, modelType, loadTemplates]);

  // ──────────────────────────────────────────────────────
  // 手动"自动匹配"按钮
  // ──────────────────────────────────────────────────────
  const handleAutoMatch = () => {
    if (!selectedModelId) return;
    setMatching(true);
    try {
      const modelIdLower = selectedModelId.toLowerCase();
      // 1) 先从官方模板匹配
      let matched = templateOptions.find((opt) =>
        opt.matchKeywords.some((kw: string) => modelIdLower.includes(kw.toLowerCase())),
      );
      if (matched) {
        setSelectedTemplateId(matched.id);
        if (matched.parameters && matched.parameters.length > 0) {
          setCustomSchema(matched.parameters.map((p) => ({ ...p })));
        }
        message.success(`已自动匹配模板: ${matched.name}`);
        return;
      }
      // 2) 若无官方匹配，尝试自定义模板
      matched = undefined;
      setSelectedTemplateId('');
      setCustomSchema([]);
      message.info('未找到匹配的模板，已清空参数');
    } finally {
      setMatching(false);
    }
  };

  // ──────────────────────────────────────────────────────
  // 模板导入（统一 ImportTemplateModal）→ 回填参数 + 刷新预设下拉
  // ──────────────────────────────────────────────────────
  const handleTemplateImported = (template: Record<string, any>) => {
    const newParams: ParameterDef[] = (template.parameters as ParameterDef[]) || [];
    if (newParams.length > 0) {
      setCustomSchema(newParams.map((p) => ({ ...p })));
    }
    loadTemplates();
  };

  /** 删除模板库自定义模板 */
  const handleDeleteCustomTemplate = (tpl: TemplateOption) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定删除此模板吗？删除后将从全站移除（含其他渠道与生成面板）。此操作不可恢复。',
      centered: true,
      okType: 'danger',
      okText: '确定删除',
      cancelText: '取消',
      onOk: async () => {
        try {
          await apiDelete(`/admin/model-templates/${tpl.id}`);
          message.success('模板已删除');
          loadTemplates();
        } catch (err) {
          showApiError(err, '删除失败');
        }
      },
    });
  };

  /** 加载模板库自定义模板的参数 */
  const handleLoadCustomTemplate = (tpl: TemplateOption) => {
    setSelectedTemplateId('');
    setCustomSchema(tpl.parameters.map((p) => ({ ...p })));
    message.success(`已加载模板: ${tpl.name}`);
  };

  /** 生成当前参数配置的 JSON 用于编辑器预设 */
  const currentParamJson = useMemo(() => {
    const obj: Record<string, any> = {
      name: selectedTemplateId
        ? templateOptions.find((t) => t.id === selectedTemplateId)?.name || '参数模板'
        : '自定义参数模板',
      parameters: templateParameters,
    };
    if (templateConstraints) {
      obj.channelConstraints = templateConstraints;
    }
    return JSON.stringify(obj, null, 2);
  }, [selectedTemplateId, templateOptions, templateParameters, templateConstraints]);

  // ──────────────────────────────────────────────────────
  // 选择预设模板
  // ──────────────────────────────────────────────────────
  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) {
      setCustomSchema([]);
      return;
    }
    const tpl = templateOptions.find((t) => t.id === templateId);
    if (tpl?.parameters) {
      setCustomSchema(tpl.parameters.map((p) => ({ ...p })));
    }
  };

  /** 全选 */
  const handleSelectAll = () => {
    setCustomSchema(templateParameters.map((p) => ({ ...p })));
  };

  /** 清除 */
  const handleClear = () => {
    setSelectedTemplateId('');
    setCustomSchema([]);
  };

  // ──────────────────────────────────────────────────────
  // 保存配置
  // ──────────────────────────────────────────────────────
  const handleSaveSchema = async () => {
    if (!existingRecordId || !selectedModelId) return;
    try {
      const cleanParams = customSchema.filter((p) => !CONSTRAINT_FIELDS.has(p.name));
      const cleanEnabledParams = cleanParams.map((p) => p.name);
      const config: PersistedParamConfig = {
        templateId: selectedTemplateId,
        parameters: cleanParams,
        channelConstraints: templateConstraints,
        enabledParams: cleanEnabledParams,
        version: 1,
        lastAppliedTemplateId: selectedTemplateId,
        lastAppliedAt: new Date().toISOString(),
      };

      await apiPost(
        `/admin/api-providers/${existingRecordId}/model-schema/${encodeURIComponent(selectedModelId)}`,
        config,
      );
      message.success('参数配置已保存');
      onSaved?.(config);
      onClose();
    } catch {
      message.error('保存失败');
    }
  };

  // ──────────────────────────────────────────────────────
  // 渲染
  // ──────────────────────────────────────────────────────

  return (
    <Modal
      title={
        <span>
          参数配置
          <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 8 }}>
            — {selectedModelId}
          </span>
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="save" type="primary" onClick={handleSaveSchema}>
          保存配置
        </Button>,
      ]}
      width={640}
    >
      {/* ── 操作栏：自动匹配 + 模板 ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Button size="small" onClick={handleAutoMatch} loading={matching}>
          自动匹配
        </Button>
        <Tooltip title="导入模板到模板库（全站可用），导入后出现在下方「预设模板」中">
          <Button size="small" icon={<FileText size={12} />} onClick={() => setImportModalOpen(true)}>
            导入模板
          </Button>
        </Tooltip>
      </div>

      {/* ── 预设模板选择（模板库：内置 + 用户导入） ── */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#595959', marginBottom: 6, fontWeight: 500 }}>
          预设模板
          <span style={{ fontWeight: 400, color: '#8c8c8c', marginLeft: 6 }}>
            （模板库：内置 + 用户导入，点「模板」可新建导入）
          </span>
        </div>
        <Select
          value={selectedTemplateId}
          onChange={handleTemplateChange}
          options={[
            {
              label: '我的模板',
              options: customTemplates.map((t) => ({ value: t.id, label: t.name })),
            },
            {
              label: '内置模板',
              options: templateOptions
                .filter((t) => t.isBuiltIn !== false)
                .map((t) => ({ value: t.id, label: t.name })),
            },
          ].filter((g) => g.options.length > 0)}
          style={{ width: '100%' }}
          size="small"
          placeholder="选择预设模板..."
        />
      </div>

      {/* ── 模板库自定义模板列表 ── */}
      {customTemplates.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#595959', marginBottom: 6, fontWeight: 500 }}>
            我的模板（模板库）
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {customTemplates.map((tpl) => (
              <div
                key={tpl.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 8px',
                  background: '#fafafa',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                <span
                  style={{ flex: 1, cursor: 'pointer', color: '#1890ff' }}
                  onClick={() => handleLoadCustomTemplate(tpl)}
                >
                  {tpl.name}
                </span>
                <span style={{ color: '#bfbfbf', fontSize: 10 }}>
                  {tpl.parameters.length} 参数
                </span>
                <Tooltip title="删除模板（全站移除）">
                  <Trash2
                    size={12}
                    style={{ cursor: 'pointer', color: '#ff4d4f' }}
                    onClick={() => handleDeleteCustomTemplate(tpl)}
                  />
                </Tooltip>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 加载错误提示 ── */}
      {loadError && (
        <Alert
          title={loadError}
          type="warning"
          showIcon
          closable
          onClose={() => setLoadError(null)}
          style={{ marginBottom: 12, borderRadius: 4, fontSize: 12 }}
        />
      )}

      {/* ── 参数列表 ── */}
      {templateParameters.length > 0 && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 12, color: '#595959', fontWeight: 500 }}>
              显示参数（开启后会在生成面板中显示）
              <span style={{ fontWeight: 400, color: '#8c8c8c', marginLeft: 6 }}>
                （{enabledParamNames.length}/{templateParameters.length} 项已启用）
              </span>
            </span>
            <Space size={4}>
              <Button
                size="small"
                onClick={handleSelectAll}
                style={{ fontSize: 11, height: 22, padding: '0 8px' }}
              >
                全选
              </Button>
              <Button
                size="small"
                onClick={handleClear}
                style={{ fontSize: 11, height: 22, padding: '0 8px' }}
              >
                清除
              </Button>
            </Space>
          </div>

          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <ParamForm
              parameters={templateParameters}
              values={schemaValues}
              onChange={() => {}}
              constraints={templateConstraints}
              registry={schemaRegistry}
              schemaRowMode
              enabledParams={enabledParamNames}
              onToggleParam={handleToggleParam}
              onOverrideDefault={handleOverrideDefault}
            />
          </div>
        </>
      )}

      {templateParameters.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#bfbfbf', fontSize: 13 }}>
          暂无可配置的参数
        </div>
      )}

      {/* ── 模板导入（统一 UI：与模板库卡片一致） ── */}
      <ImportTemplateModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={handleTemplateImported}
        presetJson={currentParamJson}
      />
    </Modal>
  );
}
