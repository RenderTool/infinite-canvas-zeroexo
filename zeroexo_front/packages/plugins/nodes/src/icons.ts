/**
 * 节点插件（堆叠媒体节点）图标映射（分而治之：本模块图标在此单点维护，快速迭代）
 *
 * 语义键遵循拍板语义表（.project-rules/zeroexo_front/rules/interaction-metadata-mapping.md）：
 * stack=GalleryThumbnails（堆叠自身标识）/ eject=Combine（移出堆叠）
 * subject=UserRound（主体节点标识，Plan#20 重设计；语义归属待用户最终拍板）
 */
import { Combine, GalleryThumbnails, UserRound } from 'lucide-react';

/** 节点插件图标映射 */
export const NODE_ICONS = {
  stack: GalleryThumbnails,
  eject: Combine,
  subject: UserRound,
} as const;
