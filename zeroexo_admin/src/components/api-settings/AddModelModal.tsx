/**
 * AddModelModal - 手动添加模型弹窗
 *
 * 当服务商的 /models 端点不可用、自动获取模型列表失败时，
 * 用于手动录入模型 ID（多行 / 逗号分隔）并选择模型类型后加入列表。
 *
 * 输入值由本组件内部持有，每次打开时重置。
 */
import { useEffect, useState } from 'react';
import { Modal, Button, Input, Select } from 'antd';
import { MODEL_TYPE_LABELS } from './ai-brand-constants';

export interface AddModelModalProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 确认添加回调（模型 ID 列表 + 类型） */
  onConfirm: (ids: string[], type: string) => void;
}

const MODEL_TYPE_OPTIONS = Object.entries(MODEL_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export default function AddModelModal({
  open,
  onClose,
  onConfirm,
}: AddModelModalProps) {
  const [text, setText] = useState('');
  const [type, setType] = useState('unclassified');

  // 每次打开时重置输入
  useEffect(() => {
    if (open) {
      setText('');
      setType('unclassified');
    }
  }, [open]);

  const handleOk = () => {
    const ids = text
      .split(/[\n,，;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
    onConfirm(ids, type);
  };

  return (
    <Modal
      title="添加模型"
      open={open}
      onCancel={onClose}
      centered
      width={520}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="confirm" type="primary" onClick={handleOk}>
          添加
        </Button>,
      ]}
    >
      <div style={{ marginBottom: 8, fontSize: 12, color: '#8c8c8c' }}>
        服务商模型列表接口不可用时，可手动录入模型 ID 完成配置
      </div>
      <Input.TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'每行输入一个模型 ID，或用英文逗号分隔\n例如：gpt-4o\nclaude-3-5-sonnet'}
        autoSize={{ minRows: 4, maxRows: 8 }}
        style={{ fontFamily: 'monospace' }}
      />
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#595959', fontSize: 13 }}>模型类型</span>
        <Select
          value={type}
          onChange={setType}
          style={{ width: 140 }}
          options={MODEL_TYPE_OPTIONS}
        />
      </div>
    </Modal>
  );
}