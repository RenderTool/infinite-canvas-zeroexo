/**
 * CredentialsForm - AI 品牌详情页凭证配置表单
 *
 * 包含：
 *   - Form 表单容器（持有 initialValues、preserve 等行为）
 *   - "品牌信息" 卡片：品牌名称、API Key、Base URL、API 格式、品牌图标、能力标签
 *   - 卡片右上角"保存"按钮
 *   - 通过 children 接收模型列表区块（保持原 Form 包裹结构不变）
 *
 * 该组件为纯展示 + 回调型组件，表单实例由父组件 AiBrandDetail 通过 props 传入。
 */
import type { ReactNode } from 'react';
import { Card, Row, Col, Button, Input, Form, Select, Space } from 'antd';
import type { FormInstance } from 'antd';
import { BRAND_ICONS } from './brand-icons';

export interface CredentialsFormProps {
  /** 表单实例（由父组件通过 Form.useForm 创建） */
  form: FormInstance;
  /** 品牌预设信息 */
  brandPreset: {
    provider: string;
    label: string;
    official: boolean;
    apiFormat: string;
    defaultBaseUrl: string;
    capabilities: string[];
  };
  /** 已存在的渠道记录（用于回显初始值） */
  existingRecord?: {
    id: string;
    name: string;
    hasCredentials?: boolean;
    credentials?: { apiKey?: string };
    capabilities?: string[];
    config?: Record<string, any>;
  };
  /** 是否为预设品牌（预设品牌禁用名称编辑、隐藏图标/标签字段） */
  isPreset: boolean;
  /** 保存状态（用于控制保存按钮 loading） */
  saveStatus: 'saved' | 'saving' | 'dirty';
  /** 点击保存按钮回调 */
  onSave: () => void;
  /** 选择品牌图标时的回调（同步更新父组件的 logoProvider 与 logoUrl 状态；
   *  表单字段的同步由本组件内部处理） */
  onLogoProviderChange: (value: string) => void;
  /** 表单值变化回调（用于替代 Form.useWatch，避免 form 未连接时的 warning） */
  onFormChange?: (changedValues: Record<string, any>, allValues: Record<string, any>) => void;
  /** 子节点（通常是 ModelListSection，保持原 Form 包裹结构） */
  children?: ReactNode;
}

export default function CredentialsForm({
  form,
  brandPreset,
  existingRecord,
  isPreset,
  saveStatus,
  onSave,
  onLogoProviderChange,
  onFormChange,
  children,
}: CredentialsFormProps) {
  return (
    <Form
      form={form}
      layout="vertical"
      preserve={false}
      onValuesChange={onFormChange}
      initialValues={{
        name: existingRecord?.name || brandPreset.label,
        apiKey:
          existingRecord?.hasCredentials ||
          existingRecord?.credentials?.apiKey === '[encrypted]'
            ? '已配置 (加密存储)'
            : existingRecord?.config?.apiKey || '',
        baseUrl:
          existingRecord?.config?.baseUrl || brandPreset.defaultBaseUrl || '',
        apiFormat: existingRecord?.config?.apiFormat || brandPreset.apiFormat,
        logoProvider: existingRecord?.config?.logoProvider || '',
        logoUrl: existingRecord?.config?.logoUrl || '',
        // ★ 优先取顶级 capabilities，降级取 config 中的备份
        capabilities: existingRecord?.capabilities || existingRecord?.config?.capabilities || [],
        official: existingRecord?.config?.official ?? brandPreset.official,
      }}
    >
      {/* ─── 品牌信息卡片 ─── */}
      <Card
        title="品牌信息"
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Button type="primary" size="small" loading={saveStatus === 'saving'} onClick={onSave}>
            保存
          </Button>
        }
      >
        {/* ─── 品牌设置 ─── */}
        <Row gutter={16}>
          <Col xs={24} sm={8}>
            <Form.Item name="name" label="品牌名称">
              <Input placeholder="输入品牌名称" disabled={isPreset} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item
              name="apiKey"
              label="API Key"
              rules={
                !existingRecord
                  ? [{ required: true, message: '请输入 API Key' }]
                  : []
              }
            >
              <Input.Password
                placeholder={
                  existingRecord ? '留空则保持原有值' : '输入 API Key ...'
                }
                autoComplete="off"
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="baseUrl" label="Base URL">
              <Input placeholder="留空使用默认地址" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} sm={8}>
            <Form.Item name="apiFormat" label="API 格式">
              <Select
                options={[
                  { value: 'openai', label: 'OpenAI 兼容' },
                  { value: 'anthropic', label: 'Anthropic' },
                  { value: 'gemini', label: 'Google Gemini' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            {!isPreset && (
              <Form.Item name="logoProvider" label="品牌图标">
                <Select
                  placeholder="选择预设图标"
                  onChange={(value) => {
                    // 同步表单字段
                    form.setFieldValue('logoUrl', '');
                    form.setFieldValue('logoProvider', value);
                    // 通知父组件更新状态
                    onLogoProviderChange(value);
                  }}
                  options={Object.keys(BRAND_ICONS).map((key) => ({
                    value: key,
                    label: (
                      <Space size={4}>
                        {(() => {
                          const Icon = BRAND_ICONS[key];
                          return <Icon size={16} />;
                        })()}
                        <span>{key}</span>
                      </Space>
                    ),
                  }))}
                />
              </Form.Item>
            )}
          </Col>
          <Col xs={24} sm={8}>
            {!isPreset && (
              <Form.Item name="capabilities" label="标签" tooltip="选择该品牌支持的模型类型">
                <Select
                  mode="multiple"
                  placeholder="选择标签"
                  options={[
                    { value: 'llm', label: '语言' },
                    { value: 'image', label: '图像' },
                    { value: 'video', label: '视频' },
                    { value: 'audio', label: '音频' },
                  ]}
                />
              </Form.Item>
            )}
          </Col>
        </Row>
      </Card>

      {/* ─── 模型列表 Tabs → 始终显示 ─── */}
      <div style={{ marginTop: 16 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            marginBottom: 8,
            color: '#333',
          }}
        >
          模型列表
        </div>
        {children}
      </div>
    </Form>
  );
}
