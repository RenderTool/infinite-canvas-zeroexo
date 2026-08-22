/** SSE Agent 事件负载 */
export interface AgentEvent {
  type:
    | 'agent:step'
    | 'agent:tool_call'
    | 'agent:tool_result'
    | 'agent:progress'
    | 'agent:complete'
    | 'agent:error'
    // 契约交互事件（Plan#33 D1: step/question/md 三大契约 UI）
    | 'agent:step_request'
    | 'agent:question_request'
    | 'agent:md'
    // 增量渲染事件（Plan#36 P0-1: 流式对话）
    | 'agent:message_delta'
    | 'agent:thinking_delta';
  data: unknown;
  timestamp: number;
}

/** step 接口数据（StepBlock 契约 UI） */
export interface StepRequestData {
  key: string;
  title: string;
  description?: string;
  /** 是否必选（false = 资料足够可跳过） */
  required?: boolean;
  /** 引导提示：资料不足时引导上传/引用画布节点收敛目标 */
  prompts?: string[];
  /** 快捷选项（如"直接生成 N 集"） */
  suggestions?: Array<{ value: string; label: string }>;
}

/** 提问接口数据（QuestionBlock 契约 UI，与前端 QuestionData 对齐） */
export interface QuestionRequestData {
  guideText?: string;
  /** 是否多选 */
  multi?: boolean;
  items: Array<{
    value: string;
    label: string;
    desc?: string;
    ai?: boolean;
    checked?: boolean;
  }>;
}
