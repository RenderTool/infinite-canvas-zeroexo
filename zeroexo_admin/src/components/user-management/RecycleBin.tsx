import { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Tag,
  Button,
  Modal,
  Input,
  Dropdown,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  RollbackOutlined,
  EllipsisOutlined,
  SearchOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { apiGet, showApiError } from '@/services/api-client';
import { useTranslation } from 'react-i18next';
import { DeletedUser } from '@/pages/users-types';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

export interface RecycleBinProps {
  refreshKey: number;
  onRestore: (user: DeletedUser) => void;
  onPermanentDelete: (user: DeletedUser) => void;
  selectedDeletedUser: DeletedUser | null;
  onSelectDeletedUser: (user: DeletedUser | null) => void;
}

export default function RecycleBin({
  refreshKey,
  onRestore,
  onPermanentDelete,
  selectedDeletedUser,
  onSelectDeletedUser,
}: RecycleBinProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DeletedUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      if (username) params.set('username', username);
      if (email) params.set('email', email);
      const result = await apiGet<{ items: DeletedUser[]; total: number }>(
        `/admin/users/recycle-bin?${params.toString()}`,
      );
      setData(Array.isArray(result?.items) ? result.items : []);
      setTotal(result?.total ?? 0);
    } catch (err) {
      showApiError(err, t('users.message.recycleLoadFailed'));
      setData([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, username, email, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [refreshKey, fetchData]);

  const handleRefresh = () => {
    fetchData();
  };

  const handleClear = () => {
    setUsername('');
    setEmail('');
    setPage(1);
  };

  const columns: ColumnsType<DeletedUser> = [
    {
      title: t('users.column.username'),
      dataIndex: 'username',
      key: 'username',
      width: 120,
      ellipsis: true,
      sorter: (a, b) => a.username.localeCompare(b.username),
      render: (v: string, record: DeletedUser) => (
        <span style={{ color: '#ff4d4f' }}>
          {v}
          {record.role === 'admin' && (
            <Tag color="red" style={{ marginLeft: 8, fontSize: 11 }}>
              {t('users.role.admin')}
            </Tag>
          )}
        </span>
      ),
    },
    {
      title: t('users.column.email'),
      dataIndex: 'email',
      key: 'email',
      width: 180,
      ellipsis: true,
      render: (v: string) => <Text type="secondary">{v}</Text>,
    },
    {
      title: t('users.column.nickname'),
      dataIndex: 'nickname',
      key: 'nickname',
      width: 100,
      ellipsis: true,
      render: (v: string) => v || <Text type="secondary">-</Text>,
    },
    {
      title: t('users.column.remainingDays'),
      dataIndex: 'remainingDays',
      key: 'remainingDays',
      width: 90,
      sorter: (a, b) => a.remainingDays - b.remainingDays,
      render: (v: number) => (
        <Tag
          color={v <= 3 ? 'red' : v <= 7 ? 'orange' : 'default'}
          style={{ margin: 0 }}
        >
          {v} {t('dashboard.monitoring.days')}
        </Tag>
      ),
    },
    {
      title: t('users.column.deletedAt'),
      dataIndex: 'deletedAt',
      key: 'deletedAt',
      width: 160,
      sorter: (a, b) => new Date(a.deletedAt).getTime() - new Date(b.deletedAt).getTime(),
      render: (v: string) => <Text type="secondary">{new Date(v).toLocaleString('zh-CN')}</Text>,
    },
    {
      title: t('users.column.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      ellipsis: true,
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      render: (v: string) => <Text type="secondary">{new Date(v).toLocaleString('zh-CN')}</Text>,
    },
    {
      title: t('users.column.action'),
      key: 'actions',
      width: 48,
      fixed: 'right',
      render: (_, record: DeletedUser) => (
        <div className="row-actions">
          <Dropdown
            menu={{
              items: [
                {
                  key: 'restore',
                  label: t('users.action.restore'),
                  icon: <RollbackOutlined />,
                },
                { type: 'divider' },
                {
                  key: 'delete',
                  label: t('users.action.permanentDelete'),
                  icon: <DeleteOutlined />,
                  danger: true,
                },
              ],
              onClick: ({ key }) => {
                if (key === 'restore') onRestore(record);
                if (key === 'delete') onSelectDeletedUser(record);
              },
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
    <>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Input
          placeholder={t('users.column.username')}
          prefix={<SearchOutlined />}
          value={username}
          onChange={(e) => { setUsername(e.target.value); setPage(1); }}
          style={{ width: 240 }}
          allowClear
        />
        <Input
          placeholder={t('users.column.email')}
          prefix={<SearchOutlined />}
          value={email}
          onChange={(e) => { setEmail(e.target.value); setPage(1); }}
          style={{ width: 240 }}
          allowClear
        />
        <Button onClick={handleClear}>
          {t('common.clear')}
        </Button>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
          {t('common.refresh')}
        </Button>
      </div>

      <Table<DeletedUser>
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
          showTotal: (total) => t('users.paginationTotal', { total }),
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        locale={{ emptyText: t('users.recycleBinEmpty') }}
      />

      <Modal
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DeleteOutlined style={{ color: '#ff4d4f' }} />
            <span>{t('users.confirm.permanentDelete')}</span>
          </span>
        }
        open={!!selectedDeletedUser}
        onOk={async () => {
          if (selectedDeletedUser) {
            await onPermanentDelete(selectedDeletedUser);
          }
        }}
        onCancel={() => onSelectDeletedUser(null)}
        okText={t('users.confirm.permanentDelete')}
        cancelText={t('common.cancel')}
        okButtonProps={{ danger: true }}
        width={480}
        centered
      >
        {selectedDeletedUser && (
          <div style={{ lineHeight: 1.8 }}>
            <p>
              {t('users.confirm.permanentDeleteDesc', { name: selectedDeletedUser.username })}
            </p>
            <p style={{ color: 'var(--color-text-secondary, #888)', fontSize: 13 }}>
              {t('users.confirm.permanentDeleteEmail')}: {selectedDeletedUser.email}
              <br />
              {t('users.confirm.permanentDeleteDays')}: {selectedDeletedUser.remainingDays} {t('dashboard.monitoring.days')}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
