/**
 * VoiceTab - AI 语音生成测试 Tab
 *
 * 与 ImageWorkbench 保持一致的渠道/模型选择器样式：
 *   - Popover 下拉：渠道 logo + 渠道名，模型 logo + 模型名
 *   - 按钮高度 24px，布局紧凑
 *   - 上下文利用率置于渠道/模型旁
 */
import { Card, Select, Button, Typography, Tag, Tooltip, Progress, Popover } from 'antd';
import { useState, useMemo, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ProviderItem } from './types';
import { getBrandIcon } from './image-workbench-utils';

const { Text } = Typography;

interface VoiceTabProps {
  providers: ProviderItem[];
  providersLoading: boolean;
}

/** 模型选项 */
interface ModelOption {
  label: string;
  value: string;
  iconProvider: string;
}

export default function VoiceTab({ providers, providersLoading }: VoiceTabProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  /** 当前选中的 provider 对象 */
  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );

  /** 当前选中渠道的显示名称 */
  const selectedProviderName = useMemo(
    () => selectedProvider?.name ?? '选择渠道',
    [selectedProvider],
  );

  /** 当前选中模型的显示名称 */
  const selectedModelName = useMemo(
    () => selectedModel ?? '选择模型',
    [selectedModel],
  );

  /** 模型列表 */
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);

  // 当渠道变更时更新模型列表
  useEffect(() => {
    if (!selectedProviderId) {
      setModelOptions([]);
      setSelectedModel(null);
      return;
    }
    const provider = providers.find((p) => p.id === selectedProviderId);
    const cachedModels = provider?.config?.fetchedModels as Record<string, string[]> | undefined;
    if (cachedModels) {
      const modelIcons = provider?.config?.modelIcons as Record<string, string> | undefined;
      const opts: ModelOption[] = [];
      const seen = new Set<string>();
      for (const [type, ids] of Object.entries(cachedModels)) {
        if (type !== 'audio') continue;
        ids.forEach((id) => {
          if (seen.has(id)) return;
          seen.add(id);
          opts.push({
            label: id,
            value: id,
            iconProvider: modelIcons?.[id.toLowerCase()] || provider?.provider || '',
          });
        });
      }
      setModelOptions(opts);
      if (opts.length > 0 && !selectedModel) {
        setSelectedModel(opts[0].value);
      }
    } else {
      setModelOptions([]);
      setSelectedModel(null);
    }
  }, [selectedProviderId, providers]);

  // 上下文利用率（模拟值，后续接入真实统计）
  const contextUtilization = 35;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 24, alignItems: 'center' }}>
      {/* 主要区域 */}
      <Card size="small" style={{ borderRadius: 4, width: '100%', maxWidth: 600 }}>
        {/* ── 渠道/模型/上下文 工具栏（底部系统位置） ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* ── 渠道选择 ── */}
            <Popover
              trigger="click"
              placement="topLeft"
              content={
                <div style={{ width: 260 }}>
                  <Text style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, display: 'block' }}>
                    选择渠道
                  </Text>
                  <Select
                    style={{ width: '100%' }}
                    placeholder="选择渠道"
                    loading={providersLoading}
                    value={selectedProviderId}
                    onChange={(id) => {
                      setSelectedProviderId(id);
                      setSelectedModel(null);
                    }}
                    labelRender={({ value }) => {
                      const p = providers.find((x) => x.id === value);
                      if (!p) return <span>选择渠道</span>;
                      const Icon = getBrandIcon(p.provider);
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Icon size={14} />
                          <span>{p.name}</span>
                        </span>
                      );
                    }}
                    options={providers.map((p) => {
                      const Icon = getBrandIcon(p.provider);
                      return {
                        value: p.id,
                        label: (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Icon size={14} />
                            <span>{p.name}</span>
                          </span>
                        ),
                      };
                    })}
                  />
                </div>
              }
            >
              <Button
                size="small"
                icon={<ChevronDown size={14} />}
                style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: 140, overflow: 'hidden', height: 24 }}
              >
                {selectedProvider ? (() => {
                  const Icon = getBrandIcon(selectedProvider.provider);
                  return <Icon size={14} />;
                })() : null}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedProviderName}
                </span>
              </Button>
            </Popover>

            {/* ── 模型选择 ── */}
            <Popover
              trigger="click"
              placement="topLeft"
              content={
                <div style={{ width: 260 }}>
                  <Text style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, display: 'block' }}>
                    选择模型
                  </Text>
                  <Select
                    style={{ width: '100%' }}
                    placeholder="选择模型"
                    value={selectedModel}
                    onChange={setSelectedModel}
                    labelRender={({ value }) => {
                      const opt = modelOptions.find((o) => o.value === value);
                      if (!opt) return <span>选择模型</span>;
                      const Icon = getBrandIcon(opt.iconProvider);
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Icon size={14} />
                          <span>{opt.label}</span>
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
                    notFoundContent={modelOptions.length === 0 ? '暂无语音模型' : undefined}
                  />
                </div>
              }
            >
              <Button
                size="small"
                icon={<ChevronDown size={14} />}
                style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: 160, overflow: 'hidden', height: 24 }}
              >
                {selectedModel ? (() => {
                  const opt = modelOptions.find((o) => o.value === selectedModel);
                  if (opt) {
                    const Icon = getBrandIcon(opt.iconProvider);
                    return <Icon size={14} />;
                  }
                  return null;
                })() : null}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedModelName}
                </span>
              </Button>
            </Popover>

            {/* ── 上下文利用率 ── */}
            <Tooltip title="当前上下文使用率，过高时可能影响生成效果">
              <Tag
                color={contextUtilization > 70 ? 'orange' : 'default'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, margin: 0, fontSize: 11 }}
              >
                <Progress
                  type="circle"
                  percent={contextUtilization}
                  size={14}
                  strokeColor={contextUtilization > 70 ? '#fa8c16' : '#52c41a'}
                  format={() => ''}
                />
                上下文 {contextUtilization}%
              </Tag>
            </Tooltip>
          </div>
        </div>
      </Card>

      {/* ── 开发中占位 ── */}
      <div style={{ textAlign: 'center', padding: '80px 0', color: '#bfbfbf' }}>
        <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>
        <div style={{ fontSize: 14 }}>语音生成功能正在开发中</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>支持 TTS 文本转语音和语音克隆</div>
      </div>
    </div>
  );
}
