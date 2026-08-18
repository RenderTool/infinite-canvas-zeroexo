/**
 * TemplateSelector - 参数模板选择器
 *
 * 在模型归类弹窗中使用，用于为非 LLM 且非未分类的模型选择一个参数模板。
 * 包含：标题、推荐模板提示、模板下拉选择、温馨提示。
 *
 * 该组件为纯展示 + 回调型组件，所有数据由父组件 ClassifyModal 通过 props 传入。
 */
import { Select, Alert } from 'antd';

export interface TemplateSelectorProps {
  /** 当前选中的参数模板 ID */
  classifyTemplateId: string;
  /** 当前类型下可用的参数模板列表 */
  templateList: any[];
  /** 推荐模板（单个模型时由后端推荐） */
  recommendedTemplate: any;
  /** 选择参数模板回调 */
  onSelectTemplate: (templateId: string) => void;
}

export default function TemplateSelector({
  classifyTemplateId,
  templateList,
  recommendedTemplate,
  onSelectTemplate,
}: TemplateSelectorProps) {
  // 无可用模板时不渲染
  if (templateList.length === 0) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
        选择参数模板
        <span style={{ fontSize: 11, color: '#8c8c8c', fontWeight: 400, marginLeft: 8 }}>
          （可选，归类后可在参数配置中微调）
        </span>
      </div>
      {recommendedTemplate && (
        <Alert
          title={`推荐模板：${recommendedTemplate.name}`}
          type="info"
          showIcon
          style={{ marginBottom: 12, fontSize: 12 }}
        />
      )}
      <Select
        value={classifyTemplateId}
        onChange={onSelectTemplate}
        style={{ width: '100%' }}
        placeholder="请选择参数模板"
        allowClear
        options={templateList.map((t) => ({
          value: t.id,
          label: `${t.name}${t.level === 'family' ? '（模型族）' : t.level === 'protocol' ? '（协议标准）' : ''}`,
        }))}
      />
      <Alert
        title={
          <div style={{ fontSize: 12 }}>
            <b>温馨提示：</b>
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              <li>不同模型的参数和能力可能有差异</li>
              <li>建议优先使用推荐模板，再根据文档微调</li>
              <li>参数配置错误可能导致生成失败或效果异常</li>
            </ul>
          </div>
        }
        type="warning"
        showIcon
        style={{ marginTop: 12 }}
      />
    </div>
  );
}
