/**
 * useVideoParamSchema - 视频参数 schema 解析与参数值管理
 *
 * 与 use-param-schema.ts 类似，但针对视频生成：
 *   1. 加载视频模型模板定义（?type=video）
 *   2. 标准化参数定义（无需 size/aspectRatio 逻辑）
 *   3. 解析当前模型的参数 schema
 *   4. 派生 displayParameters / 参考素材边界
 *   5. 管理 paramValues 状态
 *   6. 创建 workbench registry
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '@/services/api-client';
import { createWorkbenchRegistry } from './registry-factory';
import type { ParameterDef, PersistedParamConfig, ChannelConstraints } from './param-types';
import type { ProviderItem, TemplateDef } from './types';
import type { ParamRendererRegistry } from './ParamRendererRegistry';

/** 不在弹出面板中显示的 meta/系统字段 */
const DISPLAY_EXCLUDE_NAMES = new Set([
  'maxReferenceImages',
  'maxReferenceVideos',
  'maxReferenceAudios',
  'referenceImagesEnabled',
  'referenceVideosEnabled',
  'referenceAudiosEnabled',
  'prompt',
]);

export interface UseVideoParamSchemaResult {
  /** 模板定义列表 */
  templateDefs: TemplateDef[];
  /** 完整参数定义列表 */
  fullParameters: ParameterDef[];
  /** 渠道约束 */
  constraints?: ChannelConstraints;
  /** 提示词最大长度 */
  maxPromptLength?: number;
  /** 弹出面板中展示的参数列表 */
  displayParameters: ParameterDef[];
  /** 参考素材数量限制 */
  refBounds: {
    maxReferenceImages: number;
    maxReferenceVideos: number;
    maxReferenceAudios: number;
  };
  /** 当前参数值 */
  paramValues: Record<string, any>;
  /** 设置参数值 */
  setParamValues: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  /** ParamForm onChange 回调 */
  handleParamFormChange: (next: Record<string, any>) => void;
  /** 渲染器注册表 */
  workbenchRegistry: ParamRendererRegistry;
}

/**
 * 视频参数 schema 解析与参数值管理
 */
export function useVideoParamSchema(
  selectedModel: string | null,
  selectedProvider?: ProviderItem,
): UseVideoParamSchemaResult {
  const [templateDefs, setTemplateDefs] = useState<TemplateDef[]>([]);

  // 加载视频模型模板定义
  useEffect(() => {
    apiGet<any>('/admin/api-providers/templates?type=video')
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
        // 静默失败
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
        parameters: saved.parameters as ParameterDef[],
        constraints: saved.channelConstraints as ChannelConstraints | undefined,
        maxPromptLength: mpLen,
      };
    }
    if (matchedTemplate?.parameters && matchedTemplate.parameters.length > 0) {
      return {
        parameters: matchedTemplate.parameters as ParameterDef[],
        constraints: matchedTemplate.channelConstraints as ChannelConstraints | undefined,
        maxPromptLength: mpLen,
      };
    }
    return {
      parameters: [] as ParameterDef[],
      constraints: undefined as ChannelConstraints | undefined,
      maxPromptLength: mpLen,
    };
  }, [selectedModel, selectedProvider, templateDefs]);

  const { parameters: fullParameters, constraints } = modelDef;
  const maxPromptLength = modelDef.maxPromptLength;

  /** 参考素材边界 */
  const refBounds = useMemo(() => {
    const maxRefImages =
      fullParameters.find((p) => p.name === 'maxReferenceImages')?.default ?? 0;
    const maxRefVideos =
      fullParameters.find((p) => p.name === 'maxReferenceVideos')?.default ?? 0;
    const maxRefAudios =
      fullParameters.find((p) => p.name === 'maxReferenceAudios')?.default ?? 0;
    return {
      maxReferenceImages: maxRefImages as number,
      maxReferenceVideos: maxRefVideos as number,
      maxReferenceAudios: maxRefAudios as number,
    };
  }, [fullParameters]);

  const displayParameters = useMemo(() => {
    return fullParameters.filter((p) => !DISPLAY_EXCLUDE_NAMES.has(p.name) && p.type !== 'images');
  }, [fullParameters]);

  const [paramValues, setParamValues] = useState<Record<string, any>>({});

  useEffect(() => {
    const defaults: Record<string, any> = {};
    for (const param of displayParameters) {
      defaults[param.name] = param.default;
    }
    setParamValues(defaults);
  }, [displayParameters]);

  // ref 追踪最新 paramValues
  const paramValuesRef = useRef(paramValues);
  useEffect(() => {
    paramValuesRef.current = paramValues;
  });

  const handleParamFormChange = useCallback((next: Record<string, any>) => {
    setParamValues(next);
  }, []);

  const workbenchRegistry = useMemo(() => createWorkbenchRegistry(), []);

  return {
    templateDefs,
    fullParameters,
    constraints,
    maxPromptLength,
    displayParameters,
    refBounds,
    paramValues,
    setParamValues,
    handleParamFormChange,
    workbenchRegistry,
  };
}