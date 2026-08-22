/**
 * agent-skill-upgrade - Agent 技能升级管理页(Plan#33 D6)
 *
 * 两个 Tab:
 * - 升级提案: Agent 通过 agent_self_upgrade(propose) 提交的技能升级提案列表,
 *   管理员可查看详情(当前内容 vs 提案内容)并批准(写盘生效)/拒绝。
 * - 技能文件: 管理员直接浏览/编辑技能文件(SKILL.md / SYSTEM_PROMPT.md)。
 */

import { useState, useCallback, useEffect } from 'react';
import { Tabs, Table, Button, Tag, Select, Modal, Input, Space, Tooltip, Typography, message, Empty } from 'antd';
import {
  ReloadOutlined,
  CheckOutlined,
  CloseOutlined,
  FileTextOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPost, apiPut, showApiError } from '@/services/api-client';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';

/** 技能目录树节点(与后端 listSkills 对齐) */
interface SkillTreeItem {
  skillKey: string;
  files: { skillKey: string; fileName: string; size: number }[];
}

/** 技能升级提案(与后端 AgentSkillProposal 对齐) */
interface SkillProposal {
  id: string;
  skillKey: string;
  fileName: string;
  reason?: string | null;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
  createdById: string;
  reviewedById?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
}

const STATUS_OPTIONS = ['all', 'pending', 'approved', 'rejected'];
const STATUS_COLORS: Record<string, string> = {
  pending: 'gold',
  approved: 'green',
  rejected: 'red',
};

const STATUS_TEXTS: Record<string, { zh: string; en: string }> = {
  pending: { zh: '待审批', en: 'Pending' },
  approved: { zh: '已批准', en: 'Approved' },
  rejected: { zh: '已拒绝', en: 'Rejected' },
};

export default function AgentSkillUpgrade() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('zh') ? 'zh' : 'en';
  const tr = (key: string, fallback: string) => t(key, fallback);

  // ---- 提案 Tab ----
  const [proposals, setProposals] = useState<SkillProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [detail, setDetail] = useState<SkillProposal | null>(null);
  const [currentContent, setCurrentContent] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState(false);

  // ---- 文件 Tab ----
  const [skillTree, setSkillTree] = useState<SkillTreeItem[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | undefined>();
  const [selectedFile, setSelectedFile] = useState<string | undefined>();
  const [fileContent, setFileContent] = useState('');
  const [fileSaving, setFileSaving] = useState(false);

  const loadProposals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ items: SkillProposal[] }>(
        `/admin/agent-skills/proposals${statusFilter !== 'all' ? `?status=${statusFilter}` : ''}`,
      );
      setProposals(data.items ?? []);
    } catch (err) {
      showApiError(err, tr('agentSkill.loadFailed', '加载提案失败'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const loadSkillTree = useCallback(async () => {
    try {
      const data = await apiGet<{ items: SkillTreeItem[] }>('/admin/agent-skills');
      const items = data.items ?? [];
      setSkillTree(items);
      if (!selectedSkill && items.length > 0) {
        setSelectedSkill(items[0].skillKey);
      }
    } catch (err) {
      showApiError(err, tr('agentSkill.loadFailed', '加载技能目录失败'));
    }
  }, [selectedSkill]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  useEffect(() => {
    loadSkillTree();
  }, [loadSkillTree]);

  // 选中技能目录后默认选中第一个可编辑文件
  useEffect(() => {
    const node = skillTree.find((s) => s.skillKey === selectedSkill);
    if (node && node.files.length > 0 && !node.files.some((f) => f.fileName === selectedFile)) {
      setSelectedFile(node.files[0].fileName);
    }
  }, [skillTree, selectedSkill, selectedFile]);

  // 读取文件内容(详情对比 / 文件编辑共用)
  const fetchFileContent = useCallback(async (skillKey: string, fileName: string) => {
    const data = await apiGet<{ content: string }>(
      `/admin/agent-skills/${encodeURIComponent(skillKey)}/${encodeURIComponent(fileName)}`,
    );
    return data.content ?? '';
  }, []);

  // 打开提案详情: 同时读取磁盘当前内容用于对比
  const openDetail = async (row: SkillProposal) => {
    setDetail(row);
    setCurrentContent('');
    setDetailLoading(true);
    try {
      setCurrentContent(await fetchFileContent(row.skillKey, row.fileName));
    } catch {
      setCurrentContent(tr('agentSkill.readFailed', '当前文件读取失败'));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleApprove = async (row: SkillProposal) => {
    setActing(true);
    try {
      await apiPost(`/admin/agent-skills/proposals/${row.id}/approve`);
      message.success(tr('agentSkill.approveSuccess', '已批准并写入生效'));
      setDetail(null);
      await loadProposals();
    } catch (err) {
      showApiError(err, tr('agentSkill.approveFailed', '批准失败'));
    } finally {
      setActing(false);
    }
  };

  const handleReject = async (row: SkillProposal) => {
    setActing(true);
    try {
      await apiPost(`/admin/agent-skills/proposals/${row.id}/reject`);
      message.success(tr('agentSkill.rejectSuccess', '已拒绝'));
      setDetail(null);
      await loadProposals();
    } catch (err) {
      showApiError(err, tr('agentSkill.rejectFailed', '拒绝失败'));
    } finally {
      setActing(false);
    }
  };

  // 文件 Tab: 切换技能/文件时加载内容
  useEffect(() => {
    if (selectedSkill && selectedFile) {
      fetchFileContent(selectedSkill, selectedFile)
        .then(setFileContent)
        .catch((err) => showApiError(err, tr('agentSkill.loadFailed', '读取文件失败')));
    }
  }, [selectedSkill, selectedFile, fetchFileContent]);

  const handleSaveFile = async () => {
    if (!selectedSkill || !selectedFile) return;
    setFileSaving(true);
    try {
      await apiPut(
        `/admin/agent-skills/${encodeURIComponent(selectedSkill)}/${encodeURIComponent(selectedFile)}`,
        { content: fileContent },
      );
      message.success(tr('agentSkill.saveSuccess', '已保存并生效'));
      await loadSkillTree();
    } catch (err) {
      showApiError(err, tr('agentSkill.saveFailed', '保存失败'));
    } finally {
      setFileSaving(false);
    }
  };

  const statusText = (status: string) => STATUS_TEXTS[status]?.[lang] ?? status;

  const columns: ColumnsType<SkillProposal> = [
    {
      title: tr('agentSkill.skill', '技能'),
      dataIndex: 'skillKey',
      width: 160,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: tr('agentSkill.file', '文件'),
      dataIndex: 'fileName',
      width: 160,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: tr('agentSkill.reason', '理由'),
      dataIndex: 'reason',
      ellipsis: true,
      render: (v?: string | null) => v || '-',
    },
    {
      title: tr('agentSkill.contentPreview', '内容预览'),
      dataIndex: 'content',
      ellipsis: true,
      render: (v: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {v.replace(/\s+/g, ' ').slice(0, 80)}
        </Typography.Text>
      ),
    },
    {
      title: tr('agentSkill.status', '状态'),
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={STATUS_COLORS[v]}>{statusText(v)}</Tag>,
    },
    {
      title: tr('agentSkill.applicant', '申请人'),
      dataIndex: 'createdById',
      width: 140,
      render: (v: string) => (
        <Tooltip title={v}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {v.slice(0, 8)}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: tr('agentSkill.submitTime', '提交时间'),
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US'),
    },
    {
      title: tr('common.actions', '操作'),
      width: 180,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" icon={<FileTextOutlined />} onClick={() => openDetail(row)}>
            {tr('common.detail', '详情')}
          </Button>
          {row.status === 'pending' && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                onClick={() =>
                  Modal.confirm({
                    title: tr('agentSkill.approveConfirm', '确定批准该提案并写入生效吗？'),
                    centered: true,
                    okText: tr('agentSkill.approve', '批准'),
                    cancelText: tr('common.cancel', '取消'),
                    onOk: () => handleApprove(row),
                  })
                }
              >
                {tr('agentSkill.approve', '批准')}
              </Button>
              <Button
                size="small"
                danger
                icon={<CloseOutlined />}
                onClick={() =>
                  Modal.confirm({
                    title: tr('agentSkill.rejectConfirm', '确定拒绝该提案吗？'),
                    centered: true,
                    okType: 'danger',
                    okText: tr('agentSkill.reject', '拒绝'),
                    cancelText: tr('common.cancel', '取消'),
                    onOk: () => handleReject(row),
                  })
                }
              />
            </>
          )}
        </Space>
      ),
    },
  ];

  const fileOptions = skillTree.find((s) => s.skillKey === selectedSkill)?.files ?? [];
  const skillOptions = skillTree.map((s) => ({ value: s.skillKey, label: s.skillKey }));
  const fileSelectOptions = fileOptions.map((f) => ({ value: f.fileName, label: f.fileName }));

  return (
    <BreadcrumbLayout
      items={[
        { title: tr('nav.agentSkill', 'Agent 技能') },
        { title: tr('agentSkill.title', '技能升级') },
      ]}
      toolbar={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => {
            loadProposals();
            loadSkillTree();
          }}
        >
          {tr('common.refresh', '刷新')}
        </Button>
      }
    >
      <Tabs
        items={[
          {
            key: 'proposals',
            label: tr('agentSkill.proposals', '升级提案'),
            children: (
              <div>
                <Space style={{ marginBottom: 16 }}>
                  <Select
                    style={{ width: 140 }}
                    allowClear
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={STATUS_OPTIONS.map((s) => ({
                      value: s,
                      label: s === 'all' ? tr('agentSkill.all', '全部') : statusText(s),
                    }))}
                  />
                </Space>
                <Table<SkillProposal>
                  rowKey="id"
                  loading={loading}
                  columns={columns}
                  dataSource={proposals}
                  scroll={{ x: 1200 }}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                />
              </div>
            ),
          },
          {
            key: 'files',
            label: tr('agentSkill.files', '技能文件'),
            children: (
              <div style={{ display: 'flex', gap: 16, height: '100%' }}>
                <div style={{ width: 220, flexShrink: 0 }}>
                  <div style={{ marginBottom: 8 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {tr('agentSkill.skill', '技能')}
                    </Typography.Text>
                    <Select
                      style={{ width: '100%', marginTop: 4 }}
                      value={selectedSkill}
                      onChange={setSelectedSkill}
                      options={skillOptions}
                      placeholder={tr('agentSkill.noSkill', '请选择技能目录')}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {tr('agentSkill.file', '文件')}
                    </Typography.Text>
                    <Select
                      style={{ width: '100%', marginTop: 4 }}
                      value={selectedFile}
                      onChange={setSelectedFile}
                      options={fileSelectOptions}
                      placeholder="-"
                    />
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  {selectedSkill && selectedFile ? (
                    <>
                      <Input.TextArea
                        value={fileContent}
                        onChange={(e) => setFileContent(e.target.value)}
                        style={{ flex: 1, minHeight: 360, fontFamily: 'monospace', fontSize: 12 }}
                      />
                      <div style={{ marginTop: 12, textAlign: 'right' }}>
                        <Button
                          type="primary"
                          icon={<SaveOutlined />}
                          loading={fileSaving}
                          onClick={handleSaveFile}
                        >
                          {tr('common.save', '保存')}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Empty description={tr('agentSkill.noSkill', '请选择技能目录')} />
                  )}
                </div>
              </div>
            ),
          },
        ]}
      />

      {/* 提案详情 Modal(当前内容 vs 提案内容) */}
      <Modal
        title={tr('agentSkill.detailTitle', '提案详情')}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={
          detail?.status === 'pending'
            ? [
                <Button key="cancel" onClick={() => setDetail(null)}>
                  {tr('common.cancel', '取消')}
                </Button>,
                <Button key="reject" danger loading={acting} icon={<CloseOutlined />} onClick={() => detail && handleReject(detail)}>
                  {tr('agentSkill.reject', '拒绝')}
                </Button>,
                <Button key="approve" type="primary" loading={acting} icon={<CheckOutlined />} onClick={() => detail && handleApprove(detail)}>
                  {tr('agentSkill.approve', '批准')}
                </Button>,
              ]
            : [
                <Button key="close" type="primary" onClick={() => setDetail(null)}>
                  {tr('common.close', '关闭')}
                </Button>,
              ]
        }
        styles={{ body: { maxHeight: '60vh', overflow: 'auto' } }}
      >
        {detail && (
          <div>
            <Space size={12} style={{ marginBottom: 12 }}>
              <Typography.Text code>{detail.skillKey}</Typography.Text>
              <Typography.Text code>{detail.fileName}</Typography.Text>
              <Tag color={STATUS_COLORS[detail.status]}>{statusText(detail.status)}</Tag>
            </Space>
            {detail.reason && (
              <div style={{ marginBottom: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {tr('agentSkill.reason', '理由')}: {detail.reason}
                </Typography.Text>
              </div>
            )}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {tr('agentSkill.currentContent', '当前文件内容')}
                </Typography.Text>
                <pre
                  style={{
                    marginTop: 4,
                    padding: 8,
                    background: 'var(--color-bg-layout, #fafafa)',
                    border: '1px solid var(--color-border, #f0f0f0)',
                    borderRadius: 4,
                    fontSize: 12,
                    maxHeight: 300,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {detailLoading ? tr('common.loading', '加载中...') : currentContent || '-'}
                </pre>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {tr('agentSkill.proposalContent', '提案内容')}
                </Typography.Text>
                <pre
                  style={{
                    marginTop: 4,
                    padding: 8,
                    background: 'var(--color-bg-layout, #fafafa)',
                    border: '1px solid var(--color-border, #f0f0f0)',
                    borderRadius: 4,
                    fontSize: 12,
                    maxHeight: 300,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {detail.content || '-'}
                </pre>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </BreadcrumbLayout>
  );
}
