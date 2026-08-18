/**
 * ProviderDetailForm - 通用 provider 编辑/创建详情表单
 *
 * 使用 subView 模式,从卡片列表点击进入:
 * - 顶部面包屑导航
 * - 服务商品牌头部 + 配置字段 + 凭证字段
 * - 底部"保存"按钮
 * - 调用 POST 新建 / PATCH 更新
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card, Form, Input, Row, Col, Button, Select, Switch,
  message, Space, Tag, Alert,
} from 'antd';
import { Save, CheckCircle, XCircle, Play } from 'lucide-react';
import { apiPost, apiPatch, apiDelete, showApiError } from '@/services/api-client';
import DetailBreadcrumb from './DetailBreadcrumb';

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'number' | 'select' | 'switch' | 'textarea';
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  description?: string;
  sensitive?: boolean;
}

interface ProviderDetailFormProps {
  title: string;
  preset: {
    label: string;
    provider: string;
    type: string;
    defaultConfig?: Record<string, any>;
    /** 可选: bootstrap-icons CSS class,用于头部图标渲染 */
    icon?: string;
    /** 可选: 配置帮助文档链接 */
    docUrl?: string;
  };
  configFields: FieldDef[];
  credentialsFields: FieldDef[];
  providerOptions?: { value: string; label: string }[];
  existingRecord?: any;
  onBack: () => void;
  onSave?: () => void;
  /** 配置区块标题,默认"公开配置" */
  configSectionTitle?: string;
}

export default function ProviderDetailForm({
  title,
  preset,
  configFields,
  credentialsFields,
  providerOptions,
  existingRecord,
  onBack,
  onSave,
  configSectionTitle,
}: ProviderDetailFormProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 从 title 或 preset.label 提取详情名称
  const detailName = title?.replace('配置 ', '') || preset.label;

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const config: Record<string, any> = {};
      const extraCredentials: Record<string, any> = {};
      for (const field of configFields) {
        if (values[field.key] !== undefined && values[field.key] !== '') {
          if (field.sensitive) {
            const v = values[field.key];
            if (v && String(v) !== '已配置 (加密存储)') {
              extraCredentials[field.key] = v;
            }
          } else {
            config[field.key] = values[field.key];
          }
        }
      }

      const credentials: Record<string, any> = { ...extraCredentials };
      for (const field of credentialsFields) {
        const v = values[field.key];
        if (v && String(v) !== '已配置 (加密存储)') {
          credentials[field.key] = v;
        }
      }

      const dto: Record<string, any> = {
        name: values.name || preset.label,
        provider: preset.provider,
        type: preset.type,
        config,
        enabled: existingRecord?.enabled ?? true,
        isDefault: existingRecord?.isDefault ?? false,
        capabilities: values.capabilities || [],
      };
      if (Object.keys(credentials).length > 0) {
        dto.credentials = credentials;
      }

      if (existingRecord) {
        await apiPatch(`/admin/api-providers/${existingRecord.id}`, dto);
        message.success(t('api.configSaved'));
      } else {
        await apiPost('/admin/api-providers', dto);
        message.success(t('api.configCreated'));
      }

      if (onSave) onSave();
    } catch (err) {
      showApiError(err, t('error.save'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async () => {
    try {
      setTestResult(null);
      // 对于已有 ID 的记录，直接测试
      if (existingRecord?.id) {
        setTesting(true);
        const result = await apiPost<any>(`/admin/api-providers/${existingRecord.id}/test`);
        setTestResult({
          ok: result.ok,
          message: result.ok
            ? t('api.connectionOk', { latency: result.latencyMs || 0 })
            : (result.error || t('api.connectionFailed')),
        });
        return;
      }

      // 新记录：先保存，再用返回的 ID 测试
      const values = await form.validateFields();
      setTesting(true);

      const config: Record<string, any> = {};
      for (const field of configFields) {
        if (values[field.key] !== undefined && values[field.key] !== '') {
          config[field.key] = values[field.key];
        }
      }
      const credentials: Record<string, any> = {};
      for (const field of configFields) {
        if (field.sensitive) {
          const v = values[field.key];
          if (v && String(v) !== '已配置 (加密存储)') {
            credentials[field.key] = v;
          }
        }
      }
      for (const field of credentialsFields) {
        const v = values[field.key];
        if (v && String(v) !== '已配置 (加密存储)') {
          credentials[field.key] = v;
        }
      }

      const tempDto: Record<string, any> = {
        name: values.name || preset.label,
        provider: preset.provider,
        type: preset.type,
        config,
        enabled: false,
        isDefault: false,
        capabilities: [],
      };
      if (Object.keys(credentials).length > 0) {
        tempDto.credentials = credentials;
      }
      const saved = await apiPost<{ id: string }>('/admin/api-providers', tempDto);

      let result: { ok: boolean; error?: string; latencyMs?: number };
      try {
        result = await apiPost<any>(`/admin/api-providers/${saved.id}/test`);
      } finally {
        // 测试结束立即删除临时创建记录，正式落库由用户点击"保存"完成，避免残留脏数据
        await apiDelete(`/admin/api-providers/${saved.id}`).catch(() => {});
      }
      setTestResult({
        ok: result.ok,
        message: result.ok
          ? t('api.connectionOk', { latency: result.latencyMs || 0 })
          : (result.error || t('api.connectionFailed')),
      });
    } catch (err) {
      showApiError(err, t('api.testFailed'));
      setTestResult({ ok: false, message: t('api.testFailedHint') });
    } finally {
      setTesting(false);
    }
  };

  const isEditing = !!existingRecord;

  return (
    <>
      <DetailBreadcrumb
        onBack={onBack}
        detailName={detailName}
      />
      <Card styles={{ body: { paddingTop: 8 } }}>
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          enabled: existingRecord?.enabled ?? true,
          isDefault: existingRecord?.isDefault ?? false,
          name: existingRecord?.name || '',
          ...(existingRecord?.config || {}),
          ...(existingRecord
            ? Object.fromEntries(
                [
                  ...configFields.filter((f) => f.sensitive),
                  ...credentialsFields,
                ].map((f) => [
                  f.key,
                  existingRecord.credentials?.[f.key] === '[encrypted]'
                    ? '已配置 (加密存储)'
                    : '',
                ]),
              )
            : {}),
        }}
      >
        {/* 服务商标识 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            marginBottom: 24,
            background: '#f7f9fc',
            borderRadius: 6,
            border: '1px solid #e8edf5',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              background: '#1677ff15',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              color: '#1677ff',
            }}
          >
            {preset.icon ? (
              <i className={preset.icon} />
            ) : (
              preset.label.charAt(0).toUpperCase()
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#262626', display: 'flex', alignItems: 'center', gap: 8 }}>
              {preset.label}
              {preset.docUrl && (
                <Button
                  type="link"
                  size="small"
                  icon={<i className="bi bi-question-circle" style={{ fontSize: 14 }} />}
                  href={preset.docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ padding: 0, fontSize: 12, color: '#1677ff' }}
                >
                  {t('api.configHelp')}
                </Button>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 1 }}>
              {existingRecord ? t('api.editConfig') : t('api.createConfig')}
              {existingRecord?.enabled && (
                <Tag color="green" style={{ marginLeft: 8, fontSize: 11 }}>
                  <CheckCircle size={10} style={{ marginRight: 2, verticalAlign: -1 }} /> {t('api.enabled')}
                </Tag>
              )}
            </div>
          </div>
        </div>

        {/* 基本信息 */}
        <div
          style={{
            background: '#fafafa',
            borderRadius: 6,
            padding: '12px 16px 4px',
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 500, color: '#595959', marginBottom: 8 }}>
              {t('api.basicInfo')}
            </div>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="name"
                  label={t('api.brandName')}
                  rules={[{ required: true, message: t('api.enterBrandName') }]}
                >
                  <Input placeholder={`如: ${preset.label} 生产`} maxLength={64} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="provider" label={t('api.apiFormat')}>
                  {providerOptions ? (
                    <Select
                      placeholder={t('api.selectPresetIcon')}
                      options={providerOptions}
                      disabled={isEditing}
                      value={preset.provider}
                    />
                  ) : (
                    <Input value={preset.label} disabled />
                  )}
                </Form.Item>
              </Col>
            </Row>
        </div>

        {/* 配置字段 */}
        {configFields.length > 0 && (
          <div
            style={{
              background: '#fafafa',
              borderRadius: 6,
              padding: '12px 16px 4px',
              marginBottom: 20,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: '#595959', marginBottom: 8 }}>
              {t(configSectionTitle || 'api.publicConfig')}
            </div>
            <Row gutter={16}>
              {configFields.map((field) => (
                <Col
                  span={field.type === 'textarea' ? 24 : 12}
                  key={field.key}
                >
                  <Form.Item
                    name={field.key}
                    label={t(field.label)}
                    rules={
                      field.required && !(field.sensitive && isEditing)
                        ? [{ required: true, message: `${t('api.pleaseEnter')} ${t(field.label)}` }]
                        : []
                    }
                    tooltip={field.description ? t(field.description) : undefined}
                    valuePropName={
                      field.type === 'switch' ? 'checked' : 'value'
                    }
                  >
                    {field.type === 'select' ? (
                      <Select
                        placeholder={field.placeholder ? t(field.placeholder) : undefined}
                        options={field.options?.map((opt) => ({ ...opt, label: t(opt.label) })) || []}
                      />
                    ) : field.type === 'switch' ? (
                      <Switch />
                    ) : field.type === 'number' ? (
                      <Input type="number" placeholder={field.placeholder ? t(field.placeholder) : undefined} />
                    ) : field.type === 'password' ? (
                      <Input.Password placeholder={field.placeholder ? t(field.placeholder) : undefined} />
                    ) : field.type === 'textarea' ? (
                      <Input.TextArea
                        placeholder={field.placeholder ? t(field.placeholder) : undefined}
                        rows={3}
                      />
                    ) : (
                      <Input placeholder={field.placeholder ? t(field.placeholder) : undefined} />
                    )}
                  </Form.Item>
                </Col>
              ))}
            </Row>
          </div>
        )}

        {/* 凭证字段 */}
        {credentialsFields.length > 0 && (
          <div
            style={{
              background: '#fff7e6',
              borderRadius: 6,
              padding: '12px 16px 4px',
              marginBottom: 20,
              border: '1px solid #ffe7ba',
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: '#d48806',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>{t('api.credentials')}</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: '#8c8c8c' }}>
                {t('api.encrypted')}
              </span>
            </div>
            <Row gutter={16}>
              {credentialsFields.map((field) => (
                <Col span={12} key={field.key}>
                  <Form.Item
                    name={field.key}
                    label={t(field.label)}
                    tooltip={field.description ? t(field.description) : undefined}
                    rules={
                      field.required && !isEditing
                        ? [{ required: true, message: `${t('api.pleaseEnter')} ${t(field.label)}` }]
                        : []
                    }
                  >
                    <Input.Password placeholder={field.placeholder ? t(field.placeholder) : undefined} />
                  </Form.Item>
                </Col>
              ))}
            </Row>
          </div>
        )}

        {/* 测试结果 */}
        {testResult && (
          <Alert
            type={testResult.ok ? 'success' : 'error'}
            showIcon
            icon={testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
            title={testResult.message}
            style={{ marginBottom: 16, borderRadius: 4 }}
            closable
            onClose={() => setTestResult(null)}
          />
        )}

        {/* 提交 */}
        <div
          style={{
            borderTop: '1px solid #f0f0f0',
            paddingTop: 16,
            marginTop: 8,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <Space>
            <Button onClick={onBack} disabled={submitting || testing}>
              {t('common.cancel')}
            </Button>
            <Button
              icon={<Play size={14} />}
              onClick={handleTest}
              loading={testing}
              disabled={submitting}
            >
              {t('api.testConnection')}
            </Button>
            <Button
              type="primary"
              icon={<Save size={14} />}
              onClick={handleSubmit}
              loading={submitting}
            >
              {t('common.save')}
            </Button>
          </Space>
        </div>
      </Form>
    </Card>
    </>
  );
}
