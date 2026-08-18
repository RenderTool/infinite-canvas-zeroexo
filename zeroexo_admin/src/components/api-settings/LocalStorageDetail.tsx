/**
 * LocalStorageDetail - 本地存储详情与资源清理
 *
 * 导航路径: API 设置 / 对象存储 / 本地存储配置
 * 包含: 存储路径展示、定时清理计划、手动清理(孤儿文件)
 *
 * 仅对本地存储生效,对象存储相关功能在各自的控制台管理。
 */
import { useState, useEffect } from 'react';
import {
  Card, Row, Col, Button, Form, Switch, Input, InputNumber, Alert,
  Divider, Statistic, message, Modal,
} from 'antd';
import {
  Scan, Trash2, Clock, HardDrive, Copy,
  TriangleAlert,
} from 'lucide-react';
import { apiGet, apiPut, apiPost, showApiError } from '@/services/api-client';
import DetailBreadcrumb from './DetailBreadcrumb';

// ──────── 类型 ────────

interface Settings {
  storageRoot: string;
  updatedAt?: string;
}

interface ScheduleConfig {
  resourceGc: {
    cron: string;
    enabled: boolean;
    retentionDays: number;
  };
  userCleanup: {
    cron: string;
    enabled: boolean;
    retentionDays: number;
  };
}

interface CleanupResult {
  success: boolean;
  dryRun: boolean;
  referencedCount: number;
  referencedSize: number;
  orphanCount: number;
  orphanSize: number;
  deletedCount: number;
  deletedSize: number;
  message: string;
}

// ──────── 主组件 ────────

export default function LocalStorageDetail({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchScheduleConfig();
  }, []);

  const fetchSettings = async () => {
    try {
      const data = await apiGet<Settings>('/admin/settings');
      setSettings(data);
    } catch (err) {
      showApiError(err, '加载存储设置失败');
    }
  };

  const fetchScheduleConfig = async () => {
    setScheduleLoading(true);
    setScheduleError(null);
    try {
      const data = await apiGet<ScheduleConfig>('/admin/settings/schedules');
      setScheduleConfig(data);
    } catch (err) {
      setScheduleConfig(null);
      setScheduleError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setScheduleLoading(false);
    }
  };

  const saveScheduleConfig = async (values: ScheduleConfig) => {
    try {
      await apiPut('/admin/settings/schedules', {
        resourceGc: {
          cron: values.resourceGc.cron,
          enabled: values.resourceGc.enabled,
          retentionDays: values.resourceGc.retentionDays,
        },
        userCleanup: {
          cron: values.userCleanup.cron,
          enabled: values.userCleanup.enabled,
          retentionDays: values.userCleanup.retentionDays,
        },
      });
      message.success('定时任务配置已保存');
      fetchScheduleConfig();
      return true;
    } catch (err) {
      showApiError(err, '保存失败');
      return false;
    }
  };

  const handleScanOrphans = async () => {
    setScanning(true);
    setCleanupResult(null);
    try {
      const result = await apiPost<CleanupResult>('/admin/resources/cleanup-orphans', { dryRun: true });
      setCleanupResult(result);
      if (result.orphanCount === 0) {
        message.success('未发现孤儿文件，存储目录干净');
      } else {
        message.info(`发现 ${result.orphanCount} 个孤儿文件`);
      }
    } catch (err) {
      showApiError(err, '扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const handleCleanupOrphans = async () => {
    if (!cleanupResult || cleanupResult.orphanCount === 0) {
      message.warning('请先扫描，确认有孤儿文件后再清理');
      return;
    }
    Modal.confirm({
      title: '确认清理孤儿文件',
      centered: true,
      icon: <TriangleAlert size={18} />,
      content: `将删除 ${cleanupResult.orphanCount} 个未被引用的文件 (${formatSize(cleanupResult.orphanSize)})，回收存储空间。此操作不可恢复。`,
      okText: '确认清理',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setCleaning(true);
        try {
          const result = await apiPost<CleanupResult>('/admin/resources/cleanup-orphans', { dryRun: false });
          setCleanupResult(result);
          message.success(result.message);
          // 清理完成后自动重新扫描，刷新数据
          const scanResult = await apiPost<CleanupResult>('/admin/resources/cleanup-orphans', { dryRun: true });
          setCleanupResult(scanResult);
        } catch (err) {
          showApiError(err, '清理失败');
        } finally {
          setCleaning(false);
        }
      },
    });
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  return (
    <div>
      <DetailBreadcrumb
        onBack={onBack}
        detailName="本地存储配置"
      />

      <Alert
        title="本地存储配置"
        description="资源清理和存储路径仅在使用本地存储时生效。若已切换到对象存储，请前往对应存储控制台管理。"
        type="info"
        showIcon
        style={{ marginBottom: 20, borderRadius: 4 }}
      />

      {/* 存储路径 */}
      <Card
        size="small"
        style={{ borderRadius: 4, marginBottom: 16 }}
        title={<span style={{ fontWeight: 500 }}>存储路径</span>}
      >
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <HardDrive size={16} style={{ color: '#52c41a' }} />
              <code style={{
                background: '#f5f5f5', padding: '6px 12px', borderRadius: 4,
                fontSize: 13, flex: 1, wordBreak: 'break-all',
              }}>
                {settings?.storageRoot
                  ? `${settings.storageRoot.replace(/\\/g, '/')}/resources`
                  : '未配置'}
              </code>
            </div>
          </Col>
          <Col flex="none">
            <Button
              size="small"
              icon={<Copy size={14} />}
              onClick={() => {
                const text = settings?.storageRoot
                  ? `${settings.storageRoot.replace(/\\/g, '/')}/resources`
                  : '';
                if (text) { navigator.clipboard.writeText(text); message.success('已复制'); }
              }}
            >
              复制路径
            </Button>
          </Col>
        </Row>
      </Card>

      {/* 定时清理计划 */}
      <Card
        size="small"
        style={{ borderRadius: 4, marginBottom: 16 }}
        title={<span style={{ fontWeight: 500 }}>定时清理计划</span>}
      >
        {scheduleLoading && (
          <div style={{ textAlign: 'center', padding: 24, color: '#8b949e' }}>
            加载配置中...
          </div>
        )}
        {scheduleError && !scheduleLoading && (
          <Alert
            title="加载失败"
            description={scheduleError}
            type="error"
            showIcon
            action={<Button size="small" onClick={fetchScheduleConfig}>重试</Button>}
          />
        )}
        {scheduleConfig && !scheduleLoading && (
          <Form
            key={JSON.stringify(scheduleConfig)}
            layout="vertical"
            initialValues={{
              'gc.cron': scheduleConfig.resourceGc.cron,
              'gc.enabled': scheduleConfig.resourceGc.enabled,
              'gc.retentionDays': scheduleConfig.resourceGc.retentionDays,
              'user.cron': scheduleConfig.userCleanup.cron,
              'user.enabled': scheduleConfig.userCleanup.enabled,
              'user.retentionDays': scheduleConfig.userCleanup.retentionDays,
            }}
            onFinish={(values) =>
              saveScheduleConfig({
                resourceGc: {
                  cron: values['gc.cron'],
                  enabled: values['gc.enabled'],
                  retentionDays: values['gc.retentionDays'],
                },
                userCleanup: {
                  cron: values['user.cron'],
                  enabled: values['user.enabled'],
                  retentionDays: values['user.retentionDays'],
                },
              })
            }
          >
            <Row gutter={24}>
              <Col xs={24} md={12}>
                <Card type="inner" title="资源 GC（孤儿文件清理）" size="small">
                  <Form.Item label="启用" name="gc.enabled" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item label="Cron 表达式" name="gc.cron" tooltip="标准 cron: 秒 分 时 日 月 周">
                    <Input placeholder="0 0 3 * * *（每天凌晨3点）" />
                  </Form.Item>
                  <Form.Item label="保留天数" name="gc.retentionDays" tooltip="未被引用的资源保留多少天后物理删除">
                    <InputNumber min={1} max={365} style={{ width: '100%' }} />
                  </Form.Item>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card type="inner" title="回收站清理（过期用户永久删除）" size="small">
                  <Form.Item label="启用" name="user.enabled" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item label="Cron 表达式" name="user.cron" tooltip="标准 cron: 秒 分 时 日 月 周">
                    <Input placeholder="0 0 3 * * *（每天凌晨3点）" />
                  </Form.Item>
                  <Form.Item label="保留天数" name="user.retentionDays" tooltip="软删除用户保留多少天后永久删除">
                    <InputNumber min={1} max={365} style={{ width: '100%' }} />
                  </Form.Item>
                </Card>
              </Col>
            </Row>
            <Form.Item style={{ marginTop: 12, textAlign: 'right' }}>
              <Button type="primary" htmlType="submit" icon={<Clock size={14} />}>
                保存定时配置
              </Button>
            </Form.Item>
          </Form>
        )}
      </Card>

      {/* 手动清理 */}
      <Card
        size="small"
        style={{ borderRadius: 4 }}
        title={<span style={{ fontWeight: 500 }}>手动清理</span>}
      >
        <Alert
          title="清理 storage/resources/ 目录中未被任何项目或资源引用的孤儿文件。扫描模式仅预览不删除。最近1小时内修改的文件自动跳过。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <Button
            type="primary"
            icon={<Scan size={14} />}
            onClick={handleScanOrphans}
            loading={scanning}
          >
            扫描孤儿文件
          </Button>
          <Button
            danger
            icon={<Trash2 size={14} />}
            onClick={handleCleanupOrphans}
            loading={cleaning}
            disabled={!cleanupResult || cleanupResult.orphanCount === 0}
          >
            执行清理
          </Button>
        </div>

        {cleanupResult && (
          <>
            <Divider />
            <Row gutter={[16, 16]}>
              <Col span={6}>
                <Statistic title="被引用文件" value={cleanupResult.referencedCount} suffix="个" styles={{ content: { color: '#1890ff' } }} />
              </Col>
              <Col span={6}>
                <Statistic
                  title="孤儿文件"
                  value={cleanupResult.orphanCount}
                  suffix="个"
                  styles={{ content: { color: cleanupResult.orphanCount > 0 ? '#ff4d4f' : '#52c41a' } }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="可回收空间"
                  value={cleanupResult.orphanSize}
                  formatter={(value) => formatSize(Number(value))}
                  styles={{ content: { color: cleanupResult.orphanSize > 0 ? '#faad14' : '#52c41a' } }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="已清理"
                  value={cleanupResult.deletedCount}
                  suffix="个"
                  styles={{ content: { color: cleanupResult.deletedCount > 0 ? '#52c41a' : '#8b949e' } }}
                />
              </Col>
            </Row>
            <Alert
              title={cleanupResult.message}
              type={cleanupResult.dryRun ? (cleanupResult.orphanCount > 0 ? 'warning' : 'success') : 'success'}
              showIcon
              style={{ marginTop: 16 }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
