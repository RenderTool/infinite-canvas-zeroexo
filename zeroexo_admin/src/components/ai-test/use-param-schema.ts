/**
 * useParamSchema - 参数 schema 解析与参数值管理
 *
 * 封装 ImageWorkbench 中与参数定义/值相关的逻辑：
 *   1. 加载参数模板定义（用于无已保存 schema 时的回退）
 *   2. 标准化参数定义（补全 aspectRatio 的 values）
 *   3. 解析当前模型的参数 schema（优先已保存 schema，回退到模板）
 *   4. 派生 displayParameters / maxRefCount / isReferenceEnabled
 *   5. 管理 paramValues 状态（含默认值初始化、分辨率↔宽高比→尺寸联动）
 *   6. 处理 ParamForm 的 onChange（手动输入尺寸时反向匹配宽高比）
 *   7. 创建 workbench registry
 *
 * 注意：自动联动的 useEffect（resolution→size）调用 setParamValues 直接更新 state，
 *       不会经过 handleParamFormChange。因此 handleParamFormChange 中的「尺寸变化」
 *       一定是用户手动输入触发的。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '@/services/api-client';
import { computeSizePreset } from './SizeRenderer';
import { createWorkbenchRegistry } from './registry-factory';
import { matchAspectRatio } from './image-workbench-utils';
import type { ParameterDef, PersistedParamConfig, ChannelConstraints } from './param-types';
import type { ProviderItem, TemplateDef } from './types';
import type { ParamRendererRegistry } from './ParamRendererRegistry';

/** 不在 ImageWorkbench 弹出的参数面板中显示的 meta/系统字段 */
const DISPLAY_EXCLUDE_NAMES = new Set([
  'maxEdgeLength',
  'minTotalPixels',
  'referenceImagesEnabled',
  'prompt',
  'maxReferenceImages', // 最大参考素材数量:仅作约束使用,不在参数面板显示
]);

export interface UseParamSchemaResult {
  /** 模板定义列表（加载后供其他逻辑使用） */
  templateDefs: TemplateDef[];
  /** 完整参数定义列表（含 meta 字段） */
  fullParameters: ParameterDef[];
  /** 渠道约束 */
  constraints?: ChannelConstraints;
  /** 提示词最大长度（来自模板） */
  maxPromptLength?: number;
  /** 弹出面板中展示的参数列表（已过滤 meta 字段与参考图字段） */
  displayParameters: ParameterDef[];
  /** 参考图最大数量 */
  maxRefCount: number;
  /** 参考图功能是否启用 */
  isReferenceEnabled: boolean;
  /** 当前参数值 */
  paramValues: Record<string, any>;
  /** 设置参数值 */
  setParamValues: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  /** ParamForm onChange 回调（处理手动输入尺寸时的宽高比反向匹配） */
  handleParamFormChange: (next: Record<string, any>) => void;
  /** 渲染器注册表 */
  workbenchRegistry: ParamRendererRegistry;
}

/**
 * 参数 schema 解析与参数值管理
 *
 * @param selectedModel 当前选中的模型 id
 * @param selectedProvider 当前选中的渠道对象
 */
export function useParamSchema(
  selectedModel: string | null,
  selectedProvider?: ProviderItem,
): UseParamSchemaResult {
  const [templateDefs, setTemplateDefs] = useState<TemplateDef[]>([]);

  // 加载参数模板定义（用于无已保存 schema 时的回退）
  useEffect(() => {
    apiGet<any>('/admin/api-providers/templates?type=image')
      .then((result) => {
        const templates = result.data || result;
        if (Array.isArray(templates)) {
          setTemplateDefs(
            templates.map((t: any) => ({
              id: t.id,
              name: t.name,
              parameters: t.parameters || [],
              channelConstraints: t.channelConstraints || undefined,
              matchKeywords: t.matchKeywords || [],
              maxPromptLength: t.maxPromptLength,
            })),
          );
        }
      })
      .catch(() => {
        // 静默失败，不影响主功能
      });
  }, []);

  /**
   * 标准化参数定义，确保 aspectRatio 字段始终有完整的 values 定义。
   */
  const normalizeParams = useCallback((raw: ParameterDef[]): ParameterDef[] => {
    return raw.map((p) => {
      if (p.name === 'aspectRatio' && (!p.values || p.values.length === 0)) {
        return {
          ...p,
          values: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
          labels: {
            auto: 'AUTO', '1:1': '1:1', '16:9': '16:9', '9:16': '9:16',
            '4:3': '4:3', '3:4': '3:4', '3:2': '3:2', '2:3': '2:3', '21:9': '21:9',
          },
          valueTooltips: {
            auto: 'AUTO 模式：根据参考图尺寸智能匹配最佳比例（常用于图生图），文生图建议选择具体宽高比',
          },
        };
      }
      return p;
    });
  }, []);

  const modelDef = useMemo(() => {
    if (!selectedModel || !selectedProvider) {
      return {
        parameters: [] as ParameterDef[],
        constraints: undefined as ChannelConstraints | undefined,
        maxPromptLength: undefined as number | undefined,
      };
    }
    // 先匹配模板以获取 maxPromptLength（无论是否有已保存 schema）
    const modelLower = selectedModel.toLowerCase();
    const matchedTemplate = templateDefs.find((t) =>
      t.matchKeywords.some((kw: string) => modelLower.includes(kw.toLowerCase())),
    );
    const mpLen = matchedTemplate?.maxPromptLength;
    const modelSchemas = selectedProvider.config?.modelSchemas as
      | Record<string, PersistedParamConfig>
      | undefined;
    const saved = modelSchemas?.[selectedModel.toLowerCase()];
    if (saved?.parameters) {
      return {
        parameters: normalizeParams(saved.parameters as ParameterDef[]),
        constraints: saved.channelConstraints as ChannelConstraints | undefined,
        maxPromptLength: mpLen,
      };
    }
    // 无已保存 schema 时，回退到模板定义
    if (matchedTemplate?.parameters && matchedTemplate.parameters.length > 0) {
      return {
        parameters: normalizeParams(matchedTemplate.parameters as ParameterDef[]),
        constraints: matchedTemplate.channelConstraints as ChannelConstraints | undefined,
        maxPromptLength: mpLen,
      };
    }
    return {
      parameters: [] as ParameterDef[],
      constraints: undefined as ChannelConstraints | undefined,
      maxPromptLength: mpLen,
    };
  }, [selectedModel, selectedProvider, normalizeParams, templateDefs]);

  const { parameters: fullParameters, constraints } = modelDef;
  const maxPromptLength = modelDef.maxPromptLength;

  /** 参考图功能是否启用 */
  const isReferenceEnabled = useMemo(() => {
    const refField = fullParameters.find((p) => p.name === 'referenceImagesEnabled');
    return refField ? !!refField.default : false;
  }, [fullParameters]);

  const displayParameters = useMemo(() => {
    const excludeNames = new Set(DISPLAY_EXCLUDE_NAMES);
    if (!isReferenceEnabled) {
      excludeNames.add('maxReferenceImages');
    }
    // 过滤掉 type=images 的字段（参考图单独处理）
    return fullParameters.filter((p) => !excludeNames.has(p.name) && p.type !== 'images');
  }, [fullParameters, isReferenceEnabled]);

  /** 参考图最大数量 */
  const maxRefCount = useMemo(() => {
    const refField = fullParameters.find((p) => p.type === 'images');
    if (refField?.maxCount) return refField.maxCount;
    if (constraints?.bounds?.maxReferenceImages) return constraints.bounds.maxReferenceImages;
    return 9;
  }, [fullParameters, constraints]);

  const [paramValues, setParamValues] = useState<Record<string, any>>({});

  useEffect(() => {
    const defaults: Record<string, any> = {};
    for (const param of displayParameters) {
      if (param.type === 'size' && typeof param.default === 'object') {
        defaults[param.name] = param.default;
      } else {
        defaults[param.name] = param.default;
      }
    }
    setParamValues(defaults);
  }, [displayParameters]);

  /** 分辨率 ↔ 宽高比 → 尺寸联动：修改比例或分辨率时自动计算尺寸 */
  const resolution = paramValues['resolution'];
  const aspectRatio = paramValues['aspectRatio'];
  useEffect(() => {
    if (!aspectRatio || aspectRatio === 'auto') return;
    // resolution 为空时用默认 '2k'，首次打开选比例即可计算尺寸
    const effectiveResolution = (resolution as string) || '2k';
    const currentSize = paramValues['size'];
    const newSize = computeSizePreset(
      effectiveResolution,
      aspectRatio as string,
      constraints?.bounds,
    );
    if (currentSize?.width === newSize.width && currentSize?.height === newSize.height) return;
    setParamValues((prev) => ({
      ...prev,
      size: newSize,
      // resolution 为空时同步设置默认值，让 UI 高亮对应按钮
      ...(resolution ? {} : { resolution: effectiveResolution }),
    }));
  }, [resolution, aspectRatio, constraints?.bounds]);

  // ref 追踪最新 paramValues，供 onChange 回调使用（避免闭包过期）
  const paramValuesRef = useRef(paramValues);
  useEffect(() => {
    paramValuesRef.current = paramValues;
  });

  /**
   * ParamForm → handleFieldChange 的回调。
   * 注意：自动联动的 useEffect（resolution→size）调用 setParamValues 直接更新 state，
   * 不会经过此回调。因此这里的「尺寸变化」一定是用户手动输入触发的。
   */
  const handleParamFormChange = useCallback(
    (next: Record<string, any>) => {
      const prevSize = paramValuesRef.current['size'] as any;
      const nextSize = next['size'] as any;
      const sizeChanged =
        prevSize?.width !== nextSize?.width || prevSize?.height !== nextSize?.height;

      if (sizeChanged) {
        const aspectRatio = next['aspectRatio'] as string | undefined;

        if (aspectRatio !== 'auto' && nextSize?.width > 0 && nextSize?.height > 0) {
          const arParam = fullParameters.find((p) => p.name === 'aspectRatio');
          const options = arParam?.values?.filter((v) => v !== 'auto') ?? [];
          const matched = matchAspectRatio(nextSize.width, nextSize.height, options);

          if (matched) {
            // 匹配预设 → 同步更新宽高比高亮
            if (matched !== aspectRatio) {
              next.aspectRatio = matched;
            }
          } else {
            // 无匹配 → 清除宽高比和分辨率按钮高亮
            if (next.aspectRatio) next.aspectRatio = '';
            if (next.resolution) next.resolution = '';
          }
        }
      }

      setParamValues(next);
    },
    [fullParameters],
  );

  // 创建 workbench registry（组件外避免重复创建）
  const workbenchRegistry = useMemo(() => createWorkbenchRegistry(), []);

  return {
    templateDefs,
    fullParameters,
    constraints,
    maxPromptLength,
    displayParameters,
    maxRefCount,
    isReferenceEnabled,
    paramValues,
    setParamValues,
    handleParamFormChange,
    workbenchRegistry,
  };
}
