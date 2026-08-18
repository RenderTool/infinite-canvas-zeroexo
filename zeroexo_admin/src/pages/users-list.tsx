import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/auth';
import { apiGet } from '@/services/api-client';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';
import UserTable from '@/components/user-management/UserTable';

export default function UsersList() {
  const { user: currentUser } = useAuth();
  const { t } = useTranslation();
  const [roleOptions, setRoleOptions] = useState<{ label: string; value: string }[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = () => setRefreshKey((k) => k + 1);

  const fetchRoles = async () => {
    try {
      const data = await apiGet<{ roles: string[] }>('/admin/users/roles');
      setRoleOptions(
        (data.roles || [])
          .filter((r: string) => r !== 'super_admin')
          .map((r: string) => ({ label: t(`users.role.${r}` as any) || r, value: r })),
      );
    } catch {
      setRoleOptions([
        { label: t('users.role.admin'), value: 'admin' },
        { label: t('users.role.operator'), value: 'operator' },
        { label: t('users.role.user'), value: 'user' },
      ]);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  return (
    <BreadcrumbLayout
      items={[
        { title: t('users.title') },
        { title: t('users.userList') },
      ]}
    >
      <UserTable
        currentUser={currentUser}
        roleOptions={roleOptions}
        refreshKey={refreshKey}
        triggerRefresh={triggerRefresh}
        onRefreshRoles={fetchRoles}
      />
    </BreadcrumbLayout>
  );
}
