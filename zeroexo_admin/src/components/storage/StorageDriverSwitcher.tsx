/**
 * StorageDriverSwitcher - 存储 driver 切换面板(主组件)
 *
 * 功能:
 * - 4 个 driver 卡片(local / MinIO-S3 / 阿里云 OSS / 腾讯云 COS)
 * - 每个 driver 独立配置表单(委托给 SwitchWizard)
 * - 测试连接按钮
 * - 切换向导(二次密码确认)
 * - 健康状态实时显示
 *
 * 遵循用户偏好:
 * - 二次密码确认(敏感操作)
 * - 切换时显示圆形进度条
 * - 配色与现有设置页面统一
 * - 全局图标使用 Lucide
 * - 文案规范(纯中文)
 * - 节点/卡片保持简洁,信息密度合理
 *
 * 子组件:
 * - DriverCard     单个 driver 卡片
 * - SwitchWizard   切换向导(配置 → 测试 → 确认)
 * - driver-meta    DRIVER_META 元数据 + SecretInput
 * - types          共享类型定义
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Tag, Button, Space, Alert,
  Modal, message, Spin, Divider,
} from 'antd';
import { CheckOutlined, AlertOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiGet, apiPost, showApiError } from '@/services/api-client';
import { useAuth } from '@/contexts/auth';
import { useTranslation } from 'react-i18next';
import { DRIVER_META } from './driver-meta';
import type { DriverName, StorageConfig, DriverHealth } from './types';
import DriverCard from './DriverCard';
import SwitchWizard from './SwitchWizard';

export default function StorageDriverSwitcher({ onViewLocalDetail }: { onViewLocalDetail?: () => void }) {
  useAuth();
  const { t } = useTranslation();
  const [config, setConfig] = useState<StorageConfig | null>(null);
  const [health, setHealth] = useState<DriverHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDriver, setSelectedDriver] = useState<DriverName | null>(null);
  const [wizardVisible, setWizardVisible] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latency?: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [switching, setSwitching] = useState(false);

  // 加载当前配置 + 健康状态
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, h] = await Promise.all([
        apiGet<{ storage?: StorageConfig }>('/admin/settings'),
        apiGet<{ health: DriverHealth[] }>('/admin/storage/health').catch(() => ({ health: [] })),
      ]);
      const storage = cfg.storage || {
        primary: { driver: 'local' as const, options: { root: 'storage' } },
        presignExpiry: 3600,
      };
      setConfig(storage);
      setHealth(h.health || []);
      setSelectedDriver(storage.primary.driver);
    } catch (err) {
      showApiError(err, t('storage.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading || !config) {
    return (
      <Card>
        <Spin description={t('storage.loading')}><div style={{ minHeight: 200 }} /></Spin>
      </Card>
    );
  }

  const isCurrent = (name: DriverName) => config.primary.driver === name;

  const handleSelectDriver = (name: DriverName) => {
    setSelectedDriver(name);
    setTestResult(null);
    // 本地存储卡片点击直接进入详情页(含资源清理)
    if (name === 'local' && config?.primary.driver === 'local' && onViewLocalDetail) {
      onViewLocalDetail();
    }
  };

  const handleTestConnection = async (driver: DriverName, options: Record<string, any>) => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiPost<{ ok: boolean; message: string; latencyMs?: number }>(
        '/admin/storage/test-connection',
        { driver, options },
      );
      setTestResult({
        ok: res.ok,
        message: res.message,
        latency: res.latencyMs,
      });
      if (res.ok) {
        message.success(t('storage.connectionOk', { latency: res.latencyMs ?? 0 }));
      } else {
        message.error(res.message || t('storage.connectionFail'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('storage.testFailed');
      setTestResult({ ok: false, message: msg });
      message.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const handleSwitchDriver = async (newConfig: StorageConfig, password: string) => {
    setSwitching(true);
    try {
      const res = await apiPost<{ health: DriverHealth[]; storage: StorageConfig }>(
        '/admin/storage/switch',
        { config: newConfig, confirmPassword: password },
      );
      message.success(t('storage.switchSuccess'));
      setConfig(res.storage);
      setHealth(res.health);
      setWizardVisible(false);
      // 提示用户开始迁移
      Modal.confirm({
        title: t('storage.migrateConfirm'),
        centered: true,
        content: t('storage.migrateHint'),
        okText: t('storage.migrateNow'),
        cancelText: t('storage.migrateLater'),
        onOk: () => {
          // 跳转到迁移页面或触发迁移
          message.info(t('storage.migrateQueued'));
        },
      });
    } catch (err) {
      showApiError(err, t('storage.switchFailed'));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div>
      {/* 健康状态总览 */}
      <Card size="small" style={{ marginBottom: 16, borderRadius: 4 }}>
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Space size="large">
              <div>
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>{t('storage.currentDriver')}</div>
                <div style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>
                  {t(DRIVER_META[config.primary.driver as DriverName]?.label) || config.primary.driver}
                </div>
              </div>
              <Divider orientation="vertical" style={{ height: 32 }} />
              <div>
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>{t('storage.secondaryDriver')}</div>
                <div style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>
                  {config.secondary ? (
                    <Tag color="processing">{t(DRIVER_META[config.secondary.driver as DriverName]?.label) || config.secondary.driver}</Tag>
                  ) : (
                    <span style={{ color: '#bfbfbf' }}>{t('common.none')}</span>
                  )}
                </div>
              </div>
              <Divider orientation="vertical" style={{ height: 32 }} />
              <div>
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>{t('storage.healthStatus')}</div>
                <div style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>
                  {health.length > 0 ? (
                    health.map((h) => (
                      <Tag
                        key={h.driver}
                        color={h.ok ? 'success' : 'error'}
                        icon={h.ok ? <CheckOutlined style={{ fontSize: 12 }} /> : <AlertOutlined style={{ fontSize: 12 }} />}
                        style={{ marginRight: 4 }}
                      >
                        {t(DRIVER_META[h.driver as DriverName]?.label) || h.driver}
                        {h.latencyMs != null && ` · ${h.latencyMs}ms`}
                      </Tag>
                    ))
                  ) : (
                    <Tag color="default">{t('storage.notChecked')}</Tag>
                  )}
                </div>
              </div>
            </Space>
          </Col>
          <Col>
            <Button icon={<ReloadOutlined style={{ fontSize: 14 }} />} onClick={loadData}>{t('common.refresh')}</Button>
          </Col>
        </Row>
      </Card>

      {/* driver 卡片 */}
      <Alert
        type="info"
        showIcon
        title={t('storage.switchHint')}
        style={{ marginBottom: 16, borderRadius: 4 }}
      />

      <Row gutter={[16, 16]}>
        {(Object.keys(DRIVER_META) as DriverName[]).map((name) => (
          <Col xs={24} md={12} key={name}>
            <DriverCard
              name={name}
              meta={DRIVER_META[name]}
              isCurrent={isCurrent(name)}
              isSelected={selectedDriver === name}
              onSelect={() => handleSelectDriver(name)}
              onConfigure={() => {
                // 本地存储已激活时跳转到详情页(含资源清理)
                if (name === 'local' && isCurrent(name) && onViewLocalDetail) {
                  onViewLocalDetail();
                  return;
                }
                handleSelectDriver(name);
                setWizardVisible(true);
              }}
            />
          </Col>
        ))}
      </Row>

      {/* 切换向导 */}
      {selectedDriver && (
        <SwitchWizard
          visible={wizardVisible}
          onClose={() => setWizardVisible(false)}
          driver={selectedDriver}
          meta={DRIVER_META[selectedDriver]}
          currentConfig={config}
          onTest={handleTestConnection}
          onSwitch={handleSwitchDriver}
          testing={testing}
          switching={switching}
          testResult={testResult}
          onClearTestResult={() => setTestResult(null)}
        />
      )}
    </div>
  );
}
