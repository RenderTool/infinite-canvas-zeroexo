/**
 * HistoryDetailModal - 历史详情弹窗 + 下载弹窗
 *
 * 合并两个相关弹窗：
 *   1. 详情弹窗：展示生成结果的完整信息（结果图、提示词、渠道、参数、参考图、错误信息）
 *   2. 下载弹窗：图片下载预览与下载原图按钮
 *
 * 两个弹窗的开关状态由主组件控制（因为触发点分散在多处：历史列表、结果头部、详情弹窗内）。
 */
import { Modal, Image, Typography, Button, message } from "antd";
import { Copy, Download } from "lucide-react";
import type { GenerationRecord, ResultImage } from "./types";

const { Text } = Typography;

export interface HistoryDetailModalProps {
  /** 详情弹窗是否打开 */
  open: boolean;
  /** 详情记录（open 为 true 时不应为 null） */
  record: GenerationRecord | null;
  /** 关闭详情弹窗 */
  onClose: () => void;
  /** 下载弹窗的目标结果（null 表示关闭下载弹窗） */
  downloadResult: ResultImage | null;
  /** 关闭下载弹窗 */
  onCloseDownload: () => void;
}

/** 渲染参数值：base64/图片 URL 用 Image 组件，其他用 JSON 文本 */
function renderParamValue(value: unknown): React.ReactNode {
  const isImageUrl = (s: string) => s.startsWith("data:image/");
  if (typeof value === "string" && isImageUrl(value)) {
    return (
      <Image
        src={value}
        alt="图片"
        style={{
          width: 80,
          height: 80,
          borderRadius: 4,
          objectFit: "cover",
          verticalAlign: "middle",
        }}
        preview={{ mask: "查看" }}
      />
    );
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "string" && isImageUrl(v))
  ) {
    return (
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {value.map((url, i) => (
          <Image
            key={i}
            src={url}
            alt={`图片 ${i + 1}`}
            style={{
              width: 80,
              height: 80,
              borderRadius: 4,
              objectFit: "cover",
            }}
            preview={{ mask: "查看" }}
          />
        ))}
      </div>
    );
  }
  return <span style={{ color: "#595959" }}>{JSON.stringify(value)}</span>;
}

/** 历史详情弹窗 + 下载弹窗 */
export default function HistoryDetailModal({
  open,
  record,
  onClose,
  downloadResult,
  onCloseDownload,
}: HistoryDetailModalProps) {
  return (
    <>
      {/* ═══════ 详情弹窗 ═══════ */}
      <Modal
        title={`生成详情 — ${record?.model || ""}`}
        open={open}
        onCancel={onClose}
        footer={null}
        width={640}
        centered
      >
        {record && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "center",
              maxHeight: 480,
              overflowY: "auto",
              padding: "16px 0",
            }}
          >
            {/* 结果图片 */}
            {record.results.length > 0 && (
              <div style={{ width: "100%" }}>
                <Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: 500 }}
                >
                  生成结果
                </Text>
                <Image.PreviewGroup>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      marginTop: 4,
                      justifyContent: "center",
                    }}
                  >
                    {record.results.map((result) => (
                      <div
                        key={result.id}
                        style={{
                          width: 120,
                          borderRadius: 4,
                          overflow: "hidden",
                          border: "1px solid #f0f0f0",
                        }}
                      >
                        <Image
                          src={result.url}
                          alt=""
                          style={{
                            width: 120,
                            height: 120,
                            objectFit: "cover",
                          }}
                        />
                        <div
                          style={{
                            fontSize: 11,
                            textAlign: "center",
                            color: "#8c8c8c",
                            padding: "2px 0",
                            background: "#fafafa",
                          }}
                        >
                          {result.width}×{result.height}
                        </div>
                      </div>
                    ))}
                  </div>
                </Image.PreviewGroup>
              </div>
            )}

            {/* 提示词 */}
            <div style={{ width: "100%" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: 500 }}
                >
                  提示词
                </Text>
                {record.prompt && (
                  <Button
                    size="small"
                    type="text"
                    icon={<Copy size={11} />}
                    onClick={() =>
                      navigator.clipboard
                        .writeText(record.prompt)
                        .then(() => message.success("提示词已复制"))
                    }
                  />
                )}
              </div>
              <div
                style={{
                  marginTop: 4,
                  padding: 8,
                  background: "#fafafa",
                  borderRadius: 4,
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {record.prompt || "无"}
              </div>
            </div>

            {/* 渠道和模型 */}
            <div style={{ display: "flex", gap: 16, width: "100%" }}>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  渠道
                </Text>
                <div style={{ fontSize: 13 }}>{record.providerName}</div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  模型
                </Text>
                <div style={{ fontSize: 13 }}>{record.model}</div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  时间
                </Text>
                <div style={{ fontSize: 13 }}>
                  {new Date(record.createdAt).toLocaleString("zh-CN")}
                </div>
              </div>
            </div>

            {/* 参数 - base64 值用 Image 组件渲染 */}
            {Object.keys(record.params).length > 0 && (
              <div style={{ width: "100%" }}>
                <Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: 500 }}
                >
                  参数
                </Text>
                <div
                  style={{
                    marginTop: 4,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {Object.entries(record.params).map(([key, value]) => (
                    <div
                      key={key}
                      style={{
                        padding: "4px 8px",
                        background: "#fafafa",
                        borderRadius: 4,
                        fontSize: 12,
                        fontFamily: "'SF Mono', 'Menlo', 'Consolas', monospace",
                        lineHeight: 1.6,
                      }}
                    >
                      <span style={{ color: "#1677ff" }}>"{key}"</span>:{" "}
                      {renderParamValue(value)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 参考图 */}
            <div style={{ width: "100%" }}>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>
                参考图
              </Text>
              {record.references.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    flexWrap: "wrap",
                    marginTop: 4,
                  }}
                >
                  {record.references.map((ref) => (
                    <div
                      key={ref.id}
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 4,
                        overflow: "hidden",
                        border: "1px solid #f0f0f0",
                      }}
                    >
                      <Image
                        src={ref.url}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                        preview={{ mask: null }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 4, fontSize: 12, color: "#8c8c8c" }}>
                  无参考图
                </div>
              )}
            </div>

            {/* 错误信息 */}
            {(record.status === "failed" || record.status === "cancelled") &&
              record.errorMessage && (
              <div style={{ width: "100%" }}>
                <Text type="danger" style={{ fontSize: 12, fontWeight: 500 }}>
                  错误信息
                </Text>
                <div
                  style={{
                    marginTop: 4,
                    padding: 8,
                    background: "#fff2f0",
                    borderRadius: 4,
                    border: "1px solid #ffccc7",
                    fontSize: 12,
                    color: "#cf1322",
                    lineHeight: 1.6,
                  }}
                >
                  {record.errorMessage}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ═══════ 下载弹窗 ═══════ */}
      <Modal
        title="下载图片"
        open={!!downloadResult}
        onCancel={onCloseDownload}
        footer={null}
        width={400}
        centered
      >
        {downloadResult && (
          <div style={{ textAlign: "center" }}>
            <Image
              src={downloadResult.url}
              alt="下载预览"
              style={{
                maxWidth: "100%",
                maxHeight: 300,
                borderRadius: 6,
                marginBottom: 16,
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <Button
                type="primary"
                icon={<Download size={14} />}
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = downloadResult.url;
                  a.download = `ai-image-${Date.now()}.png`;
                  a.click();
                }}
              >
                下载原图
              </Button>
              <Button onClick={onCloseDownload}>取消</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
