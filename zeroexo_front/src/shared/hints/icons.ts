/**
 * 教育浮层（Contextual Controls）图标映射（分而治之：本模块图标在此单点维护，快速迭代）
 *
 * 语义键遵循拍板语义表（.project-rules/zeroexo_front/rules/interaction-metadata-mapping.md）：
 * eject=Combine（移出堆叠）
 * hint-entries 的 iconKey 由此 Map 解析（DEV 断言校验引用存在，消费端运行时兜底）。
 * 注意：保持 Record 类型——iconKey 为动态键，消费端需处理 undefined。
 */
import { Combine, type LucideIcon } from 'lucide-react';

/** 教育浮层图标映射 */
export const HINT_ICONS: Record<string, LucideIcon> = {
  eject: Combine,
};
