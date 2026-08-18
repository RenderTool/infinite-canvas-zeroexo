// 用户管理模块的类型定义与角色标签常量
// 从 pages/users.tsx 拆分而来，供主页面及子组件共享

// 用户实体（常规用户列表使用）
export interface User {
  id: string;
  username: string;
  email: string;
  nickname?: string;
  role: string;
  emailVerified: boolean;
  disabled: boolean;
  /** 当前生效订阅计划 code (free/basic/standard/premium/ultimate/enterprise) */
  planCode?: string;
  /** 订阅到期时间(到期后回退免费) */
  planExpiresAt?: string;
  createdAt: string;
  updatedAt?: string;
}

// 已删除用户（回收站列表使用）
export interface DeletedUser {
  id: string;
  username: string;
  email: string;
  nickname?: string;
  role: string;
  createdAt: string;
  deletedAt: string;
  remainingDays: number;
}

// 用户申请（注册/角色提升审批使用）
export interface UserApplication {
  id: string;
  email: string;
  username: string;
  nickname?: string;
  type: 'register' | 'admin' | 'operator';
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
}

// 角色标签映射：key 为角色标识，包含 i18n key 与 Tag 颜色
export const roleLabels: Record<string, { labelKey: string; color: string }> = {
  super_admin: { labelKey: 'users.role.superAdmin', color: 'red' },
  admin: { labelKey: 'users.role.admin', color: 'orange' },
  user: { labelKey: 'users.role.default', color: 'default' },
};
