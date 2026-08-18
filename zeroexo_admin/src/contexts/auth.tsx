import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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

  useEffect(() => {
    const token = localStorage.getItem('admin-token');
    // refreshToken 存于 sessionStorage（标签页级），见 api-client.ts 中的安全说明
    const rt = sessionStorage.getItem('admin-refresh-token');
    if (token) {
      setAccessToken(token);
      if (rt) setRefreshToken(rt);
      // 先尝试从 localStorage 加载缓存用户数据用于快速渲染
      const userStr = localStorage.getItem('admin-user');
      if (userStr) {
        try {
          const cached = JSON.parse(userStr);
          // 兼容旧缓存数据(没有 permissions 字段)
          if (!cached.permissions) cached.permissions = [];
          setUser(cached);
        } catch {
          // 缓存损坏(JSON 解析失败)：清除后稍后从 /auth/me 重新拉取
          localStorage.removeItem('admin-user');
        }
      }
      // 异步从后端获取最新用户信息(含权限)
      apiGet<User>('/auth/me')
        .then((freshUser) => {
          setUser(freshUser);
          localStorage.setItem('admin-user', JSON.stringify(freshUser));
        })
        .catch(() => {
          // 请求失败（如用户被禁用、token过期等），清除认证状态
          setAccessToken(null);
          setRefreshToken(null);
          setUser(null);
          localStorage.removeItem('admin-token');
          sessionStorage.removeItem('admin-refresh-token');
          localStorage.removeItem('admin-user');
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
    localStorage.setItem('admin-token', data.accessToken);
    if (data.refreshToken) sessionStorage.setItem('admin-refresh-token', data.refreshToken);
    localStorage.setItem('admin-user', JSON.stringify(data.user));
  };

  /** 从后端重新拉取最新用户信息并同步缓存，失败返回 null */
  const refreshUser = useCallback(async () => {
    try {
      const freshUser = await apiGet<User>('/auth/me');
      setUser(freshUser);
      localStorage.setItem('admin-user', JSON.stringify(freshUser));
      return freshUser;
    } catch {
      return null;
    }
  }, []);

  const logout = () => {
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    localStorage.removeItem('admin-token');
    sessionStorage.removeItem('admin-refresh-token');
    localStorage.removeItem('admin-user');
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