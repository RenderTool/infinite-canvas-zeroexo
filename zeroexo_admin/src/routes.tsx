import { ReactNode } from 'react';
import {
  FileTextOutlined,
  RocketOutlined,
  IdcardOutlined,
  BarChartOutlined,
  DeleteOutlined,
  TeamOutlined,
  AuditOutlined,
  ApiOutlined,
  CloudServerOutlined,
  CreditCardOutlined,
  MessageOutlined,
  SettingOutlined,
  BulbOutlined,
  DollarOutlined,
  FundOutlined,
  AppstoreOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import Analytics from './pages/analytics';
import Logs from './pages/logs';
import ApiSettings from './pages/api-settings';
import AiTest from './pages/ai-test';
import SiteContent from './pages/site-content';
import PublicPrompts from './pages/public-prompts';
import PricingSettings from './pages/pricing-settings';
import AgentSkillUpgrade from './pages/agent-skill-upgrade';

export interface RouteConfig {
  path: string;
  element?: ReactNode;
  name: string;
  /** i18n key, 用于侧边栏菜单国际化渲染 */
  nameKey?: string;
  icon?: ReactNode;
  children?: RouteConfig[];
  /** 允许访问的角色白名单 */
  roles?: string[];
  /** 允许访问的权限编码白名单 */
  permissions?: string[];
}

export const routes: RouteConfig[] = [
  {
    path: '/analytics',
    name: '数据分析',
    nameKey: 'nav.analytics',
    icon: <BarChartOutlined />,
    element: <Analytics />,
    children: [
      { path: '/analytics/operations', name: '运营分析', nameKey: 'nav.analyticsOperations', icon: <FundOutlined /> },
      // TODO: 开发中 - 计费分析页面
      // { path: '/analytics/billing', name: '计费分析', nameKey: 'nav.analyticsBilling', icon: <WalletOutlined /> },
    ],
  },
  {
    path: '/logs',
    name: '日志中心',
    nameKey: 'nav.logs',
    icon: <FileTextOutlined />,
    element: <Logs />,
  },
  {
    path: '/users',
    name: '用户管理',
    nameKey: 'nav.userManagement',
    icon: <IdcardOutlined />,
    children: [
      { path: '/users/list', name: '用户列表', nameKey: 'nav.userList', icon: <TeamOutlined /> },
      { path: '/users/recycle', name: '回收站', nameKey: 'nav.recycleBin', icon: <DeleteOutlined /> },
      { path: '/users/applications', name: '申请审核', nameKey: 'nav.applicationReview', icon: <AuditOutlined /> },
    ],
  },
  // ─── 统一服务设置入口(纯 Tab 切换, 无总览)───
  {
    path: '/api-settings',
    name: '服务设置',
    nameKey: 'nav.apiSettings',
    icon: <ApiOutlined />,
    element: <ApiSettings />,
    children: [
      { path: '/api-settings/ai', name: 'API 渠道', nameKey: 'nav.aiChannel', icon: <RocketOutlined /> },
      { path: '/api-settings/email', name: '邮件服务', nameKey: 'nav.emailService', icon: <CloudServerOutlined /> },
      { path: '/api-settings/oauth', name: '第三方登录', nameKey: 'nav.oauthLogin', icon: <IdcardOutlined /> },
      { path: '/api-settings/storage', name: '对象存储', nameKey: 'nav.objectStorage', icon: <CloudServerOutlined /> },
      { path: '/api-settings/payment', name: '支付服务', nameKey: 'nav.paymentService', icon: <CreditCardOutlined /> },
    ],
  },
  {
    path: '/site-operations',
    name: '站点运营',
    nameKey: 'nav.siteOperations',
    icon: <SettingOutlined />,
    children: [
      {
        path: '/site-operations/content',
        name: '站点内容',
        nameKey: 'nav.siteContent',
        icon: <AppstoreOutlined />,
        element: <SiteContent />,
      },
      {
        path: '/site-operations/public-prompts',
        name: '公共素材',
        nameKey: 'nav.publicAssets',
        icon: <BulbOutlined />,
        element: <PublicPrompts />,
      },
      {
        path: '/site-operations/pricing',
        name: '定价管理',
        nameKey: 'nav.pricingManagement',
        icon: <DollarOutlined />,
        element: <PricingSettings />,
      },
      // TODO: 开发中 - 积分管理页面
      // {
      //   path: '/site-operations/credits',
      //   name: '积分管理',
      //   nameKey: 'nav.creditManagement',
      //   icon: <CreditCardOutlined />,
      //   element: <AdminCredit />,
      // },
    ],
  },
  {
    path: '/ai-test',
    name: 'AI 测试',
    nameKey: 'nav.aiTest',
    icon: <MessageOutlined />,
    element: <AiTest />,
  },
  {
    path: '/agent-skills',
    name: 'Agent 技能',
    nameKey: 'nav.agentSkill',
    icon: <ToolOutlined />,
    element: <AgentSkillUpgrade />,
  },
];

export default routes;