/**
 * user-resources-types - 用户资源管理页面的类型定义
 *
 * 包含素材、画布、提示词、生成记录以及用户信息的数据结构。
 * 由 pages/user-resources.tsx 及 components/user-resources/ 下的子组件共享。
 */

/** 单个素材资源 */
export interface UserAsset {
  id: string;
  kind: string;
  filename: string;
  storageKey: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  tags: string[];
  createdAt: string;
  /** 来源标记（仅 AI 生成资源有此字段）：'后台管理测试' | 'AI 生成' */
  source?: string;
}

/** 用户画布（项目） */
export interface UserProject {
  id: string;
  title: string;
  version: number;
  tags: string[];
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 用户提示词 */
export interface UserPrompt {
  id: string;
  title: string;
  category: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 用户账户信息 */
export interface UserInfo {
  id: string;
  username: string;
  email: string;
  nickname?: string;
  role: string;
}

/** 创作记录（来自 /admin/creation API） */
export interface UserCreation {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** 合并后的项目列表项（canvas + creation） */
export interface UserProjectItem {
  id: string;
  _type: 'canvas' | 'creation';
  title: string;
  version?: number;
  tags?: string[];
  isPublic?: boolean;
  status?: string;
  createdAt: string;
  updatedAt: string;
}
