/**
 * ChatInputBar - 语言对话底栏（输入框 + 工具栏）
 *
 * 包含：
 * - Input.TextArea 输入框 + 发送按钮
 * - 渠道选择 Select（点击即展开下拉列表）
 * - 模型选择 Select（同上）
 * - 上下文使用率 Progress
 * - 深度思考 Switch
 * - 截断 / 导出 / 新对话按钮
 *
 * 仅做展示与交互回调，不持有业务状态。
 */
import {
  Card,
  Input,
  Button,
  Typography,
  Select,
  Progress,
  Switch,
  Tooltip,
} from "antd";
import { Send, Scissors, Download, Brain, Square, RefreshCw } from "lucide-react";
import {
  BRAND_ICONS,
  DefaultBrandIcon,
} from "@/components/api-settings/brand-icons";
import { KEEP_RECENT } from "./chat-utils";
import type { ProviderItem, ModelOption } from "./types";

const { Text } = Typography;

/** 上下文使用率聚合数据 */
interface TokenUsage {
  used: number;
  limit: number;
  percent: number;
}

interface ChatInputBarProps {
  /** 输入框当前值 */
  inputValue: string;
  /** 输入框值变更回调 */
  onInputChange: (value: string) => void;
  /** 发送回调 */
  onSend: () => void;
  /** 停止生成回调（AI 回复中可用） */
  onStop: () => void;
  /** 输入框按键回调（处理 Enter 发送） */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** 是否正在发送中 */
  sending: boolean;
  /** 是否未选渠道或模型（用于禁用发送按钮） */
  disabled: boolean;

  /* ── 渠道选择 ── */
  /** 可用渠道列表 */
  providers: ProviderItem[];
  /** 渠道列表加载中 */
  providersLoading: boolean;
  /** 当前选中渠道 id */
  selectedProviderId: string | null;
  /** 选择渠道回调（父组件负责同时清空模型） */
  onSelectProvider: (id: string) => void;

  /* ── 模型选择 ── */
  /** 当前选中模型 */
  selectedModel: string | null;
  /** 选择模型回调 */
  onSelectModel: (model: string) => void;
  /** 模型下拉选项 */
  modelOptions: ModelOption[];
  /** 当前渠道是否已缓存模型列表 */
  hasCachedModels: boolean;

  /* ── 上下文使用率 ── */
  /** 上下文 token 使用率聚合 */
  tokenUsage: TokenUsage;

  /* ── 深度思考 ── */
  /** 深度思考开关 */
  thinkingMode: boolean;
  /** 切换深度思考回调 */
  onToggleThinkingMode: (checked: boolean) => void;

  /* ── 操作按钮 ── */
  /** 新对话回调 */
  onNewChat: () => void;
  /** 手动截断回调 */
  onManualTruncate: () => void;
  /** 导出回调 */
  onExport: () => void;
  /** 导出按钮 loading 状态 */
  exporting: boolean;
  /** 是否存在消息（控制截断 / 导出按钮的显隐） */
  hasMessages: boolean;
  /** 是否可手动截断（消息数 > KEEP_RECENT） */
  canTruncate: boolean;
  /** 刷新渠道列表回调 */
  onRefreshProviders?: () => void;
}

export default function ChatInputBar({
  inputValue,
  onInputChange,
  onSend,
  onStop,
  onKeyDown,
  sending,
  disabled,
  providers,
  providersLoading,
  selectedProviderId,
  onSelectProvider,
  selectedModel,
  onSelectModel,
  modelOptions,
  hasCachedModels,
  tokenUsage,
  thinkingMode,
  onToggleThinkingMode,
  onNewChat,
  onManualTruncate,
  onExport,
  exporting,
  hasMessages,
  canTruncate,
  onRefreshProviders,
}: ChatInputBarProps) {
  return (
    <Card
      size="small"
      style={{ borderRadius: 4, flexShrink: 0 }}
      styles={{ body: { padding: "12px 16px" } }}
    >
      {/* 输入框 */}
      <div style={{ position: "relative" }}>
        <Input.TextArea
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          rows={3}
          disabled={sending}
          maxLength={4000}
          style={{ resize: "none", paddingRight: 80 }}
        />
        <div style={{
          position: "absolute",
          top: 4,
          right: 8,
          fontSize: 11,
          lineHeight: "18px",
          color: inputValue.length > 3800 ? "#ff4d4f" : "#8c8c8c",
          background: "rgba(255,255,255,0.85)",
          padding: "0 4px",
          borderRadius: 3,
          userSelect: "none",
          pointerEvents: "none",
          zIndex: 2,
        }}>
          {inputValue.length}/4000
        </div>
        {sending ? (
          <Button
            danger
            icon={<Square size={14} />}
            onClick={onStop}
            style={{
              position: "absolute",
              right: 8,
              bottom: 8,
              height: 32,
              lineHeight: "32px",
            }}
          >
            停止
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<Send size={14} />}
            onClick={onSend}
            disabled={disabled || !inputValue.trim()}
            style={{
              position: "absolute",
              right: 8,
              bottom: 8,
              height: 32,
              lineHeight: "32px",
            }}
          >
            发送
          </Button>
        )}
      </div>

      {/* 工具栏：左侧渠道/模型 + 右侧上下文/深度思考/操作 */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {/* 渠道刷新按钮 */}
        {onRefreshProviders && (
          <Tooltip title="刷新渠道并同步聊天记录">
            <Button
              size="small"
              icon={<RefreshCw size={13} />}
              loading={providersLoading}
              onClick={onRefreshProviders}
              style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            />
          </Tooltip>
        )}
        {/* 渠道选择：直接 Select，点击即展开下拉列表 */}
        <Select
          size="small"
          style={{ width: 140 }}
          popupMatchSelectWidth={360}
          placement="topLeft"
          placeholder="选择渠道"
          loading={providersLoading}
          disabled={sending}
          value={selectedProviderId}
          onChange={(id) => onSelectProvider(id)}
          labelRender={({ value }) => {
            const p = providers.find((x) => x.id === value);
            if (!p) return <span>选择渠道</span>;
            const Icon = (BRAND_ICONS[p.provider] || DefaultBrandIcon) as any;
            return (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  overflow: "hidden",
                }}
              >
                <Icon size={14} />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.name}
                </span>
              </span>
            );
          }}
          options={providers.map((p) => {
            const Icon = (BRAND_ICONS[p.provider] || DefaultBrandIcon) as any;
            const count = p.config?.fetchedModels
              ? Object.values(
                  p.config.fetchedModels as Record<string, string[]>,
                ).reduce((s, ids) => s + ids.length, 0)
              : 0;
            return {
              value: p.id,
              label: (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Icon size={14} />
                  <span>{p.name}</span>
                  {count > 0 && (
                    <span style={{ color: "#bfbfbf", fontSize: 11 }}>
                      ·{count}模型
                    </span>
                  )}
                </span>
              ),
            };
          })}
        />

        {/* 模型选择：直接 Select，点击即展开下拉列表 */}
        <Select
          size="small"
          style={{ width: 160 }}
          popupMatchSelectWidth={360}
          placement="topLeft"
          placeholder={hasCachedModels ? "选择模型" : "暂无缓存"}
          disabled={sending}
          value={selectedModel}
          onChange={onSelectModel}
          notFoundContent={hasCachedModels ? "暂无模型" : "暂无缓存"}
          labelRender={({ value }) => {
            const opt = modelOptions.find((o) => o.value === value);
            if (!opt) return <span>选择模型</span>;
            const Icon = (BRAND_ICONS[opt.iconProvider || ""] ||
              DefaultBrandIcon) as any;
            return (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  overflow: "hidden",
                }}
              >
                <Icon size={14} />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {opt.label}
                </span>
              </span>
            );
          }}
          options={modelOptions.map((opt) => {
            const Icon = (BRAND_ICONS[opt.iconProvider || ""] ||
              DefaultBrandIcon) as any;
            return {
              value: opt.value,
              label: (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Icon size={14} />
                  <span>{opt.label}</span>
                </span>
              ),
            };
          })}
        />

        <div style={{ flex: 1, minWidth: 4 }} />

        {/* 右侧：上下文使用率 + 深度思考 + 截断/导出 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {/* 上下文使用率（禁用 hover 事件，避免 SVG 原生 tooltip） */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 24,
              pointerEvents: "none",
            }}
          >
            <Progress
              type="circle"
              percent={Math.round(tokenUsage.percent)}
              size={14}
              strokeColor={
                tokenUsage.percent > 85
                  ? "#ff4d4f"
                  : tokenUsage.percent > 70
                    ? "#faad14"
                    : "#52c41a"
              }
              format={() => ""}
            />
            {/* 上下文使用率 */}
            <span
              style={{
                fontSize: 11,
                color: tokenUsage.percent > 70 ? "#faad14" : "#8c8c8c",
                whiteSpace: "nowrap",
              }}
            >
              上下文 {Math.round(tokenUsage.used / 1000)}K /{" "}
              {Math.round(tokenUsage.limit / 1000)}K
            </span>
          </div>

          {/* 深度思考 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              height: 24,
            }}
          >
            <Brain
              size={13}
              style={{ color: thinkingMode ? "#1677ff" : "#8c8c8c" }}
            />
            <Text
              type="secondary"
              style={{ fontSize: 11, whiteSpace: "nowrap" }}
            >
              深度思考
            </Text>
            <Switch
              size="small"
              checked={thinkingMode}
              onChange={onToggleThinkingMode}
            />
          </div>

          {/* 截断按钮 */}
          {hasMessages && (
            <Tooltip title={`保留最近 ${KEEP_RECENT} 条，丢弃更早的消息`}>
              <Button
                size="small"
                icon={<Scissors size={12} />}
                onClick={onManualTruncate}
                disabled={!canTruncate}
                style={{ height: 24, fontSize: 11 }}
              />
            </Tooltip>
          )}

          {/* 导出按钮 */}
          {hasMessages && (
            <Button
              size="small"
              icon={<Download size={12} />}
              loading={exporting}
              onClick={onExport}
              style={{ height: 24, fontSize: 11 }}
            >
              导出
            </Button>
          )}
          {/* 新对话 */}
          <Button
            size="small"
            onClick={onNewChat}
            style={{ height: 24, fontSize: 11 }}
          >
            新对话
          </Button>
        </div>
      </div>
    </Card>
  );
}
