/**
 * 共享组件（创建菜单等）图标映射（分而治之：本模块图标在此单点维护，快速迭代）
 *
 * 语义键遵循拍板语义表（.project-rules/zeroexo_front/rules/interaction-metadata-mapping.md）：
 * stack=GalleryThumbnails
 */
import { GalleryThumbnails } from 'lucide-react';

/** 节点创建菜单图标映射 */
export const CREATE_MENU_ICONS = {
  stack: GalleryThumbnails,
} as const;
