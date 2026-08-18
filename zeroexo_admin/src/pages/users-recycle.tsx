/**
 * 用户管理 - 回收站独立页面
 *
 * 由左侧 sidebar 子项「回收站」导航，不包含页面内 Tabs。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { message } from 'antd';
import { apiPost, apiDelete, showApiError } from '@/services/api-client';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';
import RecycleBin from '@/components/user-management/RecycleBin';
import { DeletedUser } from './users-types';

export default function UsersRecycle() {
  const { t } = useTranslation();
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedDeletedUser, setSelectedDeletedUser] = useState<DeletedUser | null>(null);

  const triggerRefresh = () => setRefreshKey((k) => k + 1);

  const handleRestore = async (user: DeletedUser) => {
    try {
      await apiPost(`/admin/users/${user.id}/restore`);
      message.success(t('users.message.restored', { name: user.username }));
      triggerRefresh();
    } catch (err) {
      showApiError(err, t('users.message.restoreFailed'));
    }
  };

  const handlePermanentDelete = async (user: DeletedUser) => {
    try {
      await apiDelete(`/admin/users/recycle-bin/${user.id}`);
      message.success(t('users.message.permanentDeleted', { name: user.username }));
      setSelectedDeletedUser(null);
      triggerRefresh();
    } catch (err) {
      showApiError(err, t('users.message.permanentDeleteFailed'));
    }
  };

  return (
    <BreadcrumbLayout
      items={[
        { title: t('users.title') },
        { title: t('users.recycleBin') },
      ]}
    >
      <RecycleBin
        refreshKey={refreshKey}
        onRestore={handleRestore}
        onPermanentDelete={handlePermanentDelete}
        selectedDeletedUser={selectedDeletedUser}
        onSelectDeletedUser={setSelectedDeletedUser}
      />
    </BreadcrumbLayout>
  );
}
