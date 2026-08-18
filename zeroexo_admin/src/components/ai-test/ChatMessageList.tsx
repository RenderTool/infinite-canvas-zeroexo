/**
 * ChatMessageList - 语言对话消息列表
 *
 * 负责渲染对话消息气泡（用户 / AI）、深度思考折叠、空状态占位、
 * 加载中 Spin、截断提示横幅，以及消息行的复制 / 删除操作按钮。
 *
 * 仅做展示与交互回调，不持有业务状态。
 */
import { Fragment } from "react";
import { Spin, Typography, Tooltip } from "antd";
import { Bot, User, Brain, Trash2, Copy, Check } from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";
import { KEEP_RECENT } from "./chat-utils";
import type { Message } from "./chat-types";

const { Text } = Typography;

interface ChatMessageListProps {
  /** 当前对话消息列表 */
  messages: Message[];
  /** 是否正在等待 AI 响应 */
  sending: boolean;
  /** 已自动截断的旧消息条数 */
  truncatedCount: number;
  /** 当前已复制消息的下标（用于切换复制图标） */
  copiedIdx: number | null;
  /** 复制消息回调 */
  onCopyMessage: (idx: number, content: string) => void;
  /** 从指定下标开始删除后续消息回调 */
  onDeleteFrom: (idx: number) => void;
  /** 消息列表底部锚点 ref（用于自动滚动） */
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export default function ChatMessageList({
  messages,
  sending,
  truncatedCount,
  copiedIdx,
  onCopyMessage,
  onDeleteFrom,
  messagesEndRef,
}: ChatMessageListProps) {
  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        background: "var(--color-bg-surface, #fff)",
        border: "1px solid var(--color-border-light, #f0f0f0)",
        borderRadius: 4,
        padding: "12px 0",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {truncatedCount > 0 && (
        <div
          style={{
            margin: "0 16px 12px",
            padding: "6px 12px",
            background: "#fffbe6",
            border: "1px solid #ffe58f",
            borderRadius: 4,
            fontSize: 12,
            color: "#ad6800",
            textAlign: "center",
          }}
        >
          已自动截断 {truncatedCount} 条旧消息，仅保留最近 {KEEP_RECENT} 条
        </div>
      )}
      {messages.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#bfbfbf",
          }}
        >
          <Bot size={48} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div style={{ fontSize: 14 }}>
            选择 AI 渠道和模型后输入消息开始测试
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            对话会自动缓存，离开页面后恢复
          </div>
        </div>
      ) : (
        messages.map((msg, idx) => {
          const isCopied = copiedIdx === idx;
          const showSeparator = idx > 0 && idx % 5 === 0;
          return (
            <Fragment key={idx}>
              {showSeparator && (
                <div
                  style={{
                    textAlign: "center",
                    padding: "8px 16px",
                    color: "#d9d9d9",
                    fontSize: 11,
                    userSelect: "none",
                  }}
                >
                  ——— {idx} 条消息 ———
                </div>
              )}
              <div
                className="message-row"
                style={{
                  display: "flex",
                  justifyContent:
                    msg.role === "user" ? "flex-end" : "flex-start",
                  marginBottom: 2,
                  padding: "0 16px",
                }}
              >
                <div style={{ maxWidth: msg.role === "user" ? "70%" : "80%" }}>
                  {/* 消息气泡 */}
                  {msg.role === "user" ? (
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: 8,
                        backgroundColor: "var(--color-primary, #1677ff)",
                        color: "#fff",
                        fontSize: 14,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 4,
                        }}
                      >
                        <User size={12} />
                        <Text
                          style={{
                            fontSize: 11,
                            color: "rgba(255,255,255,0.7)",
                          }}
                        >
                          用户
                        </Text>
                      </div>
                      <div style={{ color: "#fff" }}>{msg.content}</div>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: "12px 16px",
                        borderRadius: 8,
                        backgroundColor: "var(--color-bg-elevated, #f5f5f5)",
                        color: "var(--color-text-primary, #000)",
                        fontSize: 14,
                        lineHeight: 1.7,
                        wordBreak: "break-word",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 6,
                        }}
                      >
                        <Bot size={12} />
                        <Text style={{ fontSize: 11, color: "var(--color-text-tertiary, #8c8c8c)" }}>
                          AI
                        </Text>
                      </div>
                      {msg.thinkingContent && (
                        <details
                          style={{
                            marginBottom: 8,
                            background: "var(--color-bg-hover, #f0f0f0)",
                            borderRadius: 6,
                            padding: "6px 10px",
                            fontSize: 13,
                          }}
                        >
                          <summary
                            style={{
                              cursor: "pointer",
                              color: "var(--color-text-tertiary, #8c8c8c)",
                              userSelect: "none",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <Brain size={12} />
                            深度思考过程
                          </summary>
                          <div
                            style={{
                              marginTop: 6,
                              borderTop: "1px solid var(--color-border-light, #e0e0e0)",
                              paddingTop: 6,
                              color: "var(--color-text-secondary, #595959)",
                              fontStyle: "italic",
                            }}
                          >
                            <MarkdownRenderer content={msg.thinkingContent} />
                          </div>
                        </details>
                      )}
                      <MarkdownRenderer content={msg.content} />
                    </div>
                  )}

                  {/* ChatGPT 风格操作按钮（显示/隐藏由 CSS .message-row:hover .message-actions 控制，内联样式不得设置 opacity 以免覆盖） */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      padding: "4px 0",
                    }}
                    className="message-actions"
                  >
                    <Tooltip title="复制内容">
                      <div
                        onClick={() => onCopyMessage(idx, msg.content)}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 4,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          color: isCopied ? "var(--color-success, #52c41a)" : "var(--color-text-tertiary, #8c8c8c)",
                        }}
                        className="message-action-btn"
                      >
                        {isCopied ? <Check size={13} /> : <Copy size={13} />}
                      </div>
                    </Tooltip>
                    <Tooltip title="从此处删除后续消息">
                      <div
                        onClick={() => onDeleteFrom(idx)}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 4,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          color: "var(--color-text-tertiary, #8c8c8c)",
                        }}
                        className="message-action-btn"
                      >
                        <Trash2 size={13} />
                      </div>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })
      )}
      {sending && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-start",
            marginBottom: 12,
            padding: "0 16px",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              backgroundColor: "var(--color-bg-elevated, #f5f5f5)",
            }}
          >
            <Spin size="small" />
            <span style={{ marginLeft: 8, color: "var(--color-text-tertiary, #8c8c8c)", fontSize: 13 }}>
              AI 思考中...
            </span>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
