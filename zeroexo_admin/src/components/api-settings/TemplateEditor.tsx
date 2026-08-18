/**
 * TemplateEditor - 可复用的模板编辑弹窗
 *
 * 聚合页布局（非 Tab）：
 *   - 顶部：下载 JSON 按钮 + 上传 JSON 按钮
 *   - 中部：代码编辑框（预设内容自动填充）
 *   - 底部：取消 + 应用按钮
 *
 * 两种模式：
 *   - brand: 品牌级配置（baseUrl/apiFormat/capabilities）
 *   - parameter: 参数模板（parameters/prompt 等）
 */
import { useState } from 'react';
import { Modal, Button, Input, message, Space } from 'antd';

export interface TemplateEditorProps {
  open: boolean;
  onClose: () => void;
  onApply: (json: Record<string, any>) => void;
  /** 预设 JSON 字符串（默认填充到输入框） */
  presetJson?: string;
  /** 弹窗标题 */
  title?: string;
  /** Json 示例格式 */
  exampleJson?: Record<string, any>;
}

export default function TemplateEditor({
  open,
  onClose,
  onApply,
  presetJson = '',
  title = '模板管理',
  exampleJson,
}: TemplateEditorProps) {
  const [jsonText, setJsonText] = useState(presetJson);

  // 当外部 presetJson 变化时同步（如切换模板时）
  // 注意：只在 modal 打开时同步一次
  const [lastPreset, setLastPreset] = useState(presetJson);
  if (open && presetJson !== lastPreset) {
    setLastPreset(presetJson);
    setJsonText(presetJson);
  }

  /** 下载当前 JSON 为 .json 文件 */
  const handleDownload = () => {
    try {
      // 尝试格式化，如果 JSON 无效则下载原始文本
      let content = jsonText.trim();
      if (content) {
        try {
          const parsed = JSON.parse(content);
          content = JSON.stringify(parsed, null, 2);
        } catch {
          // 不格式化
        }
      }
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'template.json';
      a.click();
      URL.revokeObjectURL(url);
      message.success('模板已下载');
    } catch {
      message.error('下载失败');
    }
  };

  /** 上传 JSON 文件，读取内容到编辑框 */
  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setJsonText(text);
        message.success('JSON 文件已加载');
      };
      reader.onerror = () => message.error('文件读取失败');
      reader.readAsText(file);
    };
    input.click();
  };

  /** 应用模板 */
  const handleApply = () => {
    const trimmed = jsonText.trim();
    if (!trimmed) {
      message.warning('请先输入或上传 JSON 内容');
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object') throw new Error('无效 JSON');
      onApply(parsed);
      onClose();
    } catch {
      message.error('JSON 解析失败，请检查格式');
    }
  };

  const handleCancel = () => {
    setJsonText('');
    onClose();
  };

  return (
    <Modal
      title={title}
      open={open}
      centered
      onCancel={handleCancel}
      footer={
        <Space>
          <Button onClick={handleCancel}>取消</Button>
          <Button type="primary" onClick={handleApply}>
            应用
          </Button>
        </Space>
      }
      width={700}
    >
      {/* ── 顶部：下载 + 上传 ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Button size="small" onClick={handleDownload}>
          下载 JSON
        </Button>
        <Button size="small" onClick={handleUpload}>
          上传 JSON
        </Button>
      </div>

      {/* ── 中部：代码编辑框 ── */}
      <Input.TextArea
        rows={14}
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
        placeholder="在此粘贴或编辑模板 JSON..."
        style={{ fontFamily: 'monospace', fontSize: 12 }}
      />

      {/* ── 示例格式（默认折叠） ── */}
      {exampleJson && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#1890ff', userSelect: 'none' }}>
            查看示例格式
          </summary>
          <pre
            style={{
              background: '#f6f8fa',
              border: '1px solid #e8e8e8',
              borderRadius: 4,
              padding: 10,
              fontSize: 11,
              lineHeight: 1.5,
              overflow: 'auto',
              maxHeight: 180,
              marginTop: 6,
            }}
          >
            <code>{JSON.stringify(exampleJson, null, 2)}</code>
          </pre>
        </details>
      )}
    </Modal>
  );
}
