/**
 * VersionDialogs - 画布版本快照面板(保存版本 + 版本历史 + 回退)
 *
 * 单页面合并版:Drawer 顶部为保存区(节点数提示 + 版本名称 + 保存按钮),
 * 下方为历史列表(版本号/时间/节点数/来源/名称),选中后支持回退/删除。
 * 保存成功后自动刷新列表,不关闭面板。
 * 回退: 确认弹窗(M.confirm danger),成功后自动刷新页面加载指定版本数据
 */

import { useCallback, useEffect, useState } from 'react';
import { App, Drawer, Input, Button, Empty, Tag, Tooltip, Spin } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';
import { useTranslation } from 'react-i18next';
import { History, RotateCcw, Trash2 } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { apiGet, apiPost, apiDelete, ApiError } from '@/services/api-client.js';
import { updateProject, loadProjectGraph, saveProjectGraph } from '@zeroexo/plugin-persistence';
import type { GraphModel } from '@zeroexo/core';
import { useReadOnly } from '@/shared/readonly-context.js';

interface VersionRecord {
  id: string;
  version: number;
  size: number;
  nodeCount: number;
  createdBy: string;
  label?: string | null;
  source: string;
  createdAt: string;
}

/** 回滚接口返回:新版本号 + 缺失资源警告 + 回滚后的完整 graph(用于对齐本地缓存) */
interface RollbackResult {
  version: number;
  warnings: string[];
  graph?: {
    scene: unknown;
    connections: unknown;
    viewport: unknown;
  };
  lastSyncedAt?: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: 'manual',
  'auto-delete': 'autoDelete',
  'auto-ai': 'autoAi',
  'auto-timer': 'autoTimer',
  rollback: 'rollback',
};

export interface VersionDialogsProps {
  canvasId: string;
  /** 实时节点数(用于保存区提示) */
  nodeCount: number;
  open: boolean;
  onClose: () => void;
  theme: ThemeConfig;
}

export function VersionDialogs({
  canvasId,
  nodeCount,
  open,
  onClose,
  theme,
}: VersionDialogsProps): React.ReactElement {
  const { t } = useTranslation();
  // App.useApp() 的 message/modal 实例可消费 ConfigProvider 动态主题(静态函数无法消费)
  const { message, modal } = App.useApp();
  // 只读防护（2026-08-25 系统性只读防护）：保存/回退/删除版本均为写操作，viewer 只能浏览历史
  const readOnly = useReadOnly();
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [rollbacking, setRollbacking] = useState<number | null>(null);

  /** 加载版本列表 */
  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<VersionRecord[]>(`/projects/${canvasId}/versions`);
      setVersions(Array.isArray(data) ? data : []);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [canvasId]);

  // 打开面板时加载列表
  useEffect(() => {
    if (open) {
      void loadVersions();
    }
  }, [open, loadVersions]);

  /** 保存版本(成功后刷新列表,面板不关闭;只读早退) */
  const handleSave = useCallback(async () => {
    if (readOnly) return;
    setSaving(true);
    try {
      await apiPost(`/projects/${canvasId}/versions`, {
        label: label.trim() || undefined,
      });
      setLabel('');
      void loadVersions();
      message.success(t('versions.saveSuccessTitle'));
    } catch (err) {
      // 新画布尚未同步到云端时版本接口返回 404,给出明确提示而非笼统失败
      const notSynced = err instanceof ApiError && err.status === 404;
      message.error(t(notSynced ? 'versions.notSyncedTitle' : 'versions.saveFailedTitle'));
    } finally {
      setSaving(false);
    }
  }, [canvasId, label, loadVersions, t, readOnly]);

  /** 删除版本(只读早退) */
  const handleDelete = useCallback(
    (version: number) => {
      if (readOnly) return;
      modal.confirm({
        title: t('versions.deleteTitle'),
        content: t('versions.deleteMessage', { version }),
        centered: true,
        okType: 'danger',
        okText: t('common.confirm'),
        cancelText: t('common.cancel'),
        onOk: async () => {
          try {
            await apiDelete(`/projects/${canvasId}/versions/${version}`);
            void loadVersions();
          } catch {
            modal.error({ title: t('versions.deleteFailedTitle'), centered: true });
          }
        },
      });
    },
    [canvasId, loadVersions, t, readOnly],
  );

  /** 回退到指定版本(只读早退) */
  const handleRollback = useCallback(
    (version: number) => {
      if (readOnly) return;
      modal.confirm({
        title: t('versions.rollbackTitle'),
        content: t('versions.rollbackMessage', { version }),
        centered: true,
        okType: 'danger',
        okText: t('versions.rollbackConfirm'),
        cancelText: t('common.cancel'),
        onOk: async () => {
          setRollbacking(version);
          try {
            const result = await apiPost<RollbackResult>(
              `/projects/${canvasId}/rollback`,
              { version },
            );
            const warnings = result?.warnings ?? [];
            // ① 权威回滚结果写回本地缓存:覆盖旧 graph + 对齐 version/lastSyncedAt。
            //    否则 reload 后 localforage 优先加载回滚前的旧数据并反向推送覆盖云端,
            //    导致"回滚后强制变回新版"。
            if (result?.graph) {
              const nodes = Array.isArray(result.graph.scene)
                ? (result.graph.scene as GraphModel['nodes'])
                : [];
              const existing = await loadProjectGraph(canvasId);
              await saveProjectGraph(canvasId, {
                nodes,
                edges: Array.isArray(result.graph.connections)
                  ? (result.graph.connections as GraphModel['edges'])
                  : [],
                viewport:
                  (result.graph.viewport as GraphModel['viewport']) ?? { x: 0, y: 0, k: 1 },
                metadata: existing?.metadata ?? {},
              });
              await updateProject(canvasId, {
                version: result.version,
                lastSyncedAt: result.lastSyncedAt ?? new Date().toISOString(),
                nodeCount: nodes.length,
              });
            }
            if (warnings.length > 0) {
              modal.warning({
                title: t('versions.missingResourcesTitle'),
                content: (
                  <div>
                    <p>{t('versions.missingResourcesMessage')}</p>
                    <div style={{ maxHeight: 160, overflow: 'auto', fontSize: 12, wordBreak: 'break-all' }}>
                      {warnings.slice(0, 20).map((k) => (
                        <div key={k}>· {k}</div>
                      ))}
                      {warnings.length > 20 ? <div>… 共 {warnings.length} 项</div> : null}
                    </div>
                  </div>
                ),
                centered: true,
              });
            }
            // ③ 后端已通过 Yjs 把回滚结果广播给所有在线端(实时切换);
            //    当前端覆盖本地缓存后刷新,走完整初始化链路(资源解析/协作重连)
            window.location.reload();
          } catch {
            modal.error({
              title: t('versions.rollbackFailedTitle'),
              centered: true,
            });
            setRollbacking(null);
          }
        },
      });
    },
    [canvasId, t, readOnly],
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <History size={16} />
          {t('versions.historyTitle')}
        </span>
      }
      size={360}
      placement="right"
      styles={{ body: { padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0 } }}
    >
      {/* 保存区(合并自原保存弹窗):节点数提示 + 版本名称 + 保存 + 刷新 */}
      <div style={{ marginBottom: 8, fontSize: 13, color: theme.toolbar.text }}>
        {t('versions.nodeCountTip', { count: nodeCount })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Input
          placeholder={t('versions.labelPlaceholder')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={50}
          allowClear
          disabled={readOnly}
          onPressEnter={() => { if (!readOnly) void handleSave(); }}
        />
        <Button type="primary" loading={saving} disabled={readOnly} onClick={() => void handleSave()}>
          {t('versions.saveConfirm')}
        </Button>
        <Button onClick={() => void loadVersions()} disabled={loading}>
          {t('versions.refresh')}
        </Button>
      </div>
      <div
        style={{
          marginBottom: 8,
          padding: '6px 10px',
          borderRadius: 4,
          fontSize: 12,
          lineHeight: '18px',
          color: theme.toolbar.text,
          background: theme.toolbar.background,
          border: `1px solid ${theme.toolbar.border}`,
          opacity: 0.85,
        }}
      >
        {t('versions.retentionHint')}
      </div>
      {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
            <Spin />
          </div>
        ) : versions.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('versions.emptyHint')}
          />
        ) : (
          <Virtuoso
            style={{ flex: 1, minHeight: 0 }}
            data={versions}
            itemContent={(_index, v) => (
              <div
                style={{
                  padding: '10px 4px',
                  borderBottom: `1px solid ${theme.toolbar.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
                    <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t('versions.versionLabel', { version: v.version })}
                    </span>
                    {v.label ? (
                      <Tag style={{ marginInlineEnd: 0 }} color="blue">
                        {v.label}
                      </Tag>
                    ) : null}
                    <Tag style={{ marginInlineEnd: 0 }}>{t(`versions.source.${SOURCE_LABEL[v.source] ?? 'manual'}`)}</Tag>
                  </div>
                  <div style={{ fontSize: 12, lineHeight: '20px', color: theme.toolbar.text }}>
                    <div>{new Date(v.createdAt).toLocaleString()}</div>
                    <div>
                      {t('versions.nodeCountShort', { count: v.nodeCount })} ·{' '}
                      {(v.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                </div>
                <Tooltip title={t('versions.rollback')}>
                  <Button
                    type="text"
                    size="small"
                    icon={<RotateCcw size={14} />}
                    loading={rollbacking === v.version}
                    disabled={readOnly}
                    onClick={() => handleRollback(v.version)}
                  />
                </Tooltip>
                <Tooltip title={t('versions.delete')}>
                  <Button
                    type="text"
                    size="small"
                    icon={<Trash2 size={14} />}
                    disabled={readOnly}
                    onClick={() => handleDelete(v.version)}
                  />
                </Tooltip>
              </div>
            )}
          />
        )}
    </Drawer>
  );
}
