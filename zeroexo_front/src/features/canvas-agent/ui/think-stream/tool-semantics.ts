/**
 * tool-semantics - 工具名 → 用户语义映射（Plan#36 R2-5 phase 语义化）
 *
 * 时间线/思考流展示用户能看懂的动作名（读画布/创作剧本/生成分镜…），
 * 原始工具名作为 chip 保留在详情层。后端 agent:step 死文案已移除，
 * 展示文案统一由本表驱动。
 */

import type { ThinkingStep } from '../types.js';

export interface ToolSemantic {
  label: string;
  icon: NonNullable<ThinkingStep['icon']>;
}

const TOOL_SEMANTICS: Record<string, ToolSemantic> = {
  canvas_get_state: { label: '读取画布状态', icon: 'search' },
  canvas_add_node: { label: '创建节点', icon: 'tool' },
  canvas_add_edge: { label: '连接节点', icon: 'tool' },
  canvas_update_node: { label: '更新节点', icon: 'tool' },
  canvas_remove_node: { label: '删除节点', icon: 'tool' },
  canvas_set_selection: { label: '选中节点', icon: 'tool' },
  canvas_focus: { label: '聚焦节点', icon: 'tool' },
  canvas_set_config: { label: '调整画布配置', icon: 'tool' },
  canvas_layout: { label: '智能排列节点', icon: 'tool' },
  create_script: { label: '创作剧本', icon: 'file' },
  create_storyboard: { label: '生成分镜', icon: 'file' },
  workflow_generate: { label: '创建生成工作链', icon: 'tool' },
  read_script: { label: '读取剧本', icon: 'search' },
  save_script: { label: '保存剧本', icon: 'file' },
  read_project_config: { label: '读取项目配置', icon: 'search' },
  read_content_chunked: { label: '定位读取内容', icon: 'search' },
  artifact_library: { label: '查阅产物档案', icon: 'search' },
  research_note: { label: '记录调研结论', icon: 'think' },
  todo_write: { label: '同步任务进度', icon: 'tool' },
};

export function semanticOfTool(toolName: string): ToolSemantic {
  return TOOL_SEMANTICS[toolName] ?? { label: toolName, icon: 'tool' };
}

/** 画布操作语义（canvas_op 事件） */
const CANVAS_OP_SEMANTICS: Record<string, string> = {
  add_node: '画布创建节点',
  add_edge: '画布连接节点',
  update_node: '画布更新节点',
  remove_node: '画布删除节点',
  set_selection: '画布选中节点',
  focus: '聚焦画布节点',
  set_config: '应用画布配置',
  workflow_chain: '展开工作执行链',
  start_storyboard_generate: '启动分镜生成',
  arrange: '智能排列画布节点',
};

export function semanticOfCanvasOp(op: string): string {
  return CANVAS_OP_SEMANTICS[op] ?? `画布操作：${op}`;
}

/** 执行阶段 → 状态栏文案（R2-5 phase） */
export const PHASE_STATUS_TEXT: Record<string, string> = {
  thinking: '正在分析推理…',
  clarify: '正在收集你的输入…',
  planning: '正在制定执行计划…',
  executing: '正在执行任务…',
  reporting: '正在整理结果…',
};
