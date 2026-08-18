/**
 * ActionBar - 生成/重置操作栏
 *
 * 工作台底部操作栏右侧的按钮组。
 * 纯展示组件，所有状态与行为通过 props 上抛给父组件。
 *
 * 按钮显隐规则：
 *   - 生成中（generating=true）：生成按钮变为 loading 态
 *   - 非生成中：显示「开始生成」+「重置」按钮
 *
 * 取消按钮已移至历史卡片中（仅 pending 状态可取消，running 不可取消）。
 *
 * 生成按钮禁用条件（非生成中时）：
 *   - 提示词为空
 *   - 未选择渠道
 *   - 未选择模型
 *   - 提示词超出最大长度限制
 */
import { Button, Spin } from "antd";
import { RefreshCw, Sparkles } from "lucide-react";

export interface ActionBarProps {
  /** 是否正在生成（用户触发的生成流程，控制生成按钮 loading + 重置禁用） */
  generating: boolean;
  /** 点击生成按钮回调 */
  onGenerate?: () => void;
  /** 点击重置按钮回调 */
  onReset: () => void;
  /** 提示词是否为空（用于禁用生成按钮） */
  promptEmpty?: boolean;
  /** 是否已选择渠道 */
  hasProvider?: boolean;
  /** 是否已选择模型 */
  hasModel?: boolean;
  /** 提示词是否超出最大长度 */
  isPromptExceeded?: boolean;
  /** 是否隐藏生成按钮（已移入输入框内） */
  hideGenerate?: boolean;
}

/** 生成/重置操作栏 */
export default function ActionBar({
  generating,
  onGenerate,
  onReset,
  promptEmpty,
  hasProvider,
  hasModel,
  isPromptExceeded,
  hideGenerate,
}: ActionBarProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {/* 生成按钮（仅在 hideGenerate 为 false 时显示） */}
      {!hideGenerate && onGenerate && (
        <Button
          type="primary"
          icon={generating ? <Spin size="small" /> : <Sparkles size={14} />}
          onClick={onGenerate}
          loading={generating}
          disabled={promptEmpty || !hasProvider || !hasModel || isPromptExceeded}
          style={{ height: 24, display: "flex", alignItems: "center" }}
        >
          {generating ? "生成中..." : "开始生成"}
        </Button>
      )}

      {/* 重置按钮 */}
      <Button
        icon={<RefreshCw size={14} />}
        onClick={onReset}
        disabled={generating}
        style={{ height: 24, display: "flex", alignItems: "center" }}
      >
        重置
      </Button>
    </div>
  );
}
