import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Row, Col, Card, Tag, Button, message, Input, Select, Space, Modal, Table, Pagination,
} from 'antd';
import {
  ReloadOutlined, ExportOutlined, SearchOutlined,
  DollarOutlined, TeamOutlined, RiseOutlined, FallOutlined, WarningOutlined,
  BarChartOutlined, PieChartOutlined, TrophyOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { color as themeColor } from '@/design-tokens';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';
import { apiGet } from '@/services/api-client';
import EChartsCard from '@/components/EChartsCard';
import type { EChartsOption } from 'echarts';
import type { ColumnsType } from 'antd/es/table';

function cssVar(name: string, fallback: string): string {
  if (typeof document !== 'undefined') {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }
  return fallback;
}

interface BillingSummary {
  totalRevenue: number;
  payingUsers: number;
  arpu: number;
  overdueAmount: number;
  revenueChange: number;
  payingUsersChange: number;
  arpuChange: number;
  overdueChange: number;
}

interface OrderItem {
  orderId: string;
  userId: string;
  username: string;
  plan: string;
  period: string;
  amount: number;
  tokenUsage: number;
  paymentMethod: string;
  status: 'paid' | 'pending' | 'overdue' | 'refunded';
  createdAt: string;
}

interface RevenueItem {
  date: string;
  revenue: number;
  refund: number;
  net: number;
}

interface PlanDistributionItem {
  name: string;
  value: number;
}

interface TopConsumerItem {
  name: string;
  value: number;
}

type TimeRange = 'week' | 'month' | 'quarter' | 'year';
type DateFilter = 'all' | 'today' | 'week' | 'month' | 'quarter';
type StatusFilter = 'all' | 'paid' | 'pending' | 'overdue' | 'refunded';
type PlanFilter = 'all' | 'free' | 'pro' | 'team' | 'enterprise';



export default function AnalyticsBilling() {
  const { t } = useTranslation();

  const PLAN_OPTIONS = [
    { value: 'all', label: t('analytics.billing.filter.allPlans') },
    { value: 'free', label: t('analytics.billing.filter.free') },
    { value: 'pro', label: t('analytics.billing.filter.pro') },
    { value: 'team', label: t('analytics.billing.filter.team') },
    { value: 'enterprise', label: t('analytics.billing.filter.enterprise') },
  ];

  const STATUS_MAP: Record<string, { color: string; label: string }> = {
    paid: { color: 'green', label: t('analytics.billing.status.paid') },
    pending: { color: 'orange', label: t('analytics.billing.status.pending') },
    overdue: { color: 'red', label: t('analytics.billing.status.overdue') },
    refunded: { color: 'blue', label: t('analytics.billing.status.refunded') },
  };

  const PLAN_LABEL_MAP: Record<string, string> = {
    free: t('analytics.billing.filter.free'),
    pro: t('analytics.billing.filter.pro'),
    team: t('analytics.billing.filter.team'),
    enterprise: t('analytics.billing.filter.enterprise'),
  };

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [revenueData, setRevenueData] = useState<RevenueItem[]>([]);
  const [planDist, setPlanDist] = useState<PlanDistributionItem[]>([]);
  const [topConsumers, setTopConsumers] = useState<TopConsumerItem[]>([]);
  
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [searchText, setSearchText] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detailModal, setDetailModal] = useState<OrderItem | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, ordersRes, revenueRes, planRes, topRes] = await Promise.all([
        apiGet<BillingSummary>('/admin/billing/stats/summary').catch(() => null),
        apiGet<{ items: OrderItem[]; total: number }>('/admin/billing/orders').catch(() => ({ items: [], total: 0 })),
        apiGet<{ items: RevenueItem[] }>('/admin/billing/revenue-trend').catch(() => ({ items: [] })),
        apiGet<{ items: PlanDistributionItem[] }>('/admin/billing/plan-distribution').catch(() => ({ items: [] })),
        apiGet<{ items: TopConsumerItem[] }>('/admin/billing/top-consumers').catch(() => ({ items: [] })),
      ]);
      
      if (summaryRes) setSummary(summaryRes);
      setOrders(ordersRes.items || []);
      setRevenueData(revenueRes.items || []);
      setPlanDist(planRes.items || []);
      setTopConsumers(topRes.items || []);
    } catch {
      message.error(t('analytics.billing.message.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    fetchData();
    message.success(t('analytics.billing.message.refreshSuccess'));
  };

  const handleExport = () => {
    const headers = [
      t('analytics.billing.column.orderId'),
      t('analytics.billing.column.username'),
      t('analytics.billing.column.plan'),
      t('analytics.billing.column.period'),
      `${t('analytics.billing.column.amount')}(元)`,
      t('analytics.billing.column.tokenUsage'),
      t('analytics.billing.column.paymentMethod'),
      t('analytics.billing.column.status'),
      t('analytics.billing.column.createdAt'),
    ];
    const csvContent = [
      headers.join(','),
      ...filteredOrders.map(o => [
        o.orderId,
        o.username,
        PLAN_LABEL_MAP[o.plan] || o.plan,
        o.period,
        o.amount.toFixed(2),
        o.tokenUsage.toLocaleString(),
        o.paymentMethod,
        STATUS_MAP[o.status]?.label || o.status,
        new Date(o.createdAt).toLocaleString(),
      ].join(',')),
    ].join('\n');
    
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `billing-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success(t('analytics.billing.message.exportSuccess'));
  };

  const filteredOrders = orders.filter(o => {
    if (searchText) {
      const s = searchText.toLowerCase();
      if (!o.username.toLowerCase().includes(s) && !o.orderId.toLowerCase().includes(s)) {
        return false;
      }
    }
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (planFilter !== 'all' && o.plan !== planFilter) return false;
    if (dateFilter !== 'all') {
      const d = new Date(o.createdAt);
      const now = new Date();
      if (dateFilter === 'today') {
        if (d.toDateString() !== now.toDateString()) return false;
      } else if (dateFilter === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        if (d < weekAgo) return false;
      } else if (dateFilter === 'month') {
        if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
      } else if (dateFilter === 'quarter') {
        const q = Math.floor(now.getMonth() / 3);
        if (Math.floor(d.getMonth() / 3) !== q || d.getFullYear() !== now.getFullYear()) return false;
      }
    }
    return true;
  });

  const pagedOrders = filteredOrders.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const chartTextColor = cssVar('--color-text-secondary', '#595959');
  const chartBorderColor = cssVar('--color-border', '#f0f0f0');
  const chartSplitColor = cssVar('--color-bg-page', '#f5f5f5');
  const chartLabelColor = cssVar('--color-text-tertiary', '#bfbfbf');
  const chartSurfaceColor = cssVar('--color-bg-surface', '#ffffff');

  const revenueChartOption: EChartsOption | null = revenueData.length > 0 ? {
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartSurfaceColor,
      borderColor: chartBorderColor,
      textStyle: { color: cssVar('--color-text-primary', '#1a1a2e'), fontSize: 12 },
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params : [params];
        let html = p[0].axisValue + '<br/>';
        p.forEach((item: any) => {
          html += `${item.marker}${item.seriesName}: <strong>¥${Number(item.value).toLocaleString()}</strong><br/>`;
        });
        return html;
      },
    },
    legend: {
      data: [t('analytics.billing.chart.revenue'), t('analytics.billing.chart.refund'), t('analytics.billing.chart.netRevenue')],
      bottom: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { fontSize: 11, color: chartTextColor },
    },
    grid: { left: 55, right: 20, top: 10, bottom: 36 },
    xAxis: {
      type: 'category',
      data: revenueData.map((d) => d.date.slice(5)),
      axisLine: { lineStyle: { color: chartBorderColor } },
      axisLabel: { color: chartLabelColor, fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: {
        color: chartLabelColor,
        fontSize: 11,
        formatter: (v: number) => `¥${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`,
      },
      splitLine: { lineStyle: { color: chartSplitColor, type: 'dashed' } },
    },
    series: [
      {
        name: t('analytics.billing.chart.revenue'),
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: revenueData.map((d) => d.revenue),
        lineStyle: { color: themeColor.primary, width: 2.5 },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: `${themeColor.primary}40` },
              { offset: 1, color: `${themeColor.primary}05` },
            ],
          },
        },
      },
      {
        name: t('analytics.billing.chart.refund'),
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: revenueData.map((d) => d.refund),
        lineStyle: { color: themeColor.error, width: 2, type: 'dashed' },
      },
      {
        name: t('analytics.billing.chart.netRevenue'),
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: revenueData.map((d) => d.net),
        lineStyle: { color: themeColor.success, width: 2.5 },
      },
    ],
  } : null;

  const planChartOption: EChartsOption | null = planDist.length > 0 ? {
    tooltip: {
      trigger: 'item',
      backgroundColor: chartSurfaceColor,
      borderColor: chartBorderColor,
      textStyle: { color: cssVar('--color-text-primary', '#1a1a2e') },
      formatter: (params: any) => `${params.name}: ¥${Number(params.value).toLocaleString()} (${params.percent}%)`,
    },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['50%', '52%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 8, borderColor: chartSurfaceColor, borderWidth: 2 },
      label: { fontSize: 11, color: chartTextColor },
      labelLine: { lineStyle: { color: chartBorderColor } },
      data: planDist.map((p, i) => ({
        value: p.value,
        name: p.name,
        itemStyle: { color: [themeColor.primary, themeColor.success, themeColor.warning, themeColor.ai, '#13c2c2'][i % 5] },
      })),
    }],
  } : null;

  const topConsumerChartOption: EChartsOption | null = topConsumers.length > 0 ? {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: chartSurfaceColor,
      borderColor: chartBorderColor,
      textStyle: { color: cssVar('--color-text-primary', '#1a1a2e') },
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        return `${p.name}<br/>消费金额: <strong>¥${Number(p.value).toLocaleString()}</strong>`;
      },
    },
    grid: { left: 100, right: 50, top: 5, bottom: 20 },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: {
        color: chartLabelColor,
        fontSize: 11,
        formatter: (v: number) => `¥${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`,
      },
      splitLine: { lineStyle: { color: chartSplitColor, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: topConsumers.map((c) => c.name).reverse(),
      axisLine: { lineStyle: { color: chartBorderColor } },
      axisLabel: { color: chartTextColor, fontSize: 11 },
    },
    series: [{
      type: 'bar',
      data: topConsumers.map((c) => c.value).reverse(),
      barWidth: 14,
      itemStyle: {
        borderRadius: [0, 6, 6, 0],
        color: {
          type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
          colorStops: [
            { offset: 0, color: `${themeColor.primary}80` },
            { offset: 1, color: themeColor.primary },
          ],
        },
      },
      label: {
        show: true,
        position: 'right',
        fontSize: 11,
        color: chartTextColor,
        formatter: (params: any) => `¥${Number(params.value).toLocaleString()}`,
      },
    }],
  } : null;

  const columns: ColumnsType<OrderItem> = [
    {
      title: t('analytics.billing.column.action'),
      key: 'action',
      width: 70,
      fixed: 'left',
      render: (_: unknown, record: OrderItem) => (
        <Button
          size="small"
          type="link"
          icon={<EyeOutlined />}
          onClick={() => setDetailModal(record)}
          style={{ padding: '0 4px', fontSize: 12 }}
        >
          {t('analytics.billing.row.detail')}
        </Button>
      ),
    },
    {
      title: t('analytics.billing.column.orderId'),
      dataIndex: 'orderId',
      key: 'orderId',
      width: 180,
      sorter: (a, b) => a.orderId.localeCompare(b.orderId),
      render: (v: string) => <code style={{ fontSize: 12, color: chartTextColor }}>{v}</code>,
    },
    {
      title: t('analytics.billing.column.username'),
      dataIndex: 'username',
      key: 'username',
      width: 120,
      sorter: (a, b) => a.username.localeCompare(b.username),
    },
    {
      title: t('analytics.billing.column.plan'),
      dataIndex: 'plan',
      key: 'plan',
      width: 100,
      sorter: (a, b) => a.plan.localeCompare(b.plan),
      render: (v: string) => PLAN_LABEL_MAP[v] || v,
    },
    {
      title: t('analytics.billing.column.period'),
      dataIndex: 'period',
      key: 'period',
      width: 80,
      sorter: (a, b) => a.period.localeCompare(b.period),
    },
    {
      title: t('analytics.billing.column.amount'),
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
      align: 'right',
      sorter: (a, b) => a.amount - b.amount,
      render: (v: number) => (
        <span style={{
          fontWeight: 600,
          fontFamily: 'SF Mono, Fira Code, Consolas, monospace',
          color: v > 0 ? themeColor.success : undefined,
        }}>
          ¥{v.toLocaleString()}
        </span>
      ),
    },
    {
      title: t('analytics.billing.column.tokenUsage'),
      dataIndex: 'tokenUsage',
      key: 'tokenUsage',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.tokenUsage - b.tokenUsage,
      render: (v: number) => `${(v / 10000).toFixed(1)}万`,
    },
    {
      title: t('analytics.billing.column.paymentMethod'),
      dataIndex: 'paymentMethod',
      key: 'paymentMethod',
      width: 100,
      sorter: (a, b) => a.paymentMethod.localeCompare(b.paymentMethod),
    },
    {
      title: t('analytics.billing.column.status'),
      dataIndex: 'status',
      key: 'status',
      width: 90,
      sorter: (a, b) => a.status.localeCompare(b.status),
      render: (v: string) => {
        const s = STATUS_MAP[v] || { color: 'default', label: v };
        return <Tag color={s.color} style={{ margin: 0, borderRadius: 'var(--radius-sm, 4px)' }}>{s.label}</Tag>;
      },
    },
    {
      title: t('analytics.billing.column.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (v: string) => new Date(v).toLocaleString(),
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    },
  ];

  return (
    <BreadcrumbLayout
      items={[{ title: t('nav.analytics', '数据分析') }, { title: t('analytics.billing', '计费分析') }]}
      toolbar={
        <>
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            {t('analytics.billing.exportCsv')}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
            {t('common.refresh')}
          </Button>
        </>
      }
    >
      {/* KPI 卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={6}>
          <Card
            style={{ height: 120 }}
            styles={{ body: { padding: 16 } }}
            loading={loading}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--radius-md, 6px)',
                background: '#e6f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <DollarOutlined style={{ color: themeColor.primary }} />
              </div>
              <span style={{ fontSize: 13, color: chartTextColor }}>{t('analytics.billing.monthlyRevenue')}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
              ¥{summary?.totalRevenue?.toLocaleString() || '0'}
            </div>
            {summary && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <span style={{
                  color: summary.revenueChange >= 0 ? themeColor.success : themeColor.error,
                  display: 'inline-flex', alignItems: 'center', gap: 2,
                }}>
                  {summary.revenueChange >= 0 ? <RiseOutlined /> : <FallOutlined />}
                  {Math.abs(summary.revenueChange)}%
                </span>
                <span style={{ color: chartLabelColor, marginLeft: 4 }}>{t('analytics.billing.vsLastMonth')}</span>
              </div>
            )}
          </Card>
        </Col>

        <Col xs={12} sm={6}>
          <Card
            style={{ height: 120 }}
            styles={{ body: { padding: 16 } }}
            loading={loading}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--radius-md, 6px)',
                background: '#e7f8ee', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <TeamOutlined style={{ color: themeColor.success }} />
              </div>
              <span style={{ fontSize: 13, color: chartTextColor }}>{t('analytics.billing.payingUsers')}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
              {summary?.payingUsers?.toLocaleString() || '0'}
            </div>
            {summary && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <span style={{
                  color: summary.payingUsersChange >= 0 ? themeColor.success : themeColor.error,
                  display: 'inline-flex', alignItems: 'center', gap: 2,
                }}>
                  {summary.payingUsersChange >= 0 ? <RiseOutlined /> : <FallOutlined />}
                  {Math.abs(summary.payingUsersChange)}%
                </span>
                <span style={{ color: chartLabelColor, marginLeft: 4 }}>{t('analytics.billing.vsLastMonth')}</span>
              </div>
            )}
          </Card>
        </Col>

        <Col xs={12} sm={6}>
          <Card
            style={{ height: 120 }}
            styles={{ body: { padding: 16 } }}
            loading={loading}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--radius-md, 6px)',
                background: '#fff7e6', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <RiseOutlined style={{ color: themeColor.warning }} />
              </div>
              <span style={{ fontSize: 13, color: chartTextColor }}>{t('analytics.billing.arpu')}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
              ¥{summary?.arpu?.toFixed(2) || '0'}
            </div>
            {summary && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <span style={{
                  color: summary.arpuChange >= 0 ? themeColor.success : themeColor.error,
                  display: 'inline-flex', alignItems: 'center', gap: 2,
                }}>
                  {summary.arpuChange >= 0 ? <RiseOutlined /> : <FallOutlined />}
                  {Math.abs(summary.arpuChange)}%
                </span>
                <span style={{ color: chartLabelColor, marginLeft: 4 }}>{t('analytics.billing.vsLastMonth')}</span>
              </div>
            )}
          </Card>
        </Col>

        <Col xs={12} sm={6}>
          <Card
            style={{ height: 120 }}
            styles={{ body: { padding: 16 } }}
            loading={loading}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--radius-md, 6px)',
                background: '#fff1f0', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <WarningOutlined style={{ color: themeColor.error }} />
              </div>
              <span style={{ fontSize: 13, color: chartTextColor }}>{t('analytics.billing.overdueAmount')}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, color: summary?.overdueAmount ? themeColor.error : undefined }}>
              ¥{summary?.overdueAmount?.toLocaleString() || '0'}
            </div>
            {summary && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <span style={{
                  color: summary.overdueChange <= 0 ? themeColor.success : themeColor.error,
                  display: 'inline-flex', alignItems: 'center', gap: 2,
                }}>
                  {summary.overdueChange <= 0 ? <FallOutlined /> : <RiseOutlined />}
                  {Math.abs(summary.overdueChange)}%
                </span>
                <span style={{ color: chartLabelColor, marginLeft: 4 }}>{t('analytics.billing.vsLastMonth')}</span>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 收入趋势 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 600 }}>
                  <DollarOutlined style={{ color: themeColor.primary }} />
                  {t('analytics.billing.revenueTrend')}
                </span>
                <Space size={4}>
                  {(['week', 'month', 'quarter', 'year'] as TimeRange[]).map((range) => (
                    <Button
                      key={range}
                      size="small"
                      type={timeRange === range ? 'primary' : 'default'}
                      onClick={() => setTimeRange(range)}
                      style={{ fontSize: 12 }}
                    >
                      {range === 'week' ? t('analytics.billing.timeRange.week') : range === 'month' ? t('analytics.billing.timeRange.month') : range === 'quarter' ? t('analytics.billing.timeRange.quarter') : t('analytics.billing.timeRange.year')}
                    </Button>
                  ))}
                </Space>
              </div>
            }
            styles={{ body: { padding: '16px 16px 8px' } }}
          >
            <EChartsCard
              title=""
              option={revenueChartOption}
              loading={loading}
              height={280}
            />
          </Card>
        </Col>
      </Row>

      {/* 套餐占比 + 消费排行 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <PieChartOutlined style={{ color: themeColor.ai }} />
                {t('analytics.billing.planDistribution')}
              </span>
            }
            styles={{ body: { padding: '16px' } }}
          >
            <div style={{ height: 280 }}>
              {planChartOption ? (
                <EChartsCard
                  title=""
                  option={planChartOption}
                  loading={loading}
                  height={280}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: chartLabelColor }}>
                  {t('analytics.billing.noData')}
                </div>
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <TrophyOutlined style={{ color: themeColor.warning }} />
                {t('analytics.billing.topConsumers')}
              </span>
            }
            styles={{ body: { padding: '16px' } }}
          >
            <div style={{ height: 280 }}>
              {topConsumerChartOption ? (
                <EChartsCard
                  title=""
                  option={topConsumerChartOption}
                  loading={loading}
                  height={280}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: chartLabelColor }}>
                  {t('analytics.billing.noData')}
                </div>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* 筛选栏 */}
      <Card
        style={{ marginTop: 16 }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <Space size={16} wrap>
          <Input
            placeholder={t('analytics.billing.filter.search')}
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setCurrentPage(1); }}
            style={{ width: 240 }}
            allowClear
          />
          <Select
            placeholder={t('analytics.billing.filter.time')}
            value={dateFilter}
            onChange={(v) => { setDateFilter(v); setCurrentPage(1); }}
            style={{ width: 120 }}
          >
            <Select.Option value="all">{t('analytics.billing.filter.all')}</Select.Option>
            <Select.Option value="today">{t('analytics.billing.filter.today')}</Select.Option>
            <Select.Option value="week">{t('analytics.billing.filter.week')}</Select.Option>
            <Select.Option value="month">{t('analytics.billing.filter.month')}</Select.Option>
            <Select.Option value="quarter">{t('analytics.billing.filter.quarter')}</Select.Option>
          </Select>
          <Select
            placeholder={t('analytics.billing.filter.status')}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}
            style={{ width: 120 }}
          >
            <Select.Option value="all">{t('analytics.billing.filter.all')}</Select.Option>
            <Select.Option value="paid">{t('analytics.billing.status.paid')}</Select.Option>
            <Select.Option value="pending">{t('analytics.billing.status.pending')}</Select.Option>
            <Select.Option value="overdue">{t('analytics.billing.status.overdue')}</Select.Option>
            <Select.Option value="refunded">{t('analytics.billing.status.refunded')}</Select.Option>
          </Select>
          <Select
            placeholder={t('analytics.billing.filter.plan')}
            value={planFilter}
            onChange={(v) => { setPlanFilter(v); setCurrentPage(1); }}
            style={{ width: 140 }}
            options={PLAN_OPTIONS}
          />
        </Space>
      </Card>

      {/* 计费明细表格 */}
      <Card
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <BarChartOutlined style={{ color: themeColor.primary }} />
            {t('analytics.billing.billingDetail')}
          </span>
        }
        style={{ marginTop: 16, marginBottom: 24 }}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          columns={columns}
          dataSource={pagedOrders}
          rowKey="orderId"
          loading={loading}
          size="small"
          bordered
          sticky
          scroll={{ x: 1200 }}
          pagination={false}
        />
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 16px', borderTop: `1px solid ${chartBorderColor}`,
        }}>
          <span style={{ fontSize: 13, color: chartTextColor }}>
            {t('analytics.billing.totalRecords', { total: filteredOrders.length })}
          </span>
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            total={filteredOrders.length}
            onChange={(page) => setCurrentPage(page)}
            onShowSizeChange={(page, size) => {
              setPageSize(size);
              setCurrentPage(page);
            }}
            showSizeChanger
            showQuickJumper
            showTotal={(total) => t('analytics.billing.totalRecords', { total })}
          />
        </div>
      </Card>

      {/* 订单详情弹窗 */}
      <Modal
        title={t('analytics.billing.detail.title')}
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={null}
        width={520}
        centered
      >
        {detailModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '8px 16px', fontSize: 13 }}>
              <span style={{ color: chartTextColor }}>{t('analytics.billing.detail.orderId')}</span>
              <code>{detailModal.orderId}</code>
              
              <span style={{ color: chartTextColor }}>{t('analytics.billing.detail.username')}</span>
              <span style={{ fontWeight: 500 }}>{detailModal.username}</span>
              
              <span style={{ color: chartTextColor }}>{t('analytics.billing.detail.plan')}</span>
              <span>{PLAN_LABEL_MAP[detailModal.plan] || detailModal.plan}</span>
              
              <span style={{ color: chartTextColor }}>{t('analytics.billing.detail.period')}</span>
              <span>{detailModal.period}</span>
              
              <span style={{ color: chartTextColor }}>{t('analytics.billing.detail.amount')}</span>
              <span style={{ fontWeight: 600, color: detailModal.amount > 0 ? themeColor.success : undefined }}>
                ¥{detailModal.amount.toLocaleString()}
              </span>
              
              <span style={{ color: chartTextColor }}>{t('analytics.billing.detail.tokenUsage')}</span>
              <span>{detailModal.tokenUsage.toLocaleString()}</span>
              
              <span style={{ color: chartTextColor }}>{t('analytics.billing.detail.paymentMethod')}</span>
              <span>{detailModal.paymentMethod}</span>
              
              <span style={{ color: chartTextColor }}>{t('analytics.billing.detail.status')}</span>
              <Tag color={STATUS_MAP[detailModal.status]?.color} style={{ margin: 0 }}>
                {STATUS_MAP[detailModal.status]?.label || detailModal.status}
              </Tag>
              
              <span style={{ color: chartTextColor }}>{t('analytics.billing.detail.createdAt')}</span>
              <span>{new Date(detailModal.createdAt).toLocaleString()}</span>
            </div>
          </div>
        )}
      </Modal>
    </BreadcrumbLayout>
  );
}
