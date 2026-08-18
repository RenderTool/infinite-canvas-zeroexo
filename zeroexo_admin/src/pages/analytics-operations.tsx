import { useState, useEffect, useRef, useCallback } from 'react';
import { StatisticCard } from '@ant-design/pro-components';
import { Row, Col, Card, Tag, Button, message, Tooltip, Switch, Select, Space } from 'antd';
import { useAuth } from '@/contexts/auth';
import {
  UserOutlined, ProjectOutlined, ThunderboltOutlined, ReloadOutlined,
  FileTextOutlined, RocketOutlined, TeamOutlined, ClockCircleOutlined,
  CheckCircleOutlined, DatabaseOutlined, CloudServerOutlined,
  BarChartOutlined, LineChartOutlined,
} from '@ant-design/icons';
import { apiGet } from '@/services/api-client';
import EChartsCard from '@/components/EChartsCard';
import type { EChartsOption } from 'echarts';
import { BRAND_ICONS, BRAND_COLORS } from '@/components/api-settings/brand-icons';
import { color as themeColor } from '@/design-tokens';
import { useTranslation } from 'react-i18next';

function cssVar(name: string, fallback: string): string {
  if (typeof document !== 'undefined') {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }
  return fallback;
}

interface UsersAnalytics {
  total: number;
  new: number;
  active: number;
}

interface ProjectsAnalytics {
  total: number;
  new: number;
}

interface TopUser {
  username: string;
  projects: number;
  aiCalls: number;
}

interface ActiveUser {
  username: string;
  email: string;
  lastActive: string;
  projectCount: number;
  promptCount: number;
  aiCallCount: number;
}

interface ServiceHealth {
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

interface InfraHealth {
  database: ServiceHealth;
  redis: ServiceHealth & { configured: boolean };
}

interface MonitoringData {
  cpu: number;
  memory: number;
  storageUsed: number;
  storageTotal: number;
  uptime: string;
  activeConnections: number;
  requestsPerSecond: number;
  errorRate: number;
}

interface DailyItem {
  date: string;
  [key: string]: string | number;
}

interface ModelDistItem {
  name: string;
  value: number;
}

export default function AnalyticsOperations() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [usersAna, setUsersAna] = useState<UsersAnalytics | null>(null);
  const [projectsAna, setProjectsAna] = useState<ProjectsAnalytics | null>(null);
  const [, setTopUsers] = useState<TopUser[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [activeProviders, setActiveProviders] = useState(0);
  const [monitoring, setMonitoring] = useState<MonitoringData | null>(null);
  const [health, setHealth] = useState<InfraHealth | null>(null);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [userGrowth, setUserGrowth] = useState<DailyItem[]>([]);
  const [aiCallsTrend, setAiCallsTrend] = useState<DailyItem[]>([]);
  const [modelDist, setModelDist] = useState<ModelDistItem[]>([]);
  const [tokenTrend, setTokenTrend] = useState<DailyItem[]>([]);
  const [resourceGrowth, setResourceGrowth] = useState<DailyItem[]>([]);

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<number>(30);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tokenModel, setTokenModel] = useState<string>('');
  const tokenModelRef = useRef<string>('');
  // 请求序号：用于丢弃过期响应，避免自动刷新/手动刷新/模型切换并发时旧数据覆盖新数据
  const fetchSeqRef = useRef(0);

  const fetchTokenTrend = async (model: string) => {
    try {
      const query = model ? `?model=${encodeURIComponent(model)}` : '';
      const result = await apiGet<{ items: DailyItem[] }>(`/admin/analytics/token-trend${query}`);
      setTokenTrend(result.items || []);
    } catch { /* ignore */ }
  };

  const fetchMonitoring = async () => {
    try {
      const result = await apiGet<MonitoringData>('/admin/monitoring');
      setMonitoring(result);
    } catch { /* ignore */ }
  };

  const fetchHealth = async () => {
    try {
      const result = await apiGet<InfraHealth>('/admin/monitoring/health');
      setHealth(result);
    } catch { /* ignore */ }
  };

  const fetchActiveUsers = async () => {
    try {
      const result = await apiGet<{ items: ActiveUser[] }>('/admin/analytics/active-users');
      setActiveUsers(result.items || []);
    } catch { /* ignore */ }
  };

  const fetchAll = async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    const [
      usersResult, projectsResult, usersTopResult, logsResult, providersResult,
      growthResult, callsTrendResult, modelsResult, resGrowthResult,
    ] = await Promise.all([
      apiGet<UsersAnalytics>('/admin/analytics/users').catch(() => null),
      apiGet<ProjectsAnalytics>('/admin/analytics/projects').catch(() => null),
      apiGet<{ items: TopUser[] }>('/admin/analytics/top-users').catch(() => null),
      apiGet<{ stats: { total: number } }>('/admin/logs').catch(() => ({ stats: { total: 0 } })),
      apiGet<{ items: { enabled: boolean }[] }>('/admin/api-providers?type=ai').catch(() => ({ items: [] })),
      apiGet<{ items: DailyItem[] }>('/admin/analytics/user-growth').catch(() => ({ items: [] })),
      apiGet<{ items: DailyItem[] }>('/admin/analytics/ai-calls-trend').catch(() => ({ items: [] })),
      apiGet<{ items: ModelDistItem[] }>('/admin/analytics/model-distribution').catch(() => ({ items: [] })),
      apiGet<{ items: DailyItem[] }>('/admin/analytics/resource-growth').catch(() => ({ items: [] })),
    ]);
    // 过期响应（已有更新的请求发出）直接丢弃
    if (seq !== fetchSeqRef.current) return;
    
    const updates: (() => void)[] = [];
    if (usersResult) updates.push(() => setUsersAna(usersResult));
    if (projectsResult) updates.push(() => setProjectsAna(projectsResult));
    if (usersTopResult) updates.push(() => setTopUsers(usersTopResult.items || []));
    updates.push(() => setTotalLogs(logsResult?.stats?.total || 0));
    updates.push(() => setActiveProviders(providersResult?.items?.filter((p) => p.enabled).length ?? 0));
    if (growthResult) updates.push(() => setUserGrowth(growthResult.items || []));
    if (callsTrendResult) updates.push(() => setAiCallsTrend(callsTrendResult.items || []));
    if (modelsResult) updates.push(() => setModelDist(modelsResult.items || []));
    if (resGrowthResult) updates.push(() => setResourceGrowth(resGrowthResult.items || []));
    
    updates.forEach((update) => update());
    
    fetchTokenTrend(tokenModelRef.current);
    fetchMonitoring();
    fetchHealth();
    fetchActiveUsers();
    
    if (seq !== fetchSeqRef.current) return;
    requestAnimationFrame(() => {
      setLoading(false);
    });
  };

  const stopAutoRefreshTimer = useCallback(() => {
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }
  }, []);

  const startAutoRefreshTimer = useCallback(() => {
    stopAutoRefreshTimer();
    autoRefreshTimerRef.current = setInterval(() => {
      fetchAll();
    }, refreshInterval * 1000);
  }, [refreshInterval, stopAutoRefreshTimer]);

  useEffect(() => {
    if (authLoading || !user) return;
    
    fetchAll();

    if (autoRefresh) {
      startAutoRefreshTimer();
    } else {
      stopAutoRefreshTimer();
    }

    return () => {
      stopAutoRefreshTimer();
    };
  }, [authLoading, user, autoRefresh, startAutoRefreshTimer, stopAutoRefreshTimer]);

  const formatUptime = (seconds: string) => {
    const s = parseInt(seconds) || 0;
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(`${d}${t('analytics.operations.days')}`);
    if (h > 0) parts.push(`${h}${t('analytics.operations.hours')}`);
    parts.push(`${m}${t('analytics.operations.minutes')}`);
    return parts.join(' ');
  };

  const getBrandKey = (modelName: string): string => {
    const lower = modelName.toLowerCase();
    for (const key of Object.keys(BRAND_ICONS)) {
      if (key === 'default') continue;
      if (lower.startsWith(key) || lower.includes(`/${key}/`) || lower.includes(`-${key}-`)) {
        return key;
      }
    }
    const knownBrands = ['openai', 'anthropic', 'gemini', 'deepseek', 'stability', 'volcengine', 'bailian', 'siliconflow', 'qwen', 'doubao', 'zhipu', 'grok', 'minimax', 'moonshot', 'kimi', 'hunyuan'];
    for (const brand of knownBrands) {
      if (lower.includes(brand)) return brand;
    }
    return 'default';
  };

  const formatModelName = (name: string): string => {
    if (!name) return '-';
    if (/^[a-f0-9]{32,64}$/i.test(name) || /^[a-f0-9]{8}-/i.test(name)) {
      return t('analytics.operations.unknownModel');
    }
    let formatted = name.replace(/^(channel|provider|source|model):/i, '');
    if (formatted.includes('/')) {
      const parts = formatted.split('/');
      formatted = parts[parts.length - 1];
    }
    if (formatted.includes(':')) {
      const parts = formatted.split(':');
      formatted = parts[parts.length - 1];
    }
    formatted = formatted.trim().replace(/^["']|["']$/g, '');
    return formatted || t('analytics.operations.unknownModel');
  };

  const statCards = [
    { title: t('analytics.operations.stat.totalUsers'), value: usersAna?.total || 0, suffix: t('analytics.operations.unit.people'), color: themeColor.primary, icon: <UserOutlined /> },
    { title: t('analytics.operations.stat.newUsers'), value: usersAna?.new || 0, suffix: t('analytics.operations.unit.people'), color: themeColor.success, icon: <UserOutlined /> },
    { title: t('analytics.operations.stat.activeUsers'), value: usersAna?.active || 0, suffix: t('analytics.operations.unit.people'), color: themeColor.ai, icon: <ThunderboltOutlined /> },
    { title: t('analytics.operations.stat.totalProjects'), value: projectsAna?.total || 0, suffix: t('analytics.operations.unit.items'), color: '#13c2c2', icon: <ProjectOutlined /> },
    { title: t('analytics.operations.stat.totalLogs'), value: totalLogs, suffix: t('analytics.operations.unit.logs'), color: themeColor.warning, icon: <FileTextOutlined /> },
    { title: t('analytics.operations.stat.activeChannels'), value: activeProviders, suffix: t('analytics.operations.unit.channels'), color: '#eb2f96', icon: <RocketOutlined /> },
  ];

  const allOk = health?.database.ok && (!health?.redis.configured || health?.redis.ok);

  const chartTextColor = cssVar('--color-text-secondary', '#595959');
  const chartBorderColor = cssVar('--color-border', '#f0f0f0');
  const chartSplitColor = cssVar('--color-bg-page', '#f5f5f5');
  const chartLabelColor = cssVar('--color-text-tertiary', '#bfbfbf');

  const userGrowthOption: EChartsOption | null = userGrowth.length > 0 ? {
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: chartBorderColor, borderWidth: 1, textStyle: { fontSize: 12 } },
    legend: { data: [t('analytics.operations.legend.newUsers'), t('analytics.operations.legend.cumulativeUsers')], bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 11, color: chartTextColor } },
    grid: { left: 45, right: 16, top: 10, bottom: 36 },
    xAxis: { type: 'category', data: userGrowth.map((d) => d.date.slice(5)), axisLabel: { fontSize: 10, color: chartLabelColor }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: [
      { type: 'value', splitLine: { lineStyle: { color: chartSplitColor, type: 'dashed' } }, axisLabel: { fontSize: 10, color: chartLabelColor } },
      { type: 'value', splitLine: { show: false }, axisLabel: { fontSize: 10, color: chartLabelColor } },
    ],
    series: [
      { name: t('analytics.operations.legend.newUsers'), type: 'bar', barWidth: 8, itemStyle: { borderRadius: [4, 4, 0, 0], color: themeColor.primary }, data: userGrowth.map((d) => d.newUsers) },
      { name: t('analytics.operations.legend.cumulativeUsers'), type: 'line', yAxisIndex: 1, smooth: true, symbol: 'none', lineStyle: { width: 2, color: themeColor.success },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${themeColor.success}26` }, { offset: 1, color: `${themeColor.success}05` }] } },
        data: userGrowth.map((d) => d.cumulative) },
    ],
  } : null;

  const aiCallsColors = [themeColor.primary, themeColor.success, themeColor.warning, themeColor.ai];
  const aiCallsOption: EChartsOption | null = aiCallsTrend.length > 0 ? {
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: chartBorderColor, borderWidth: 1, textStyle: { fontSize: 12 } },
    legend: { data: [t('analytics.operations.legend.text'), t('analytics.operations.legend.image'), t('analytics.operations.legend.video'), t('analytics.operations.legend.audio')], bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 11, color: chartTextColor } },
    grid: { left: 45, right: 16, top: 10, bottom: 36 },
    xAxis: { type: 'category', data: aiCallsTrend.map((d) => d.date.slice(5)), axisLabel: { fontSize: 10, color: chartLabelColor }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: chartSplitColor, type: 'dashed' } }, axisLabel: { fontSize: 10, color: chartLabelColor } },
    series: (['text', 'image', 'video', 'audio'] as const).map((kind, i) => ({
      name: t(`analytics.operations.legend.${kind}`), type: 'line' as const, smooth: true, symbol: 'none',
      lineStyle: { width: 2, color: aiCallsColors[i] },
      data: aiCallsTrend.map((d) => d[kind] || 0),
    })),
  } : null;

  const sortedModelDist = [...modelDist].sort((a, b) => b.value - a.value).slice(0, 10);
  const maxModelValue = sortedModelDist.length > 0 ? Math.max(...sortedModelDist.map((d) => d.value)) : 1;

  const tokenTrendOption: EChartsOption | null = tokenTrend.length > 0 ? {
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: chartBorderColor, borderWidth: 1, textStyle: { fontSize: 12 }, formatter: (params: any) => {
      const p = Array.isArray(params) ? params[0] : params;
      return `${p.axisValue}<br/>${p.seriesName}: ${Number(p.value).toLocaleString()} tokens`;
    } },
    grid: { left: 55, right: 16, top: 10, bottom: 24 },
    xAxis: { type: 'category', data: tokenTrend.map((d) => d.date.slice(5)), axisLabel: { fontSize: 10, color: chartLabelColor }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: chartSplitColor, type: 'dashed' } }, axisLabel: { fontSize: 10, color: chartLabelColor, formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v) } },
    series: [{
      name: tokenModel || t('analytics.operations.allModels'),
      type: 'line', smooth: true, symbol: 'none',
      lineStyle: { width: 2, color: themeColor.ai },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${themeColor.ai}26` }, { offset: 1, color: `${themeColor.ai}05` }] } },
      data: tokenTrend.map((d) => d.tokens || 0),
    }],
  } : null;

  const resGrowthColors = [themeColor.primary, themeColor.success, themeColor.warning, '#d9d9d9'];
  const resGrowthOption: EChartsOption | null = resourceGrowth.length > 0 ? {
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: chartBorderColor, borderWidth: 1, textStyle: { fontSize: 12 } },
    legend: { data: [t('analytics.operations.legend.images'), t('analytics.operations.legend.videos'), t('analytics.operations.legend.audios'), t('analytics.operations.legend.others')], bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 11, color: chartTextColor } },
    grid: { left: 45, right: 16, top: 10, bottom: 36 },
    xAxis: { type: 'category', data: resourceGrowth.map((d) => d.date.slice(5)), axisLabel: { fontSize: 10, color: chartLabelColor }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: chartSplitColor, type: 'dashed' } }, axisLabel: { fontSize: 10, color: chartLabelColor } },
    series: (['images', 'videos', 'audios', 'others'] as const).map((kind, i) => ({
      name: t(`analytics.operations.legend.${kind}`), type: 'bar' as const, stack: 'total', barWidth: 12,
      itemStyle: { borderRadius: 0, color: resGrowthColors[i] },
      data: resourceGrowth.map((d) => d[kind] || 0),
    })),
  } : null;

  const handleRefresh = () => {
    fetchAll();
    message.success(t('analytics.operations.message.refreshSuccess'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: '24px 32px 0', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 24 }}>
        <div style={{ flex: 1 }} />
        <Space size={8}>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary, #595959)' }}>{t('analytics.operations.autoRefresh')}</span>
          <Switch
            size="small"
            checked={autoRefresh}
            onChange={(checked) => setAutoRefresh(checked)}
          />
          {autoRefresh && (
            <Select
              size="small"
              value={refreshInterval}
              onChange={(val) => setRefreshInterval(val)}
              style={{ width: 100 }}
              options={[
                { value: 30, label: t('analytics.operations.refresh30s') },
                { value: 60, label: t('analytics.operations.refresh1m') },
                { value: 300, label: t('analytics.operations.refresh5m') },
              ]}
            />
          )}
          <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
            {t('analytics.operations.refresh')}
          </Button>
        </Space>
      </div>
      <div style={{ flex: 1, minHeight: 0, marginTop: 16, overflow: 'auto' }}>
      {/* KPI 卡片 */}
      <Row gutter={[16, 16]}>
        {statCards.map((stat, index) => (
          <Col xs={12} sm={8} lg={4} key={index}>
            <StatisticCard
              style={{ borderRadius: 'var(--radius-lg, 8px)' }}
              statistic={{
                icon: stat.icon,
                title: stat.title,
                value: stat.value,
                suffix: stat.suffix,
              }}
            />
          </Col>
        ))}
      </Row>

      {/* 服务状态 + {t('analytics.operations.modelRanking')} */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CloudServerOutlined style={{ color: themeColor.ai }} />
                {t('analytics.operations.serviceStatus')}
              </span>
            }
            extra={
              <Button size="small" icon={<ReloadOutlined />} onClick={() => { fetchMonitoring(); fetchHealth(); }}>
                {t('analytics.operations.refresh')}
              </Button>
            }
            style={{ borderRadius: 'var(--radius-lg, 8px)', height: '100%' }}
          >
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <div style={{ padding: '12px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <CheckCircleOutlined style={{ fontSize: 20, color: allOk ? themeColor.success : themeColor.error }} />
                <span style={{ fontWeight: 500 }}>{t('analytics.operations.system')}</span>
                <Tag color={allOk ? 'green' : 'red'} style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>
                  {allOk ? t('analytics.operations.normal') : t('analytics.operations.abnormal')}
                </Tag>
              </div>
              <div style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 13, lineHeight: 2 }}>
                <div>
                  <ClockCircleOutlined style={{ marginRight: 6 }} />
                  {t('analytics.operations.uptime')}: {formatUptime(monitoring?.uptime || '0')}
                </div>
                <div>
                  <span>{t('analytics.operations.latency')}: </span>
                  <span>{health?.database.latencyMs ?? '-'}ms</span>
                </div>
              </div>
            </div>
          </Col>

          <Col xs={24} md={8}>
            <div style={{ padding: '12px 0', borderLeft: '1px solid var(--color-border, #f0f0f0)', paddingLeft: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <DatabaseOutlined style={{ fontSize: 20, color: themeColor.primary }} />
                <span style={{ fontWeight: 500 }}>{t('analytics.operations.database')}</span>
                <Tag color={health?.database.ok ? 'green' : 'red'} style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>
                  {health?.database.ok ? t('analytics.operations.normal') : t('analytics.operations.abnormal')}
                </Tag>
              </div>
              <div style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 13, lineHeight: 2 }}>
                <div>{t('analytics.operations.latency')}: {health?.database.latencyMs ?? '-'}ms</div>
                {health?.database.error && (
                  <Tooltip title={health.database.error}>
                    <span style={{ color: themeColor.error, fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                      {health.database.error}
                    </span>
                  </Tooltip>
                )}
              </div>
            </div>
          </Col>

          <Col xs={24} md={8}>
            <div style={{ padding: '12px 0', borderLeft: '1px solid var(--color-border, #f0f0f0)', paddingLeft: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <CloudServerOutlined style={{ fontSize: 20, color: '#13c2c2' }} />
                <span style={{ fontWeight: 500 }}>{t('analytics.operations.redis')}</span>
                {!health?.redis.configured ? (
                  <Tag color="default" style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{t('analytics.operations.notConfigured')}</Tag>
                ) : (
                  <Tag color={health.redis.ok ? 'green' : 'red'} style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>
                    {health.redis.ok ? t('analytics.operations.connected') : t('analytics.operations.disconnected')}
                  </Tag>
                )}
              </div>
              <div style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 13, lineHeight: 2 }}>
                {health?.redis.configured && (
                  <div>{t('analytics.operations.latency')}: {health?.redis.latencyMs ?? '-'}ms</div>
                )}
                {health?.redis.configured && health?.redis.error && (
                  <Tooltip title={health.redis.error}>
                    <span style={{ color: themeColor.error, fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                      {health.redis.error}
                    </span>
                  </Tooltip>
                )}
              </div>
            </div>
          </Col>
        </Row>
      </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <BarChartOutlined style={{ fontSize: 14, color: themeColor.warning }} />
                {t('analytics.operations.modelRanking')}
              </span>
            }
            style={{ height: 280, borderRadius: 'var(--radius-lg, 8px)' }}
            styles={{ body: { padding: '16px', overflowY: 'auto', height: 'calc(100% - 57px)' } }}
            loading={loading}
          >
            {sortedModelDist.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sortedModelDist.map((d) => {
                  const brandKey = getBrandKey(d.name);
                  const BrandIcon = BRAND_ICONS[brandKey] || BRAND_ICONS.default;
                  const brandColor = BRAND_COLORS[brandKey] || themeColor.primary;
                  const displayName = formatModelName(d.name);
                  const pct = Math.max((d.value / maxModelValue) * 100, 2);
                  return (
                    <div key={d.name} style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', alignItems: 'center', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary, #1a1a2e)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <BrandIcon size={18} />
                        <span>{displayName}</span>
                      </div>
                      <div style={{ height: 20, background: 'var(--color-fill-tertiary, #f5f5f5)', borderRadius: 'var(--radius-sm, 4px)', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            borderRadius: 'var(--radius-sm, 4px)',
                            width: `${pct}%`,
                            background: `linear-gradient(90deg, ${brandColor}, ${brandColor}cc)`,
                            transition: 'width 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
                          }}
                        />
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary, #1a1a2e)', fontVariantNumeric: 'tabular-nums', minWidth: 56, textAlign: 'right' }}>
                        {Number(d.value).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 24, fontSize: 13, color: 'var(--color-text-tertiary, #bfbfbf)' }}>{t('analytics.operations.noData')}</div>
            )}
          </Card>
        </Col>
      </Row>

      {/* {t('analytics.operations.userGrowth')} */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <EChartsCard
            title={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <BarChartOutlined style={{ fontSize: 14, color: themeColor.primary }} />
                {t('analytics.operations.userGrowth')}
              </span>
            }
            option={userGrowthOption}
            loading={loading}
            height={280}
          />
        </Col>
        <Col xs={24} lg={12}>
          <EChartsCard
            title={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <BarChartOutlined style={{ fontSize: 14, color: themeColor.ai }} />
                {t('analytics.operations.aiCallsTrend')}
              </span>
            }
            option={aiCallsOption}
            loading={loading}
            height={280}
          />
        </Col>
      </Row>

      {/* {t('analytics.operations.tokenTrend')} + {t('analytics.operations.resourceGrowth')} */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <EChartsCard
            title={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <LineChartOutlined style={{ fontSize: 14, color: themeColor.ai }} />
                {t('analytics.operations.tokenTrend')}
              </span>
            }
            option={tokenTrendOption}
            loading={loading}
            height={280}
            extra={
              <Select
                size="small"
                style={{ width: 180 }}
                placeholder={t('analytics.operations.allModels')}
                value={tokenModel}
                onChange={(val) => {
                  tokenModelRef.current = val;
                  setTokenModel(val);
                  fetchTokenTrend(val);
                }}
                options={[
                  { value: '', label: t('analytics.operations.allModels') },
                  ...sortedModelDist.map((d) => ({ value: d.name, label: d.name })),
                ]}
              />
            }
          />
        </Col>
        <Col xs={24} lg={12}>
          <EChartsCard
            title={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <BarChartOutlined style={{ fontSize: 14, color: themeColor.success }} />
                {t('analytics.operations.resourceGrowth')}
              </span>
            }
            option={resGrowthOption}
            loading={loading}
            height={280}
          />
        </Col>
      </Row>

      {/* {t('analytics.operations.activeUsers')}列表 */}
      <Card
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TeamOutlined style={{ color: themeColor.ai }} />
            {t('analytics.operations.activeUsers')}
          </span>
        }
        style={{ marginTop: 16, marginBottom: 24, borderRadius: 'var(--radius-lg, 8px)' }}
      >
        {activeUsers.length > 0 ? (
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border, #f0f0f0)', background: 'var(--color-bg-elevated, #fafafa)' }}>
                  <th style={{ textAlign: 'left', fontWeight: 500, color: 'var(--color-text-primary, #1a1a2e)', padding: '10px 12px' }}>{t('analytics.operations.column.username')}</th>
                  <th style={{ textAlign: 'left', fontWeight: 500, color: 'var(--color-text-primary, #1a1a2e)', padding: '10px 12px' }}>{t('analytics.operations.column.email')}</th>
                  <th style={{ textAlign: 'left', fontWeight: 500, color: 'var(--color-text-primary, #1a1a2e)', padding: '10px 12px' }}>{t('analytics.operations.column.lastActive')}</th>
                  <th style={{ textAlign: 'right', fontWeight: 500, color: 'var(--color-text-primary, #1a1a2e)', padding: '10px 12px' }}>{t('analytics.operations.column.projects')}</th>
                  <th style={{ textAlign: 'right', fontWeight: 500, color: 'var(--color-text-primary, #1a1a2e)', padding: '10px 12px' }}>{t('analytics.operations.column.prompts')}</th>
                  <th style={{ textAlign: 'right', fontWeight: 500, color: 'var(--color-text-primary, #1a1a2e)', padding: '10px 12px' }}>{t('analytics.operations.column.aiCalls')}</th>
                </tr>
              </thead>
              <tbody>
                {activeUsers.map((u) => (
                  <tr key={u.username} style={{ borderBottom: '1px solid var(--color-border, #f0f0f0)', transition: 'background 0.2s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-page, #f5f5f5)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>{u.username}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--color-text-secondary, #595959)' }}>{u.email}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--color-text-secondary, #595959)' }}>{u.lastActive ? new Date(u.lastActive).toLocaleString() : '-'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{u.projectCount}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{u.promptCount}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--color-primary, #1677ff)', fontWeight: 500 }}>{u.aiCallCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: 'var(--color-text-secondary, #595959)' }}>
              {t('analytics.operations.totalRecords', { total: activeUsers.length })}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 24, fontSize: 13, color: '#bfbfbf' }}>{t('analytics.operations.noData')}</div>
        )}
      </Card>
      </div>
    </div>
  );
}
