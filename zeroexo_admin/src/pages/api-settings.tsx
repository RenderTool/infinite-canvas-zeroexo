/**
 * API 设置 - 纯路由分发页面（无页面内 Tabs）
 *
 * 每个子模块由左侧 sidebar 子项导航，本页面仅根据当前路由路径
 * 渲染对应的 Tab 组件，并统一提供面包屑。
 */
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';
import ApiProvidersTab from '@/components/api-settings/tabs/ApiProvidersTab';
import EmailProvidersTab from '@/components/api-settings/tabs/EmailProvidersTab';
import OAuthProvidersTab from '@/components/api-settings/tabs/OAuthProvidersTab';
import StorageProvidersTab from '@/components/api-settings/tabs/StorageProvidersTab';
import PaymentProvidersTab from '@/components/api-settings/tabs/PaymentProvidersTab';

const SUB_ROUTES: Record<string, { labelKey: string; Component: React.ComponentType }> = {
  ai: { labelKey: 'nav.aiChannel', Component: ApiProvidersTab },
  email: { labelKey: 'nav.emailService', Component: EmailProvidersTab },
  oauth: { labelKey: 'nav.oauthLogin', Component: OAuthProvidersTab },
  storage: { labelKey: 'nav.objectStorage', Component: StorageProvidersTab },
  payment: { labelKey: 'nav.paymentService', Component: PaymentProvidersTab },
};

export default function ApiSettings() {
  const location = useLocation();
  const { t } = useTranslation();

  const match = location.pathname.match(/\/api-settings\/(\w+)$/);
  const subKey = (match && SUB_ROUTES[match[1]] ? match[1] : 'ai') as string;
  const { labelKey, Component } = SUB_ROUTES[subKey];

  return (
    <BreadcrumbLayout
      items={[
        { title: t('nav.apiSettings') },
        { title: t(labelKey) },
      ]}
    >
      <Component />
    </BreadcrumbLayout>
  );
}
