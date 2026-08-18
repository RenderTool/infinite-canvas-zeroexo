/** 参数分组 */
export interface ParamGroup {
  id: string;
  label: string;
  icon: string;
  items: ParamItem[];
}

export interface ParamItem {
  key: string;
  label: string;
  type: 'text' | 'select' | 'tags' | 'textarea';
  options?: string[];
}

/** 项目配置参数键值对 */
export type ProjectConfig = Record<string, string | string[]>;

/** 参数分组定义
 *
 * 立项时用户仅需配置与「创作内容本身」相关的 5 个核心参数。
 * 平台/分发/受众/变现/画质/预算/视觉参考/核心信息/行动号召等
 * 渠道侧或 AI 可推导的字段不再列出，避免在立项阶段产生噪音。
 */
export const PARAM_GROUPS: ParamGroup[] = [
  {
    id: 'production',
    label: '创作规格',
    icon: 'Settings',
    items: [
      { key: 'duration', label: '时长', type: 'select', options: ['15-30s', '30-60s', '1-3min', '3-5min', '5min+'] },
      { key: 'format', label: '画面比例', type: 'select', options: ['横屏', '竖屏', '方形', '自适应'] },
    ],
  },
  {
    id: 'creative',
    label: '题材风格',
    icon: 'Palette',
    items: [
      { key: 'genre', label: '题材类型', type: 'select', options: ['剧情', '搞笑', '科普', '教程', '广告', 'Vlog', '动画', '纪录片', '其他'] },
      { key: 'style', label: '风格标签', type: 'tags' },
      { key: 'concept', label: '创意概念', type: 'textarea' },
    ],
  },
];