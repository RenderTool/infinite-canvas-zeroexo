/**
 * ImageSettingsPopover - 图片节点生成配置弹出面板
 *
 * 用 SettingsPopoverShell 包裹,面板内容: 质量 + 尺寸 + 数量。
 * 读写 node.data(quality/size/count),通过 onChange 回调上抛 patch。
 * 选项分组:常用比例(不含 2k/4k 变体)。
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import { Tooltip } from 'antd';
import {
  SettingsPopoverShell,
  SettingGroup,
  OptionPill,
  NumberInput,
} from './settings-popover-shell.js';
import {
  useAiConfigStore,
  getModelSpecs,
} from '../../ai-config/use-ai-config-store.js';

export interface ImageSettingsPopoverProps {
  /** Bug6: 当前模型值("channelId::model" 编码),用于获取后端 specs */
  model: string;
  /** 当前质量(auto/low/medium/high) */
  quality: string;
  /** 当前尺寸(auto 或 比例 或 WxH) */
  size: string;
  /** 当前生成数量 */
  count: number;
  theme: ThemeConfig;
  /** 配置变更回调,上抛 patch(如 { quality: 'high' }) */
  onChange: (patch: { quality?: string; size?: string; count?: number }) => void;
}

interface QualityOption {
  value: string;
  labelKey: string;
}

interface AspectOption {
  value: string;
  label: string;
  /** 用于在按钮上绘制比例框 */
  ratio: number;
}

const QUALITY_OPTIONS: QualityOption[] = [
  { value: 'auto', labelKey: 'prompt.imageQualityAuto' },
  { value: 'high', labelKey: 'prompt.imageQualityHigh' },
  { value: 'medium', labelKey: 'prompt.imageQualityMedium' },
  { value: 'low', labelKey: 'prompt.imageQualityLow' },
];

const ASPECT_OPTIONS: AspectOption[] = [
  { value: 'auto', label: 'auto', ratio: 0 },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '3:4', label: '3:4', ratio: 3 / 4 },
  { value: '3:2', label: '3:2', ratio: 3 / 2 },
  { value: '2:3', label: '2:3', ratio: 2 / 3 },
];

const QUICK_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MAX_COUNT = 15;

function qualityLabel(t: (key: string) => string, value: string): string {
  const opt = QUALITY_OPTIONS.find((o) => o.value === value);
  return opt ? t(opt.labelKey) : value;
}

function sizeLabel(value: string): string {
  const opt = ASPECT_OPTIONS.find((o) => o.value === value || o.value === 'auto');
  if (value === 'auto') return 'auto';
  // 精确匹配比例
  if (opt && opt.value === value) return opt.label;
  // WxH 格式直接显示
  return value;
}

export function ImageSettingsPopover({
  model,
  quality,
  size,
  count,
  theme,
  onChange,
}: ImageSettingsPopoverProps): React.ReactElement {
  const { t } = useTranslation();
  const config = useAiConfigStore((state) => state.config);
  // Bug6: 从后端 ModelConfig 获取 specs(动态配置规格)
  const specs = useMemo(() => getModelSpecs(config.channels, model), [config.channels, model]);

  const safeQuality = quality || 'auto';
  const safeSize = size || 'auto';
  const safeCount = Math.max(1, Math.min(MAX_COUNT, Math.floor(Math.abs(Number(count)) || 1)));

  // Bug6: 从 specs 提取动态规格(回退到常量)
  const qualities = useMemo(() => {
    if (!specs || !Array.isArray(specs.qualities)) return QUALITY_OPTIONS.map((o) => o.value);
    return specs.qualities.filter((v): v is string => typeof v === 'string');
  }, [specs]);
  const sizes = useMemo(() => {
    if (!specs || !Array.isArray(specs.sizes)) return ASPECT_OPTIONS.map((o) => o.value);
    return specs.sizes.filter((v): v is string => typeof v === 'string');
  }, [specs]);
  const maxCount = useMemo(() => {
    if (!specs || typeof specs.maxCount !== 'number') return MAX_COUNT;
    return Math.max(1, Math.min(MAX_COUNT, specs.maxCount));
  }, [specs]);

  const summary = useMemo(() => {
    return `${qualityLabel(t, safeQuality)} · ${sizeLabel(safeSize)} · ${safeCount}${t('prompt.imageCountUnit')}`;
  }, [t, safeQuality, safeSize, safeCount]);

  return (
    <SettingsPopoverShell summary={summary} theme={theme} panelWidth={320}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SettingGroup title={t('prompt.imageQualityTitle')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {QUALITY_OPTIONS.filter((opt) => qualities.includes(opt.value)).map((opt) => (
              <OptionPill
                key={opt.value}
                selected={safeQuality === opt.value}
                theme={theme}
                onClick={() => onChange({ quality: opt.value })}
              >
                {t(opt.labelKey)}
              </OptionPill>
            ))}
          </div>
        </SettingGroup>

        <SettingGroup title={t('prompt.imageSizeTitle')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {ASPECT_OPTIONS.filter((opt) => sizes.includes(opt.value)).map((opt) => (
              <AspectButton
                key={opt.value}
                value={opt.value}
                label={opt.label}
                ratio={opt.ratio}
                selected={safeSize === opt.value}
                theme={theme}
                onClick={() => onChange({ size: opt.value })}
              />
            ))}
          </div>
        </SettingGroup>

        <SettingGroup title={t('prompt.imageCountTitle')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {QUICK_COUNTS.filter((n) => n <= maxCount).map((n) => (
              <OptionPill
                key={n}
                selected={safeCount === n}
                theme={theme}
                onClick={() => onChange({ count: n })}
              >
                {n}
              </OptionPill>
            ))}
            <NumberInput
              value={String(safeCount)}
              min={1}
              max={maxCount}
              theme={theme}
              onChange={(value) => {
                const n = Math.max(1, Math.min(maxCount, Math.floor(Number(value) || 1)));
                onChange({ count: n });
              }}
            />
          </div>
        </SettingGroup>
      </div>
    </SettingsPopoverShell>
  );
}

/** 比例按钮: 上方比例框 + 下方标签 */
function AspectButton({
  value,
  label,
  ratio,
  selected,
  theme,
  onClick,
}: {
  value: string;
  label: string;
  ratio: number;
  selected: boolean;
  theme: ThemeConfig;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Tooltip title={value}>
      <button
        type="button"
        onClick={onClick}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          height: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          borderRadius: 10,
          border: `1px solid ${selected ? theme.toolbar.text : theme.toolbar.border}`,
          background: 'transparent',
          color: theme.toolbar.text,
          cursor: 'pointer',
          fontSize: 12,
          transition: 'opacity 0.12s',
        }}
      >
      <AspectIcon ratio={ratio} color={theme.toolbar.text} />
      <span>{label}</span>
    </button>
    </Tooltip>
  );
}

/** 比例示意框(auto 时显示文字) */
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
