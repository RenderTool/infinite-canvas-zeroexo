import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Table,
  Button,
  Switch,
  Tag,
  Tooltip,
  message,
  Modal,
  Input,
  Select,
  Space,
  Alert,
  Dropdown,
  DatePicker,
} from 'antd';
import type { Dayjs } from 'dayjs';
import {
  ReloadOutlined,
  DeleteOutlined,
  SearchOutlined,
  EyeOutlined,
  EllipsisOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { apiGet, apiDelete, showApiError } from '@/services/api-client';
import { useTranslation } from 'react-i18next';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';
import type { ColumnsType } from 'antd/es/table';

interface LogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  category: string;
  message: string;
  username?: string;
  userId?: string;
  meta?: Record<string, unknown>;
}

interface LogStats {
  total: number;
  byLevel: Record<string, number>;
  byCategory: Record<string, number>;
}

const LEVEL_COLORS: Record<string, string> = {
  info: 'blue',
  warn: 'orange',
  error: 'red',
};

const LEVEL_OPTIONS = [
  { value: 'info', label: 'INFO' },
  { value: 'warn', label: 'WARN' },
  { value: 'error', label: 'ERROR' },
];

const CATEGORY_OPTIONS = (t: (key: string) => string) => [
  { value: 'all', label: t('logs.filter.allCategories') },
  { value: 'auth', label: t('logs.filter.auth') },
  { value: 'user', label: t('logs.filter.user') },
  { value: 'billing', label: t('logs.filter.billing') },
  { value: 'api', label: t('logs.filter.api') },
  { value: 'system', label: t('logs.filter.system') },
];

export default function Logs() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [level, setLevel] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [username, setUsername] = useState('');
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [detailModal, setDetailModal] = useState<LogEntry | null>(null);

  const [autoRefresh, setAutoRefresh] = useState(() => {
    const saved = localStorage.getItem('zeroexo:logs:auto-refresh');
    return saved === 'true';
  });
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { t } = useTranslation();

  const stopAutoRefreshTimer = useCallback(() => {
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }
  }, []);

  const startAutoRefreshTimer = useCallback(() => {
    stopAutoRefreshTimer();
    autoRefreshTimerRef.current = setInterval(() => {
      fetchData();
    }, 3000);
  }, [stopAutoRefreshTimer]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      params.set('offset', String((page - 1) * pageSize));
      if (keyword) params.set('keyword', keyword);
      if (level) params.set('level', level);
      if (category && category !== 'all') params.set('category', category);
      if (username) params.set('username', username);
      if (timeRange) {
        params.set('startTime', timeRange[0].toISOString());
        params.set('endTime', timeRange[1].toISOString());
      }

      const result = await apiGet<{ entries: LogEntry[]; total: number; stats: LogStats }>(
        `/admin/logs?${params.toString()}`,
      );
      setData(result.entries || []);
      setTotal(result.total ?? result.stats?.total ?? 0);
    } catch (err) {
      showApiError(err, t('error.load'));
      setData([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, level, category, username, timeRange, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (autoRefresh) {
      startAutoRefreshTimer();
    } else {
      stopAutoRefreshTimer();
    }
    return () => {
      stopAutoRefreshTimer();
    };
  }, [autoRefresh, startAutoRefreshTimer, stopAutoRefreshTimer]);

  const handleAutoRefreshChange = (checked: boolean) => {
    setAutoRefresh(checked);
    localStorage.setItem('zeroexo:logs:auto-refresh', String(checked));
  };

  const handleCopyDetail = async () => {
    if (!detailModal) return;
    const lines = [
      `${t('logs.detail.time')} ${new Date(detailModal.timestamp).toLocaleString('zh-CN')}`,
      `${t('logs.detail.level')} ${detailModal.level.toUpperCase()}`,
      `${t('logs.detail.category')} ${detailModal.category}`,
      `${t('logs.detail.user')} ${detailModal.username || (detailModal.userId ? detailModal.userId : '-')}`,
      `${t('logs.detail.message')} ${detailModal.message}`,
    ];
    if (detailModal.meta && Object.keys(detailModal.meta).length > 0) {
      lines.push(`${t('logs.detail.meta')}: ${JSON.stringify(detailModal.meta, null, 2)}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      message.success(t('logs.copied'));
    } catch {
      message.error(t('logs.copyFailed'));
    }
  };

  const handleClearLogs = () => {
    Modal.confirm({
      title: t('logs.confirmClear'),
      content: t('logs.confirmClear'),
      centered: true,
      okType: 'danger',
      okText: t('logs.clear'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await apiDelete('/admin/logs');
          message.success(t('logs.message.cleared'));
          fetchData();
        } catch (err) {
          showApiError(err, t('logs.message.clearFailed'));
        }
      },
    });
  };

  const columns: ColumnsType<LogEntry> = [
    {
      title: t('logs.columns.time'),
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 170,
      sorter: (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      render: (v: string) => (
        <span style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 12 }}>
          {new Date(v).toLocaleString('zh-CN')}
        </span>
      ),
    },
    {
      title: t('logs.columns.level'),
      dataIndex: 'level',
      key: 'level',
      width: 70,
      sorter: (a, b) => a.level.localeCompare(b.level),
      render: (v: string) => (
        <Tag
          color={LEVEL_COLORS[v] || 'default'}
          style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}
        >
          {v.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: t('logs.columns.category'),
      dataIndex: 'category',
      key: 'category',
      width: 80,
      sorter: (a, b) => a.category.localeCompare(b.category),
      render: (v: string) => (
        <Tag style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>
          {v}
        </Tag>
      ),
    },
    {
      title: t('logs.columns.user'),
      dataIndex: ['username', 'userId'],
      key: 'user',
      width: 100,
      render: (_: React.ReactNode, record: LogEntry) =>
        record.username || (record.userId ? record.userId.slice(0, 8) : '-'),
    },
    {
      title: t('logs.columns.message'),
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <span>{v}</span>
        </Tooltip>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 48,
      fixed: 'right',
      render: (_, record: LogEntry) => (
        <div className="row-actions">
          <Dropdown
            menu={{
              items: [
                {
                  key: 'detail',
                  label: t('logs.action.detail'),
                  icon: <EyeOutlined />,
                },
              ],
              onClick: () => setDetailModal(record),
            }}
            trigger={['click']}
            placement="bottomRight"
          >
            <Button
              type="primary"
              icon={<EllipsisOutlined />}
              style={{ width: 32, height: 32, padding: 0 }}
            />
          </Dropdown>
        </div>
      ),
    },
  ];

  return (
    <BreadcrumbLayout
      items={[{ title: t('logs.title') }]}
      toolbar={
        <Space size={12}>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary, #595959)' }}>
            {t('common.autoRefresh')}
          </span>
          <Switch size="small" checked={autoRefresh} onChange={handleAutoRefreshChange} />
          <Button icon={<ReloadOutlined />} onClick={fetchData}>
            {t('common.refresh')}
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={handleClearLogs}>
            {t('logs.clear')}
          </Button>
        </Space>
      }
    >
      <Alert
        title={t('logs.alert.clearHint')}
        type="info"
        showIcon
        style={{ marginBottom: 16, fontSize: 12 }}
      />

      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Input
          placeholder={t('logs.columns.message')}
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          style={{ width: 240 }}
          allowClear
        />
        <Input
          placeholder={t('logs.columns.user')}
          prefix={<SearchOutlined />}
          value={username}
          onChange={(e) => { setUsername(e.target.value); setPage(1); }}
          style={{ width: 240 }}
          allowClear
        />
        <Select
          placeholder={t('logs.columns.level')}
          allowClear
          style={{ width: 100 }}
          options={LEVEL_OPTIONS}
          value={level}
          onChange={(v) => { setLevel(v); setPage(1); }}
        />
        <Select
          placeholder={t('logs.columns.category')}
          allowClear
          style={{ width: 140 }}
          options={CATEGORY_OPTIONS(t)}
          value={category}
          onChange={(v) => { setCategory(v); setPage(1); }}
        />
        <DatePicker.RangePicker
          showTime={{ format: 'HH:mm:ss' }}
          format="YYYY-MM-DD HH:mm:ss"
          placeholder={[t('logs.filter.startTime'), t('logs.filter.endTime')]}
          value={timeRange}
          onChange={(v) => { setTimeRange(v as [Dayjs, Dayjs] | null); setPage(1); }}
        />
        <Button
          onClick={() => {
            setKeyword('');
            setUsername('');
            setLevel(undefined);
            setCategory(undefined);
            setTimeRange(null);
            setPage(1);
          }}
        >
          {t('common.clear')}
        </Button>
      </div>

      <Table<LogEntry>
        className="data-table resource-table"
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        size="small"
        bordered
        sticky
        scroll={{ x: 'max-content' }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (total) => `${t('common.total')} ${total} ${t('common.items')}`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />

      {/* 详情弹窗 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 24 }}>
            <span>{t('logs.detail.title')}</span>
            <Button size="small" icon={<CopyOutlined />} onClick={handleCopyDetail}>
              {t('logs.copy')}
            </Button>
          </div>
        }
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={null}
        width={680}
        centered
        destroyOnHidden
      >
        {detailModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '8px 16px', fontSize: 13 }}>
              <span style={{ color: 'var(--color-text-secondary, #595959)' }}>{t('logs.detail.time')}</span>
              <span>{new Date(detailModal.timestamp).toLocaleString('zh-CN')}</span>
              <span style={{ color: 'var(--color-text-secondary, #595959)' }}>{t('logs.detail.level')}</span>
              <Tag
                color={LEVEL_COLORS[detailModal.level]}
                style={{ margin: 0, fontSize: 11 }}
              >
                {detailModal.level.toUpperCase()}
              </Tag>
              <span style={{ color: 'var(--color-text-secondary, #595959)' }}>{t('logs.detail.category')}</span>
              <Tag style={{ margin: 0, fontSize: 11 }}>{detailModal.category}</Tag>
              <span style={{ color: 'var(--color-text-secondary, #595959)' }}>{t('logs.detail.user')}</span>
              <span>{detailModal.username || (detailModal.userId ? detailModal.userId.slice(0, 8) : '-')}</span>
              <span style={{ color: 'var(--color-text-secondary, #595959)' }}>{t('logs.detail.message')}</span>
              <span>{detailModal.message}</span>
            </div>
            {detailModal.meta && Object.keys(detailModal.meta).length > 0 && (
              <div>
                <div style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 12, marginBottom: 4 }}>
                  {t('logs.detail.meta')}
                </div>
                <pre
                  style={{
                    background: 'var(--color-bg-code, #f6f8fa)',
                    borderRadius: 'var(--radius-md, 6px)',
                    padding: 12,
                    fontSize: 12,
                    maxHeight: 200,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {JSON.stringify(detailModal.meta, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </BreadcrumbLayout>
  );
}
