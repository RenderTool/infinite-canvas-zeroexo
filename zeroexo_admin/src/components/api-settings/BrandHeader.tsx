/**
 * BrandHeader - AI 品牌详情页头部区域
 *
 * 包含：
 *   - 品牌图标 / Logo 显示（支持自定义 URL、自定义图标 provider、默认品牌图标）
 *   - 品牌名称、官方/自定义徽标、描述
 *   - 保存状态指示（已保存 / 保存中 / 未保存）
 *   - 模板按钮、删除按钮
 *   - 测试连接结果提示（含原始模型 ID 折叠展示）
 *
 * 该组件为纯展示 + 回调型组件，所有数据由父组件 AiBrandDetail 通过 props 传入。
 */
import type { FC } from 'react';
import { Badge, Button, Space, Spin, Tooltip } from 'antd';
import { CheckCircle, XCircle, FileText, Trash2, RefreshCw, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BRAND_ICONS, DefaultBrandIcon, type BrandIconProps } from './brand-icons';
import type { BalanceDisplay } from './tabs/api-providers-types';

export interface BrandHeaderProps {
  /** 品牌预设信息 */
  brandPreset: {
    provider: string;
    label: string;
    description: string;
  };
  /** 是否为预设品牌 */
  isPreset: boolean;
  /** 品牌主色（用于背景、边框） */
  brandColor: string;
  /** 自定义 Logo URL（优先级最高） */
  logoUrlValue: string;
  /** 自定义图标 provider（优先级次于 logoUrlValue） */
  logoProviderValue: string;
  /** 默认品牌图标组件 */
  BrandIconComponent: FC<BrandIconProps>;
  /** 保存状态 */
  saveStatus: 'saved' | 'saving' | 'dirty';
  /** 已存在的渠道记录（用于判断删除按钮可见性等） */
  existingRecord?: {
    id: string;
    isDefault: boolean;
  };
  /** 删除渠道回调 */
  onDelete?: (item: { id: string; label: string }) => void;
  /** 是否正在删除渠道 */
  deletingChannel: boolean;
  /** 设置删除中状态 */
  setDeletingChannel: (value: boolean) => void;
  /** 打开模板编辑器 */
  onOpenTemplate: () => void;
  /** 测试连接结果 */
  testResult: { ok: boolean; message: string } | null;
  /** API 原始返回的模型 ID 列表（用于折叠展示） */
  rawModelIds: string[] | null;
  /** 余额展示态（Plan#17；未配置渠道时为 undefined） */
  balanceDisplay?: BalanceDisplay;
  /** 上次余额查询时间（悬浮提示用） */
  balanceCheckedAt?: string | null;
  /** 刷新余额回调 */
  onRefreshBalance?: () => void;
  /** 余额刷新中 */
  balanceRefreshing?: boolean;
}

/** 余额级别 → 展示色 */
const BALANCE_COLORS: Record<string, string> = {
  ok: '#52c41a',
  warning: '#fa8c16',
  danger: '#f5222d',
  error: '#f5222d',
  unsupported: '#8c8c8c',
  unknown: '#8c8c8c',
};

export default function BrandHeader({
  brandPreset,
  isPreset,
  brandColor,
  logoUrlValue,
  logoProviderValue,
  BrandIconComponent,
  saveStatus,
  existingRecord,
  onDelete,
  deletingChannel,
  setDeletingChannel,
  onOpenTemplate,
  testResult,
  rawModelIds,
  balanceDisplay,
  balanceCheckedAt,
  onRefreshBalance,
  balanceRefreshing,
}: BrandHeaderProps) {
  const { t } = useTranslation();

  // 余额标签文案（三态 + 警示分级）
  const balanceLabel = balanceDisplay
    ? balanceDisplay.level === 'unknown'
      ? t('ai.balance.notQueried')
      : balanceDisplay.level === 'unsupported'
        ? t('ai.balance.unsupported')
        : balanceDisplay.level === 'error'
          ? t('ai.balance.queryFailed')
          : balanceDisplay.text
    : null;
  const balanceTip = balanceDisplay
    ? balanceDisplay.detail ||
      (balanceCheckedAt
        ? t('ai.balance.checkedAt', { time: new Date(balanceCheckedAt).toLocaleString() })
        : undefined)
    : undefined;

  return (
    <>
      {/* ─── 品牌头部 ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 20,
          padding: 16,
          background: `${brandColor}08`,
          borderRadius: 6,
          border: `1px solid ${brandColor}20`,
        }}
      >
        <div style={{ flexShrink: 0, lineHeight: 0 }}>
          {logoUrlValue ? (
            <img
              src={logoUrlValue}
              alt={brandPreset.label}
              style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover' }}
            />
          ) : logoProviderValue ? (
            (() => {
              const Icon = BRAND_ICONS[logoProviderValue] || DefaultBrandIcon;
              return <Icon size={44} />;
            })()
          ) : (
            <BrandIconComponent size={44} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 600 }}>
              {brandPreset.label}
            </span>
            <Badge
              count={isPreset ? '官方' : '自定义'}
              style={{
                backgroundColor: isPreset ? '#52c41a' : '#faad14',
                fontSize: 11,
                fontWeight: 400,
              }}
            />
            {/* 余额徽标（Plan#17：支持/不支持/未查询三态 + 欠费/低余额警示色） */}
            {balanceDisplay && balanceLabel && (
              <Tooltip title={balanceTip}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 12,
                    padding: '1px 8px',
                    borderRadius: 10,
                    color: BALANCE_COLORS[balanceDisplay.level] || '#8c8c8c',
                    background: `${BALANCE_COLORS[balanceDisplay.level] || '#8c8c8c'}14`,
                    cursor: 'default',
                  }}
                >
                  <Wallet size={12} />
                  {t('ai.balance.label')} {balanceLabel}
                  {balanceDisplay.level === 'danger' && `（${t('ai.balance.depleted')}）`}
                  {balanceDisplay.level === 'warning' && `（${t('ai.balance.low')}）`}
                </span>
              </Tooltip>
            )}
          </div>
          {brandPreset.description && (
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>
              {brandPreset.description}
            </div>
          )}
        </div>
        {/* 操作按钮组 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 4,
              backgroundColor:
                saveStatus === 'saving'
                  ? '#f0f5ff'
                  : saveStatus === 'dirty'
                  ? '#fff7e6'
                  : '#f6ffed',
              color:
                saveStatus === 'saving'
                  ? '#1890ff'
                  : saveStatus === 'dirty'
                  ? '#fa8c16'
                  : '#52c41a',
            }}
          >
            {saveStatus === 'saving' ? (
              <Spin size="small" style={{ marginRight: 4 }} />
            ) : saveStatus === 'dirty' ? (
              <span>✏️</span>
            ) : (
              <span>✓</span>
            )}
            {saveStatus === 'saving' ? '保存中...' : saveStatus === 'dirty' ? '未保存' : '已保存'}
          </div>
        <Space>
          {existingRecord?.id && onRefreshBalance && (
            <Button
              size="small"
              type="primary"
              ghost
              icon={<RefreshCw size={14} />}
              loading={balanceRefreshing}
              onClick={onRefreshBalance}
            >
              {balanceRefreshing ? t('ai.balance.refreshing') : t('ai.balance.refresh')}
            </Button>
          )}
          <Button size="small" icon={<FileText size={14} />} onClick={onOpenTemplate}>
            模板
          </Button>
          {existingRecord?.id && onDelete && !existingRecord.isDefault && (
            <Button
              size="small"
              danger
              icon={<Trash2 size={14} />}
              onClick={() => {
                if (deletingChannel) return;
                setDeletingChannel(true);
                onDelete({ id: existingRecord.id!, label: brandPreset.label });
                setTimeout(() => setDeletingChannel(false), 500);
              }}
            >
              删除
            </Button>
          )}
        </Space>
        </div>
      </div>

      {/* ─── 测试结果提示 ─── */}
      {testResult && (
        <>
          <div
            style={{
              padding: '8px 12px',
              marginBottom: 16,
              borderRadius: 4,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: testResult.ok ? '#f6ffed' : '#fff2f0',
              border: `1px solid ${testResult.ok ? '#b7eb8f' : '#ffccc7'}`,
              color: testResult.ok ? '#389e0d' : '#cf1322',
            }}
          >
            {testResult.ok ? (
              <CheckCircle size={16} />
            ) : (
              <XCircle size={16} />
            )}
            <span>{testResult.message}</span>
          </div>
          {rawModelIds && rawModelIds.length > 0 && (
            <details style={{ margin: '-8px 0 16px', fontSize: 12, color: '#8c8c8c' }}>
              <summary style={{ cursor: 'pointer' }}>
                API 原始返回 {rawModelIds.length} 个模型 ID（点击展开）
              </summary>
              <pre style={{ maxHeight: 200, overflow: 'auto', padding: 8, background: '#fafafa', borderRadius: 4, marginTop: 4, fontSize: 11, lineHeight: 1.6 }}>
                {rawModelIds.join('\n')}
              </pre>
            </details>
          )}
        </>
      )}
    </>
  );
}
