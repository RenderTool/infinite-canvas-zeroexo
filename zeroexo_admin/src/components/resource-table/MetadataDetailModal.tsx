/**
 * MetadataDetailModal — 可复用的 AI 生成元数据详情弹窗
 *
 * 用于在管理后台查看 AI 生成资源的完整元数据（prompt、model、provider、params 等）。
 * 未来扩展视频、音频时可通过 record.kind 字段展示不同的渲染形式。
 */
import { Modal, Image, Typography, Button, Tag, message } from 'antd';
import { Copy } from 'lucide-react';

const { Text } = Typography;

export interface MetadataDetailModalProps {
  record: Record<string, unknown> | null;
  onClose: () => void;
}

/** 渲染参数值 */
function renderParamValue(value: unknown): React.ReactNode {
  const isImageUrl = (s: string) => s.startsWith('data:image/') || s.startsWith('http');
  if (typeof value === 'string' && isImageUrl(value)) {
    return <Image src={value} alt="" style={{ width: 80, height: 80, borderRadius: 4, objectFit: 'cover' }} preview={{ mask: '查看' }} />;
  }
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' && isImageUrl(v))) {
    return (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {value.map((url, i) => (
          <Image key={i} src={url} alt="" style={{ width: 80, height: 80, borderRadius: 4, objectFit: 'cover' }} preview={{ mask: '查看' }} />
        ))}
      </div>
    );
  }
  if (value === null || value === undefined) return <span style={{ color: '#8c8c8c' }}>-</span>;
  return <span style={{ color: '#595959' }}>{JSON.stringify(value)}</span>;
}

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  success: { color: 'success', label: '成功' },
  failed: { color: 'error', label: '失败' },
  running: { color: 'processing', label: '生成中' },
  pending: { color: 'warning', label: '等待中' },
  cancelled: { color: 'default', label: '已取消' },
};

const KIND_LABELS: Record<string, string> = {
  image: '图片', video: '视频', audio: '音频', text: '文本',
};

/** 渲染单行元数据字段 */
function renderField(key: string, value: unknown): React.ReactNode {
  const labels: Record<string, string> = {
    id: '记录 ID', kind: '生成类型', prompt: '提示词', negativePrompt: '反向提示词',
    model: '模型', providerName: '渠道', status: '状态', costTokens: '消耗 Token',
    costMs: '耗时 (ms)', errorMessage: '错误信息', createdAt: '创建时间', updatedAt: '更新时间',
  };
  const hidden = new Set(['ownerId', 'providerId', 'resultAssetId', 'projectId']);
  if (hidden.has(key)) return null;

  const label = labels[key] || key;

  if (key === 'status') {
    const s = STATUS_MAP[String(value)] || { color: 'default', label: String(value) };
    return (
      <div key={key}>
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>{label}</Text>
        <div style={{ marginTop: 2 }}><Tag color={s.color}>{s.label}</Tag></div>
      </div>
    );
  }
  if (key === 'kind') {
    return (
      <div key={key}>
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>{label}</Text>
        <div style={{ marginTop: 2 }}><Tag>{KIND_LABELS[String(value)] || String(value)}</Tag></div>
      </div>
    );
  }
  if (key === 'prompt' && value) {
    return (
      <div key={key}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>{label}</Text>
          <Button size="small" type="text" icon={<Copy size={11} />}
            onClick={() => navigator.clipboard.writeText(String(value)).then(() => message.success('提示词已复制'))}
          />
        </div>
        <div style={{ marginTop: 4, padding: 8, background: '#fafafa', borderRadius: 4, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflow: 'auto' }}>
          {String(value)}
        </div>
      </div>
    );
  }
  if (key === 'createdAt' || key === 'updatedAt') {
    const d = value ? new Date(String(value)).toLocaleString('zh-CN') : '-';
    return (
      <div key={key}>
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>{label}</Text>
        <div style={{ marginTop: 2, fontSize: 13 }}>{d}</div>
      </div>
    );
  }
  if (value === null || value === undefined) {
    return (
      <div key={key}>
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>{label}</Text>
        <div style={{ marginTop: 2, fontSize: 13, color: '#8c8c8c' }}>-</div>
      </div>
    );
  }
  return (
    <div key={key}>
      <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>{label}</Text>
      <div style={{ marginTop: 2, fontSize: 13 }}>{String(value)}</div>
    </div>
  );
}

export default function MetadataDetailModal({ record, onClose }: MetadataDetailModalProps) {
  if (!record) return null;

  const fields: React.ReactNode[] = [];
  const entries = Object.entries(record);
  for (const [key, value] of entries) {
    if (key === 'params') continue;
    const node = renderField(key, value);
    if (node !== null) fields.push(node);
  }

  const params = record.params as Record<string, unknown> | undefined;

  return (
    <Modal
      title={`${KIND_LABELS[String(record.kind)] || String(record.kind) || ''} 生成详情 — ${String(record.model) || ''}`}
      open={!!record}
      onCancel={onClose}
      footer={null}
      width={640}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {fields}

        {params && Object.keys(params).length > 0 && (
          <div>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>完整请求参数</Text>
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflow: 'auto' }}>
              {Object.entries(params).map(([k, v]) => (
                <div key={k} style={{ padding: '4px 8px', background: '#fafafa', borderRadius: 4, fontSize: 12, fontFamily: "'SF Mono', 'Menlo', 'Consolas', monospace", lineHeight: 1.6 }}>
                  <span style={{ color: '#1677ff' }}>{JSON.stringify(k)}</span>: <span>{renderParamValue(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {String(record.status) === 'failed' && !!record.errorMessage && (
          <div>
            <Text type="danger" style={{ fontSize: 12, fontWeight: 500 }}>错误信息</Text>
            <div style={{ marginTop: 4, padding: 8, background: '#fff2f0', borderRadius: 4, border: '1px solid #ffccc7', fontSize: 12, color: '#cf1322', lineHeight: 1.6 }}>
              {String(record.errorMessage)}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
