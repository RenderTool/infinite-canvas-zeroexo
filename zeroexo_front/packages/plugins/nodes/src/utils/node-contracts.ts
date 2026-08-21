/**
 * 节点尺寸契约常量(Plan#11 全节点迁移 A2)
 *
 * 单一事实源:各节点扩展的 defaultSize/minSize 与所有尺寸入口(上传/替换/拖拽/AI生成)
 * 统一引用本文件常量 —— **节点本身的契约自己维护,改契约只改这一处**。
 *
 * 使用规则:
 * - 扩展定义(index.tsx)引用: createImageExtension 等 defaultSize/minSize 直接引用
 * - 包内工具(utils/)引用: replaceNodeImage 等需要"无 ext 时的类型契约兜底"
 * - 禁止在其他地方散落 620/348/404/360/96 等裸数字
 */

// ===== 媒体类(620×348 = 16:9 基准) =====
export const TEXT_DEFAULT_SIZE = { width: 620, height: 348 };
export const GENERATOR_DEFAULT_SIZE = { width: 620, height: 348 };
export const IMAGE_DEFAULT_SIZE = { width: 620, height: 348 };
export const VIDEO_DEFAULT_SIZE = { width: 620, height: 348 };
/** 媒体类统一最小尺寸(等比锁节点的下限) */
export const MEDIA_MIN_SIZE = { width: 80, height: 80 };
/** 文本节点最小尺寸(自由 resize 下限,与 resize 几何隐式兜底一致,契约显式化) */
export const TEXT_MIN_SIZE = { width: 80, height: 60 };

// ===== 音频气泡(特化外观,非 16:9) =====
export const AUDIO_DEFAULT_SIZE = { width: 360, height: 96 };

// ===== StackNode(620×404 = 展示区 348 + 导航 56) =====
export const STACKED_MEDIA_DEFAULT_SIZE = { width: 620, height: 404 };
export const STACKED_MEDIA_MIN_SIZE = { width: 220, height: 143 };

// ===== AI 占位(网格 179×101 + 8px 留白 = 195×117) =====
export const AI_PLACEHOLDER_DEFAULT_SIZE = { width: 195, height: 117 };

// ===== Plan#20 重设计：主体节点统一 16:9 纯预览卡（同堆叠节点 620×348） =====
export const SUBJECT_DEFAULT_SIZE = { width: 620, height: 348 };
/** 主体节点统一最小尺寸（与 default 严格等比：220/620 = 123.48 → 123，偏差 0.48px ≤ 0.75，触底不破坏等比锁） */
export const SUBJECT_MIN_SIZE = { width: 220, height: 123 };
