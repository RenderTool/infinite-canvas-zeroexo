/**
 * 定价分组管理 - 订阅计划(Plan) CRUD + 用户订阅授予
 *
 * 商业模型：
 * - 计划档位：基础/标准/高级/超级/企业团队（每档配置分组倍率、周期赠送积分、月/季/年价格、席位）
 * - 用户订阅：按计划授予用户，到期自动回退免费
 */
import { useState, useEffect, useCallback } from 'react';
import { StatisticCard } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Space,
  Tag,
  Row,
  Col,
  Tabs,
  Divider,
  Typography,
  App,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CrownOutlined,
  TeamOutlined,
  ReloadOutlined,
  DollarOutlined,
  UserOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { apiGet, apiPost } from '@/services/api-client';
import { color as themeColor } from '@/design-tokens';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

interface Plan {
  id: string;
  code: string;
  name: string;
  description?: string;
  multiplier: number;
  creditsPerCycle: number;
  monthlyPrice: number;
  quarterlyPrice: number;
  yearlyPrice: number;
  seats: number;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionRecord {
  id: string;
  planCode: string;
  cycle: string;
  seats: number;
  status: string;
  renewMode: string;
  startAt: string;
  expiresAt: string;
  cancelledAt?: string;
  plan?: { code: string; name: string };
}

interface UserInfo {
  id: string;
  username: string;
  email: string;
  planCode?: string;
  planExpiresAt?: string;
}

const PLAN_COLORS: Record<string, string> = {
  free: 'default',
  basic: 'blue',
  standard: 'cyan',
  premium: 'purple',
  ultimate: 'gold',
  enterprise: 'volcano',
};

export default function PlanManagement() {
  const { t } = useTranslation();
  const { message: appMessage, modal } = App.useApp();

  const getCycleLabel = (cycle: string) => {
    const labels: Record<string, string> = {
      month: t('plans.cycle.month'),
      quarter: t('plans.cycle.quarter'),
      year: t('plans.cycle.year'),
    };
    return labels[cycle] || cycle;
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, { color: string; label: string }> = {
      active: { color: 'green', label: t('plans.status.active') },
      expired: { color: 'default', label: t('plans.status.expired') },
      cancelled: { color: 'warning', label: t('plans.status.cancelled') },
    };
    return labels[status] || { color: 'default', label: status };
  };

  const [activeTab, setActiveTab] = useState('plans');
  const [planKeyword, setPlanKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [form] = Form.useForm();

  // 用户订阅授予
  const [userKeyword, setUserKeyword] = useState('');
  const [userResults, setUserResults] = useState<UserInfo[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [subsModalOpen, setSubsModalOpen] = useState(false);
  const [subsUser, setSubsUser] = useState<UserInfo | null>(null);
  const [subsList, setSubsList] = useState<SubscriptionRecord[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [subsForm] = Form.useForm();
  const [grantLoading, setGrantLoading] = useState(false);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<Plan[]>('/admin/plans');
      setPlans(Array.isArray(data) ? data : []);
    } catch {
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const openCreateModal = () => {
    setEditingPlan(null);
    form.resetFields();
    form.setFieldsValue({
      multiplier: 1,
      creditsPerCycle: 0,
      monthlyPrice: 0,
      quarterlyPrice: 0,
      yearlyPrice: 0,
      seats: 1,
      enabled: true,
      sortOrder: 0,
    });
    setModalOpen(true);
  };

  const openEditModal = (plan: Plan) => {
    setEditingPlan(plan);
    form.setFieldsValue({ ...plan });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingPlan) {
        await apiPost(`/admin/plans/${editingPlan.id}`, values);
        appMessage.success(t('plans.message.updated'));
      } else {
        await apiPost('/admin/plans', values);
        appMessage.success(t('plans.message.created'));
      }
      setModalOpen(false);
      fetchPlans();
    } catch {
      appMessage.error(t('plans.message.saveFailed'));
    }
  };

  const handleDelete = async (plan: Plan) => {
    modal.confirm({
      title: t('plans.confirm.deleteTitle'),
      content: t('plans.confirm.deleteContent', { name: plan.name }),
      centered: true,
      okType: 'danger',
      onOk: async () => {
        try {
          await apiPost(`/admin/plans/${plan.id}/delete`);
          appMessage.success(t('plans.message.deleted'));
          fetchPlans();
        } catch {
          appMessage.error(t('plans.message.deleteFailed'));
        }
      },
    });
  };

  const handleToggleEnabled = async (plan: Plan) => {
    try {
      await apiPost(`/admin/plans/${plan.id}`, { enabled: !plan.enabled });
      appMessage.success(t(plan.enabled ? 'plans.message.disabled' : 'plans.message.enabled'));
      fetchPlans();
    } catch {
      appMessage.error(t('plans.message.operationFailed'));
    }
  };

  // ===== 用户订阅管理 =====

  const searchUsers = async () => {
    if (!userKeyword.trim()) return;
    setUserSearchLoading(true);
    try {
      const result = await apiGet<{ items: UserInfo[] }>(
        `/admin/users?username=${encodeURIComponent(userKeyword.trim())}&pageSize=10`,
      );
      setUserResults(result.items || []);
    } catch {
      appMessage.error(t('plans.message.searchUserFailed'));
    } finally {
      setUserSearchLoading(false);
    }
  };

  const loadUserSubscriptions = async (user: UserInfo) => {
    setSubsUser(user);
    setSubsModalOpen(true);
    setSubsLoading(true);
    setSubsList([]);
    subsForm.resetFields();
    try {
      const list = await apiGet<SubscriptionRecord[]>(`/admin/plans/users/${user.id}/subscriptions`);
      setSubsList(Array.isArray(list) ? list : []);
    } catch {
      setSubsList([]);
    } finally {
      setSubsLoading(false);
    }
  };

  const handleGrant = async () => {
    if (!subsUser) return;
    try {
      const values = await subsForm.validateFields();
      setGrantLoading(true);
      await apiPost(`/admin/plans/users/${subsUser.id}/subscribe`, values);
      appMessage.success(t('plans.message.granted'));
      setSubsModalOpen(false);
      fetchPlans();
    } catch (err: any) {
      if (err?.errorFields) return;
      appMessage.error(t('plans.message.grantFailed'));
    } finally {
      setGrantLoading(false);
    }
  };

  const handleCancelSub = async (sub: SubscriptionRecord) => {
    if (!subsUser) return;
    modal.confirm({
      title: t('plans.confirm.cancelTitle'),
      content: t('plans.confirm.cancelContent', { name: sub.plan?.name || sub.planCode }),
      centered: true,
      okType: 'danger',
      onOk: async () => {
        try {
          await apiPost(`/admin/plans/users/${subsUser.id}/cancel`, { subscriptionId: sub.id });
          appMessage.success(t('plans.message.cancelled'));
          loadUserSubscriptions(subsUser);
        } catch {
          appMessage.error(t('plans.message.cancelFailed'));
        }
      },
    });
  };

  const handleResetFree = async () => {
    if (!subsUser) return;
    modal.confirm({
      title: t('plans.confirm.resetTitle'),
      content: t('plans.confirm.resetContent', { username: subsUser.username }),
      centered: true,
      okType: 'danger',
      onOk: async () => {
        try {
          await apiPost(`/admin/plans/users/${subsUser.id}/reset`);
          appMessage.success(t('plans.message.resetToFree'));
          loadUserSubscriptions(subsUser);
        } catch {
          appMessage.error(t('plans.message.resetFailed'));
        }
      },
    });
  };

  const planColumns: ColumnsType<Plan> = [
    {
      title: t('plans.column.plan'),
      dataIndex: 'name',
      key: 'name',
      width: 140,
      fixed: 'left',
      render: (name: string, record) => (
        <Space>
          <CrownOutlined style={{ color: themeColor.ai }} />
          <div>
            <Text strong>{name}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>code: {record.code}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: t('plans.column.multiplier'),
      dataIndex: 'multiplier',
      key: 'multiplier',
      width: 100,
      align: 'right',
      sorter: (a, b) => a.multiplier - b.multiplier,
      render: (v: number) => <Text>{v.toFixed(2)}x</Text>,
    },
    {
      title: t('plans.column.creditsPerCycle'),
      dataIndex: 'creditsPerCycle',
      key: 'creditsPerCycle',
      width: 100,
      align: 'right',
      sorter: (a, b) => a.creditsPerCycle - b.creditsPerCycle,
      render: (v: number) => <Text>{v.toLocaleString()}</Text>,
    },
    {
      title: t('plans.column.price'),
      key: 'price',
      width: 200,
      render: (_, record) => (
        <Space size={8} wrap>
          {record.monthlyPrice > 0 && <Tag color="blue">{t('plans.cycle.month')} ¥{record.monthlyPrice}</Tag>}
          {record.quarterlyPrice > 0 && <Tag color="cyan">{t('plans.cycle.quarter')} ¥{record.quarterlyPrice}</Tag>}
          {record.yearlyPrice > 0 && <Tag color="gold">{t('plans.cycle.year')} ¥{record.yearlyPrice}</Tag>}
          {record.monthlyPrice <= 0 && record.quarterlyPrice <= 0 && record.yearlyPrice <= 0 && (
            <Text type="secondary">-</Text>
          )}
        </Space>
      ),
    },
    {
      title: t('plans.column.seats'),
      dataIndex: 'seats',
      key: 'seats',
      width: 80,
      align: 'right',
      sorter: (a, b) => a.seats - b.seats,
      render: (v: number) => <Text>{v}</Text>,
    },
    {
      title: t('plans.column.sortOrder'),
      dataIndex: 'sortOrder',
      key: 'sortOrder',
      width: 70,
      align: 'right',
      sorter: (a, b) => a.sortOrder - b.sortOrder,
    },
    {
      title: t('plans.column.status'),
      dataIndex: 'enabled',
      key: 'enabled',
      width: 90,
      sorter: (a, b) => Number(a.enabled) - Number(b.enabled),
      render: (v: boolean) => (
        <Tag color={v ? 'green' : 'default'} style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>
          {v ? t('plans.status.enabled') : t('plans.status.disabled')}
        </Tag>
      ),
    },
    {
      title: t('plans.column.actions'),
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)}>{t('plans.action.edit')}</Button>
          <Button size="small" onClick={() => handleToggleEnabled(record)}>
            {t(record.enabled ? 'plans.action.disable' : 'plans.action.enable')}
          </Button>
          {record.code !== 'free' && (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)} />
          )}
        </Space>
      ),
    },
  ];

  const userResultColumns: ColumnsType<UserInfo> = [
    {
      title: t('plans.column.username'),
      dataIndex: 'username',
      key: 'username',
      width: 130,
      render: (v: string) => <strong>{v}</strong>,
    },
    {
      title: t('plans.column.email'),
      dataIndex: 'email',
      key: 'email',
      width: 200,
      ellipsis: true,
    },
    {
      title: t('plans.column.planLevel'),
      key: 'plan',
      width: 140,
      render: (_, record) => {
        const isActive = record.planCode && record.planExpiresAt && new Date(record.planExpiresAt).getTime() > Date.now();
        if (!isActive) return <Tag color="default">{t('plans.status.free')}</Tag>;
        return (
          <Space size={4}>
            <Tag color={PLAN_COLORS[record.planCode!] || 'blue'} style={{ margin: 0 }}>{record.planCode}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {new Date(record.planExpiresAt!).toLocaleDateString('zh-CN')}
            </Text>
          </Space>
        );
      },
    },
    {
      title: t('plans.column.actions'),
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Button size="small" type="link" onClick={() => loadUserSubscriptions(record)}>
          {t('plans.action.manageSubscription')}
        </Button>
      ),
    },
  ];

  const filteredPlans = plans.filter(
    (p) =>
      !planKeyword.trim() ||
      p.name.includes(planKeyword.trim()) ||
      p.code.toLowerCase().includes(planKeyword.trim().toLowerCase()),
  );

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={6}>
            <StatisticCard
              statistic={{
                title: t('plans.stats.totalPlans'),
                value: plans.length,
                prefix: <CrownOutlined style={{ color: themeColor.ai }} />,
              }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <StatisticCard
              statistic={{
                title: t('plans.stats.enabled'),
                value: plans.filter((p) => p.enabled).length,
                prefix: <CheckCircleOutlined style={{ color: themeColor.success }} />,
              }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <StatisticCard
              statistic={{
                title: t('plans.stats.paidPlans'),
                value: plans.filter((p) => p.code !== 'free' && p.monthlyPrice > 0).length,
                prefix: <DollarOutlined style={{ color: themeColor.primary }} />,
              }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <StatisticCard
              statistic={{
                title: t('plans.stats.totalSeats'),
                value: plans.reduce((sum, p) => sum + p.seats, 0),
                prefix: <TeamOutlined style={{ color: themeColor.warning }} />,
              }}
            />
          </Col>
        </Row>
      </Card>

      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'plans',
              label: (
                <Space size={4}>
                  <CrownOutlined /> {t('plans.tab.planConfig')}
                </Space>
              ),
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Space>
                    <Input
                      placeholder={t('plans.search.planPlaceholder')}
                      prefix={<SearchOutlined />}
                      value={planKeyword}
                      onChange={(e) => setPlanKeyword(e.target.value)}
                      style={{ width: 240 }}
                      allowClear
                    />
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                      {t('plans.action.createPlan')}
                    </Button>
                  </Space>
                  <Table
                    className="data-table"
                    rowKey="id"
                    loading={loading}
                    columns={planColumns}
                    dataSource={filteredPlans}
                    pagination={false}
                    bordered
                    sticky
                    scroll={{ x: 1000 }}
                    locale={{ emptyText: t('plans.empty.noPlans') }}
                  />
                </div>
              ),
            },
            {
              key: 'users',
              label: (
                <Space size={4}>
                  <UserOutlined /> {t('plans.tab.userSubscriptions')}
                </Space>
              ),
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Space>
                    <Input
                      placeholder={t('plans.search.userPlaceholder')}
                      prefix={<SearchOutlined />}
                      value={userKeyword}
                      onChange={(e) => setUserKeyword(e.target.value)}
                      onPressEnter={searchUsers}
                      style={{ width: 240 }}
                      allowClear
                    />
                    <Button type="primary" loading={userSearchLoading} onClick={searchUsers}>
                      {t('plans.action.search')}
                    </Button>
                  </Space>
                  {userResults.length > 0 ? (
                    <Table
                      rowKey="id"
                      size="small"
                      columns={userResultColumns}
                      dataSource={userResults}
                      pagination={false}
                      bordered
                      sticky
                    />
                  ) : (
                    <div style={{ color: 'var(--color-text-secondary, #999)', padding: 24, textAlign: 'center' }}>
                      {t('plans.empty.searchHint')}
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* 创建/编辑计划弹窗 */}
      <Modal
        title={t(editingPlan ? 'plans.modal.editTitle' : 'plans.modal.createTitle')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        width={680}
        centered
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="code" label={t('plans.form.code')} rules={[{ required: true }]}
                extra={editingPlan ? undefined : t('plans.form.codeExtra')}
              >
                <Input disabled={!!editingPlan} placeholder={t('plans.form.codePlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label={t('plans.form.name')} rules={[{ required: true }]}>
                <Input placeholder={t('plans.form.namePlaceholder')} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label={t('plans.form.description')}>
            <Input.TextArea rows={2} placeholder={t('plans.form.descriptionPlaceholder')} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="multiplier" label={t('plans.form.multiplier')} rules={[{ required: true }]}
                extra={t('plans.form.multiplierExtra')}
              >
                <InputNumber min={0} max={100} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="creditsPerCycle" label={t('plans.form.creditsPerCycle')} rules={[{ required: true }]}>
                <InputNumber min={0} max={100000000} step={1000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="seats" label={t('plans.form.seats')} rules={[{ required: true }]}>
                <InputNumber min={1} max={10000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Divider titlePlacement="start">{t('plans.form.priceConfig')}</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="monthlyPrice" label={t('plans.form.monthlyPrice')} rules={[{ required: true }]}>
                <InputNumber min={0} max={999999} precision={2} prefix="¥" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="quarterlyPrice" label={t('plans.form.quarterlyPrice')} rules={[{ required: true }]}>
                <InputNumber min={0} max={999999} precision={2} prefix="¥" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="yearlyPrice" label={t('plans.form.yearlyPrice')} rules={[{ required: true }]}>
                <InputNumber min={0} max={999999} precision={2} prefix="¥" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="sortOrder" label={t('plans.form.sortOrder')} rules={[{ required: true }]}>
                <InputNumber min={0} max={9999} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="enabled" label={t('plans.form.enabled')} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 用户订阅管理弹窗 */}
      <Modal
        title={subsUser ? t('plans.modal.manageSubscription', { username: subsUser.username }) : t('plans.modal.manageSubscription')}
        open={subsModalOpen}
        onCancel={() => setSubsModalOpen(false)}
        footer={null}
        width={720}
        centered
        destroyOnHidden
      >
        {subsUser && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Space>
              <Text strong>{t('plans.label.currentLevel')}</Text>
              {subsUser.planCode && subsUser.planExpiresAt && new Date(subsUser.planExpiresAt).getTime() > Date.now() ? (
                <Space size={4}>
                  <Tag color={PLAN_COLORS[subsUser.planCode] || 'blue'}>{subsUser.planCode}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('plans.label.expiresAt')}{new Date(subsUser.planExpiresAt).toLocaleString('zh-CN')}
                  </Text>
                </Space>
              ) : (
                <Tag color="default">{t('plans.status.free')}</Tag>
              )}
            </Space>

            <Form form={subsForm} layout="vertical">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="planId" label={t('plans.form.grantPlan')} rules={[{ required: true }]}>
                    <Select placeholder={t('plans.form.grantPlanPlaceholder')} options={plans.filter((p) => p.enabled).map((p) => ({
                      value: p.id,
                      label: `${p.name} (${p.code})`,
                    }))} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item name="cycle" label={t('plans.form.billingCycle')} initialValue="month">
                    <Select options={['month', 'quarter', 'year'].map((v) => ({ value: v, label: getCycleLabel(v) }))} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item name="seats" label={t('plans.form.seats')} initialValue={1}>
                    <InputNumber min={1} max={10000} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Space>
                <Form.Item name="renewMode" label={t('plans.form.renewMode')} initialValue="manual" style={{ marginBottom: 0 }}>
                  <Select style={{ width: 140 }} options={[
                    { value: 'manual', label: t('plans.renewMode.manual') },
                    { value: 'auto', label: t('plans.renewMode.auto') },
                  ]} />
                </Form.Item>
                <Form.Item name="extend" label={t('plans.label.extend')} valuePropName="checked" initialValue={false} style={{ marginBottom: 0 }}>
                  <Switch checkedChildren={t('plans.extend.on')} unCheckedChildren={t('plans.extend.off')} />
                </Form.Item>
              </Space>
            </Form>
            <Space>
              <Button type="primary" icon={<CheckCircleOutlined />} loading={grantLoading} onClick={handleGrant}>
                {t('plans.action.grantSubscription')}
              </Button>
              <Button danger icon={<StopOutlined />} onClick={handleResetFree}>
                {t('plans.action.resetToFree')}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => loadUserSubscriptions(subsUser)}>
                {t('common.refresh')}
              </Button>
            </Space>

            <Divider titlePlacement="start" style={{ margin: '4px 0' }}>{t('plans.label.subscriptionHistory')}</Divider>
            <Table
              rowKey="id"
              size="small"
              loading={subsLoading}
              dataSource={subsList}
              pagination={false}
              bordered
              sticky
              locale={{ emptyText: t('plans.empty.noSubscriptions') }}
              columns={[
                {
                  title: t('plans.column.plan'),
                  dataIndex: 'planCode',
                  key: 'planCode',
                  width: 110,
                  render: (v: string, r) => <Tag color={PLAN_COLORS[v] || 'blue'} style={{ margin: 0 }}>{r.plan?.name || v}</Tag>,
                },
                {
                  title: t('plans.column.cycle'),
                  dataIndex: 'cycle',
                  key: 'cycle',
                  width: 70,
                  render: (v: string) => getCycleLabel(v),
                },
                {
                  title: t('plans.column.seats'),
                  dataIndex: 'seats',
                  key: 'seats',
                  width: 60,
                  align: 'right',
                },
                {
                  title: t('plans.column.status'),
                  dataIndex: 'status',
                  key: 'status',
                  width: 80,
                  render: (v: string) => {
                    const s = getStatusLabel(v);
                    return <Tag color={s.color} style={{ margin: 0 }}>{s.label}</Tag>;
                  },
                },
                {
                  title: t('plans.column.startAt'),
                  dataIndex: 'startAt',
                  key: 'startAt',
                  width: 130,
                  render: (v: string) => <span style={{ fontSize: 12 }}>{new Date(v).toLocaleDateString('zh-CN')}</span>,
                },
                {
                  title: t('plans.column.expiresAt'),
                  dataIndex: 'expiresAt',
                  key: 'expiresAt',
                  width: 130,
                  render: (v: string) => <span style={{ fontSize: 12 }}>{new Date(v).toLocaleDateString('zh-CN')}</span>,
                },
                {
                  title: t('plans.column.actions'),
                  key: 'actions',
                  width: 80,
                  render: (_, r) => r.status === 'active' && (
                    <Button size="small" danger type="link" onClick={() => handleCancelSub(r)}>{t('plans.action.cancel')}</Button>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
