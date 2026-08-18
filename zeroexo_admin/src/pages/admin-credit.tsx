import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';
import {
  Table,
  Form,
  InputNumber,
  Input,
  Button,
  Tag,
  Row,
  Col,
  Select,
  message,
  Descriptions,
  Typography,
  Dropdown,
  Statistic,
  Modal,
} from 'antd';
import {
  UserOutlined,
  WalletOutlined,
  ReloadOutlined,
  HistoryOutlined,
  TransactionOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  ThunderboltOutlined,
  DownOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { apiGet, apiPost, showApiError } from '@/services/api-client';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

interface CreditBalance {
  balance: number;
  frozenAmount: number;
  available: number;
  totalCharged: number;
  totalConsumed: number;
}

interface ConsumptionItem {
  id: string;
  generationId: string;
  userId: string;
  model: string;
  modelType: string;
  unitType: string;
  usageAmount: number;
  inputTokens: number;
  outputTokens: number;
  creditsConsumed: number;
  creditValueCny: number;
  upstreamCostUsd: number;
  channelPool: string;
  modelMultiplier: number;
  completionMultiplier: number;
  groupMultiplier: number;
  creditPerUnit: number;
  billingStatus: string;
  createdAt: string;
}

interface TransactionItem {
  id: string;
  userId: string;
  creditId: string;
  type: string;
  amount: number;
  balanceAfter: number;
  referenceId?: string;
  remark?: string;
  operatorId?: string;
  createdAt: string;
}

interface UserSearchResult {
  id: string;
  username: string;
  email: string;
  nickname?: string;
  role: string;
}

const MODEL_TYPE_COLOR: Record<string, string> = {
  llm: 'blue',
  image: 'green',
  video: 'purple',
  audio: 'orange',
};

export default function AdminCredit() {
  const { t } = useTranslation();

  const getTxTypeInfo = (type: string) => {
    const map: Record<string, { label: string; color: string }> = {
      recharge: { label: t('credit.txType.recharge'), color: 'green' },
      freeze: { label: t('credit.txType.freeze'), color: 'orange' },
      unfreeze: { label: t('credit.txType.unfreeze'), color: 'blue' },
      consume: { label: t('credit.txType.consume'), color: 'red' },
      refund: { label: t('credit.txType.refund'), color: 'purple' },
    };
    return map[type] || { label: type, color: 'default' };
  };

  const getModelTypeLabel = (modelType: string) => {
    const labels: Record<string, string> = {
      llm: t('credit.modelType.llm'),
      image: t('credit.modelType.image'),
      video: t('credit.modelType.video'),
      audio: t('credit.modelType.audio'),
    };
    return labels[modelType] || modelType;
  };

  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [consumptions, setConsumptions] = useState<ConsumptionItem[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [consumptionTotal, setConsumptionTotal] = useState(0);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [activeTab, setActiveTab] = useState<'consumptions' | 'transactions'>('consumptions');
  const [loading, setLoading] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [detailModal, setDetailModal] = useState<ConsumptionItem | TransactionItem | null>(null);
  const [rechargeForm] = Form.useForm();
  const [refundForm] = Form.useForm();
  const [consumptionPage, setConsumptionPage] = useState(1);
  const [transactionPage, setTransactionPage] = useState(1);
  const pageSize = 20;
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBalance = useCallback(async (userId: string) => {
    try {
      const data = await apiGet<CreditBalance>(`/admin/billing/credits/${userId}`);
      setBalance(data);
    } catch {
      setBalance(null);
    }
  }, []);

  const fetchConsumptions = useCallback(async (userId: string, page: number) => {
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const data = await apiGet<{ items: ConsumptionItem[]; total: number }>(
        `/admin/billing/credits/${userId}/consumptions?limit=${pageSize}&offset=${offset}`,
      );
      setConsumptions(Array.isArray(data?.items) ? data.items : []);
      setConsumptionTotal(data?.total ?? 0);
    } catch {
      setConsumptions([]);
      setConsumptionTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTransactions = useCallback(async (userId: string, page: number) => {
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const data = await apiGet<{ items: TransactionItem[]; total: number }>(
        `/admin/billing/credits/${userId}/transactions?limit=${pageSize}&offset=${offset}`,
      );
      const list = Array.isArray(data?.items) ? data.items : [];
      setTransactions(list);
      setTransactionTotal(data?.total ?? list.length);
    } catch {
      setTransactions([]);
      setTransactionTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUserData = useCallback(async (user: UserSearchResult) => {
    setSelectedUser(user);
    setSearchText('');
    setSearchResults([]);
    setConsumptionPage(1);
    setTransactionPage(1);
    await Promise.all([
      fetchBalance(user.id),
      fetchConsumptions(user.id, 1),
      fetchTransactions(user.id, 1),
    ]);
  }, [fetchBalance, fetchConsumptions, fetchTransactions]);

  const handleSearch = useCallback((keyword: string) => {
    setSearchText(keyword);
    if (!keyword.trim()) {
      setSearchResults([]);
      return;
    }
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const data = await apiGet<{ items: UserSearchResult[] }>(
          `/admin/users?username=${encodeURIComponent(keyword.trim())}`,
        );
        setSearchResults(Array.isArray(data?.items) ? data.items : []);
      } catch {
        setSearchResults([]);
      }
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  const handleRecharge = async () => {
    if (!selectedUser) return;
    try {
      const values = await rechargeForm.validateFields();
      await apiPost(`/admin/billing/credits/${selectedUser.id}/recharge`, {
        credits: values.credits,
        remark: values.remark,
      });
      message.success(t('credit.message.rechargeSuccess', { username: selectedUser.username, credits: values.credits }));
      setRechargeOpen(false);
      rechargeForm.resetFields();
      await fetchBalance(selectedUser.id);
      if (activeTab === 'transactions') {
        await fetchTransactions(selectedUser.id, transactionPage);
      }
    } catch (err) {
      showApiError(err, t('credit.message.rechargeFail'));
    }
  };

  const handleRefund = async () => {
    if (!selectedUser) return;
    try {
      const values = await refundForm.validateFields();
      await apiPost(`/admin/billing/credits/${selectedUser.id}/refund`, {
        credits: values.credits,
        referenceId: values.referenceId,
        remark: values.remark,
      });
      message.success(t('credit.message.refundSuccess', { username: selectedUser.username, credits: values.credits }));
      setRefundOpen(false);
      refundForm.resetFields();
      await fetchBalance(selectedUser.id);
      if (activeTab === 'transactions') {
        await fetchTransactions(selectedUser.id, transactionPage);
      }
    } catch (err) {
      showApiError(err, t('credit.message.refundFail'));
    }
  };

  const consumptionColumns: ColumnsType<ConsumptionItem> = [
    {
      title: t('common.actions'),
      key: 'actions',
      width: 40,
      fixed: 'left',
      render: (_, record: ConsumptionItem) => (
        <Dropdown
          menu={{
            items: [
              {
                key: 'detail',
                label: t('common.detail'),
                icon: <EyeOutlined />,
              },
            ],
            onClick: () => setDetailModal(record),
          }}
          trigger={['click']}
          placement="bottomRight"
        >
          <Button
            size="small"
            type="text"
            className="row-action-btn"
            icon={<DownOutlined />}
            onClick={(e) => e.stopPropagation()}
          />
        </Dropdown>
      ),
    },
    {
      title: t('credit.consumption.model'),
      dataIndex: 'model',
      key: 'model',
      width: 140,
      ellipsis: true,
      render: (name: string, record) => (
        <div>
          <Text strong>{name}</Text>
          <div>
            <Tag
              color={MODEL_TYPE_COLOR[record.modelType] || 'default'}
              style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}
            >
              {getModelTypeLabel(record.modelType)}
            </Tag>
          </div>
        </div>
      ),
    },
    {
      title: t('credit.consumption.channel'),
      dataIndex: 'channelPool',
      key: 'channelPool',
      width: 100,
      ellipsis: true,
      render: (v: string) => <Text type="secondary">{v || '-'}</Text>,
    },
    {
      title: t('credit.consumption.usage'),
      key: 'usage',
      width: 120,
      render: (_, record) => (
        <div>
          <Text>{record.usageAmount}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}> {record.unitType}</Text>
          {record.inputTokens > 0 && (
            <div><Text type="secondary" style={{ fontSize: 11 }}>{t('credit.consumption.inputTokens')}: {record.inputTokens} tok</Text></div>
          )}
          {record.outputTokens > 0 && (
            <div><Text type="secondary" style={{ fontSize: 11 }}>{t('credit.consumption.outputTokens')}: {record.outputTokens} tok</Text></div>
          )}
        </div>
      ),
    },
    {
      title: t('credit.consumption.multiplier'),
      key: 'multiplier',
      width: 100,
      render: (_, record) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {record.modelMultiplier?.toFixed?.(2) ?? '1.00'}x /{' '}
          {record.completionMultiplier?.toFixed?.(2) ?? '1.00'}x /{' '}
          {record.groupMultiplier?.toFixed?.(2) ?? '1.00'}x
        </Text>
      ),
    },
    {
      title: t('credit.consumption.creditsConsumed'),
      dataIndex: 'creditsConsumed',
      key: 'creditsConsumed',
      width: 100,
      render: (v: number) => <Text strong style={{ color: 'var(--color-error, #ff4d4f)' }}>-{v}</Text>,
    },
    {
      title: t('credit.consumption.creditValue'),
      dataIndex: 'creditValueCny',
      key: 'creditValueCny',
      width: 100,
      render: (v: number) => <Text>¥{v?.toFixed?.(4) ?? '0.0000'}</Text>,
    },
    {
      title: t('credit.consumption.upstreamCost'),
      dataIndex: 'upstreamCostUsd',
      key: 'upstreamCostUsd',
      width: 100,
      render: (v: number) => <Text type="secondary">${v?.toFixed?.(4) ?? '0.0000'}</Text>,
    },
    {
      title: t('credit.consumption.status'),
      dataIndex: 'billingStatus',
      key: 'billingStatus',
      width: 80,
      render: (v: string) => {
        const map: Record<string, { color: string; label: string }> = {
          completed: { color: 'green', label: t('credit.billingStatus.completed') },
          pending: { color: 'orange', label: t('credit.billingStatus.pending') },
          failed: { color: 'red', label: t('credit.billingStatus.failed') },
        };
        const item = map[v] || { color: 'default', label: v };
        return <Tag color={item.color} style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{item.label}</Tag>;
      },
    },
    {
      title: t('credit.consumption.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      sorter: (a: ConsumptionItem, b: ConsumptionItem) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      render: (v: string) => <Text type="secondary">{new Date(v).toLocaleString('zh-CN')}</Text>,
    },
  ];

  const transactionColumns: ColumnsType<TransactionItem> = [
    {
      title: t('common.actions'),
      key: 'actions',
      width: 40,
      fixed: 'left',
      render: (_, record: TransactionItem) => (
        <Dropdown
          menu={{
            items: [
              {
                key: 'detail',
                label: t('common.detail'),
                icon: <EyeOutlined />,
              },
            ],
            onClick: () => setDetailModal(record),
          }}
          trigger={['click']}
          placement="bottomRight"
        >
          <Button
            size="small"
            type="text"
            className="row-action-btn"
            icon={<DownOutlined />}
            onClick={(e) => e.stopPropagation()}
          />
        </Dropdown>
      ),
    },
    {
      title: t('credit.transaction.type'),
      dataIndex: 'type',
      key: 'type',
      width: 80,
      render: (v: string) => {
        const info = getTxTypeInfo(v);
        return <Tag color={info.color} style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{info.label}</Tag>;
      },
    },
    {
      title: t('credit.transaction.amount'),
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
      render: (v: number) => (
        <Text strong style={{ color: v >= 0 ? 'var(--color-success, #52c41a)' : 'var(--color-error, #ff4d4f)' }}>
          {v >= 0 ? '+' : ''}{v}
        </Text>
      ),
    },
    {
      title: t('credit.transaction.balanceAfter'),
      dataIndex: 'balanceAfter',
      key: 'balanceAfter',
      width: 100,
      render: (v: number) => <Text>{v}</Text>,
    },
    {
      title: t('credit.transaction.referenceId'),
      dataIndex: 'referenceId',
      key: 'referenceId',
      width: 140,
      ellipsis: true,
      render: (v: string) => v ? <Text code>{v}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: t('credit.transaction.remark'),
      dataIndex: 'remark',
      key: 'remark',
      width: 120,
      ellipsis: true,
      render: (v: string) => <Text type="secondary">{v || '-'}</Text>,
    },
    {
      title: t('credit.transaction.operator'),
      dataIndex: 'operatorId',
      key: 'operatorId',
      width: 100,
      ellipsis: true,
      render: (v: string) => v ? <Text>{v}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: t('credit.transaction.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      sorter: (a: TransactionItem, b: TransactionItem) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      render: (v: string) => <Text type="secondary">{new Date(v).toLocaleString('zh-CN')}</Text>,
    },
  ];

  const activeColumns = activeTab === 'consumptions' ? consumptionColumns : transactionColumns;

  const handleRefresh = async () => {
    if (!selectedUser) return;
    await fetchBalance(selectedUser.id);
    if (activeTab === 'consumptions') {
      await fetchConsumptions(selectedUser.id, consumptionPage);
    } else {
      await fetchTransactions(selectedUser.id, transactionPage);
    }
    message.success(t('credit.message.refreshed'));
  };

  const switchTab = (tab: 'consumptions' | 'transactions') => {
    setActiveTab(tab);
    if (!selectedUser) return;
    if (tab === 'consumptions') {
      fetchConsumptions(selectedUser.id, consumptionPage);
    } else {
      fetchTransactions(selectedUser.id, transactionPage);
    }
  };

  const pageTitle = activeTab === 'consumptions' ? t('credit.tab.consumptions') : t('credit.tab.transactions');

  const statCards = (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      <Col xs={12} sm={8} md={4}>
        <Statistic
          title={t('credit.stat.balance')}
          value={balance?.balance ?? 0}
          prefix={<WalletOutlined style={{ color: 'var(--color-primary, #1677ff)' }} />}
        />
      </Col>
      <Col xs={12} sm={8} md={4}>
        <Statistic
          title={t('credit.stat.frozen')}
          value={balance?.frozenAmount ?? 0}
          prefix={<ClockCircleOutlined style={{ color: 'var(--color-warning, #fa8c16)' }} />}
        />
      </Col>
      <Col xs={12} sm={8} md={4}>
        <Statistic
          title={t('credit.stat.available')}
          value={balance?.available ?? 0}
          prefix={<CheckCircleOutlined style={{ color: 'var(--color-success, #52c41a)' }} />}
        />
      </Col>
      <Col xs={12} sm={8} md={4}>
        <Statistic
          title={t('credit.stat.totalCharged')}
          value={balance?.totalCharged ?? 0}
          prefix={<DollarOutlined style={{ color: 'var(--color-purple, #722ed1)' }} />}
        />
      </Col>
      <Col xs={12} sm={8} md={4}>
        <Statistic
          title={t('credit.stat.totalConsumed')}
          value={balance?.totalConsumed ?? 0}
          prefix={<ThunderboltOutlined style={{ color: 'var(--color-error, #ff4d4f)' }} />}
        />
      </Col>
      <Col xs={12} sm={8} md={4}>
        <Statistic
          title={t('credit.stat.netSpend')}
          value={(balance?.totalCharged ?? 0) - (balance?.totalConsumed ?? 0)}
          prefix={<WalletOutlined style={{ color: 'var(--color-cyan, #13c2c2)' }} />}
        />
      </Col>
    </Row>
  );

  const detailContent = detailModal ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {activeTab === 'consumptions' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px 16px', fontSize: 13 }}>
          <Text type="secondary">ID:</Text>
          <Text code>{(detailModal as ConsumptionItem).id}</Text>
          <Text type="secondary">{t('credit.consumption.generationId')}:</Text>
          <Text code>{(detailModal as ConsumptionItem).generationId}</Text>
          <Text type="secondary">{t('credit.consumption.model')}:</Text>
          <Text strong>{(detailModal as ConsumptionItem).model}</Text>
          <Text type="secondary">{t('credit.transaction.type')}:</Text>
          <Tag color={MODEL_TYPE_COLOR[(detailModal as ConsumptionItem).modelType]} style={{ margin: 0, fontSize: 11 }}>
            {getModelTypeLabel((detailModal as ConsumptionItem).modelType)}
          </Tag>
          <Text type="secondary">{t('credit.consumption.channel')}:</Text>
          <Text>{(detailModal as ConsumptionItem).channelPool || '-'}</Text>
          <Text type="secondary">{t('credit.consumption.usage')}:</Text>
          <Text>{(detailModal as ConsumptionItem).usageAmount} {(detailModal as ConsumptionItem).unitType}</Text>
          <Text type="secondary">{t('credit.consumption.creditsConsumed')}:</Text>
          <Text strong style={{ color: 'var(--color-error, #ff4d4f)' }}>-{(detailModal as ConsumptionItem).creditsConsumed}</Text>
          <Text type="secondary">{t('credit.consumption.creditValue')}:</Text>
          <Text>¥{(detailModal as ConsumptionItem).creditValueCny?.toFixed?.(4) ?? '0.0000'}</Text>
          <Text type="secondary">{t('credit.consumption.upstreamCost')}:</Text>
          <Text type="secondary">${(detailModal as ConsumptionItem).upstreamCostUsd?.toFixed?.(4) ?? '0.0000'}</Text>
          <Text type="secondary">{t('credit.consumption.status')}:</Text>
          <Tag color={(detailModal as ConsumptionItem).billingStatus === 'completed' ? 'green' : (detailModal as ConsumptionItem).billingStatus === 'pending' ? 'orange' : 'red'} style={{ margin: 0, fontSize: 11 }}>
            {(detailModal as ConsumptionItem).billingStatus === 'completed' ? t('credit.billingStatus.completed') : (detailModal as ConsumptionItem).billingStatus === 'pending' ? t('credit.billingStatus.pending') : t('credit.billingStatus.failed')}
          </Tag>
          <Text type="secondary">{t('credit.consumption.createdAt')}:</Text>
          <Text type="secondary">{new Date((detailModal as ConsumptionItem).createdAt).toLocaleString('zh-CN')}</Text>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px 16px', fontSize: 13 }}>
          <Text type="secondary">ID:</Text>
          <Text code>{(detailModal as TransactionItem).id}</Text>
          <Text type="secondary">{t('credit.transaction.type')}:</Text>
          <Tag color={getTxTypeInfo((detailModal as TransactionItem).type).color} style={{ margin: 0, fontSize: 11 }}>
            {getTxTypeInfo((detailModal as TransactionItem).type).label}
          </Tag>
          <Text type="secondary">{t('credit.transaction.amount')}:</Text>
          <Text strong style={{ color: (detailModal as TransactionItem).amount >= 0 ? 'var(--color-success, #52c41a)' : 'var(--color-error, #ff4d4f)' }}>
            {(detailModal as TransactionItem).amount >= 0 ? '+' : ''}{(detailModal as TransactionItem).amount}
          </Text>
          <Text type="secondary">{t('credit.transaction.balanceAfter')}:</Text>
          <Text>{(detailModal as TransactionItem).balanceAfter}</Text>
          <Text type="secondary">{t('credit.transaction.referenceId')}:</Text>
          {(detailModal as TransactionItem).referenceId ? <Text code>{(detailModal as TransactionItem).referenceId}</Text> : <Text type="secondary">-</Text>}
          <Text type="secondary">{t('credit.transaction.remark')}:</Text>
          <Text type="secondary">{(detailModal as TransactionItem).remark || '-'}</Text>
          <Text type="secondary">{t('credit.transaction.operator')}:</Text>
          <Text type="secondary">{(detailModal as TransactionItem).operatorId || '-'}</Text>
          <Text type="secondary">{t('credit.transaction.createdAt')}:</Text>
          <Text type="secondary">{new Date((detailModal as TransactionItem).createdAt).toLocaleString('zh-CN')}</Text>
        </div>
      )}
    </div>
  ) : null;

  return (
    <BreadcrumbLayout
      items={[{ title: t('credit.breadcrumb.siteOps') }, { title: t('credit.breadcrumb.creditMgmt') }]}
      toolbar={
        <>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary, #595959)', marginRight: 12 }}>
            {selectedUser ? `${selectedUser.username} · ${pageTitle}` : pageTitle}
          </span>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh} disabled={!selectedUser}>
            {t('credit.btn.refresh')}
          </Button>
        </>
      }
    >
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Select
          style={{ width: 320 }}
          showSearch
          value={selectedUser?.id || undefined}
          placeholder={t('credit.search.placeholder')}
          onSearch={handleSearch}
          onChange={(value) => {
            if (value) {
              const user = searchResults.find((u) => u.id === value);
              if (user) {
                fetchUserData(user);
              }
            } else {
              setSelectedUser(null);
              setBalance(null);
              setConsumptions([]);
              setTransactions([]);
              setConsumptionTotal(0);
              setTransactionTotal(0);
            }
          }}
          filterOption={false}
          notFoundContent={searchText ? t('credit.search.searching') : t('credit.search.inputKeyword')}
          allowClear
          optionLabelProp="label"
        >
          {searchResults.map((u) => (
            <Select.Option key={u.id} value={u.id} label={u.username}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <UserOutlined style={{ color: 'var(--color-text-tertiary, #bfbfbf)' }} />
                <span>{u.username}</span>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {u.email || '-'}
                </Text>
                <Tag
                  color={u.role === 'super_admin' ? 'red' : u.role === 'admin' ? 'purple' : 'default'}
                  style={{ margin: 0, fontSize: 10 }}
                >
                  {u.role}
                </Tag>
              </div>
            </Select.Option>
          ))}
        </Select>
        {selectedUser && (
          <>
            <Button type="primary" icon={<DollarOutlined />} onClick={() => setRechargeOpen(true)}>
              {t('credit.btn.recharge')}
            </Button>
            <Button icon={<ThunderboltOutlined />} onClick={() => setRefundOpen(true)}>
              {t('credit.btn.refund')}
            </Button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <Button
          onClick={() => switchTab('consumptions')}
          type={activeTab === 'consumptions' ? 'link' : 'text'}
          style={{ padding: '4px 12px' }}
        >
          <HistoryOutlined /> {t('credit.tab.consumptions')}
        </Button>
        <Button
          onClick={() => switchTab('transactions')}
          type={activeTab === 'transactions' ? 'link' : 'text'}
          style={{ padding: '4px 12px' }}
        >
          <TransactionOutlined /> {t('credit.tab.transactions')}
        </Button>
      </div>

      {statCards}

      {selectedUser ? (
        <Table
          className="data-table"
          rowKey="id"
          loading={loading}
          columns={activeColumns as any}
          dataSource={(activeTab === 'consumptions' ? consumptions : transactions) as any}
          size="small"
          bordered
          sticky
          scroll={{ x: 'max-content' }}
          pagination={{
            current: activeTab === 'consumptions' ? consumptionPage : transactionPage,
            pageSize,
            total: activeTab === 'consumptions' ? consumptionTotal : transactionTotal,
            showSizeChanger: true,
            showTotal: (total) => t('credit.pagination.total', { total }),
            onChange: (page) => {
              if (activeTab === 'consumptions') {
                setConsumptionPage(page);
                fetchConsumptions(selectedUser.id, page);
              } else {
                setTransactionPage(page);
                fetchTransactions(selectedUser.id, page);
              }
            },
          }}
          locale={{ emptyText: activeTab === 'consumptions' ? t('credit.empty.noConsumptions') : t('credit.empty.noTransactions') }}
        />
      ) : (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-text-tertiary, #bfbfbf)' }}>
          <UserOutlined style={{ fontSize: 48, color: 'var(--color-text-tertiary, #bfbfbf)' }} />
          <div style={{ marginTop: 16 }}>{t('credit.empty.noUser')}</div>
        </div>
      )}

      {/* 详情弹窗 */}
      <Modal
        title={activeTab === 'consumptions' ? t('credit.detail.title') : t('credit.detail.transactionTitle')}
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={null}
        width={680}
        centered
        destroyOnHidden
      >
        {detailContent}
      </Modal>

      {/* 充值弹窗 */}
      <Modal
        title={t('credit.recharge.title')}
        open={rechargeOpen}
        onCancel={() => setRechargeOpen(false)}
        onOk={handleRecharge}
        okText={t('credit.recharge.confirm')}
        cancelText={t('common.cancel')}
        centered
        destroyOnHidden
      >
        {selectedUser && (
          <div style={{ marginBottom: 16 }}>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label={t('credit.recharge.user')}>{selectedUser.username}</Descriptions.Item>
              <Descriptions.Item label={t('credit.recharge.currentBalance')}>
                <Text strong>{balance?.balance ?? 0}</Text>
              </Descriptions.Item>
            </Descriptions>
          </div>
        )}
        <Form form={rechargeForm} layout="vertical">
          <Form.Item
            name="credits"
            label={t('credit.recharge.credits')}
            rules={[{ required: true, message: t('credit.recharge.creditsRequired') }]}
          >
            <InputNumber
              min={1}
              step={100}
              style={{ width: '100%' }}
              placeholder={t('credit.recharge.creditsPlaceholder')}
            />
          </Form.Item>
          <Form.Item name="remark" label={t('credit.recharge.remark')}>
            <Input.TextArea rows={3} placeholder={t('credit.recharge.remarkPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 退款弹窗 */}
      <Modal
        title={t('credit.refund.title')}
        open={refundOpen}
        onCancel={() => setRefundOpen(false)}
        onOk={handleRefund}
        okText={t('credit.refund.confirm')}
        cancelText={t('common.cancel')}
        centered
        destroyOnHidden
      >
        {selectedUser && (
          <div style={{ marginBottom: 16 }}>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label={t('credit.recharge.user')}>{selectedUser.username}</Descriptions.Item>
              <Descriptions.Item label={t('credit.recharge.currentBalance')}>
                <Text strong>{balance?.balance ?? 0}</Text>
              </Descriptions.Item>
            </Descriptions>
          </div>
        )}
        <Form form={refundForm} layout="vertical">
          <Form.Item
            name="credits"
            label={t('credit.refund.credits')}
            rules={[{ required: true, message: t('credit.refund.creditsRequired') }]}
          >
            <InputNumber
              min={1}
              step={100}
              style={{ width: '100%' }}
              placeholder={t('credit.refund.creditsPlaceholder')}
            />
          </Form.Item>
          <Form.Item name="referenceId" label={t('credit.refund.referenceId')}>
            <Input placeholder={t('credit.refund.referenceIdPlaceholder')} />
          </Form.Item>
          <Form.Item name="remark" label={t('credit.recharge.remark')}>
            <Input.TextArea rows={3} placeholder={t('credit.recharge.remarkPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </BreadcrumbLayout>
  );
}
