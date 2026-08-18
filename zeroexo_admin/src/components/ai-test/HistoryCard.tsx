/**
 * HistoryCard - 历史记录卡片
 *
 * 单条历史记录的展示与操作，支持两种视图变体：
 *   1. grid: 全屏网格视图下的卡片（含提示词预览，hoverable）
 *   2. list: 右侧固定宽度列表视图下的卡片（含选中态高亮）
 *
 * 卡片提供以下操作：
 *   - 下载结果图片
 *   - 添加到参考图
 *   - 查看详情
 *   - 复制提示词
 *   - 重试（仅失败状态）
 *   - 删除
 *
 * 所有状态变更与网络请求通过回调上抛给父组件处理。
 */
import {
  Card,
  Button,
  Tooltip,
  Spin,
  Tag,
  message,
  Checkbox,
  Space,
} from "antd";
import {
  Trash2,
  RefreshCw,
  Download,
  Plus,
  CircleAlert,
  Copy,
  Square,
} from "lucide-react";
import type { GenerationRecord, ResultImage } from "./types";

export interface HistoryCardProps {
  /** 历史记录数据 */
  item: GenerationRecord;
  /** 视图变体：grid 全屏网格 / list 右侧列表 */
  variant: "grid" | "list";
  /** list 视图下是否处于选中态 */
  active?: boolean;
  /** 是否正在生成（用于禁用重试按钮） */
  generating: boolean;
  /** 批量模式下是否被选中 */
  selected?: boolean;
  /** 批量模式下的勾选回调 */
  onToggleSelect?: (id: string) => void;
  /** 选中该条记录 */
  onSelect: (item: GenerationRecord) => void;
  /** 下载结果图片 */
  onDownload: (result: ResultImage, index: number) => void;
  /** 添加结果到参考图 */
  onAddToReferences: (result: ResultImage, index: number) => void;
  /** 查看详情 */
  onShowDetail: (item: GenerationRecord) => void;
  /** 重试该条记录 */
  onRetryHistory: (item: GenerationRecord) => void;
  /** 删除该条记录 */
  onDeleteHistory: (id: string) => void;
  /** 取消该条记录（仅 pending 状态显示取消按钮） */
  onCancelHistory?: (id: string) => void;
}

/** 历史记录卡片 - 单条记录的展示与操作 */
export default function HistoryCard({
  item,
  variant,
  active,
  generating,
  selected,
  onToggleSelect,
  onSelect,
  onDownload,
  onAddToReferences,
  onShowDetail,
  onRetryHistory,
  onDeleteHistory,
  onCancelHistory,
}: HistoryCardProps) {
  const isGrid = variant === "grid";

  /** 复制提示词到剪贴板 */
  const handleCopyPrompt = (prompt: string) => {
    navigator.clipboard
      .writeText(prompt)
      .then(() => message.success("提示词已复制"));
  };

  /** 渲染封面：缩略图 + 尺寸标签 / 加载中 / 无结果占位 */
  const renderCover = () => (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16/9",
        overflow: "hidden",
        borderRadius: "6px 6px 0 0",
        background: "#1a1a1a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* 批量选择勾选框 */}
      {onToggleSelect && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 4,
            left: 4,
            zIndex: 10,
            background: selected ? "rgba(22,119,255,0.85)" : "rgba(0,0,0,0.4)",
            borderRadius: 3,
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Checkbox
            checked={selected}
            onChange={() => onToggleSelect(item.id)}
            style={{ transform: "scale(0.75)" }}
          />
        </div>
      )}
      {item.results.length > 0 ? (
        <>
          {/* 缩略图使用原生 img + lazy loading 节省带宽 */}
          <img
            src={item.results[0].url}
            alt=""
            loading="lazy"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
          {/* 尺寸标签 */}
          {item.results[0] && (
            <span
              style={{
                position: "absolute",
                bottom: 4,
                right: 4,
                fontSize: 9,
                color: "rgba(255,255,255,0.8)",
                background: "rgba(0,0,0,0.5)",
                padding: "0 4px",
                lineHeight: "16px",
                borderRadius: 2,
              }}
            >
              {item.results[0].width}×{item.results[0].height}
            </span>
          )}
        </>
      ) : item.status === "running" || item.status === "pending" ? (
        <Spin style={{ color: "#fff" }} />
      ) : (
        <div
          style={
            isGrid
              ? { fontSize: 12, color: "#8c8c8c" }
              : {
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  color: "#8c8c8c",
                }
          }
        >
          无生成结果
        </div>
      )}
    </div>
  );

  /** 渲染操作按钮组：删除按钮右对齐，其他按钮左对齐 */
  const renderActions = () => {
    const leftButtons = [
      // 1. 添加参考（仅有结果时可用）
      item.results.length > 0 ? (
        <Tooltip key="addref" title="添加参考">
          <Button
            size="small"
            type="text"
            icon={<Plus size={11} />}
            style={{ height: 22, border: "none" }}
            onClick={(e) => {
              e.stopPropagation();
              onAddToReferences(item.results[0], 0);
            }}
          />
        </Tooltip>
      ) : (
        <span key="addref" />
      ),
      // 2. 复制提示词
      <Tooltip key="copy" title="复制提示词">
        <Button
          size="small"
          type="text"
          icon={<Copy size={11} />}
          style={{ height: 22, border: "none" }}
          onClick={(e) => {
            e.stopPropagation();
            handleCopyPrompt(item.prompt);
          }}
        />
      </Tooltip>,
      // 3. 详情
      <Tooltip key="detail" title="详情">
        <Button
          size="small"
          type="text"
          icon={<CircleAlert size={11} />}
          style={{ height: 22, border: "none" }}
          onClick={(e) => {
            e.stopPropagation();
            onShowDetail(item);
          }}
        />
      </Tooltip>,
      // 4. 下载（仅有结果时可用）
      item.results.length > 0 ? (
        <Tooltip key="download" title="下载">
          <Button
            size="small"
            type="text"
            icon={<Download size={11} />}
            style={{ height: 22, border: "none" }}
            onClick={(e) => {
              e.stopPropagation();
              onDownload(item.results[0], 0);
            }}
          />
        </Tooltip>
      ) : (
        <span key="download" />
      ),
      // 5. 重试（仅失败/取消状态）
      item.status === "failed" || item.status === "cancelled" ? (
        <Tooltip key="retry" title="重试">
          <Button
            size="small"
            type="text"
            icon={<RefreshCw size={11} />}
            style={{ height: 22, border: "none" }}
            disabled={generating}
            onClick={(e) => {
              e.stopPropagation();
              onRetryHistory(item);
            }}
          />
        </Tooltip>
      ) : (
        <span key="retry" />
      ),
      // 7. 取消（仅 pending 状态可取消，排队中尚未提交运营商）
      item.status === "pending" && onCancelHistory ? (
        <Tooltip key="cancel" title="取消">
          <Button
            size="small"
            type="text"
            danger
            icon={<Square size={11} />}
            style={{ height: 22, border: "none" }}
            onClick={(e) => {
              e.stopPropagation();
              onCancelHistory(item.id);
            }}
          />
        </Tooltip>
      ) : (
        <span key="cancel" />
      ),
    ];

    const rightButtons = [
      // 6. 删除（右对齐）
      <Tooltip key="delete" title="删除">
        <Button
          size="small"
          type="text"
          danger
          icon={<Trash2 size={11} />}
          style={{ height: 22, border: "none" }}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteHistory(item.id);
          }}
        />
      </Tooltip>,
    ];

    // 返回单个 action 项，内部分左右两组
    return [
      <div
        key="actions"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
        }}
      >
        <Space size={0}>{leftButtons}</Space>
        <Space size={0}>{rightButtons}</Space>
      </div>,
    ];
  };

  /** 渲染标签栏：模型 / 状态 / 时间 */
  const renderTags = () => (
    <div
      style={{
        display: "flex",
        gap: 3,
        flexWrap: "wrap",
        alignItems: "center",
        fontSize: 10,
      }}
    >
      <Tag
        color="blue"
        style={{
          fontSize: 9,
          padding: "0 3px",
          margin: 0,
          lineHeight: "16px",
          ...(isGrid
            ? {}
            : {
                maxWidth: 80,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }),
        }}
      >
        {item.model}
      </Tag>
      {item.status === "pending" ? (
        <Tag
          color="orange"
          style={{
            fontSize: 9,
            padding: "0 3px",
            margin: 0,
            lineHeight: "16px",
          }}
        >
          排队中
        </Tag>
      ) : item.status === "running" ? (
        <Tag
          color="processing"
          style={{
            fontSize: 9,
            padding: "0 3px",
            margin: 0,
            lineHeight: "16px",
          }}
        >
          生成中
        </Tag>
      ) : item.status === "success" ? (
        <Tag
          color="green"
          style={{
            fontSize: 9,
            padding: "0 3px",
            margin: 0,
            lineHeight: "16px",
          }}
        >
          {item.results.length > 0
            ? `${item.results[0].width}×${item.results[0].height}`
            : ""}
        </Tag>
      ) : item.status === "cancelled" ? (
        <Tag
          color="default"
          style={{
            fontSize: 9,
            padding: "0 3px",
            margin: 0,
            lineHeight: "16px",
          }}
        >
          已取消
        </Tag>
      ) : (
        <Tag
          color="red"
          style={{
            fontSize: 9,
            padding: "0 3px",
            margin: 0,
            lineHeight: "16px",
          }}
        >
          失败
        </Tag>
      )}
      <Tag
        style={{
          fontSize: 9,
          padding: "0 3px",
          margin: 0,
          lineHeight: "16px",
        }}
      >
        {new Date(item.createdAt).toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Tag>
    </div>
  );

  // ─── grid 视图：含提示词预览，hoverable ───
  if (isGrid) {
    return (
      <Card
        size="small"
        hoverable
        onClick={() => onSelect(item)}
        style={{ borderRadius: 6 }}
        styles={{ body: { padding: 0 } }}
        cover={renderCover()}
        actions={renderActions()}
      >
        <div
          style={{
            padding: "6px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.prompt || "(无提示词)"}
          </div>
          {renderTags()}
        </div>
      </Card>
    );
  }

  // ─── list 视图：选中态高亮 ───
  return (
    <Card
      size="small"
      style={{
        borderRadius: 6,
        borderColor: active ? "#1677ff" : "#f0f0f0",
        background: active ? "#f0f7ff" : "#fff",
        cursor: "pointer",
      }}
      styles={{ body: { padding: "6px 8px" } }}
      onClick={() => onSelect(item)}
      cover={renderCover()}
      actions={renderActions()}
    >
      <Card.Meta description={renderTags()} />
    </Card>
  );
}
