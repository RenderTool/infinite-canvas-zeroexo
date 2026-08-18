import { useState, useCallback, useEffect } from 'react';
import { Table, Button, Tag, Space, Modal, Select, Dropdown, Row, Col, Input, App, Form, DatePicker, Divider, Card } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ItemType } from 'antd/es/menu/interface';
import { ModalForm, ProFormText, ProFormSelect, StatisticCard } from '@ant-design/pro-components';
import dayjs from 'dayjs';
import { color as themeColor } from '@/design-tokens';
import {
  PlusOutlined,
  LockOutlined,
  UnlockOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  EllipsisOutlined,
  DeleteOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  UserOutlined,
  SearchOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { apiGet, apiPost, apiPatch, apiDelete, showApiError } from '@/services/api-client';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { User, roleLabels } from '@/pages/users-types';

interface PlanItem {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
}

export interface UserTableProps {
  currentUser: { role: string } | null;
  roleOptions: { label: string; value: string }[];
  refreshKey: number;
  triggerRefresh: () => void;
  onRefreshRoles?: () => void;
}

export default function UserTable({
  currentUser,
  roleOptions,
  refreshKey,
  triggerRefresh,
  onRefreshRoles,
}: UserTableProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isSuperAdmin = currentUser?.role === 'super_admin';
  const { message, modal } = App.useApp();

  const [data, setData] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();

  const [stats, setStats] = useState({ total: 0, active: 0, disabled: 0, admins: 0 });

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<User | null>(null);
  const [editForm] = Form.useForm();
  const [planOptions, setPlanOptions] = useState<{ label: string; value: string }[]>([]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('page', String(page));
      query.set('pageSize', String(pageSize));
      if (keyword) query.set('keyword', keyword);
      if (roleFilter) query.set('role', roleFilter);
      if (statusFilter) query.set('disabled', statusFilter);
      const result = await apiGet<{ items: User[]; total: number }>(`/admin/users?${query.toString()}`);
      setData(result.items || []);
      setTotal(result.total || 0);
    } catch (err) {
      showApiError(err, t('users.message.loadFailed'));
      setData([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, roleFilter, statusFilter, t]);

  // 挂载 / 筛选条件变化 / refreshKey 变化时统一重新拉取，避免重复请求
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers, refreshKey]);

  const fetchStats = useCallback(async () => {
    try {
      const result = await apiGet<{ total: number; active: number; disabled: number; admins: number }>('/admin/users/stats');
      setStats(result);
    } catch {
      setStats({
        total: data.length,
        active: data.filter((u) => !u.disabled).length,
        disabled: data.filter((u) => u.disabled).length,
        admins: data.filter((u) => u.role === 'admin' || u.role === 'super_admin').length,
      });
    }
  }, [data]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleDeleteUser = async (id: string, username: string) => {
    try {
      await apiDelete(`/admin/users/${id}`);
      message.success(t('users.message.deleted', { name: username }));
      triggerRefresh();
    } catch (err) {
      showApiError(err, t('users.message.deleteFailed'));
    }
  };

  const handleToggleDisable = async (id: string, disabled: boolean) => {
    try {
      await apiPatch(`/admin/users/${id}`, { disabled: !disabled });
      message.success(disabled ? t('users.message.enabled') : t('users.message.disabled'));
      triggerRefresh();
    } catch (err) {
      showApiError(err, t('users.message.operationFailed'));
    }
  };

  const handleClear = () => {
    setKeyword('');
    setRoleFilter(undefined);
    setStatusFilter(undefined);
    setPage(1);
  };

  const handleOpenEdit = async (record: User) => {
    setEditRecord(record);
    editForm.setFieldsValue({
      nickname: record.nickname || '',
      role: record.role,
      planCode: undefined,
      planExpiresAt: undefined,
    });
    // 动态获取启用的会员分组
    try {
      const plans = await apiGet<PlanItem[]>('/admin/plans?enabled=true');
      setPlanOptions(
        (Array.isArray(plans) ? plans : []).map((p) => ({
          label: `${p.name} (${p.code})`,
          value: p.code,
        })),
      );
    } catch {
      setPlanOptions([]);
    }
    // 回填当前有效订阅（无设置则保持为空）
    const isActive = record.planCode && record.planExpiresAt && new Date(record.planExpiresAt).getTime() > Date.now();
    if (isActive) {
      editForm.setFieldsValue({
        planCode: record.planCode,
        planExpiresAt: dayjs(record.planExpiresAt),
      });
    }
    setEditModalOpen(true);
  };

  const handleEditSubmit = async () => {
    if (!editRecord) return;
    try {
      const values = await editForm.validateFields();
      const payload: any = { ...values };
      if (payload.role && !isSuperAdmin) {
        delete payload.role;
      }
      payload.planCode = payload.planCode || null;
      payload.planExpiresAt = payload.planCode ? payload.planExpiresAt?.toISOString() ?? null : null;
      await apiPatch(`/admin/users/${editRecord.id}`, payload);
      message.success(t('users.message.updated'));
      setEditModalOpen(false);
      setEditRecord(null);
      editForm.resetFields();
      triggerRefresh();
    } catch {
      // validation failed, no need to handle
    }
  };

  const columns: ColumnsType<User> = [
    {
      title: t('users.column.username'),
      dataIndex: 'username',
      key: 'username',
      width: 130,
      ellipsis: true,
      sorter: (a, b) => a.username.localeCompare(b.username),
      render: (_dom: React.ReactNode, record: User) => {
        const roleInfo = roleLabels[record.role] || { labelKey: record.role, color: 'default' };
        return (
          <Space>
            <strong>{record.username}</strong>
            <Tag color={roleInfo.color} style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{t(roleInfo.labelKey)}</Tag>
          </Space>
        );
      },
    },
    {
      title: t('users.column.email'),
      dataIndex: 'email',
      key: 'email',
      width: 180,
      ellipsis: true,
      sorter: (a, b) => a.email.localeCompare(b.email),
      render: (_dom: React.ReactNode, record: User) => (
        <Space>
          <span>{record.email}</span>
          {record.emailVerified ? (
            <Tag color="green" style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{t('users.status.verified')}</Tag>
          ) : (
            <Tag color="default" style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{t('users.status.unverified')}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: t('users.column.nickname'),
      dataIndex: 'nickname',
      key: 'nickname',
      width: 100,
      ellipsis: true,
      sorter: (a, b) => (a.nickname || '').localeCompare(b.nickname || ''),
    },
    {
      title: t('users.column.plan'),
      key: 'plan',
      width: 140,
      sorter: (a, b) => (a.planCode || '').localeCompare(b.planCode || ''),
      render: (_dom: React.ReactNode, record: User) => {
        const isActive = record.planCode && record.planExpiresAt && new Date(record.planExpiresAt).getTime() > Date.now();
        if (!isActive) {
          return <Tag color="default" style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{t('users.plan.free')}</Tag>;
        }
        const colorMap: Record<string, string> = {
          basic: 'blue',
          standard: 'cyan',
          premium: 'purple',
          ultimate: 'gold',
          enterprise: 'volcano',
        };
        return (
          <Space size={4}>
            <Tag color={colorMap[record.planCode!] || 'blue'} style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>
              {record.planCode}
            </Tag>
            <span style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 12 }}>
              {new Date(record.planExpiresAt!).toLocaleDateString('zh-CN')}
            </span>
          </Space>
        );
      },
    },
    {
      title: t('users.column.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      ellipsis: true,
      sorter: true,
      render: (v: string) => <span style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 12 }}>{new Date(v).toLocaleString('zh-CN')}</span>,
    },
    {
      title: t('users.column.action'),
      key: 'actions',
      width: 48,
      fixed: 'right',
      render: (_dom: React.ReactNode, record: User) => {
        const isSuper = record.role === 'super_admin';
        const moreItems: ItemType[] = [];

        moreItems.push({
          key: 'edit',
          label: t('users.action.edit'),
          icon: <EditOutlined />,
        });

        if (!isSuper) {
          moreItems.push({
            key: 'toggle',
            label: record.disabled ? t('users.action.enable') : t('users.action.disable'),
            icon: record.disabled ? <UnlockOutlined /> : <LockOutlined />,
          });
        }

        moreItems.push({
          key: 'resources',
          label: t('users.action.resource'),
          icon: <FolderOpenOutlined />,
        });

        if (!isSuper) {
          moreItems.push({ type: 'divider' });
          moreItems.push({
            key: 'delete',
            label: t('users.action.delete'),
            icon: <DeleteOutlined />,
            danger: true,
          });
        }

        return (
          <div className="row-actions">
            <Dropdown
              menu={{
                items: moreItems,
                onClick: ({ key }) => {
                  if (key === 'edit') handleOpenEdit(record);
                  if (key === 'toggle') handleToggleDisable(record.id, record.disabled);
                  if (key === 'resources') navigate(`/users/${record.id}/resources`);
                  if (key === 'delete') {
                    modal.confirm({
                      title: t('users.confirm.delete', { name: record.username }),
                      centered: true,
                      okType: 'danger',
                      okText: t('users.action.delete'),
                      cancelText: t('common.cancel'),
                      onOk: () => handleDeleteUser(record.id, record.username),
                    });
                  }
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
        );
      },
    },
  ];

  const roleOptionsList = [
    { label: t('users.role.user'), value: 'user' },
    { label: t('users.role.admin'), value: 'admin' },
    { label: t('users.role.superAdmin'), value: 'super_admin' },
  ];

  const statusOptionsList = [
    { label: t('users.status.normal'), value: 'false' },
    { label: t('users.status.disabled'), value: 'true' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
      {/* 统计卡片：与定价分组统计卡片同款风格与布局 */}
      <Card>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={6}>
            <StatisticCard
              statistic={{
                title: t('users.stats.total'),
                value: stats.total,
                prefix: <TeamOutlined style={{ color: themeColor.primary }} />,
              }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <StatisticCard
              statistic={{
                title: t('users.stats.active'),
                value: stats.active,
                prefix: <CheckCircleOutlined style={{ color: themeColor.success }} />,
              }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <StatisticCard
              statistic={{
                title: t('users.stats.disabled'),
                value: stats.disabled,
                prefix: <CloseCircleOutlined style={{ color: themeColor.error }} />,
              }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <StatisticCard
              statistic={{
                title: t('users.stats.admins'),
                value: stats.admins,
                prefix: <UserOutlined style={{ color: themeColor.warning }} />,
              }}
            />
          </Col>
        </Row>
      </Card>

      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Input
          placeholder={t('users.column.username')}
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          style={{ width: 240 }}
          allowClear
        />
        <Select
          placeholder={t('users.column.role')}
          allowClear
          style={{ width: 140 }}
          options={roleOptionsList}
          value={roleFilter}
          onChange={(v) => { setRoleFilter(v); setPage(1); }}
        />
        <Select
          placeholder={t('users.column.status')}
          allowClear
          style={{ width: 140 }}
          options={statusOptionsList}
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(1); }}
        />
        <Button onClick={handleClear}>
          {t('common.clear')}
        </Button>
        <div style={{ flex: 1 }} />
        <Button key="refresh" icon={<ReloadOutlined />} onClick={() => { fetchUsers(); fetchStats(); }}>
          {t('common.refresh')}
        </Button>
        <ModalForm
          key="add"
          title={t('users.action.add')}
          trigger={
            <Button type="primary" icon={<PlusOutlined />} onClick={onRefreshRoles}>
              {t('users.action.add')}
            </Button>
          }
          onFinish={async (values) => {
            await apiPost('/admin/users', values);
            message.success(t('users.message.created'));
            triggerRefresh();
            return true;
          }}
        >
          <ProFormText name="username" label={t('users.form.username')} rules={[{ required: true }]} />
          <ProFormText name="email" label={t('users.form.email')} rules={[{ required: true, type: 'email' }]} />
          <ProFormText.Password name="password" label={t('users.form.password')} rules={[{ required: true, min: 6 }]} />
          <ProFormText name="nickname" label={t('users.form.nickname')} placeholder={t('users.form.optional')} />
          <ProFormSelect name="role" label={t('users.form.role')} initialValue="user" options={roleOptions} disabled={!isSuperAdmin} />
        </ModalForm>
      </div>

      <Table<User>
        className="data-table resource-table"
        key={`users-${refreshKey}`}
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        size="small"
        bordered
        sticky
        locale={{
          emptyText: (
            <div style={{ padding: '40px 0', color: 'var(--color-text-secondary, #999)' }}>
              {t('users.noData')}
            </div>
          ),
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t2) => t('common.total', { total: t2 }),
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        scroll={{ x: 1250 }}
      />

      {/* 编辑用户弹窗 */}
      <Modal
        title={t('users.action.editUser')}
        open={editModalOpen}
        onCancel={() => {
          setEditModalOpen(false);
          setEditRecord(null);
          editForm.resetFields();
        }}
        onOk={handleEditSubmit}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        centered
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" preserve={false}>
          <Form.Item
            name="nickname"
            label={t('users.form.nickname')}
          >
            <Input placeholder={t('users.form.optional')} />
          </Form.Item>
          <Form.Item
            name="role"
            label={t('users.form.role')}
            rules={[{ required: true }]}
          >
            <Select
              options={roleOptions}
              disabled={!isSuperAdmin}
            />
          </Form.Item>
          {!isSuperAdmin && (
            <p style={{ color: '#999', fontSize: 12, marginTop: -8 }}>{t('users.edit.onlySuperAdmin')}</p>
          )}
          <Divider style={{ margin: '12px 0' }} />
          <Form.Item
            name="planCode"
            label={t('users.form.plan')}
            extra={t('users.edit.planHint')}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('users.plan.free')}
              options={planOptions}
              onChange={() => editForm.setFieldValue('planExpiresAt', undefined)}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.planCode !== cur.planCode}
          >
            {({ getFieldValue }) =>
              getFieldValue('planCode') ? (
                <Form.Item
                  name="planExpiresAt"
                  label={t('users.form.planExpiresAt')}
                  rules={[{ required: true, message: t('users.message.planExpiresRequired') }]}
                >
                  <DatePicker
                    style={{ width: '100%' }}
                    showTime
                    disabledDate={(d) => d && d.startOf('day').isBefore(dayjs().startOf('day'))}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
