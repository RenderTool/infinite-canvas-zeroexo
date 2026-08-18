/**
 * ModelPicker - 模型/渠道选择器
 *
 * - 按 capability 筛选模型(启发式:模型名关键字)
 * - 按渠道分组显示("model(channelName)")
 * - 无模型时触发 onMissingConfig 回调(打开渠道设置)
 * - 事件隔离:stopPropagation 避免触发画布交互
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Tooltip } from 'antd';
import { ChevronDown, Cpu } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import {
  useAiConfigStore,
  modelOptionLabel,
  filterChannelModelsByCapability,
} from '../../ai-config/use-ai-config-store.js';
import type { ModelCapability, AiConfig } from '../../ai-config/use-ai-config-store.js';
import i18n from '@/i18n/config';

export interface ModelPickerProps {
  value: string;
  onChange: (model: string) => void;
  capability: ModelCapability;
  theme: ThemeConfig;
  onMissingConfig?: () => void;
  disabled?: boolean;
}

interface ChannelGroup {
  channelId: string;
  channelName: string;
  models: string[];
}

export function ModelPicker({
  value,
  onChange,
  capability,
  theme,
  onMissingConfig,
  disabled = false,
}: ModelPickerProps): React.ReactElement {
  const config = useAiConfigStore((state) => state.config);
  const loaded = useAiConfigStore((state) => state.loaded);
  const loadChannels = useAiConfigStore((state) => state.loadChannels);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Bug6: 若 channels 尚未加载(如刷新后未登录态打开 picker),触发后端拉取
  useEffect(() => {
    if (!loaded) {
      void loadChannels();
    }
  }, [loaded, loadChannels]);

  // Bug6: 按 capability 筛选(优先用后端 capabilities,回退启发式)+ 按渠道分组
  const groups = useMemo<ChannelGroup[]>(() => {
    const filtered = filterChannelModelsByCapability(config.channels, capability);
    const map = new Map<string, ChannelGroup>();
    for (const modelValue of filtered) {
      const channel = config.channels.find((ch) => modelValue.startsWith(`${ch.id}::`));
      const channelId = channel?.id ?? '';
      const channelName = channel?.name ?? '';
      if (!map.has(channelId)) map.set(channelId, { channelId, channelName, models: [] });
      map.get(channelId)!.models.push(modelValue);
    }
    return Array.from(map.values());
  }, [config, capability]);

  const hasModels = groups.some((g) => g.models.length > 0);
  const currentLabel = value ? modelOptionLabel(config, value) : '';

  const handleTriggerClick = useCallback(() => {
    if (disabled) return;
    if (!hasModels) {
      onMissingConfig?.();
      return;
    }
    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setOpen((prev) => !prev);
  }, [disabled, hasModels, onMissingConfig]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      // 面板内的点击由面板自己处理(选中后关闭)
      const panel = document.querySelector('[data-model-picker-panel="true"]');
      if (panel?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [open]);

  const handleSelect = useCallback(
    (model: string) => {
      onChange(model);
      setOpen(false);
    },
    [onChange],
  );

  const stopInteraction = (event: ReactPointerEvent): void => {
    event.stopPropagation();
  };

  return (
    <>
      <Tooltip title={currentLabel || undefined}>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={handleTriggerClick}
          onPointerDown={stopInteraction}
          onMouseDown={(event) => event.stopPropagation()}
          style={triggerStyle(theme, disabled)}
        >
          <Cpu size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span style={triggerTextStyle}>{currentLabel || placeholderForCapability(capability)}</span>
          <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
        </button>
        </Tooltip>
      {open && rect ? (
        <ModelPickerPanel
          rect={rect}
          groups={groups}
          value={value}
          theme={theme}
          config={config}
          capability={capability}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

// ===== 下拉面板(createPortal 到 document.body) =====

function ModelPickerPanel({
  rect,
  groups,
  value,
  theme,
  config,
  capability,
  onSelect,
  onClose,
}: {
  rect: DOMRect;
  groups: ChannelGroup[];
  value: string;
  theme: ThemeConfig;
  config: AiConfig;
  capability: ModelCapability;
  onSelect: (model: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const width = 280;
  const gap = 6;
  const margin = 8;
  const maxMenuHeight = 280;
  const left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.left));
  // Bug6: 菜单优先显示在触发元素上方(空间不够时回退到下方)
  const showAbove = rect.top - gap - maxMenuHeight >= margin;
  const top = showAbove ? Math.max(margin, rect.top - gap - maxMenuHeight) : rect.bottom + gap;

  const stopInteraction = (event: ReactPointerEvent): void => {
    event.stopPropagation();
  };

  // 滚动时关闭(避免定位漂移)
  useEffect(() => {
    const onScroll = () => onClose();
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [onClose]);

  return createPortal(
    <div
      data-model-picker-panel="true"
      ref={panelRef}
      style={{
        position: 'fixed',
        left,
        top,
        width,
        maxHeight: maxMenuHeight,
        overflowY: 'auto',
        zIndex: 9999,
        padding: 4,
        borderRadius: 12,
        border: `1px solid ${theme.toolbar.border}`,
        background: theme.toolbar.panel,
        boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
        backdropFilter: 'blur(8px)',
        color: theme.toolbar.text,
      }}
      onPointerDown={stopInteraction}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {groups.length === 0 || groups.every((g) => g.models.length === 0) ? (
        <div style={emptyStyle(theme.toolbar.textMuted)}>{emptyMessage(capability)}</div>
      ) : (
        groups.map((group) =>
          group.models.length === 0 ? null : (
            <div key={group.channelId} style={groupStyle}>
              {groups.length > 1 ? (
                <div style={groupLabelStyle(theme.toolbar.textMuted)}>{group.channelName}</div>
              ) : null}
              {group.models.map((modelValue) => {
                const label = modelOptionLabel(config, modelValue);
                const selected = modelValue === value;
                return (
                  <button
                    key={modelValue}
                    type="button"
                    style={itemStyle(theme, selected)}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onSelect(modelValue);
                    }}
                  >
                    <Cpu size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{label}</span>
                  </button>
                );
              })}
            </div>
          ),
        )
      )}
    </div>,
    document.body,
  );
}

// ===== 辅助 =====

function placeholderForCapability(capability: ModelCapability): string {
  switch (capability) {
    case 'image': return i18n.t('modelPicker.selectImageModel');
    case 'video': return i18n.t('modelPicker.selectVideoModel');
    case 'audio': return i18n.t('modelPicker.selectAudioModel');
    default: return i18n.t('modelPicker.selectTextModel');
  }
}

function emptyMessage(capability: ModelCapability): string {
  switch (capability) {
    case 'image': return i18n.t('modelPicker.noImageModels');
    case 'video': return i18n.t('modelPicker.noVideoModels');
    case 'audio': return i18n.t('modelPicker.noAudioModels');
    default: return i18n.t('modelPicker.noTextModels');
  }
}

// ===== 样式 =====

const triggerStyle = (theme: ThemeConfig, disabled: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  maxWidth: 200,
  padding: '0 10px',
  borderRadius: 9999,
  border: `1px solid ${theme.toolbar.border}`,
  background: 'transparent',
  color: theme.toolbar.text,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  fontSize: 12,
  transition: 'border-color 0.12s',
});

const triggerTextStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  textAlign: 'left',
  minWidth: 0,
};

const groupStyle: CSSProperties = {
  padding: '2px 0',
};

const groupLabelStyle = (textMuted: string): CSSProperties => ({
  fontSize: 10,
  fontWeight: 600,
  color: textMuted,
  padding: '4px 8px 2px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
});

const itemStyle = (theme: ThemeConfig, selected: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 8px',
  borderRadius: 8,
  border: 'none',
  background: selected ? `${theme.toolbar.accent}20` : 'transparent',
  color: selected ? theme.toolbar.accent : theme.toolbar.text,
  cursor: 'pointer',
  textAlign: 'left',
  fontSize: 12,
  transition: 'background 0.12s',
});

const emptyStyle = (textMuted: string): CSSProperties => ({
  padding: '12px 8px',
  fontSize: 12,
  color: textMuted,
  textAlign: 'center',
});
