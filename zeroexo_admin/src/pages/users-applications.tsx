/**
 * 用户管理 - 申请审核独立页面
 *
 * 由左侧 sidebar 子项「申请审核」导航，不包含页面内 Tabs。
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Tag, Button, message, Modal, Select, Form, Input, Table, Dropdown,
} from 'antd';
import {
  CheckOutlined, CloseOutlined, SearchOutlined, EllipsisOutlined, ReloadOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { apiGet, apiPatch, apiDelete, showApiError } from '@/services/api-client';
import { useTranslation } from 'react-i18next';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';
import { UserApplication } from './users-types';
import type { ColumnsType } from 'antd/es/table';
import type { ItemType } from 'antd/es/menu/interface';

export default function UsersApplications() {
  const { t } = useTranslation();

  const [appLoading, setAppLoading] = useState(false);
  const [appData, setAppData] = useState<UserApplication[]>([]);
  const [appTotal, setAppTotal] = useState(0);
  const [appPage, setAppPage] = useState(1);
  const [appPageSize, setAppPageSize] = useState(20);
  const [appSearch, setAppSearch] = useState<{ username?: string; status?: string }>({});
  const [, setPendingCount] = useState(0);
  const [approveModal, setApproveModal] = useState<{ id: string; username: string; type: string } | null>(null);
  const [targetRole, setTargetRole] = useState('admin');

  const fetchApplications = useCallback(async () => {
    setAppLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(appPage));
      params.set('limit', String(appPageSize));
      if (appSearch.username) params.set('username', appSearch.username);
      if (appSearch.status) params.set('status', appSearch.status);
      const result = await apiGet<{ items: UserApplication[]; total: number }>(
        `/admin/applications?${params.toString()}`,
      );
      setAppData(Array.isArray(result?.items) ? result.items : []);
      setAppTotal(result?.total ?? 0);
      setPendingCount(
        (result?.items || []).filter((a) => a.status === 'pending').length,
      );
    } catch (err) {
      showApiError(err, t('users.message.applicationsLoadFailed'));
      setAppData([]);
      setAppTotal(0);
    } finally {
      setAppLoading(false);
    }
  }, [appPage, appPageSize, appSearch, t]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleApproveWithRole = async () => {
    if (!approveModal) return;
    try {
      await apiPatch(`/admin/applications/${approveModal.id}/approve`, { targetRole });
      message.success(t('users.message.approved', { role: t(`users.role.${targetRole}` as any) }));
      setApproveModal(null);
      fetchApplications();
    } catch (err) {
      showApiError(err, t('users.message.approveFailed'));
    }
  };

  const handleReject = async (id: string) => {
    try {
      await apiPatch(`/admin/applications/${id}/reject`, {});
      message.success(t('users.message.rejected'));
      fetchApplications();
    } catch (err) {
      showApiError(err, t('users.message.rejectFailed'));
    }
  };

  const handleDeleteApplication = (id: string) => {
    Modal.confirm({
      title: t('users.confirm.deleteApplication'),
      content: t('users.confirm.deleteApplication'),
      centered: true,
      okType: 'danger',
      okText: t('users.action.delete'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await apiDelete(`/admin/applications/${id}`);
          message.success(t('users.message.applicationDeleted'));
          fetchApplications();
        } catch (err) {
          showApiError(err, t('users.message.applicationDeleteFailed'));
        }
      },
    });
  };

  const applicationColumns: ColumnsType<UserApplication> = [
    {
      title: t('users.column.username'),
      dataIndex: 'username',
      key: 'username',
      width: 120,
      ellipsis: true,
      sorter: (a, b) => a.username.localeCompare(b.username),
      render: (v: string) => <strong>{v}</strong>,
    },
    {
      title: t('users.column.email'),
      dataIndex: 'email',
      key: 'email',
      width: 180,
      ellipsis: true,
      sorter: (a, b) => a.email.localeCompare(b.email),
      render: (v: string) => v,
    },
    {
      title: t('users.column.type'),
      dataIndex: 'type',
      key: 'type',
      width: 100,
      sorter: (a, b) => a.type.localeCompare(b.type),
      render: (v: string) => (
        <Tag color={v === 'admin' ? 'red' : 'purple'} style={{ margin: 0 }}>
          {v === 'admin' ? t('users.role.admin') : t('users.role.operator')}
        </Tag>
      ),
    },
    {
      title: t('users.column.reason'),
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: t('users.column.status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      sorter: (a, b) => a.status.localeCompare(b.status),
      render: (v: string) => {
        const colors: Record<string, string> = { pending: 'orange', approved: 'green', rejected: 'red' };
        const texts: Record<string, string> = {
          pending: t('users.status.pending'),
          approved: t('users.status.approved'),
          rejected: t('users.status.rejected'),
        };
        return <Tag color={colors[v]} style={{ margin: 0 }}>{texts[v]}</Tag>;
      },
    },
    {
      title: t('users.column.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: t('users.column.action'),
      key: 'actions',
      width: 48,
      fixed: 'right',
      render: (_, record: UserApplication) => {
        const items: ItemType[] = [];

        if (record.status === 'pending') {
          items.push({
            key: 'approve',
            label: t('users.action.approve'),
            icon: <CheckOutlined />,
          });
          items.push({
            key: 'reject',
            label: t('users.action.reject'),
            icon: <CloseOutlined />,
            danger: true,
          });
        } else if (record.status === 'rejected') {
          items.push({
            key: 'reapprove',
            label: t('users.action.reapprove'),
            icon: <CheckOutlined />,
          });
        } else if (record.status === 'approved') {
          items.push({
            key: 'cancel',
            label: t('users.action.cancelApproval'),
            icon: <CloseOutlined />,
            danger: true,
          });
        }

        items.push({ type: 'divider' });
        items.push({
          key: 'delete',
          label: t('users.action.delete'),
          icon: <DeleteOutlined />,
          danger: true,
        });

        return (
          <div className="row-actions">
            <Dropdown
              menu={{
                items,
                onClick: ({ key }) => {
                  if (key === 'approve' || key === 'reapprove') {
                    setApproveModal({ id: record.id, username: record.username, type: record.type });
                    setTargetRole(record.type === 'operator' ? 'operator' : 'admin');
                  }
                  if (key === 'reject' || key === 'cancel') handleReject(record.id);
                  if (key === 'delete') handleDeleteApplication(record.id);
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

  return (
    <BreadcrumbLayout
      items={[
        { title: t('users.title') },
        { title: t('users.applicationReview') },
      ]}
    >
        <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <Input
            placeholder={t('users.column.username')}
            prefix={<SearchOutlined />}
            value={appSearch.username}
            onChange={(e) => { setAppSearch((prev) => ({ ...prev, username: e.target.value })); setAppPage(1); }}
            style={{ width: 160 }}
            allowClear
          />
          <Select
            placeholder={t('users.column.status')}
            allowClear
            style={{ width: 120 }}
            value={appSearch.status}
            onChange={(v) => { setAppSearch((prev) => ({ ...prev, status: v || undefined })); setAppPage(1); }}
            options={[
              { value: 'pending', label: t('users.status.pending') },
              { value: 'approved', label: t('users.status.approved') },
              { value: 'rejected', label: t('users.status.rejected') },
            ]}
          />
          <Button
            onClick={() => { setAppSearch({}); setAppPage(1); }}
          >
            {t('common.clear')}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchApplications}>
            {t('common.refresh')}
          </Button>
        </div>

        <Table<UserApplication>
          className="data-table resource-table"
          rowKey="id"
          columns={applicationColumns}
          dataSource={appData}
          loading={appLoading}
          size="small"
          bordered
          sticky
          scroll={{ x: 'max-content' }}
          pagination={{
            current: appPage,
            pageSize: appPageSize,
            total: appTotal,
            showSizeChanger: true,
            showTotal: (t2) => t('users.paginationTotal', { total: t2 }),
            onChange: (p, ps) => {
              setAppPage(p);
              setAppPageSize(ps);
            },
          }}
          locale={{ emptyText: t('users.noApplications') }}
        />

        <Modal
          title={t('users.action.approve')}
          open={!!approveModal}
          onOk={handleApproveWithRole}
          onCancel={() => setApproveModal(null)}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
          centered
          width={520}
          destroyOnHidden
        >
          {approveModal && (
            <Form layout="vertical">
              <Form.Item>
                <span>
                  {t('users.action.approve')} <strong>{approveModal.username}</strong> {t('users.message.approved')}（
                  {approveModal.type === 'admin' ? t('users.role.admin') : t('users.role.operator')}）
                </span>
              </Form.Item>
              <Form.Item label={t('users.form.selectRole')}>
                <Select
                  value={targetRole}
                  onChange={setTargetRole}
                  style={{ width: '100%' }}
                  options={[
                    { label: t('users.role.admin'), value: 'admin' },
                    { label: t('users.role.operator'), value: 'operator' },
                  ]}
                />
              </Form.Item>
            </Form>
          )}
        </Modal>
    </BreadcrumbLayout>
  );
}
