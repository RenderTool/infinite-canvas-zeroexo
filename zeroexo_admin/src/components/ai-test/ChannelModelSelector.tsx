/**
 * ChannelModelSelector - 渠道/模型/参数三段选择器
 *
 * 将工作台底部操作栏左侧的三段选择器抽离：
 *   1. 渠道选择：直接 Select（点击即展开下拉列表，一步选中）
 *   2. 模型选择：直接 Select（同上）
 *   3. 参数设置：Popover + ParamForm（参数较多需要面板承载）
 *
 * 设计要点：
 *   - 纯展示组件，所有状态由父组件管理，通过 props 传入
 *   - 第三段 Popover 内嵌 ParamForm，渲染 displayParameters 中的参数
 *   - 选择渠道时会重置模型（由父组件通过 onSelectProvider 控制是否清空模型）
 *   - 渠道/模型 Select 保留品牌图标 labelRender 和模型数量显示
 */
import { Button, Popover, Select, Typography, Tooltip } from 'antd';
import { Settings, RefreshCw } from 'lucide-react';
import ParamForm from './ParamForm';
import type { ParamRendererRegistry } from './ParamRendererRegistry';
import type { ParameterDef, ChannelConstraints } from './param-types';
import type { ProviderItem, ModelOption } from './types';
import { getBrandIcon } from './image-workbench-utils';

const { Text } = Typography;

export interface ChannelModelSelectorProps {
  /** 所有可用渠道 */
  providers: ProviderItem[];
  /** 渠道列表加载中 */
  providersLoading: boolean;
  /** 刷新渠道列表回调 */
  onRefreshProviders?: () => void;
  /** 当前选中的渠道 id */
  selectedProviderId: string | null;
  /** 当前选中的渠道对象 */
  selectedProvider?: ProviderItem;
  /** 选择渠道回调（父组件负责同步清空模型等副作用） */
  onSelectProvider: (id: string | null) => void;
  /** 模型选项列表 */
  modelOptions: ModelOption[];
  /** 当前选中的模型 */
  selectedModel: string | null;
  /** 选择模型回调 */
  onSelectModel: (model: string | null) => void;
  /** 当前选中的渠道名称（用于按钮显示） */
  selectedProviderName: string;
  /** 当前选中的模型名称（用于按钮显示） */
  selectedModelName: string;
  /** 参数定义列表（已过滤，仅展示用） */
  displayParameters: ParameterDef[];
  /** 当前参数值 */
  paramValues: Record<string, any>;
  /** 参数值变更回调 */
  onParamChange: (next: Record<string, any>) => void;
  /** 渠道约束 */
  constraints?: ChannelConstraints;
  /** 渲染器注册表 */
  workbenchRegistry: ParamRendererRegistry;
  /** 参数摘要文案（显示在参数按钮上） */
  paramSummary: string;
  /** 模型列表为空时的提示文案 */
  notFoundContent?: string;
}

/** 渠道/模型/参数三段选择器 */
export default function ChannelModelSelector({
  providers,
  providersLoading,
  onRefreshProviders,
  selectedProviderId,
  onSelectProvider,
  modelOptions,
  selectedModel,
  onSelectModel,
  selectedProviderName,
  selectedModelName,
  displayParameters,
  paramValues,
  onParamChange,
  constraints,
  workbenchRegistry,
  paramSummary,
  notFoundContent = '暂无图像模型',
}: ChannelModelSelectorProps) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {/* 渠道刷新按钮：1:1 方块图标，带 tooltip */}
      {onRefreshProviders && (
        <Tooltip title="刷新渠道列表">
          <Button
            size="small"
            icon={<RefreshCw size={13} />}
            loading={providersLoading}
            onClick={onRefreshProviders}
            style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          />
        </Tooltip>
      )}
      {/* 渠道选择：直接 Select，点击即展开下拉列表 */}
      <Select
        size="small"
        style={{ width: 140 }}
        popupMatchSelectWidth={240}
        placement="topLeft"
        placeholder="选择渠道"
        loading={providersLoading}
        value={selectedProviderId}
        onChange={(id) => {
          onSelectProvider(id);
          onSelectModel(null);
        }}
        labelRender={({ value }) => {
          const p = providers.find((x) => x.id === value);
          if (!p) return <span>{selectedProviderName}</span>;
          const Icon = getBrandIcon(p.provider);
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
              <Icon size={14} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
            </span>
          );
        }}
        options={providers.map((p) => {
          const count = p.config?.fetchedModels
            ? Object.values(p.config.fetchedModels as Record<string, string[]>).reduce(
                (s, ids) => s + ids.length,
                0,
              )
            : 0;
          const Icon = getBrandIcon(p.provider);
          return {
            value: p.id,
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon size={14} />
                <span>{p.name}</span>
                <span style={{ color: '#8c8c8c', fontSize: 11 }}>
                  {count ? `· ${count}模型` : ''}
                </span>
              </span>
            ),
          };
        })}
      />

      {/* 模型选择：直接 Select，点击即展开下拉列表 */}
      <Select
        size="small"
        style={{ width: 160 }}
        popupMatchSelectWidth={240}
        placement="topLeft"
        placeholder="选择模型"
        value={selectedModel}
        onChange={onSelectModel}
        labelRender={({ value }) => {
          const opt = modelOptions.find((o) => o.value === value);
          if (!opt) return <span>{selectedModelName}</span>;
          const Icon = getBrandIcon(opt.iconProvider);
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
              <Icon size={14} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {opt.label}
              </span>
            </span>
          );
        }}
        options={modelOptions.map((opt) => {
          const Icon = getBrandIcon(opt.iconProvider);
          return {
            value: opt.value,
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon size={14} />
                <span>{opt.label}</span>
              </span>
            ),
          };
        })}
        notFoundContent={modelOptions.length === 0 ? notFoundContent : undefined}
      />

      {/* 参数设置：保留 Popover + ParamForm 结构（参数较多需要面板承载） */}
      <Popover
        trigger="click"
        placement="topLeft"
        content={
          <div style={{ width: 280 }}>
            <Text style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, display: 'block' }}>
              参数设置
            </Text>
            <ParamForm
              parameters={displayParameters}
              values={paramValues}
              onChange={onParamChange}
              constraints={constraints}
              registry={workbenchRegistry}
            />
          </div>
        }
      >
        <Button
          size="small"
          icon={<Settings size={14} />}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            maxWidth: 180,
            overflow: 'hidden',
            height: 24,
          }}
        >
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {paramSummary}
          </span>
        </Button>
      </Popover>
    </div>
  );
}
