/**
 * IconSelectModal - 模型品牌图标选择弹窗
 *
 * 用于为单个模型指定品牌图标，便于在模型列表中区分不同品牌的模型。
 * 选择 "default" 即恢复为默认品牌图标（清除自定义配置）。
 *
 * 该组件为纯展示 + 回调型组件，图标数据来自 brand-icons 中的 BRAND_ICONS。
 */
import { Modal, Button } from 'antd';
import { BRAND_ICONS } from './brand-icons';

export interface IconSelectModalProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 当前操作的模型 ID */
  modelId: string | null;
  /** 当前模型已配置的图标 key（用于高亮选中项） */
  currentIcon: string;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 选择图标回调（key === 'default' 表示恢复默认，清除自定义配置） */
  onSelect: (key: string) => void;
  /** 恢复默认回调（清除自定义图标配置） */
  onReset: () => void;
}

export default function IconSelectModal({
  open,
  modelId,
  currentIcon,
  onClose,
  onSelect,
  onReset,
}: IconSelectModalProps) {
  return (
    <Modal
      title="选择品牌图标"
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="reset" onClick={onReset}>
          恢复默认
        </Button>,
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
      ]}
      width={520}
    >
      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 12 }}>
        选择该模型的品牌图标，用于在模型列表中区分不同品牌的模型。
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 12,
        }}
      >
        {Object.entries(BRAND_ICONS).map(([key, IconComp]) => {
          const selected = !!modelId && currentIcon === key;
          return (
            <div
              key={key}
              onClick={() => onSelect(key)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: '12px 8px',
                borderRadius: 8,
                border: selected ? '2px solid #1890ff' : '1px solid #f0f0f0',
                background: selected ? '#e6f4ff' : '#fff',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconComp size={32} />
              </div>
              <span style={{ fontSize: 11, color: selected ? '#1890ff' : '#595959' }}>
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </span>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
