/**
 * 对象存储 Tab - 复用 storage-driver-switcher + 本地存储详情
 *
 * 支持列表/详情视图切换:
 * - list: 显示 driver 卡片列表(默认)
 * - detail: 显示本地存储配置详情页(含资源清理)
 */
import { useState } from 'react';
import StorageDriverSwitcher from '@/components/storage-driver-switcher';
import LocalStorageDetail from '../LocalStorageDetail';

export default function StorageProvidersTab() {
  const [subView, setSubView] = useState<'list' | 'local-detail'>('list');

  if (subView === 'local-detail') {
    return <LocalStorageDetail onBack={() => setSubView('list')} />;
  }

  return <StorageDriverSwitcher onViewLocalDetail={() => setSubView('local-detail')} />;
}
