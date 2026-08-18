/**
 * ApiProviderOverview - API 集成的总览仪表盘
 *
 * 展示内容:
 * - 按类型分布(AI/邮件/OAuth/存储/支付)
 * - 健康状态分布(健康/降级/故障/未知)
 * - 异常告警列表
 * - 限额预警列表
 */
import { Card, Row, Col, Tag, Space, Empty, Progress, Spin } from 'antd';
import { AlertTriangle, Activity, CheckCircle } from 'lucide-react';

interface AlertItem {
  id: string;
  name: string;
  type: string;
  severity: 'critical' | 'warning';
  reason: string;
}

interface QuotaWarning {
  id: string;
  name: string;
  type: string;
  usage: {
    dailyLimit: number;
    dailyUsed: number;
    monthlyLimit: number;
    monthlyUsed: number;
    level: 'critical' | 'warning' | 'normal';
  };
}

interface DashboardData {
  total: number;
  byType: Record<string, number>;
  byHealth: Record<string, number>;
  alerts: AlertItem[];
  quotaWarnings: QuotaWarning[];
}

interface ApiProviderOverviewProps {
  dashboard: DashboardData | null;
  loading: boolean;
}

const HEALTH_COLORS: Record<string, string> = {
  healthy: '#52c41a',
  degraded: '#fa8c16',
  down: '#f5222d',
  unknown: '#bfbfbf',
};

const HEALTH_LABELS: Record<string, string> = {
  healthy: '健康',
  degraded: '降级',
  down: '故障',
  unknown: '未知',
};

const TYPE_LABELS: Record<string, string> = {
  ai: 'API 渠道',
  email: '邮件服务',
  oauth: '第三方登录',
  storage: '对象存储',
  payment: '支付服务',
};

const QUOTA_LEVEL_LABELS: Record<string, string> = {
  critical: '严重',
  warning: '预警',
  normal: '正常',
};

export default function ApiProviderOverview({ dashboard, loading }: ApiProviderOverviewProps) {
  if (loading) {
    return (
      <Card>
        <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin tip="加载中..." />
        </div>
      </Card>
    );
  }

  if (!dashboard) {
    return (
      <Card>
        <Empty description="暂无数据" />
      </Card>
    );
  }

  const byTypeEntries = Object.entries(dashboard.byType || {});
  const byHealthEntries = Object.entries(dashboard.byHealth || {});
  const hasAlerts = dashboard.alerts && dashboard.alerts.length > 0;
  const hasQuotaWarnings = dashboard.quotaWarnings && dashboard.quotaWarnings.length > 0;

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card title="按类型分布" size="small">
            {byTypeEntries.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无集成" />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {byTypeEntries.map(([type, count]) => (
                  <div
                    key={type}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>{TYPE_LABELS[type] || type}</span>
                    <Tag color="blue">{count as number}</Tag>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="健康状态" size="small">
            {byHealthEntries.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无健康数据" />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {byHealthEntries.map(([status, count]) => (
                  <div
                    key={status}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: HEALTH_COLORS[status] || '#bfbfbf',
                          marginRight: 8,
                        }}
                      />
                      {HEALTH_LABELS[status] || status}
                    </span>
                    <Tag
                      color={
                        status === 'healthy'
                          ? 'green'
                          : status === 'down'
                            ? 'red'
                            : status === 'degraded'
                              ? 'orange'
                              : 'default'
                      }
                    >
                      {count as number}
                    </Tag>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      {hasAlerts && (
        <Card
          title={
            <Space>
              <AlertTriangle size={16} color="#f5222d" />
              <span>异常告警</span>
              <Tag color="red">{(dashboard.alerts || []).length}</Tag>
            </Space>
          }
          size="small"
          style={{ marginBottom: 16 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(dashboard.alerts || []).map((alert, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <Tag color={alert.severity === 'critical' ? 'red' : 'orange'}>
                  {alert.severity === 'critical' ? '严重' : '警告'}
                </Tag>
                <span>{alert.name}</span>
                <Tag>{TYPE_LABELS[alert.type] || alert.type}</Tag>
                <span style={{ color: '#8c8c8c' }}>{alert.reason}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {hasQuotaWarnings && (
        <Card
          title={
            <Space>
              <Activity size={16} color="#fa8c16" />
              <span>限额预警</span>
              <Tag color="orange">{(dashboard.quotaWarnings || []).length}</Tag>
            </Space>
          }
          size="small"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(dashboard.quotaWarnings || []).map((warning, idx) => {
              const dailyPct =
                warning.usage.dailyLimit === Infinity
                  ? 0
                  : Math.round((warning.usage.dailyUsed / warning.usage.dailyLimit) * 100);
              const monthlyPct =
                warning.usage.monthlyLimit === Infinity
                  ? 0
                  : Math.round((warning.usage.monthlyUsed / warning.usage.monthlyLimit) * 100);
              const maxPct = Math.max(dailyPct, monthlyPct);
              return (
                <div key={idx} style={{ padding: '4px 0' }}>
                  <Space direction="vertical" style={{ width: '100%' }} size={4}>
                    <Space>
                      <span>{warning.name}</span>
                      <Tag>{TYPE_LABELS[warning.type] || warning.type}</Tag>
                      <Tag
                        color={
                          warning.usage.level === 'critical'
                            ? 'red'
                            : warning.usage.level === 'warning'
                              ? 'orange'
                              : 'default'
                        }
                      >
                        {QUOTA_LEVEL_LABELS[warning.usage.level] || warning.usage.level}
                      </Tag>
                    </Space>
                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                      日用量: {warning.usage.dailyUsed} /{' '}
                      {warning.usage.dailyLimit === Infinity ? '无限制' : warning.usage.dailyLimit}
                      {warning.usage.dailyLimit !== Infinity && ` (${dailyPct}%)`}
                      <span style={{ margin: '0 8px' }}>·</span>
                      月用量: {warning.usage.monthlyUsed} /{' '}
                      {warning.usage.monthlyLimit === Infinity ? '无限制' : warning.usage.monthlyLimit}
                      {warning.usage.monthlyLimit !== Infinity && ` (${monthlyPct}%)`}
                    </div>
                    <Progress
                      percent={maxPct}
                      status={warning.usage.level === 'critical' ? 'exception' : 'active'}
                      size="small"
                      showInfo={false}
                    />
                  </Space>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {!hasAlerts && !hasQuotaWarnings && (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space>
                <CheckCircle size={16} color="#52c41a" />
                <span>所有服务运行正常</span>
              </Space>
            }
          />
        </Card>
      )}
    </div>
  );
}
