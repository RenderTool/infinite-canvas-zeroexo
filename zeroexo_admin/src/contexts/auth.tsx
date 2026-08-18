import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { apiPost, apiGet, setAccessToken, setRefreshToken } from '@/services/api-client';

interface PermissionInfo {
  code: string;
  module: string;
}

interface User {
  id: string;
  email: string;
  username: string;
  nickname?: string;
  role: string;
  permissions: PermissionInfo[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** 从后端重新拉取最新用户信息并同步缓存（用于申请被批准等角色变化场景），失败返回 null */
  refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // 安全说明（修复 F1.1/F1.2/F1.3）：
  // - accessToken 仅存于内存（模块变量），不再写入 localStorage，避免 XSS 窃取管理员令牌。
  // - refreshToken 存于 sessionStorage（标签页级、关闭即失效），用于刷新页面后静默续期。
  // - 含 role/permissions 的 user 对象仅存内存，不再持久化到 localStorage，防止本地篡改提权。
  //   权限的唯一可信来源是后端的 /auth/me；任何 localStorage 中的 user 仅作首屏占位，刷新后立即以 /auth/me 覆盖。
  useEffect(() => {
    // 仅从 sessionStorage 读取 refreshToken 用于续期（accessToken 不落盘）
    const rt = sessionStorage.getItem('admin-refresh-token');
    if (rt) setRefreshToken(rt);
    if (rt) {
      // 有 refreshToken：必须先经后端校验才能恢复会话，防止使用伪造/篡改的本地状态
      apiGet<User>('/auth/me')
        .then((freshUser) => {
          setUser(freshUser);
        })
        .catch(() => {
          // 校验失败（禁用/过期等）：清除认证状态
          setAccessToken(null);
          setRefreshToken(null);
          setUser(null);
          sessionStorage.removeItem('admin-refresh-token');
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const data = await apiPost<{ accessToken: string; refreshToken: string; user: User }>(
      '/auth/login',
      { email, password },
    );
    setAccessToken(data.accessToken);
    if (data.refreshToken) setRefreshToken(data.refreshToken);
    setUser(data.user);
    // 注意：accessToken 与 user 不再写入 localStorage
    if (data.refreshToken) sessionStorage.setItem('admin-refresh-token', data.refreshToken);
  };

  /** 从后端重新拉取最新用户信息并同步缓存，失败返回 null */
  const refreshUser = useCallback(async () => {
    try {
      const freshUser = await apiGet<User>('/auth/me');
      setUser(freshUser);
      return freshUser;
    } catch {
      return null;
    }
  }, []);

  const logout = () => {
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    sessionStorage.removeItem('admin-refresh-token');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}