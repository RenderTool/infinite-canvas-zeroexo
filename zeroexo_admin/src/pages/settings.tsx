import { Card, Empty } from 'antd';
import { useTranslation } from 'react-i18next';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';

/**
 * 系统设置页
 *
 * 角色权限已迁移到用户管理页,本页作为纯占位/入口页,
 * 后续如需添加全局配置可在此扩展。
 */
export default function Settings() {
  const { t } = useTranslation();
  
  return (
    <BreadcrumbLayout items={[{ title: t('nav.settings', '系统设置') }]}>
      <Card>
        <Empty description={t('settings.configMovedToModules')} />
      </Card>
    </BreadcrumbLayout>
  );
}
