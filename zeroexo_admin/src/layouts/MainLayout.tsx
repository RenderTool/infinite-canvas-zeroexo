import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link, Outlet } from 'react-router-dom';
import { ProLayout } from '@ant-design/pro-components';
import { Dropdown, Button, Drawer, Menu } from 'antd';
import { LogoutOutlined, UserOutlined, MenuOutlined, CloseOutlined } from '@ant-design/icons';
import { Languages } from 'lucide-react';
import { useAuth } from '@/contexts/auth';
import routes from '@/routes';
import { useTranslation } from 'react-i18next';

/**
 * 判断用户是否有权限访问某路由
 *
 * 判定规则(双层 AND 关系):
 * 1. super_admin 永远放行
 * 2. 若路由声明了 roles,当前用户角色必须在白名单内
 * 3. 若路由声明了 permissions,当前用户必须拥有其中至少一个权限
 *
 * 注意:roles 与 permissions 是 AND 关系,而非 OR。
 * 仅声明 roles 不声明 permissions 时,只做粗粒度身份检查;
 * 仅声明 permissions 不声明 roles 时,只做细粒度权限检查。
 */
function hasRouteAccess(
  route: { roles?: string[]; permissions?: string[] },
  userRole: string,
  userPermissions: string[],
): boolean {
  if (userRole === 'super_admin') return true;
  if (route.roles && route.roles.length > 0 && !route.roles.includes(userRole)) {
    return false;
  }
  if (
    route.permissions &&
    route.permissions.length > 0 &&
    !route.permissions.some((p) => userPermissions.includes(p))
  ) {
    return false;
  }
  return true;
}

// 检测移动端
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return isMobile;
}

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('i18n-lang', lang);
  };

  // 当前语言(优先从 localStorage 读取,保障 Select value 正确匹配)
  const currentLang = (() => {
    const stored = localStorage.getItem('i18n-lang');
    if (stored === 'zh-CN' || stored === 'en-US') return stored;
    const detected = i18n.language;
    if (detected?.startsWith('zh')) return 'zh-CN';
    return 'en-US';
  })();

  // 用户拥有的权限编码集合(用于细粒度权限判断)
  const userPermissions = (user?.permissions || []).map((p) => p.code);

  // 转换 RouteConfig → ProLayout 预期的格式(同时过滤权限)
  // 递归支持多级菜单；无子项的路由不添加 routes 属性，避免 ProLayout 在折叠模式下创建空白弹出面板
  const toMenuItem = (route: (typeof routes)[number]): any => {
    const label = route.nameKey ? t(route.nameKey, route.name) : route.name;
    if (route.children && route.children.length > 0) {
      const visibleChildren = route.children
        .filter((child) => hasRouteAccess(child, user?.role || '', userPermissions))
        .map(toMenuItem);
      if (visibleChildren.length > 0) {
        return { path: route.path, name: label, icon: route.icon, routes: visibleChildren };
      }
    }
    return { path: route.path, name: label, icon: route.icon };
  };
  const buildMenuRoutes = (routeList: typeof routes) =>
    routeList
      .filter((route) => hasRouteAccess(route, user?.role || '', userPermissions))
      .map(toMenuItem) as any[];

  // 自动关闭移动端抽屉后的回调
  const handleMobileMenuClick = (path: string) => {
    setMobileDrawerOpen(false);
    navigate(path);
  };

  // 构建移动端 Menu items（递归支持多级菜单展开支持）
  const toMobileItem = (route: any): any => {
    if (route.routes && route.routes.length > 0) {
      return {
        key: route.path as string,
        icon: route.icon,
        label: route.name,
        children: route.routes.map(toMobileItem),
      };
    }
    return {
      key: route.path as string,
      icon: route.icon,
      label: route.name,
    };
  };
  const mobileMenuItems = buildMenuRoutes(routes).map(toMobileItem);

  // 移动端：自定义布局（无 NAV 顶部栏，用浮动按钮 + Drawer）
  if (isMobile) {
    return (
      <div style={{ position: 'relative', minHeight: '100vh' }}>
        {/* 浮动菜单按钮 */}
        <Button
          type="primary"
          shape="circle"
          size="large"
          icon={<MenuOutlined />}
          onClick={() => setMobileDrawerOpen(true)}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 1050,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            width: 48,
            height: 48,
          }}
        />
        {/* 移动端抽屉菜单 */}
        <Drawer
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src="/admin/ZeroExoLogo.svg" alt="ZeroExo" style={{ width: 28, height: 28 }} />
              <span style={{ fontWeight: 200, fontSize: 16, letterSpacing: '-0.02em' }}>ZeroExo</span>
            </div>
          }
          placement="left"
          size={280}
          open={mobileDrawerOpen}
          onClose={() => setMobileDrawerOpen(false)}
          closable={false}
          extra={
            <Button type="text" icon={<CloseOutlined style={{ fontSize: 18 }} />} onClick={() => setMobileDrawerOpen(false)} />
          }
          styles={{ body: { padding: 0, overflow: 'auto' } }}
        >
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            defaultOpenKeys={[]}
            items={mobileMenuItems}
            onClick={({ key }) => handleMobileMenuClick(key)}
            style={{ borderRight: 0 }}
          />
          {/* 抽屉底部：用户信息 + 语言切换 */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: '12px 16px',
              borderTop: '1px solid var(--color-border, #f0f0f0)',
              background: 'var(--color-bg-container, #fff)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'logout',
                      label: t('auth.logout', '退出登录'),
                      icon: <LogoutOutlined />,
                      onClick: handleLogout,
                    },
                  ],
                }}
                placement="topRight"
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                  }}
                >
                  <UserOutlined style={{ fontSize: 14, color: 'var(--color-text-secondary, #595959)' }} />
                  <span style={{ fontSize: 13, color: 'var(--color-text-secondary, #595959)' }}>
                    {user?.nickname || user?.username || t('common.user')}
                  </span>
                </div>
              </Dropdown>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'zh-CN',
                      label: t('settings.chinese'),
                      disabled: currentLang === 'zh-CN',
                      onClick: () => handleLanguageChange('zh-CN'),
                    },
                    {
                      key: 'en-US',
                      label: t('settings.english'),
                      disabled: currentLang === 'en-US',
                      onClick: () => handleLanguageChange('en-US'),
                    },
                  ],
                }}
                placement="topRight"
              >
                <Button size="small" type="text" icon={<Languages size={18} />} />
              </Dropdown>
            </div>
          </div>
        </Drawer>
        {/* 主内容区域 */}
        <div className="main-content">
          <Outlet />
        </div>
      </div>
    );
  }

  // 桌面端：标准 ProLayout 侧边栏
  return (
    <ProLayout
      key={i18n.language}
      title="ZeroExo"
      logo={<img src="/admin/ZeroExoLogo.svg" alt="ZeroExo" style={{ width: 32, height: 32 }} />}
      layout="side"
      fixSiderbar
      route={{
        routes: buildMenuRoutes(routes),
      } as any}
      location={location}
      selectedKeys={[location.pathname + location.search]}
      menuItemRender={(item, dom) => <Link to={item.path as string}>{dom}</Link>}
      breadcrumbRender={false}
      collapsed={sidebarCollapsed}
      onCollapse={(c) => setSidebarCollapsed(c)}
      menuHeaderRender={() => {
        if (sidebarCollapsed) {
          return (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: 48,
              }}
            >
              <img src="/admin/ZeroExoLogo.svg" alt="ZeroExo" style={{ width: 28, height: 28 }} />
            </div>
          );
        }
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px' }}>
            <img src="/admin/ZeroExoLogo.svg" alt="ZeroExo" style={{ width: 32, height: 32 }} />
            <span style={{ fontWeight: 200, fontSize: 16, letterSpacing: '-0.02em' }}>ZeroExo</span>
          </div>
        );
      }}
      menuFooterRender={() => {
        if (sidebarCollapsed) {
          return (
            <div
              style={{
                padding: '8px 0',
                borderTop: '1px solid var(--color-border, #f0f0f0)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'zh-CN',
                        label: t('settings.chinese'),
                        disabled: currentLang === 'zh-CN',
                        onClick: () => handleLanguageChange('zh-CN'),
                      },
                      {
                        key: 'en-US',
                        label: t('settings.english'),
                        disabled: currentLang === 'en-US',
                        onClick: () => handleLanguageChange('en-US'),
                      },
                    ],
                  }}
                  placement="topRight"
                >
                  <Button size="small" type="text" icon={<Languages size={18} />} />
                </Dropdown>
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'logout',
                        label: t('auth.logout', '退出登录'),
                        icon: <LogoutOutlined />,
                        onClick: handleLogout,
                      },
                    ],
                  }}
                  placement="topRight"
                >
                  <UserOutlined style={{ fontSize: 18, color: 'var(--color-text-secondary, #595959)', cursor: 'pointer' }} />
                </Dropdown>
              </div>
            </div>
          );
        }
        return (
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--color-border, #f0f0f0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'logout',
                      label: t('auth.logout', '退出登录'),
                      icon: <LogoutOutlined />,
                      onClick: handleLogout,
                    },
                  ],
                }}
                placement="topRight"
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <UserOutlined style={{ fontSize: 16, color: 'var(--color-text-secondary, #595959)' }} />
                  <span style={{ fontSize: 13, color: 'var(--color-text-secondary, #595959)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user?.nickname || user?.username || t('common.user')}
                  </span>
                </div>
              </Dropdown>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'zh-CN',
                      label: t('settings.chinese'),
                        disabled: currentLang === 'zh-CN',
                        onClick: () => handleLanguageChange('zh-CN'),
                      },
                      {
                        key: 'en-US',
                        label: t('settings.english'),
                        disabled: currentLang === 'en-US',
                        onClick: () => handleLanguageChange('en-US'),
                    },
                  ],
                }}
                placement="topRight"
              >
                <Button
                  size="small"
                  type="text"
                  icon={<Languages size={18} />}
                />
              </Dropdown>
            </div>
          </div>
        );
      }}
    >
      <div className="main-content">
        <Outlet />
      </div>
    </ProLayout>
  );
}
