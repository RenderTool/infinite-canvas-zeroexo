/**
 * SwitchWizard - driver 切换向导
 *
 * 三步流程:
 *   步骤 0 - 配置:填写 driver 表单参数
 *   步骤 1 - 测试:发起连接测试,展示成功/失败结果与延迟
 *   步骤 2 - 确认:输入登录密码(二次确认)后执行切换
 *
 * 测试通过后才允许进入确认步骤;切换进行中显示圆形进度条。
 * 保留原 React.createElement(meta.icon, ...) 形式的动态图标渲染。
 */
import React, { useState, useEffect } from 'react';
import {
  Modal, Steps, Result, message, Empty, Progress, Form, Input, Switch,
  Space, Alert, Row, Col, Button, Spin, Tag, Card,
} from 'antd';
import { CheckOutlined, ReloadOutlined, ArrowRightOutlined, SafetyOutlined, SettingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { DRIVER_META, SecretInput } from './driver-meta';
import type { DriverName, StorageConfig } from './types';

export default function SwitchWizard({
  visible,
  onClose,
  driver,
  meta,
  currentConfig,
  onTest,
  onSwitch,
  testing,
  switching,
  testResult,
  onClearTestResult,
}: {
  visible: boolean;
  onClose: () => void;
  driver: DriverName;
  meta: typeof DRIVER_META[DriverName];
  currentConfig: StorageConfig;
  onTest: (driver: DriverName, options: Record<string, any>) => Promise<void>;
  onSwitch: (newConfig: StorageConfig, password: string) => Promise<void>;
  testing: boolean;
  switching: boolean;
  testResult: { ok: boolean; message: string; latency?: number } | null;
  onClearTestResult: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [form] = Form.useForm();
  const [options, setOptions] = useState<Record<string, any>>(meta.defaultOptions as any);
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (visible) {
      setStep(0);
      onClearTestResult();
      // 用当前 driver 的配置预填(若是当前 driver)
      if (currentConfig.primary.driver === driver) {
        setOptions({ ...meta.defaultOptions, ...currentConfig.primary.options });
        form.setFieldsValue({ ...meta.defaultOptions, ...currentConfig.primary.options });
      } else {
        setOptions({ ...meta.defaultOptions });
        form.setFieldsValue(meta.defaultOptions);
      }
      setPassword('');
    }
  }, [visible, driver, meta, form, currentConfig]);

  const handleTest = async () => {
    try {
      const values = await form.validateFields();
      setOptions(values);
      await onTest(driver, values);
    } catch {
      // 校验失败
    }
  };

  const handleConfirm = async () => {
    if (!password) {
      message.error(t('storage.enterPassword'));
      return;
    }
    const newConfig: StorageConfig = {
      primary: { driver, options },
      secondary: currentConfig.primary.driver !== driver ? currentConfig.primary : undefined,
      presignExpiry: currentConfig.presignExpiry || 3600,
    };
    await onSwitch(newConfig, password);
  };

  const isCurrent = currentConfig.primary.driver === driver;

  return (
    <Modal
      title={
        <Space>
          {React.createElement(meta.icon, { size: 16 })}
          <span>{isCurrent ? t('storage.view') : t('storage.switchTo')} {t(meta.label)}</span>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      width={720}
      footer={null}
      destroyOnHidden
    >
      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          { title: t('storage.stepConfig'), icon: <SettingOutlined style={{ fontSize: 14 }} /> },
          { title: t('storage.stepTest'), icon: <CheckOutlined style={{ fontSize: 14 }} /> },
          { title: t('storage.stepConfirm'), icon: <SafetyOutlined style={{ fontSize: 14 }} /> },
        ]}
      />

      {/* 步骤 0: 配置 */}
      {step === 0 && (
        <Form form={form} layout="vertical" initialValues={options}>
          <Alert
            type="info"
            showIcon
            title={t('storage.configHint')}
            style={{ marginBottom: 16, borderRadius: 4 }}
          />
          <Row gutter={16}>
            {meta.fields.map((field) => (
              <Col xs={24} md={12} key={field.key}>
                <Form.Item
                  name={field.key}
                  label={t(field.label)}
                  rules={(field as any).required ? [{ required: true, message: `${t('storage.pleaseEnter')} ${t(field.label)}` }] : []}
                >
                  <SecretInput
                    secret={(field as any).secret}
                    placeholder={field.placeholder}
                  />
                </Form.Item>
              </Col>
            ))}
          </Row>
          {driver === 's3' && (
            <Form.Item name="forcePathStyle" label="Path Style" valuePropName="checked">
              <Switch checkedChildren={t('storage.enabled')} unCheckedChildren={t('storage.disabled')} />
            </Form.Item>
          )}
          {driver === 'oss' && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="internal" label={t('storage.intranetEndpoint')} valuePropName="checked">
                  <Switch checkedChildren={t('storage.intranet')} unCheckedChildren={t('storage.extranet')} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="secure" label="HTTPS" valuePropName="checked">
                  <Switch checkedChildren="HTTPS" unCheckedChildren="HTTP" />
                </Form.Item>
              </Col>
            </Row>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Space>
              <Button
                type="primary"
                onClick={handleTest}
                loading={testing}
                icon={<CheckOutlined style={{ fontSize: 14 }} />}
              >
                {t('storage.testConnection')}
              </Button>
              <Button
                type="primary"
                ghost
                onClick={() => {
                  form.validateFields().then((values) => {
                    setOptions(values);
                    setStep(1);
                  });
                }}
              >
                {t('storage.next')} <ArrowRightOutlined style={{ fontSize: 14, marginLeft: 4 }} />
              </Button>
            </Space>
          </div>
        </Form>
      )}

      {/* 步骤 1: 测试连接 */}
      {step === 1 && (
        <div>
          {testing ? (
            <Card>
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin size="large" />
                <div style={{ marginTop: 16, color: '#8c8c8c' }}>{t('storage.testing')}</div>
              </div>
            </Card>
          ) : testResult ? (
            <Result
              status={testResult.ok ? 'success' : 'error'}
              title={testResult.ok ? t('storage.connectionSuccess') : t('storage.connectionFail')}
              subTitle={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>{testResult.message}</span>
                  {testResult.latency != null && (
                    <span style={{ color: '#8c8c8c' }}>{t('storage.latency', { latency: testResult.latency })}</span>
                  )}
                </div>
              }
              extra={
                <Space>
                  <Button onClick={() => setStep(0)}>{t('storage.backToConfig')}</Button>
                  <Button type="primary" onClick={handleTest} icon={<ReloadOutlined style={{ fontSize: 14 }} />}>
                    {t('storage.reTest')}
                  </Button>
                  <Button
                    type="primary"
                    disabled={!testResult.ok}
                    onClick={() => setStep(2)}
                  >
                    {t('storage.next')} <ArrowRightOutlined style={{ fontSize: 14, marginLeft: 4 }} />
                  </Button>
                </Space>
              }
            />
          ) : (
            <Empty description={t('storage.pleaseTest')} />
          )}
        </div>
      )}

      {/* 步骤 2: 确认切换(二次密码) */}
      {step === 2 && (
        <div>
          <Alert
            type="warning"
            showIcon
            title={t('storage.sensitiveConfirm')}
            description={
              <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                <li>{t('storage.switchImmediately')}</li>
                <li>{t('storage.secondaryDriverHint')}</li>
                <li>{t('storage.noAutoMigrate')}</li>
                {!isCurrent && (
                  <li style={{ color: '#ff4d4f' }}>
                    {t('storage.migrateOldFiles', { driver: t(DRIVER_META[currentConfig.primary.driver as DriverName]?.label) || currentConfig.primary.driver })}
                  </li>
                )}
              </ul>
            }
            style={{ marginBottom: 16, borderRadius: 4 }}
          />

          <Card size="small" style={{ marginBottom: 16, borderRadius: 4, background: '#fafafa' }}>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>{t('storage.postSwitchConfig')}</div>
            <Row gutter={8}>
              <Col span={6}>
                <div style={{ fontSize: 12 }}>{t('storage.primaryDriver')}</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{t(meta.label)}</div>
              </Col>
              <Col span={6}>
                <div style={{ fontSize: 12 }}>{t('storage.secondaryDriver')}</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {!isCurrent ? (
                    <Tag color="orange">
                      {t(DRIVER_META[currentConfig.primary.driver as DriverName]?.label) || currentConfig.primary.driver}
                    </Tag>
                  ) : t('common.none')}
                </div>
              </Col>
              <Col span={6}>
                <div style={{ fontSize: 12 }}>Region</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{(options as any).region || 'N/A'}</div>
              </Col>
              <Col span={6}>
                <div style={{ fontSize: 12 }}>Bucket</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{(options as any).bucket || 'N/A'}</div>
              </Col>
            </Row>
          </Card>

          <Form layout="vertical">
            <Form.Item label={t('storage.enterPasswordConfirm')} required>
              <Input.Password
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('storage.loginPassword')}
                prefix={<SafetyOutlined style={{ fontSize: 14 }} />}
              />
            </Form.Item>
          </Form>

          {switching && (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <Progress
                type="circle"
                percent={75}
                status="active"
                format={() => t('storage.switching')}
              />
              <div style={{ marginTop: 12, color: '#8c8c8c' }}>{t('storage.switchingHint')}</div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            <Button onClick={() => setStep(1)} disabled={switching}>{t('common.back')}</Button>
            <Button
              type="primary"
              danger={!isCurrent}
              loading={switching}
              disabled={!password || switching}
              onClick={handleConfirm}
              icon={<SafetyOutlined style={{ fontSize: 14 }} />}
            >
              {isCurrent ? t('common.save') : t('storage.confirmSwitch')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
