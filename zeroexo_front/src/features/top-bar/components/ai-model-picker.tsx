/**
 * AiModelPicker - AI 模型选择器（Plan#36 R2 返工）
 *
 * 废弃早期 Modal 切换设施 + 渠道/模型两级结构，
 * 改为与提示词输入块同款：SettingsPopoverShell dropdown 触发 + 浮出面板，
 * 面板内平铺全部 LLM 模型列表（不分模型商），选中即时生效。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { Cpu, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';
import {
  SettingsPopoverShell,
  SettingGroup,
} from '../../generator-settings/settings-popover-shell.js';
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

  const channels = useAiConfigStore((state) => state.config.channels);
  const loaded = useAiConfigStore((state) => state.loaded);
  const isLoading = useAiConfigStore((state) => state.isLoading);
  const loadError = useAiConfigStore((state) => state.loadError);
  const selectedChannelId = useAiConfigStore((state) => state.selectedChannelId);
  const selectedModel = useAiConfigStore((state) => state.selectedModel);
  const setSelectedChannel = useAiConfigStore((state) => state.setSelectedChannel);

  // 平铺全部 LLM(text) 能力模型（不分模型商，与提示词输入块一致）
  const flatModels = useMemo(() => {
    const opts: Array<{ channelId: string; channelName: string; model: string; iconKey: string }> = [];
    for (const ch of channels) {
      const icons = ch.modelIcons ?? {};
      for (const m of ch.models) {
        if (!modelHasCapability(channels, encodeChannelModel(ch.id, m), 'text')) continue;
        opts.push({
          channelId: ch.id,
          channelName: ch.name,
          model: m,
          iconKey: icons[m.toLowerCase()] || ch.provider,
        });
      }
    }
    return opts;
  }, [channels]);

  const currentChannel = useMemo(
    () => channels.find((ch) => ch.id === selectedChannelId),
    [channels, selectedChannelId],
  );

  const handlePick = useCallback(
    (channelId: string, model: string) => {
      setSelectedChannel(channelId, model);
    },
    [setSelectedChannel],
  );

  useEffect(() => {
    const store = useAiConfigStore.getState();
    if (!store.loaded) {
      store.loadChannels();
    }
  }, []);

  const handleRefresh = useCallback(() => {
    useAiConfigStore.getState().loadChannels();
  }, []);

  // 触发器摘要：渠道·模型（与提示词面板 dropdown 同款）
  const summary = currentChannel
    ? selectedModel
      ? `${currentChannel.name} · ${selectedModel}`
      : currentChannel.name
    : loaded
      ? t('aiModelPicker.selectAiChannel')
      : t('aiModelPicker.loading');

  const accent = theme.toolbar.accent;
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const itemBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const hoverBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const selectedBg = isDark ? `${accent}33` : `${accent}1F`;

  return (
    <SettingsPopoverShell
      summary={summary}
      theme={theme}
      panelWidth={300}
      placement="topLeft"
      triggerVariant="dropdown"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 工具行：标题 + 刷新 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: text }}>
            <Cpu size={13} />
            {t('aiModelPicker.modalTitle')}
          </span>
          <Tooltip title={t('aiModelPicker.refreshChannel')}>
            <Button
              type="text"
              icon={<RefreshCw size={13} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />}
              onClick={handleRefresh}
              disabled={isLoading}
              style={{ width: 24, height: 24, padding: 0, color: textMuted }}
            />
          </Tooltip>
        </div>

        {loadError && !isLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 8,
              background: itemBg,
              color: theme.toolbar.danger,
              fontSize: 12,
            }}
          >
            <AlertCircle size={13} />
            <span style={{ flex: 1 }}>{loadError}</span>
            <Button type="text" size="small" onClick={handleRefresh} style={{ color: theme.toolbar.danger }}>
              {t('aiModelPicker.retry')}
            </Button>
          </div>
        ) : null}

        {/* 平铺模型列表（不分渠道分组） */}
        <SettingGroup title={t('aiModelPicker.selectModel')} color={textMuted}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }} className="zx-thin-scroll">
            {isLoading && flatModels.length === 0 ? (
              <div style={{ padding: 12, textAlign: 'center', color: textMuted, fontSize: 12 }}>{t('aiModelPicker.loading')}</div>
            ) : flatModels.length === 0 ? (
              <div style={{ padding: 12, textAlign: 'center', color: textMuted, fontSize: 12 }}>
                {loaded ? t('aiModelPicker.noAvailableChannels') : t('aiModelPicker.loading')}
              </div>
            ) : (
              flatModels.map((opt) => {
                const Icon = getModelIconComponent(opt.iconKey);
                const selected = opt.channelId === selectedChannelId && opt.model === selectedModel;
                return (
                  <PickerItem
                    key={`${opt.channelId}::${opt.model}`}
                    selected={selected}
                    accent={accent}
                    text={text}
                    selectedBg={selectedBg}
                    hoverBg={hoverBg}
                    onClick={() => handlePick(opt.channelId, opt.model)}
                  >
                    <Icon size={14} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>
                      {opt.model}
                    </span>
                    <span style={{ fontSize: 10, color: textMuted, flexShrink: 0, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {opt.channelName}
                    </span>
                    {selected ? <Check size={13} color={accent} /> : null}
                  </PickerItem>
                );
              })
            )}
          </div>
        </SettingGroup>
      </div>
    </SettingsPopoverShell>
  );
}

export type { ModelChannel } from '../../ai-config/index.js';

// ===== 面板选项行（选中/悬停高亮） =====

interface PickerItemProps {
  selected: boolean;
  accent: string;
  text: string;
  selectedBg: string;
  hoverBg: string;
  onClick: () => void;
  children: React.ReactNode;
}

function PickerItem({
  selected,
  accent,
  text,
  selectedBg,
  hoverBg,
  onClick,
  children,
}: PickerItemProps): React.ReactElement {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 10px',
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
