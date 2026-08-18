/**
 * ClassifyModal - 模型归类弹窗
 *
 * 用于将一个或多个模型归类到指定类型（语言 / 图像 / 视频 / 音频 / 未分类）。
 * 非 LLM 且非未分类时，可附加选择一个参数模板（可选）。
 *
 * 该组件为纯展示 + 回调型组件，所有数据与状态由父组件 AiBrandDetail 持有。
 */
import { Modal, Button, Tabs, Tooltip } from 'antd';
import {
  MessageOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import TemplateSelector from './TemplateSelector';

export interface ClassifyModalProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 待归类的模型 ID 列表 */
  classifyModelIds: string[];
  /** 当前选中的归类类型 */
  selectedClassifyType: string;
  /** 当前选中的参数模板 ID */
  classifyTemplateId: string;
  /** 当前类型下可用的参数模板列表 */
  templateList: any[];
  /** 推荐模板（单个模型时由后端推荐） */
  recommendedTemplate: any;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 选择归类类型回调（同时会清空模板选择） */
  onSelectType: (type: string) => void;
  /** 选择参数模板回调 */
  onSelectTemplate: (templateId: string) => void;
  /** 确认归类回调 */
  onConfirm: () => void;
  /** 自动匹配回调（批量归类时可用） */
  onAutoMatch?: () => Promise<void>;
}

export default function ClassifyModal({
  open,
  classifyModelIds,
  selectedClassifyType,
  classifyTemplateId,
  templateList,
  recommendedTemplate,
  onClose,
  onSelectType,
  onSelectTemplate,
  onConfirm,
  onAutoMatch,
}: ClassifyModalProps) {
  return (
    <Modal
      title="归类模型"
      open={open}
      onCancel={onClose}
      width={520}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        classifyModelIds.length > 1 && onAutoMatch && (
          <Tooltip key="autoMatch" title="根据模型名称尝试自动猜测类型">
            <Button
              onClick={onAutoMatch}
              style={{ marginRight: 8 }}
            >
              自动匹配
            </Button>
          </Tooltip>
        ),
        <Button
          key="confirm"
          type="primary"
          onClick={onConfirm}
          disabled={!selectedClassifyType}
        >
          确认归类
        </Button>,
      ]}
    >
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: '#595959' }}>
          将 <b>{classifyModelIds.length}</b> 个模型归类到：
        </span>
      </div>
      <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, padding: 4, marginBottom: 16 }}>
        <Tabs
          activeKey={selectedClassifyType || undefined}
          onChange={(val) => {
            onSelectType(val);
          }}
          size="small"
          tabBarGutter={0}
          style={{ margin: 0 }}
          items={[
            {
              key: 'llm',
              label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}><MessageOutlined style={{ fontSize: 14 }} />语言</span>,
            },
            {
              key: 'image',
              label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}><PictureOutlined style={{ fontSize: 14 }} />图像</span>,
            },
            {
              key: 'video',
              label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}><VideoCameraOutlined style={{ fontSize: 14 }} />视频</span>,
            },
            {
              key: 'audio',
              label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}><AudioOutlined style={{ fontSize: 14 }} />音频</span>,
            },
            {
              key: 'unclassified',
              label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}><QuestionCircleOutlined style={{ fontSize: 14 }} />未分类</span>,
            },
          ]}
        />
      </div>

      {/* 模板选择（非 LLM 且非未分类时显示） */}
      {selectedClassifyType && selectedClassifyType !== 'llm' && selectedClassifyType !== 'unclassified' && (
        <TemplateSelector
          classifyTemplateId={classifyTemplateId}
          templateList={templateList}
          recommendedTemplate={recommendedTemplate}
          onSelectTemplate={onSelectTemplate}
        />
      )}

      {/* 模型列表 */}
      {classifyModelIds.length <= 5 && classifyModelIds.length > 0 && (
        <div style={{ marginTop: 20, fontSize: 12, color: '#8c8c8c' }}>
          <div style={{ marginBottom: 4 }}>模型列表：</div>
          {classifyModelIds.map((id) => (
            <div key={id} style={{ fontFamily: 'monospace' }}>
              {id}
            </div>
          ))}
        </div>
      )}
      {classifyModelIds.length > 5 && (
        <div style={{ marginTop: 20, fontSize: 12, color: '#8c8c8c' }}>
          （共 {classifyModelIds.length} 个模型，仅显示前 5 个）
          {classifyModelIds.slice(0, 5).map((id) => (
            <div key={id} style={{ fontFamily: 'monospace' }}>
              {id}
            </div>
          ))}
          ...
        </div>
      )}
    </Modal>
  );
}
