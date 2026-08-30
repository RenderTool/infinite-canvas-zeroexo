/**
 * 剧创节点模块图标映射（分而治之：本模块图标在此单点维护，快速迭代）
 *
 * 遵循拍板语义表（.project-rules/zeroexo_front/rules/interaction-metadata-mapping.md）：
 * 胶囊工具图标属交互语义，必须走模块级 icons.ts Map，禁止在扩展文件里散落内联 lucide。
 * fullscreen=Maximize（剧本/分镜/出片/剧管全屏编辑统一入口）
 */
import { Maximize, FileUp, BookOpen, Aperture, RotateCcw, Film, AlertTriangle, X, Check } from 'lucide-react';

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
  // ===== 生产台内容区图标（2026-08-31 铁律：一律 lucide 走本 Map，禁止 emoji 字符） =====
  /** 视频空位占位（暂无视频/暂无生成产物） */
  videoEmpty: Film,
  /** 失败告警（生成失败覆盖层） */
  warning: AlertTriangle,
  /** 关闭/失败标记（替代 ✕ / ✗ 字符） */
  close: X,
  /** 成功/完成标记（替代 ✓ 字符） */
  check: Check,
} as const;
