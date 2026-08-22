/**
 * 剧创节点模块图标映射（分而治之：本模块图标在此单点维护，快速迭代）
 *
 * 遵循拍板语义表（.project-rules/zeroexo_front/rules/interaction-metadata-mapping.md）：
 * 胶囊工具图标属交互语义，必须走模块级 icons.ts Map，禁止在扩展文件里散落内联 lucide。
 * fullscreen=Maximize（剧本/分镜/出片/剧管全屏编辑统一入口）
 */
import { Maximize, FileUp, BookOpen, Aperture, RotateCcw, Play, FolderKanban } from 'lucide-react';

/** 剧创节点胶囊工具图标映射 */
export const CANVAS_NODE_ICONS = {
  /** 全屏编辑（剧本/分镜/出片/剧管胶囊统一图标） */
  fullscreen: Maximize,
  /** 导入剧本 */
  import: FileUp,
  /** 全屏翻阅 */
  read: BookOpen,
  /** 生成分镜 */
  generateStoryboard: Aperture,
  /** 重新生成（分镜/出片） */
  regenerate: RotateCcw,
  /** 出片全屏编辑（沿用既有语义） */
  play: Play,
  /** 剧管（生成/关联剧中管理） */
  production: FolderKanban,
} as const;
