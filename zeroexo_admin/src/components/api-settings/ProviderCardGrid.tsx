/**
 * ProviderCardGrid - 通用预设/已配置 provider 卡片网格
 *
 * 左侧图标 + 标题 + 描述 + 已配置状态
 * 点击卡片进入配置/编辑页面
 */
import { ReactNode } from 'react';
import { Card, Row, Col, Tag, Spin, Empty, Switch, Checkbox, Pagination, Button, Tooltip } from 'antd';
import { Check, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BalanceDisplay } from './tabs/api-providers-types';

export interface ProviderCardItem {
  id?: string;
  label: string;
  provider: string;
  description?: string;
  icon?: ReactNode;
  color?: string;
  configured?: boolean;
  /** 渠道级启用状态（仅已配置渠道有意义；undefined 视为启用） */
  enabled?: boolean;
  /** 是否为默认渠道 */
  isDefault?: boolean;
  meta?: Record<string, any>;
  isPreset?: boolean;
}

interface ProviderCardGridProps {
  items: ProviderCardItem[];
  loading?: boolean;
  onSelect: (item: ProviderCardItem) => void;
  /** 渠道级启用/禁用切换回调 */
  onToggleEnabled?: (item: ProviderCardItem, enabled: boolean) => void;
  /** 设为默认渠道回调 */
  onSetDefault?: (item: ProviderCardItem) => void;
  /** 正在切换的渠道 id 集合（用于 Switch loading 态） */
  togglingIds?: Set<string>;
  /** 刷新渠道余额回调（Plan#17，仅 AI 渠道 Tab 传入） */
  onRefreshBalance?: (item: ProviderCardItem) => void;
  /** 正在刷新余额的渠道 id 集合（刷新按钮 loading 态） */
  refreshingBalanceIds?: Set<string>;
  emptyText?: string;
  /** 批量删除模式 */
  batchMode?: boolean;
  /** 已选中的 id 集合 */
  selectedIds?: Set<string>;
  /** 切换选中 */
  onToggleSelect?: (item: ProviderCardItem) => void;
  /** 分页相关 */
  pagination?: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
  };
}

export default function ProviderCardGrid({
  items,
  loading,
  onSelect,
  onToggleEnabled,
  onSetDefault,
  togglingIds,
  onRefreshBalance,
  refreshingBalanceIds,
  emptyText = '暂无可用服务',
  batchMode,
  selectedIds,
  onToggleSelect,
  pagination,
}: ProviderCardGridProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Card>
        <div
          style={{
            minHeight: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Spin tip="加载中...">
            <div style={{ padding: 24 }} />
          </Spin>
        </div>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <Empty description={emptyText} />
      </Card>
    );
  }

  return (
    <div>
      <Row gutter={[16, 16]}>
        {items.map((item, idx) => {
        const cardColor = item.color || 'var(--color-primary, #1677ff)';
        // 已配置渠道: enabled !== false 视为启用；未配置渠道默认关闭
        const isEnabled = item.configured ? item.enabled !== false : false;
        const showSwitch = !!onToggleEnabled;
        const isToggling = !!(item.id && togglingIds?.has(item.id));
        const isRefreshingBalance = !!(item.id && refreshingBalanceIds?.has(item.id));
        // 余额展示态（Plan#17，仅已配置 AI 渠道有值）
        const balance = item.meta?.balance as BalanceDisplay | undefined;

        return (
          <Col xs={24} md={12} key={item.id || `${item.provider}-${idx}`}>
            <Card
              hoverable={!batchMode}
              style={{
                borderRadius: 'var(--radius-lg, 8px)',
                borderLeft: item.configured
                  ? `3px solid ${cardColor}`
                  : '3px solid transparent',
                border: batchMode && selectedIds?.has(item.id!)
                  ? `1px solid ${cardColor}`
                  : undefined,
                background: batchMode && selectedIds?.has(item.id!)
                  ? 'var(--color-bg-selected, #eff6ff)'
                  : 'var(--color-bg-surface, #ffffff)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                overflow: 'hidden',
                opacity: item.configured && !isEnabled && !batchMode ? 0.55 : 1,
                height: '100%',
              }}
              styles={{ body: { padding: 16, position: 'relative', height: '100%' } }}
              onClick={() => {
                if (batchMode && onToggleSelect) {
                  onToggleSelect(item);
                } else {
                  onSelect(item);
                }
              }}
            >
              <Row
                align="top"
                gutter={12}
                style={{ height: '100%', display: 'flex', alignItems: 'flex-start' }}
              >
                {batchMode && onToggleSelect && (
                  <Col flex="none">
                    <div
                      style={{ paddingTop: 10 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={selectedIds?.has(item.id!)}
                        onChange={() => onToggleSelect(item)}
                      />
                    </div>
                  </Col>
                )}
                <Col flex="none">
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 'var(--radius-md, 6px)',
                      background: cardColor === 'var(--color-primary, #1677ff)'
                        ? 'var(--color-primary-light, #e6f4ff)'
                        : `${cardColor}15`,
                      color: cardColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                    }}
                  >
                    {item.icon}
                  </div>
                </Col>
                <Col flex="auto" style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      height: '100%',
                    }}
                  >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 4,
                      flexWrap: 'wrap',
                      width: '100%',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text-primary, #171717)' }}>
                      {item.label}
                    </span>
                    {item.configured && (
                      <Tag color="green" style={{ marginLeft: 0 }}>
                        <Check
                          size={10}
                          style={{ marginRight: 2, verticalAlign: -1 }}
                        />{' '}
                        已配置
                      </Tag>
                    )}
                    {item.configured && !isEnabled && (
                      <Tag color="default" style={{ marginLeft: 0 }}>
                        已禁用
                      </Tag>
                    )}
                    {item.isDefault && (
                      <Tag color="purple" style={{ marginLeft: 0 }}>
                        默认
                      </Tag>
                    )}
                    {item.configured && !item.isDefault && onSetDefault && !batchMode && (
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: 0, fontSize: 12, height: 'auto' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetDefault(item);
                        }}
                      >
                        设为默认
                      </Button>
                    )}
                    {showSwitch && (
                      <span
                        style={{ marginLeft: 'auto' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Switch
                          size="small"
                          checked={isEnabled}
                          loading={isToggling}
                          onChange={(checked) =>
                            onToggleEnabled!(item, checked)
                          }
                          disabled={batchMode}
                        />
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-secondary, #525252)',
                        lineHeight: 1.6,
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word',
                      }}
                    >
                      {item.description}
                    </div>
                  )}
                  {item.meta?.models && (
                    <div style={{ marginTop: 8 }}>
                      <Tag color="blue" style={{ fontSize: 11 }}>
                        {item.meta.models as string}
                      </Tag>
                    </div>
                  )}
                  {item.configured && balance && (
                    <div
                      style={{ marginTop: item.meta?.models ? 4 : 8, display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Tooltip
                        title={
                          balance.detail ||
                          (item.meta?.balanceCheckedAtTip as string) ||
                          undefined
                        }
                      >
                        <Tag
                          color={
                            balance.level === 'danger'
                              ? 'red'
                              : balance.level === 'warning'
                                ? 'orange'
                                : balance.level === 'ok'
                                  ? 'green'
                                  : 'default'
                          }
                          style={{ fontSize: 11, marginLeft: 0, cursor: 'default' }}
                        >
                          {balance.level === 'unknown'
                            ? `${t('ai.balance.label')}: ${t('ai.balance.notQueried')}`
                            : balance.level === 'unsupported'
                              ? `${t('ai.balance.label')}: ${t('ai.balance.unsupported')}`
                              : balance.level === 'error'
                                ? `${t('ai.balance.label')}: ${t('ai.balance.queryFailed')}`
                                : `${t('ai.balance.label')}: ${balance.text}`}
                        </Tag>
                      </Tooltip>
                      {onRefreshBalance && !batchMode && (
                        <Tooltip title={t('ai.balance.refresh')}>
                          <Button
                            type="text"
                            size="small"
                            style={{ padding: '0 4px', height: 20, fontSize: 11 }}
                            loading={isRefreshingBalance}
                            icon={!isRefreshingBalance ? <RefreshCw size={12} /> : undefined}
                            onClick={() => onRefreshBalance(item)}
                          />
                        </Tooltip>
                      )}
                    </div>
                  )}
                </div>
                </Col>
              </Row>
            </Card>
          </Col>
        );
      })}
    </Row>
    {pagination && (
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
        <Pagination
          current={pagination.current}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onChange={pagination.onChange}
          showSizeChanger
          showTotal={(total, range) => `${range[0]}-${range[1]} / 共 ${total} 条`}
        />
      </div>
    )}
    </div>
  );
}
