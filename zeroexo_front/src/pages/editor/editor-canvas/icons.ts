/**
 * 画布模块图标映射（分而治之：本模块图标在此单点维护，快速迭代）
 *
 * 语义键遵循拍板语义表（.project-rules/zeroexo_front/rules/interaction-metadata-mapping.md）：
 * stack=GalleryThumbnails / group=Group / ungroup=Ungroup / resetView=SquareDashed
 * 新增/更换本模块图标只改此文件，模块内所有按钮自动跟随。
 */
import { GalleryThumbnails, Group, SquareDashed, Ungroup } from 'lucide-react';

/** 画布模块（右键菜单/画布操作菜单）图标映射 */
export const EDITOR_ICONS = {
  stack: GalleryThumbnails,
  group: Group,
  ungroup: Ungroup,
  resetView: SquareDashed,
} as const;
