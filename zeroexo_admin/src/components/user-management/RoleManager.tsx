// 角色管理组件
// 从 pages/users.tsx 拆分规划而来，提供独立的角色管理界面
// 说明：原 users.tsx 中不存在独立的"角色管理 Tab"，pathToTabKey 中仅预留了 roles 路由映射。
// 此组件为预留扩展，暂未接入主页面 tabItems，以保持运行时行为不变。
// 后续如需启用，可在 users.tsx 中导入并作为新 Tab 项添加（参考 RecycleBin 接入方式）。

import { ProTable, ProColumns } from '@ant-design/pro-components';
import { Tag, Space, Select } from 'antd';
import { apiGet, showApiError } from '@/services/api-client';
import { useTranslation } from 'react-i18next';
import { User, roleLabels } from '@/pages/users-types';

export interface RoleManagerProps {
  // 可选角色列表（与用户列表页共享）
  roleOptions: { label: string; value: string }[];
  // 角色更新回调（由父组件实现，内部调用 API 并刷新）
  onUpdateRole: (userId: string, role: string) => void;
  // 当前登录用户（仅需 role 字段用于权限判断；与 auth context 的 User 结构兼容）
  currentUser?: { role: string } | null;
  // 刷新键：变化时触发 ProTable 重新挂载并重新请求
  refreshKey?: number;
}

export default function RoleManager({
  roleOptions,
  onUpdateRole,
  currentUser,
  refreshKey,
}: RoleManagerProps) {
  const { t } = useTranslation();
  const isSuperAdmin = currentUser?.role === 'super_admin';

  // 获取用户列表（ProTable request 回调）
  const fetchUsers = async (params?: {
    pageSize?: number;
    current?: number;
    username?: string;
    role?: string;
  }) => {
    const page = params?.current || 1;
    const pageSize = params?.pageSize || 20;
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (params?.username) query.set('username', params.username);
    if (params?.role) query.set('role', params.role);
    try {
      const data = await apiGet<{ items: User[]; total: number }>(`/admin/users?${query.toString()}`);
      return { data: data.items || [], success: true, total: data.total || 0 };
    } catch (err) {
      showApiError(err, t('users.message.loadFailed'));
      return { data: [], success: false, total: 0 };
    }
  };

  // 角色管理列定义：用户名、邮箱、角色（可编辑）、状态
  const roleColumns: ProColumns<User>[] = [
    {
      title: t('users.column.username'),
      dataIndex: 'username',
      width: 140,
      render: (_dom: React.ReactNode, record: User) => {
        const roleInfo = roleLabels[record.role] || { labelKey: record.role, color: 'default' };
        return (
          <Space>
            <strong>{record.username}</strong>
            <Tag color={roleInfo.color}>{t(roleInfo.labelKey)}</Tag>
          </Space>
        );
      },
    },
    { title: t('users.column.email'), dataIndex: 'email', width: 220 },
    {
      title: t('users.column.role'),
      dataIndex: 'role',
      width: 180,
      render: (_dom: React.ReactNode, record: User) => (
        <Select
          value={record.role}
          options={roleOptions}
          disabled={!isSuperAdmin || record.role === 'super_admin'}
          style={{ width: '100%' }}
          onChange={(value) => onUpdateRole(record.id, value)}
        />
      ),
    },
    {
      title: t('users.column.status'),
      dataIndex: 'disabled',
      width: 100,
      render: (_dom: React.ReactNode, record: User) => (
        <Tag color={record.disabled ? 'red' : 'green'}>
          {record.disabled ? t('users.status.disabled') : t('users.status.normal')}
        </Tag>
      ),
    },
  ];

  return (
    <ProTable<User>
      key={`roles-${refreshKey || 0}`}
      columns={roleColumns}
      request={fetchUsers}
      rowKey="id"
      ghost
      scroll={{ x: 'max-content' }}
      search={{ filterType: 'light' }}
      options={{ density: true }}
    />
  );
}
