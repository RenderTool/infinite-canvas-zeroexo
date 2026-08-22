/**
 * pending-agent-prompt - 主页 → 画布 Agent 的待注入提示词传递通道(Plan#33 D5)
 *
 * 主页「点击生成」流程:先创建画布项目,再跳转画布页。画布页挂载后消费本通道:
 *   1. 打开 Agent 面板(dockOpen)
 *   2. 提示词完整占位到输入框(inputText)
 *   3. 自动发送,Agent 在面板内思考(非主页下方任务卡片)
 *
 * 用 localStorage 持久化:路由跳转 + 画布页懒加载期间不丢失;
 * 仅消费一次(consume 即清除),防止刷新/重进重复触发。
 */

const PENDING_PROMPT_KEY = 'zeroexo:pending-agent-prompt';

/** 写入待注入提示词(空值清除) */
export function setPendingAgentPrompt(prompt: string | null): void {
  try {
    if (prompt == null || prompt.trim() === '') {
      localStorage.removeItem(PENDING_PROMPT_KEY);
      return;
    }
    localStorage.setItem(PENDING_PROMPT_KEY, prompt);
  } catch {
    // 隐私模式/存储禁用时静默降级:跳转后不自动占位,用户手动输入
  }
}

/** 消费待注入提示词(一次性,读取即清除) */
export function consumePendingAgentPrompt(): string | null {
  try {
    const value = localStorage.getItem(PENDING_PROMPT_KEY);
    if (value == null) return null;
    localStorage.removeItem(PENDING_PROMPT_KEY);
    return value;
  } catch {
    return null;
  }
}
