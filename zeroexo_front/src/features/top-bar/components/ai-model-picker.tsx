/**
 * AiModelPicker - AI 渠道/模型选择器（收纳式）
 *
 * 显示在顶部工具栏，收纳为单个 Cpu 图标按钮（32x32，与语言切换按钮一致）。
 * 点击弹出居中 Modal，双列展示渠道列表 + 模型列表，操作即时生效。
 *
 * 相比原 Select 方案（渠道 130px + 模型 140px + 刷新 24px ≈ 300px），
 * 仅占 32px，节省约 270px 水平空间；同时规避 antd Select 弹层
 * 在 React 19 下静默失效的已知问题。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button, Tooltip } from 'antd';
import { Cpu, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { Modal } from '@/shared/components/index.js';
import { useTranslation } from 'react-i18next';
import {
  useAiConfigStore,
  getModelIconComponent,
  modelHasCapability,
  encodeChannelModel,
} from '../../ai-config/index.js';

export function AiModelPicker(): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const [open, setOpen] = useState(false);

  const channels = useAiConfigStore((state) => state.config.channels);
  const loaded = useAiConfigStore((state) => state.loaded);
  const isLoading = useAiConfigStore((state) => state.isLoading);
  const loadError = useAiConfigStore((state) => state.loadError);
  const selectedChannelId = useAiConfigStore((state) => state.selectedChannelId);
  const selectedModel = useAiConfigStore((state) => state.selectedModel);
  const setSelectedChannel = useAiConfigStore((state) => state.setSelectedChannel);

  // 每个渠道仅保留 LLM(text) 能力模型（此选择器为 LLM 渠道/模型面板）
  const channelLlmModels = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const ch of channels) {
      const llmModels = ch.models.filter((m) =>
        modelHasCapability(channels, encodeChannelModel(ch.id, m), 'text'),
      );
      map.set(ch.id, llmModels);
    }
    return map;
  }, [channels]);

  // 只展示至少含一个 LLM 模型的渠道
  const visibleChannels = useMemo(
    () => channels.filter((ch) => (channelLlmModels.get(ch.id)?.length ?? 0) > 0),
    [channels, channelLlmModels],
  );

  const currentChannel = useMemo(
    () => channels.find((ch) => ch.id === selectedChannelId),
    [channels, selectedChannelId],
  );

  // 当前渠道下的 LLM 模型选项列表
  const modelOptions = useMemo(() => {
    if (!currentChannel) return [];
    const modelIcons = currentChannel.modelIcons ?? {};
    return (channelLlmModels.get(currentChannel.id) ?? []).map((m) => {
      const iconKey = modelIcons[m.toLowerCase()] || currentChannel.provider;
      return { value: m, iconKey };
    });
  }, [currentChannel, channelLlmModels]);

  const handleChannelChange = useCallback(
    (id: string) => {
      const firstModel = channelLlmModels.get(id)?.[0];
      setSelectedChannel(id, firstModel);
    },
    [channelLlmModels, setSelectedChannel],
  );

  const handleModelChange = useCallback(
    (model: string) => {
      if (!selectedChannelId) return;
      setSelectedChannel(selectedChannelId, model);
    },
    [selectedChannelId, setSelectedChannel],
  );

  // 组件挂载时自动加载渠道（如果尚未加载）
  useEffect(() => {
    const store = useAiConfigStore.getState();
    if (!store.loaded) {
      store.loadChannels();
    }
  }, []);

  const handleRefresh = useCallback(() => {
    useAiConfigStore.getState().loadChannels();
  }, []);

  const displayName = currentChannel
    ? selectedModel
      ? `${currentChannel.name} · ${selectedModel}`
      : currentChannel.name
    : loaded
      ? t('aiModelPicker.selectAiChannel')
      : t('aiModelPicker.loading');

  // ─── 样式令牌 ────────────────────────────────────────────────
  const accent = theme.toolbar.accent;
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;
  const itemBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const hoverBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const selectedBg = isDark ? `${accent}33` : `${accent}1F`;

  const listWrapStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    border: `1px solid ${border}`,
    borderRadius: 8,
    padding: 4,
    background: isDark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.015)',
  };

  return (
    <>
      {/* 触发按钮：Cpu 图标 + 当前渠道/模型提示 */}
      <Button
        type="text"
        icon={<Cpu size={16} />}
        onClick={() => setOpen(true)}
        title={displayName}
        style={{ width: 32, height: 32, padding: 0, color: text }}
      />

      {/* 居中弹窗：渠道 + 模型双列选择 */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('aiModelPicker.modalTitle')}
        width={600}
        theme={theme}
        footer={
          <Button type="text" onClick={() => setOpen(false)} style={{ color: text }}>
            {t('aiModelPicker.close')}
          </Button>
        }
      >
        {/* 工具行：标题 + 刷新 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: text }}>
            {currentChannel ? `${currentChannel.name} · ${selectedModel || t('aiModelPicker.selectModel')}` : displayName}
          </span>
          <Tooltip title={t('aiModelPicker.refreshChannel')}>
            <Button
              type="text"
              icon={<RefreshCw size={14} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />}
              onClick={handleRefresh}
              disabled={isLoading}
              style={{ width: 28, height: 28, padding: 0, color: textMuted }}
            />
          </Tooltip>
        </div>

        {loadError && !isLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 8,
              background: itemBg,
              color: theme.toolbar.danger,
              fontSize: 13,
            }}
          >
            <AlertCircle size={14} />
            <span style={{ flex: 1 }}>{loadError}</span>
            <Button type="text" size="small" onClick={handleRefresh} style={{ color: theme.toolbar.danger }}>
              {t('aiModelPicker.retry')}
            </Button>
          </div>
        ) : null}

        {/* 双列：渠道 | 模型 */}
        <div style={{ display: 'flex', gap: 14, height: 300 }}>
          {/* 渠道列表 */}
          <div style={{ ...listWrapStyle, flexBasis: '46%' }}>
            {isLoading && channels.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: textMuted, fontSize: 13 }}>{t('aiModelPicker.loading')}</div>
            ) : visibleChannels.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: textMuted, fontSize: 13 }}>
                {loaded ? t('aiModelPicker.noAvailableChannels') : t('aiModelPicker.loading')}
              </div>
            ) : (
              visibleChannels.map((ch) => {
                const Icon = getModelIconComponent(ch.provider);
                const selected = ch.id === selectedChannelId;
                const llmCount = channelLlmModels.get(ch.id)?.length ?? 0;
                return (
                  <SelectableItem
                    key={ch.id}
                    selected={selected}
                    accent={accent}
                    text={text}
                    selectedBg={selectedBg}
                    hoverBg={hoverBg}
                    onClick={() => handleChannelChange(ch.id)}
                    title={llmCount ? `${ch.name} · ${t('aiModelPicker.modelsCount', { count: llmCount })}` : ch.name}
                  >
                    <Icon size={15} />
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                      }}
                    >
                      {ch.name}
                    </span>
                    <span style={{ fontSize: 11, color: textMuted, flexShrink: 0 }}>
                      {t('aiModelPicker.modelsCount', { count: llmCount })}
                    </span>
                    {selected ? <Check size={14} color={accent} /> : null}
                  </SelectableItem>
                );
              })
            )}
          </div>

          {/* 模型列表 */}
          <div style={{ ...listWrapStyle, flexBasis: '54%' }}>
            {!currentChannel ? (
              <div style={{ padding: 16, textAlign: 'center', color: textMuted, fontSize: 13 }}>
                {t('aiModelPicker.selectChannelFirst')}
              </div>
            ) : modelOptions.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: textMuted, fontSize: 13 }}>
                {t('aiModelPicker.noModelsInChannel')}
              </div>
            ) : (
              modelOptions.map((opt) => {
                const Icon = getModelIconComponent(opt.iconKey);
                const selected = opt.value === selectedModel;
                return (
                  <SelectableItem
                    key={opt.value}
                    selected={selected}
                    accent={accent}
                    text={text}
                    selectedBg={selectedBg}
                    hoverBg={hoverBg}
                    onClick={() => handleModelChange(opt.value)}
                    title={opt.value}
                  >
                    <Icon size={15} />
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                      }}
                    >
                      {opt.value}
                    </span>
                    {selected ? <Check size={14} color={accent} /> : null}
                  </SelectableItem>
                );
              })
            )}
          </div>
        </div>

        {/* 提示行 */}
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: textMuted,
          }}
        >
          <Cpu size={13} />
          <span>{t('aiModelPicker.currentHint', { displayName })}</span>
        </div>
      </Modal>
    </>
  );
}

export type { ModelChannel } from '../../ai-config/index.js';

// ===== 列表可选项（选中/悬停高亮） =====

interface SelectableItemProps {
  selected: boolean;
  accent: string;
  text: string;
  selectedBg: string;
  hoverBg: string;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}

function SelectableItem({
  selected,
  accent,
  text,
  selectedBg,
  hoverBg,
  onClick,
  title,
  children,
}: SelectableItemProps): React.ReactElement {
  const [hover, setHover] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        background: selected ? selectedBg : hover ? hoverBg : 'transparent',
        color: selected ? accent : text,
        transition: 'background 0.15s ease',
      }}
    >
      {children}
    </div>
  );
}
