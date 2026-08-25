/**
 * DynamicParamForm - 动态参数表单组件
 *
 * 根据 ParameterDef 数组动态渲染参数控件，与 Admin 配置的参数系统保持一致。
 * 支持: enum(radio/select)、number、boolean、size、string 等参数类型。
 * size 类型从 Admin 的 SizeRenderer 移植，包含分辨率档位、宽高比预设、约束校验、锁定比例等。
 *
 * 数据源:
 *   - /admin/api-providers/templates?type=image|video|audio (模板定义)
 *   - channel.config.modelSchemas[modelName] (持久化的模型配置)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Unlink } from 'lucide-react';
import { Tooltip } from 'antd';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import { SettingsPopoverShell, SettingGroup, OptionPill, NumberInput, SwitchRow } from './settings-popover-shell.js';
import { apiGet } from '@/services/api-client.js';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n/config';

/** 参数类型定义(与 param-types.ts 对齐) */
export type ParamType = 'enum' | 'number' | 'boolean' | 'size' | 'string';

export interface ParameterDef {
  name: string;
  type: ParamType;
  label: string;
  default: any;
  values?: string[];
  labels?: Record<string, string>;
  display?: 'radio' | 'select';
  valueTooltips?: Record<string, string>;
  min?: number;
  max?: number;
  step?: number;
  tooltip?: string;
  placeholder?: string;
  required?: boolean;
  /** 高级参数：生成面板默认折叠在「高级选项」中（普通用户不常调整） */
  advanced?: boolean;
}

export interface ChannelConstraints {
  bounds?: {
    minTotalPixels?: number;
    maxTotalPixels?: number;
    maxEdgeLength?: number;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    maxReferenceImages?: number;
    maxReferenceVideos?: number;
    maxReferenceAudios?: number;
  };
}

/** 模板定义 */
export interface TemplateDef {
  id: string;
  name: string;
  parameters: ParameterDef[];
  channelConstraints?: ChannelConstraints;
  matchKeywords: string[];
  maxPromptLength?: number;
}

export interface DynamicParamFormProps {
  /** 当前模型 ID(编码后的 "channelId::model" 格式) */
  model: string;
  /** 生成模式(Plan#33: 扩展 text,script/storyboard 走 GeneratorStaticParams 不走本组件) */
  generationMode: 'image' | 'video' | 'audio' | 'text';
  /** 当前参数值 */
  paramValues: Record<string, any>;
  /** 参数值变更回调 */
  onChange: (patch: Record<string, any>) => void;
  /** 主题 */
  theme: ThemeConfig;
  /** 标题前缀(如 "图片"、"视频"、"音频") */
  titlePrefix?: string;
  /** 模板约束就绪回调(父级用于获取参考素材上限等边界值) */
  onConstraintsReady?: (constraints?: ChannelConstraints) => void;
}

// ===== 尺寸工具函数(从 Admin SizeRenderer 移植) =====

/** 分辨率字符串 → 像素值 */
function resolvePixels(resolution: string, fallback: number): number {
  const map: Record<string, number> = { '512': 512, '1k': 1024, '2k': 2048, '3k': 3072, '4k': 4096 };
  return map[resolution.toLowerCase()] ?? fallback;
}

/** 分辨率选项 */
const RESOLUTION_OPTIONS = ['512', '1k', '2k', '3k', '4k'];

/** 宽高比选项 */
const ASPECT_OPTIONS = [
  { value: '1:1', ratio: 1 },
  { value: '16:9', ratio: 16 / 9 },
  { value: '9:16', ratio: 9 / 16 },
  { value: '4:3', ratio: 4 / 3 },
  { value: '3:4', ratio: 3 / 4 },
  { value: '3:2', ratio: 3 / 2 },
  { value: '2:3', ratio: 2 / 3 },
  { value: '21:9', ratio: 21 / 9 },
];

/**
 * 火山引擎 API 官方尺寸映射表
 */
const VOLCENGINE_SIZE_MAP: Record<string, Record<string, { width: number; height: number }>> = {
  '1k': {
    '1:1': { width: 1024, height: 1024 },
    '4:3': { width: 1152, height: 864 },
    '3:4': { width: 864, height: 1152 },
    '16:9': { width: 1424, height: 800 },
    '9:16': { width: 800, height: 1424 },
    '3:2': { width: 1248, height: 832 },
    '2:3': { width: 832, height: 1248 },
    '21:9': { width: 1568, height: 672 },
  },
  '2k': {
    '1:1': { width: 2048, height: 2048 },
    '4:3': { width: 2368, height: 1776 },
    '3:4': { width: 1776, height: 2368 },
    '16:9': { width: 2816, height: 1584 },
    '9:16': { width: 1584, height: 2816 },
    '3:2': { width: 2496, height: 1664 },
    '2:3': { width: 1664, height: 2496 },
    '21:9': { width: 3136, height: 1344 },
  },
};

/**
 * 从分辨率 + 宽高比计算实际像素尺寸，确保满足像素约束。
 * 命中官方尺寸表同样需要统一过一遍 bounds 裁剪（maxEdge → minPixels → maxPixels）。
 */
function computeSizePreset(
  resolution: string,
  aspectRatio: string,
  bounds?: ChannelConstraints['bounds'],
): { width: number; height: number } {
  const res = resolution.toLowerCase();
  const resMap = VOLCENGINE_SIZE_MAP[res];
  let w: number;
  let h: number;
  if (resMap?.[aspectRatio]) {
    ({ width: w, height: h } = resMap[aspectRatio]);
  } else {
    const [rw, rh] = aspectRatio.split(':').map(Number);
    if (!rw || !rh) return { width: 1024, height: 1024 };
    const rawEdge = resolvePixels(res, bounds?.maxEdgeLength || 1024);
    const edge = bounds?.maxEdgeLength ? Math.min(rawEdge, bounds.maxEdgeLength) : rawEdge;
    w = rw >= rh ? edge : Math.round((edge * rw) / rh);
    h = rh >= rw ? edge : Math.round((edge * rh) / rw);
  }
  // 最长边约束（保持比例裁剪）
  const maxEdge = bounds?.maxEdgeLength;
  if (maxEdge && Math.max(w, h) > maxEdge) {
    const ratio = w / h;
    if (ratio >= 1) {
      w = maxEdge;
      h = Math.max(1, Math.round(maxEdge / ratio));
    } else {
      h = maxEdge;
      w = Math.max(1, Math.round(maxEdge * ratio));
    }
  }
  // 最小像素约束（提升时若超最长边则按最长边比例回退）
  const minPixels = bounds?.minTotalPixels ?? 921600;
  if (w * h < minPixels) {
    const scale = Math.sqrt(minPixels / (w * h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    if (maxEdge && (w > maxEdge || h > maxEdge)) {
      const ratio = w / h;
      if (ratio >= 1) {
        w = maxEdge;
        h = Math.max(1, Math.round(maxEdge / ratio));
      } else {
        h = maxEdge;
        w = Math.max(1, Math.round(maxEdge * ratio));
      }
    }
  }
  // 最大像素约束
  const maxPixels = bounds?.maxTotalPixels;
  if (maxPixels && w * h > maxPixels) {
    const scale = Math.sqrt(maxPixels / (w * h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  return { width: w, height: h };
}

// ===== 约束校验工具 =====

interface ConstraintWarnings {
  warnings: string[];
  hasError: boolean;
}

function checkSizeConstraints(
  size: { width: number; height: number },
  bounds: ChannelConstraints['bounds'] | undefined,
): ConstraintWarnings {
  const warnings: string[] = [];
  if (!bounds) return { warnings, hasError: false };
  const { width, height } = size;
  if (width <= 0 || height <= 0) return { warnings, hasError: false };
  const pixelCount = width * height;
  const minPx = bounds.minTotalPixels;
  if (minPx && pixelCount < minPx) {
    warnings.push(i18n.t('promptPanel.minPixelsWarning', { minPx: minPx.toLocaleString() }));
  }
  const maxPx = bounds.maxTotalPixels;
  if (maxPx && pixelCount > maxPx) {
    warnings.push(i18n.t('promptPanel.maxPixelsWarning', { maxPx: maxPx.toLocaleString() }));
  }
  const maxEdge = bounds.maxEdgeLength;
  if (maxEdge && Math.max(width, height) > maxEdge) {
    warnings.push(i18n.t('promptPanel.maxEdgeWarning', { maxEdge }));
  }
  return { warnings, hasError: warnings.length > 0 };
}

// ===== 尺寸比例示意图标 =====

function AspectIcon({ ratio, color }: { ratio: number; color: string }): React.ReactElement {
  if (ratio === 0) {
    return <span style={{ height: 24, display: 'inline-flex', alignItems: 'center', fontSize: 11, opacity: 0.6 }}>auto</span>;
  }
  const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
  const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
  return (
    <span style={{ height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ width: boxWidth, height: boxHeight, border: `2px solid ${color}`, borderRadius: 2 }} />
    </span>
  );
}

// ===== 尺寸参数渲染器 =====

function SizeRenderer({
  param,
  value,
  allValues,
  constraints,
  theme,
  onChangeParam,
  params,
}: {
  param: ParameterDef;
  value: any;
  allValues: Record<string, any>;
  constraints?: ChannelConstraints;
  theme: ThemeConfig;
  onChangeParam: (name: string, value: any) => void;
  /** 完整参数列表：消费模板配置的 resolution/aspectRatio values/labels，而非硬编码档位 */
  params: ParameterDef[];
}): React.ReactElement {
  const { t } = useTranslation();

  // ── 档位/比例优先取模板配置（如 seedream 只配 1k/2k → 不渲染 512/3k/4k） ──
  const resolutionParam = params.find((p) => p.name === 'resolution');
  const aspectParam = params.find((p) => p.name === 'aspectRatio');
  const resolutionOptions = resolutionParam?.values?.length
    ? resolutionParam.values
    : RESOLUTION_OPTIONS;
  const rawAspectValues = aspectParam?.values?.length
    ? aspectParam.values
    : ['auto', ...ASPECT_OPTIONS.map((o) => o.value)];
  const hasAutoAspect = rawAspectValues.includes('auto');
  const aspectOptions = rawAspectValues
    .filter((v) => v !== 'auto')
    .map((v) => {
      const [rw, rh] = v.split(':').map(Number);
      return { value: v, ratio: rw && rh ? rw / rh : 1 };
    });

  // 当前分辨率/宽高比/尺寸值
  const resolution = (allValues['resolution'] as string) || resolutionOptions[0];
  const aspectRatio = (allValues['aspectRatio'] as string) || 'auto';
  const isAuto = aspectRatio === 'auto';
  const rawSize = value && typeof value === 'object' && 'width' in value
    ? value as { width: number; height: number }
    : { width: 1024, height: 1024 };

  // 锁定比例状态
  const [aspectLocked, setAspectLocked] = useState(false);

  // 当前宽高比(用于锁定比例计算)
  const currentAspect = useMemo(() => {
    if (rawSize.width > 0 && rawSize.height > 0) {
      return rawSize.width / rawSize.height;
    }
    return 1;
  }, [rawSize.width, rawSize.height]);

  // 约束校验
  const { warnings, hasError } = useMemo(
    () => checkSizeConstraints(rawSize, constraints?.bounds),
    [rawSize, constraints?.bounds],
  );

  // 分辨率变更(AUTO 比例下也可点选:分辨率独立生效,比例保持 AUTO)
  const handleResolutionChange = useCallback((val: string) => {
    onChangeParam('resolution', val);
    if (aspectRatio && aspectRatio !== 'auto') {
      const { width: w, height: h } = computeSizePreset(val, aspectRatio, constraints?.bounds);
      onChangeParam('size', { width: w, height: h });
    }
  }, [aspectRatio, constraints?.bounds, onChangeParam]);

  // 宽高比变更
  const handleAspectRatioChange = useCallback((val: string) => {
    onChangeParam('aspectRatio', val);
    if (val === 'auto') {
      onChangeParam('size', { width: 0, height: 0 });
      return;
    }
    if (resolution) {
      const { width: w, height: h } = computeSizePreset(resolution, val, constraints?.bounds);
      onChangeParam('size', { width: w, height: h });
    }
  }, [resolution, constraints?.bounds, onChangeParam]);

  // 宽度变更
  const handleWidthChange = useCallback((v: string) => {
    const width = Number(v) || 0;
    if (aspectLocked && width > 0 && rawSize.height > 0) {
      const newHeight = Math.round(width / currentAspect);
      onChangeParam('size', { width, height: newHeight });
    } else {
      onChangeParam('size', { width, height: rawSize.height });
    }
  }, [aspectLocked, rawSize.height, currentAspect, onChangeParam]);

  // 高度变更
  const handleHeightChange = useCallback((v: string) => {
    const height = Number(v) || 0;
    if (aspectLocked && height > 0 && rawSize.width > 0) {
      const newWidth = Math.round(height * currentAspect);
      onChangeParam('size', { width: newWidth, height });
    } else {
      onChangeParam('size', { width: rawSize.width, height });
    }
  }, [aspectLocked, rawSize.width, currentAspect, onChangeParam]);

  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 分辨率档位选择（档位来自模板配置 values，无配置时回退内置列表） */}
      <SettingGroup title={t('promptPanel.resolution')} color={mutedColor}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(5, resolutionOptions.length)}, 1fr)`, gap: 6 }}>
          {resolutionOptions.map((opt) => (
            <OptionPill
              key={opt}
              selected={resolution === opt}
              theme={theme}
              onClick={() => handleResolutionChange(opt)}
            >
              {resolutionParam?.labels?.[opt] ?? opt}
            </OptionPill>
          ))}
        </div>
      </SettingGroup>

      {/* 宽高比预设选择（选项来自模板配置 values） */}
      <SettingGroup title={t('promptPanel.aspectRatio')} color={mutedColor}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {hasAutoAspect && (
            <Tooltip title={t('promptPanel.autoAspect')}>
              <button
                type="button"
                onClick={() => handleAspectRatioChange('auto')}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  height: 56,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  borderRadius: 10,
                  border: `1px solid ${isAuto ? theme.toolbar.accent : theme.toolbar.border}`,
                  background: isAuto
                    ? (theme.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)')
                    : 'transparent',
                  color: textColor,
                  cursor: 'pointer',
                  fontSize: 11,
                  transition: 'opacity 0.12s',
                }}
              >
                <AspectIcon ratio={0} color={textColor} />
                <span>{aspectParam?.labels?.['auto'] ?? 'auto'}</span>
              </button>
            </Tooltip>
          )}
          {aspectOptions.map((opt) => (
            <Tooltip key={opt.value} title={opt.value}>
              <button
                type="button"
                onClick={() => handleAspectRatioChange(opt.value)}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  height: 56,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  borderRadius: 10,
                  border: `1px solid ${!isAuto && aspectRatio === opt.value ? theme.toolbar.accent : theme.toolbar.border}`,
                  background: !isAuto && aspectRatio === opt.value
                    ? (theme.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)')
                    : 'transparent',
                  color: textColor,
                  cursor: 'pointer',
                  fontSize: 11,
                  transition: 'opacity 0.12s',
                }}
              >
                <AspectIcon ratio={opt.ratio} color={textColor} />
                <span>{aspectParam?.labels?.[opt.value] ?? opt.value}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      </SettingGroup>

      {/* 宽度 × 高度输入(锁定按钮与输入框垂直居中:容器底部对齐 + 按钮等高 32px) */}
      <SettingGroup title={param.label || t('promptPanel.dimensions')} color={mutedColor}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: mutedColor, marginBottom: 2 }}>{t('promptPanel.width')}</div>
            <NumberInput
              value={String(rawSize.width || '')}
              min={constraints?.bounds?.minWidth ?? 0}
              max={constraints?.bounds?.maxWidth ?? 9999}
              theme={theme}
              disabled={isAuto}
              onChange={handleWidthChange}
              width="100%"
              radius={8}
            />
          </div>
          {/* 锁定比例按钮(32px 与输入框等高,底部对齐 → 垂直居中于输入框) */}
          <Tooltip title={aspectLocked ? t('promptPanel.unlockAspect') : t('promptPanel.lockAspect')}>
            <span
              onClick={() => setAspectLocked(!aspectLocked)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 32,
                cursor: 'pointer',
                color: aspectLocked ? theme.toolbar.accent : (theme.mode === 'dark' ? '#666' : '#bfbfbf'),
                borderRadius: 4,
                transition: 'all 0.15s',
                flexShrink: 0,
              }}
            >
              {aspectLocked ? <Link size={14} /> : <Unlink size={14} />}
            </span>
          </Tooltip>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: mutedColor, marginBottom: 2 }}>{t('promptPanel.height')}</div>
            <NumberInput
              value={String(rawSize.height || '')}
              min={constraints?.bounds?.minHeight ?? 0}
              max={constraints?.bounds?.maxHeight ?? 9999}
              theme={theme}
              disabled={isAuto}
              onChange={handleHeightChange}
              width="100%"
              radius={8}
            />
          </div>
        </div>

        {/* 约束警告 */}
        {hasError && !isAuto && (
          <div style={{ fontSize: 11, color: '#ff4d4f', marginTop: 4, lineHeight: 1.5 }}>
            {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}

        {/* 约束提示(无警告时) */}
        {constraints?.bounds && !isAuto && !hasError && (
          <div style={{ fontSize: 10, color: mutedColor, marginTop: 2 }}>
            {t('promptPanel.maxEdgeHint', { maxEdge: constraints.bounds.maxEdgeLength ?? 4096 })}
            {constraints.bounds.minTotalPixels && t('promptPanel.minMpHint', { minMp: Math.round(constraints.bounds.minTotalPixels / 1024 / 1024 * 10) / 10 })}
          </div>
        )}

        {/* 智能模式提示 */}
        {isAuto && (
          <div style={{ fontSize: 11, color: mutedColor, marginTop: 4 }}>
            {t('promptPanel.autoModeHint')}
          </div>
        )}
      </SettingGroup>
    </div>
  );
}

// ===== 通用工具函数 =====

/** 根据生成模式获取模板类型 */
function getTemplateType(mode: string): string {
  switch (mode) {
    case 'image': return 'image';
    case 'video': return 'video';
    case 'audio': return 'audio';
    case 'text': return 'text';
    default: return 'image';
  }
}

/** 加载模板定义 */
function loadTemplates(mode: string): Promise<TemplateDef[]> {
  const type = getTemplateType(mode);
  return apiGet<any>(`/ai/templates?type=${type}`)
    .then((result) => {
      const templates = result.data || result;
      if (!Array.isArray(templates)) return [];
      return templates.map((t: any) => ({
        id: t.id,
        name: t.name,
        parameters: t.parameters || [],
        channelConstraints: t.channelConstraints || undefined,
        matchKeywords: t.matchKeywords || [],
        maxPromptLength: t.maxPromptLength,
      }));
    })
    .catch(() => []);
}

/** 从模板匹配模型对应的参数定义 */
function matchModelParameters(
  model: string,
  templates: TemplateDef[],
): { parameters: ParameterDef[]; constraints?: ChannelConstraints; maxPromptLength?: number } {
  const modelLower = model.toLowerCase();
  for (const template of templates) {
    if (template.matchKeywords.some((kw) => modelLower.includes(kw.toLowerCase()))) {
      return {
        parameters: template.parameters,
        constraints: template.channelConstraints,
        maxPromptLength: template.maxPromptLength,
      };
    }
  }
  return { parameters: [] };
}

/** 参数显示排除列表(与 Admin 一致;resolution/aspectRatio 仅在存在 size 渲染器时排除)。
 * 注意:maxReferenceImages/maxReferenceVideos/maxReferenceAudios 等是后端给前端的
 * 约束上限(参考素材区已按其限制上传),不是供用户编辑的面板参数,一律隐藏。 */
const DISPLAY_EXCLUDE_NAMES = new Set([
  'maxEdgeLength',
  'minTotalPixels',
  'referenceImagesEnabled',
  'referenceVideosEnabled',
  'referenceAudiosEnabled',
  'prompt',
  'maxReferenceImages',
  'maxReferenceVideos',
  'maxReferenceAudios',
  // 水印参数由模板驱动显示(boolean SwitchRow),默认关闭由模板 default: false 保证(2026-08-25 用户拍板)
]);

/** 过滤需要显示的参数 */
function filterDisplayParameters(parameters: ParameterDef[]): ParameterDef[] {
  const exclude = new Set(DISPLAY_EXCLUDE_NAMES);
  // 存在 size 类型参数时,resolution/aspectRatio 由 size 渲染器内部处理,不重复显示;
  // 视频等无 size 渲染器的模板则保留独立显示
  if (parameters.some((p) => p.type === 'size')) {
    exclude.add('resolution');
    exclude.add('aspectRatio');
  }
  return parameters.filter((p) => !exclude.has(p.name) && (p.type as string) !== 'images');
}

/** 获取枚举值显示标签 */
function getValueLabel(param: ParameterDef, value: string): string {
  if (param.labels && param.labels[value]) {
    return param.labels[value];
  }
  return value;
}

/** 生成摘要文本 */
function buildSummary(params: ParameterDef[], values: Record<string, any>): string {
  const parts: string[] = [];
  for (const param of params) {
    const val = values[param.name];
    if (val === undefined || val === null) continue;
    if (param.type === 'enum') {
      parts.push(getValueLabel(param, String(val)));
    } else if (param.type === 'size') {
      // width/height 为数值即有效(0 也合法:AUTO 模式 size={width:0,height:0} 曾致 String({}) 显示 [object Object])
      if (typeof val === 'object' && val !== null && typeof (val as any).width === 'number') {
        const w = (val as any).width as number;
        const h = (val as any).height as number;
        parts.push(w > 0 && h > 0 ? `${w}x${h}` : 'AUTO');
      } else {
        parts.push(String(val));
      }
    } else if (param.type === 'boolean') {
      // 不显示 boolean 在摘要中
    } else {
      parts.push(String(val));
    }
  }
  const aspectRatio = values['aspectRatio'];
  if (aspectRatio && aspectRatio !== 'auto') {
    parts.unshift(aspectRatio);
  }
  const resolution = values['resolution'];
  if (resolution) {
    parts.unshift(resolution);
  }
  return parts.slice(0, 3).join(' · ');
}

/** DynamicParamForm 组件 */
export function DynamicParamForm({
  model,
  generationMode,
  paramValues,
  onChange,
  theme,
  titlePrefix = '',
  onConstraintsReady,
}: DynamicParamFormProps): React.ReactElement {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<TemplateDef[]>([]);
  const [loaded, setLoaded] = useState<boolean>(false);
  // 高级参数折叠区展开状态（默认收起）
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 加载模板
  useEffect(() => {
    let cancelled = false;
    loadTemplates(generationMode).then((result) => {
      if (!cancelled) {
        setTemplates(result);
        setLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, [generationMode]);

  // 匹配当前模型的参数
  const { parameters, constraints } = useMemo(() => {
    if (!loaded || templates.length === 0) {
      return { parameters: [], constraints: undefined as ChannelConstraints | undefined };
    }
    return matchModelParameters(model, templates);
  }, [model, templates, loaded]);

  // 模板约束就绪回调(父级获取参考素材上限等边界值)
  useEffect(() => {
    onConstraintsReady?.(constraints);
  }, [constraints, onConstraintsReady]);

  // Bug3: 模型切换时参数必须随之刷新 —— 将新模型模板的默认值写回 paramValues,
  // 避免旧模型残留参数(如 mode/分辨率)继续显示。初始挂载模型不重置(保留已保存参数)。
  // mode 不做默认写回:参考区首尾帧/多模态需用户显式选择才切换(2026-08-25 用户拍板)
  const prevModelRef = useRef<string>(model);
  useEffect(() => {
    if (!loaded || prevModelRef.current === model || parameters.length === 0) return;
    prevModelRef.current = model;
    const defaults: Record<string, any> = {};
    for (const p of parameters) {
      if (p.name === 'mode') continue;
      defaults[p.name] = p.default;
    }
    onChange(defaults);
  }, [loaded, model, parameters, onChange]);

  // Bug3: 首次加载完成且该节点尚未保存任何参数时,将当前模型模板默认值写回,
  // 保证"默认选中模型"时面板参数立即与实际生效参数一致(不覆盖用户已保存的参数)
  const initialDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (!loaded || initialDefaultAppliedRef.current || parameters.length === 0) return;
    const hasSavedValues = paramValues && Object.keys(paramValues).length > 0;
    if (hasSavedValues) {
      initialDefaultAppliedRef.current = true;
      return;
    }
    initialDefaultAppliedRef.current = true;
    const defaults: Record<string, any> = {};
    for (const p of parameters) {
      if (p.name === 'mode') continue;
      defaults[p.name] = p.default;
    }
    onChange(defaults);
  }, [loaded, parameters, paramValues, onChange]);

  // 过滤显示参数（advanced 参数折叠在「高级选项」中）
  const displayParams = useMemo(() => filterDisplayParameters(parameters), [parameters]);
  const basicParams = useMemo(() => displayParams.filter((p) => !p.advanced), [displayParams]);
  const advancedParams = useMemo(() => displayParams.filter((p) => p.advanced), [displayParams]);

  // 合并所有值用于摘要和联动(基于完整 parameters 构建默认值,确保被 size 渲染器
  // 内部处理的 resolution/aspectRatio 也能拿到模板默认值)
  const allValues = useMemo(() => {
    const result: Record<string, any> = {};
    for (const p of parameters) {
      result[p.name] = p.default;
    }
    return { ...result, ...paramValues };
  }, [parameters, paramValues]);

  // 计算摘要（仅基础参数；高级参数不干扰普通用户摘要）
  const summary = useMemo(() => {
    if (basicParams.length === 0) return t('promptPanel.defaultSummary');
    return buildSummary(basicParams, allValues);
  }, [basicParams, allValues, t]);

  // 处理参数变更
  const handleParamChange = useCallback((name: string, value: any) => {
    onChange({ [name]: value });
  }, [onChange]);

  // 渲染参数控件(必须在条件性 return 之前调用,以保持 hooks 顺序一致)
  const renderParam = useCallback((param: ParameterDef) => {
    // mode 参数:仅显式选择后才有值(参考区随用户选择切换首尾帧/多模态),
    // 不回退模板默认值,避免"默认选中首尾帧"的假象
    const value = param.name === 'mode'
      ? paramValues[param.name]
      : (paramValues[param.name] ?? param.default);

    switch (param.type) {
      case 'enum': {
        if (!param.values || param.values.length === 0) return null;

        if (param.display === 'radio' || param.values.length <= 6) {
          return (
            <SettingGroup title={param.label} color={theme.toolbar.textMuted}>
              {/* flex-wrap 自适应宽度(对齐 admin EnumRenderer):固定网格会挤压长 label 导致换行(如「编辑视频」) */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {param.values.map((v) => (
                  <OptionPill
                    key={v}
                    selected={String(value) === v}
                    theme={theme}
                    onClick={() => handleParamChange(param.name, v)}
                  >
                    {getValueLabel(param, v)}
                  </OptionPill>
                ))}
              </div>
            </SettingGroup>
          );
        }

        return (
          <SettingGroup title={param.label} color={theme.toolbar.textMuted}>
            <select
              value={String(value)}
              onChange={(e) => handleParamChange(param.name, e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                height: 32,
                borderRadius: 8,
                border: `1px solid ${theme.toolbar.border}`,
                background: 'transparent',
                color: theme.toolbar.text,
                padding: '0 10px',
                fontSize: 12,
                outline: 'none',
                width: '100%',
              }}
            >
              {param.values.map((v) => (
                <option key={v} value={v} style={{ background: theme.toolbar.panel }}>
                  {getValueLabel(param, v)}
                </option>
              ))}
            </select>
          </SettingGroup>
        );
      }

      case 'number': {
        return (
          <SettingGroup title={param.label} color={theme.toolbar.textMuted}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <NumberInput
                value={String(value ?? param.default ?? 0)}
                min={param.min ?? 0}
                max={param.max ?? 9999}
                theme={theme}
                onChange={(v) => handleParamChange(param.name, Number(v))}
              />
              {param.tooltip && (
                <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
                  {param.tooltip}
                </span>
              )}
            </div>
          </SettingGroup>
        );
      }

      case 'boolean': {
        return (
          <SwitchRow
            label={param.label}
            checked={!!value}
            theme={theme}
            onChange={(checked) => handleParamChange(param.name, checked)}
          />
        );
      }

      case 'size': {
        // size 参数使用完整的 SizeRenderer（传入完整参数列表以消费模板档位配置）
        return (
          <SizeRenderer
            param={param}
            value={value}
            allValues={allValues}
            constraints={constraints}
            theme={theme}
            onChangeParam={handleParamChange}
            params={parameters}
          />
        );
      }

      case 'string': {
        return (
          <SettingGroup title={param.label} color={theme.toolbar.textMuted}>
            <input
              type="text"
              value={String(value ?? '')}
              placeholder={param.placeholder}
              onChange={(e) => handleParamChange(param.name, e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                height: 32,
                borderRadius: 8,
                border: `1px solid ${theme.toolbar.border}`,
                background: 'transparent',
                color: theme.toolbar.text,
                padding: '0 10px',
                fontSize: 12,
                outline: 'none',
                width: '100%',
              }}
            />
          </SettingGroup>
        );
      }

      default:
        return null;
    }
  }, [paramValues, theme, handleParamChange, allValues, constraints, parameters]);

  // 无参数时显示默认摘要（在所有 hooks 之后判断）
  if (basicParams.length === 0 && advancedParams.length === 0) {
    return (
      <SettingsPopoverShell summary={summary} theme={theme} panelWidth={320} triggerVariant="dropdown">
        <div style={{ padding: '12px 0', textAlign: 'center', color: theme.toolbar.textMuted, fontSize: 12 }}>
          {t('promptPanel.noCustomParams')}
        </div>
      </SettingsPopoverShell>
    );
  }

  return (
    <SettingsPopoverShell summary={summary} theme={theme} panelWidth={320} triggerVariant="dropdown">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.toolbar.text }}>
          {t('promptPanel.paramSettings', { prefix: titlePrefix })}
        </div>
        {basicParams.map((param) => (
          <div key={param.name}>{renderParam(param)}</div>
        ))}

        {/* 高级选项折叠区：普通用户不常调整的专业参数（固定镜头/尾帧/优先级等） */}
        {advancedParams.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                height: 30,
                borderRadius: 8,
                border: `1px solid ${theme.toolbar.border}`,
                background: 'transparent',
                color: theme.toolbar.textMuted,
                cursor: 'pointer',
                fontSize: 12,
                transition: 'opacity 0.12s',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  transform: showAdvanced ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.15s',
                  fontSize: 10,
                }}
              >
                ▸
              </span>
              {t('promptPanel.advancedOptions')}
              <span style={{ opacity: 0.6 }}>{advancedParams.length}</span>
            </button>
            {showAdvanced && advancedParams.map((param) => (
              <div key={param.name}>{renderParam(param)}</div>
            ))}
          </div>
        )}
      </div>
    </SettingsPopoverShell>
  );
}