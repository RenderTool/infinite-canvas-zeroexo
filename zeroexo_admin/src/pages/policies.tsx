/**
 * Policies - 政策公告管理页面
 *
 * 展示完整的政策公告条目列表（版本化管理）。
 * 每条记录包含：标题、类型、当前发布版本、版本历史、编辑操作。
 *
 * 后端 API（全局前缀 /api）：
 *   GET    /admin/policies                          → 列表
 *   GET    /admin/policies/:key/versions            → 版本列表
 *   GET    /admin/policies/:key/versions/:version   → 版本详情
 *   POST   /admin/policies/:key/versions            → 创建版本
 *   PUT    /admin/policies/:key/versions/:version   → 更新版本
 *   POST   /admin/policies/:key/versions/:version/publish → 发布
 *   DELETE /admin/policies/:key/versions/:version   → 删除版本
 *   DELETE /admin/policies/:key                     → 删除整个政策
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Button, Modal, Form, Input, Select, Tag, Space, message, Tooltip, Card, Grid, Tabs,
} from 'antd';
import { PlusOutlined, DeleteOutlined, CheckCircleOutlined, StopOutlined, HistoryOutlined, FileTextOutlined, GlobalOutlined, SearchOutlined, EditOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { color as themeColor } from '@/design-tokens';
import { apiGet, apiPost, apiPut, apiDelete, showApiError } from '@/services/api-client';

// ====== 类型定义 ======

interface PolicyInfo {
  key: string;
  title: string;
  type: 'policy' | 'announcement';
  updatedAt: string;
  currentVersion: number | null;
}

interface VersionInfo {
  version: number;
  title: string;
  type: string;
  published: boolean;
  notes: string;
  editorId?: string;
  createdAt: string;
  updatedAt: string;
}

interface VersionDetail {
  title: string;
  titleEn: string;
  titleJa: string;
  content: string;
  contentEn: string;
  contentJa: string;
  type: string;
  notes: string;
  published: boolean;
  version: number;
  editorId?: string;
  createdAt: string;
  updatedAt: string;
}

// ====== 常量 ======

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  policy: { label: 'policies.type.policyLabel', color: themeColor.primary, icon: <FileTextOutlined /> },
  announcement: { label: 'policies.type.announcementLabel', color: themeColor.success, icon: <GlobalOutlined /> },
};

// ====== 组件 ======

export default function Policies() {
  const { t } = useTranslation();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  // 移动端 Tab 状态
  const [mobileTab, setMobileTab] = useState<'list' | 'edit'>('list');

  // 列表状态
  const [policies, setPolicies] = useState<PolicyInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // 版本状态
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<VersionDetail | null>(null);
  const [selectedVersionNum, setSelectedVersionNum] = useState<number | null>(null);
  const [versionSearch, setVersionSearch] = useState('');

  // 编辑器状态
  const [editTitle, setEditTitle] = useState('');
  const [editTitleEn, setEditTitleEn] = useState('');
  const [editTitleJa, setEditTitleJa] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editContentEn, setEditContentEn] = useState('');
  const [editContentJa, setEditContentJa] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editType, setEditType] = useState<'policy' | 'announcement'>('policy');
  const [editLang, setEditLang] = useState<'zh' | 'en' | 'ja'>('zh');
  const [saving, setSaving] = useState(false);

  // 新建版本弹窗
  const [createVersionModal, setCreateVersionModal] = useState(false);
  const [createVersionKey, setCreateVersionKey] = useState<string | null>(null);
  const [createVersionForm] = Form.useForm();

  // 新建政策弹窗
  const [createPolicyModal, setCreatePolicyModal] = useState(false);
  const [createPolicyForm] = Form.useForm();

  // ====== 获取政策列表 ======
  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<PolicyInfo[]>('/admin/policies');
      setPolicies(data);
    } catch (err) {
      showApiError(err, t('error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  // ====== 选中政策，获取版本列表 ======
  const handleSelectPolicy = useCallback(async (key: string) => {
    setSelectedKey(key);
    setSelectedVersion(null);
    setSelectedVersionNum(null);
    setLoadingVersions(true);
    // 移动端自动切换到编辑Tab
    if (isMobile) setMobileTab('edit');
    try {
      // 获取版本列表 + 当前发布版本
      const data = await apiGet<{ key: string; currentVersion: number | null; versions: VersionInfo[] }>(`/admin/policies/${key}/versions`);
      setVersions(data.versions);
      // 默认选中当前发布版本，如果没有则选最新版本
      if (data.currentVersion != null) {
        const cv = data.versions.find((v) => v.version === data.currentVersion);
        if (cv) {
          handleEditVersion(key, cv.version);
        } else if (data.versions.length > 0) {
          handleEditVersion(key, data.versions[0].version);
        }
      } else if (data.versions.length > 0) {
        handleEditVersion(key, data.versions[0].version);
      }
    } catch (err) {
      showApiError(err, t('error.load'));
      setVersions([]);
    } finally {
      setLoadingVersions(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ====== 编辑版本 ======
  const handleEditVersion = useCallback(async (key: string, version: number) => {
    try {
      const data = await apiGet<VersionDetail>(`/admin/policies/${key}/versions/${version}`);
      setSelectedVersion(data);
      setSelectedVersionNum(version);
      setEditTitle(data.title);
      setEditTitleEn(data.titleEn || '');
      setEditTitleJa(data.titleJa || '');
      setEditContent(data.content);
      setEditContentEn(data.contentEn);
      setEditContentJa(data.contentJa);
      setEditNotes(data.notes);
      setEditType(data.type as 'policy' | 'announcement');
      setEditLang('zh');
    } catch (err) {
      showApiError(err, t('error.load'));
    }
  }, [t]);

  // ====== 保存编辑 ======
  const handleSave = useCallback(async () => {
    if (!selectedKey || selectedVersionNum == null) return;
    setSaving(true);
    try {
      await apiPut(`/admin/policies/${selectedKey}/versions/${selectedVersionNum}`, {
        title: editTitle,
        titleEn: editTitleEn || '',
        titleJa: editTitleJa || '',
        content: editContent,
        contentEn: editContentEn,
        contentJa: editContentJa,
        notes: editNotes,
        type: editType,
      });
      message.success(t('success.save'));
      // 刷新版本列表
      const data = await apiGet<{ key: string; currentVersion: number | null; versions: VersionInfo[] }>(`/admin/policies/${selectedKey}/versions`);
      setVersions(data.versions);
      // 刷新政策列表
      fetchPolicies();
    } catch (err) {
      showApiError(err, t('error.save'));
    } finally {
      setSaving(false);
    }
  }, [selectedKey, selectedVersionNum, editTitle, editContent, editContentEn, editContentJa, editNotes, editType, fetchPolicies, t]);

  // ====== 发布版本 ======
  const handlePublish = useCallback(async (version: number) => {
    if (!selectedKey) return;
    Modal.confirm({
      title: t('policies.publishConfirm.title'),
      content: t('policies.publishConfirm.content', { version }),
      centered: true,
      onOk: async () => {
        try {
          await apiPost(`/admin/policies/${selectedKey}/versions/${version}/publish`);
          message.success(t('policies.publishConfirm.success', { version }));
          // 刷新版本列表
          const data = await apiGet<{ key: string; currentVersion: number | null; versions: VersionInfo[] }>(`/admin/policies/${selectedKey}/versions`);
          setVersions(data.versions);
          // 刷新当前版本
          if (selectedVersionNum) {
            handleEditVersion(selectedKey, selectedVersionNum);
          }
          fetchPolicies();
        } catch (err) {
          showApiError(err, t('error.save'));
        }
      },
    });
  }, [selectedKey, selectedVersionNum, handleEditVersion, fetchPolicies, t]);

  // ====== 创建新版本 ======
  const handleCreateVersion = useCallback(async (key: string) => {
    setCreateVersionKey(key);
    createVersionForm.resetFields();
    // 如果有当前版本，预填内容
    if (selectedVersion && selectedKey === key) {
      createVersionForm.setFieldsValue({
        title: selectedVersion.title,
        titleEn: selectedVersion.titleEn || '',
        titleJa: selectedVersion.titleJa || '',
        content: selectedVersion.content,
        contentEn: selectedVersion.contentEn,
        contentJa: selectedVersion.contentJa,
        type: selectedVersion.type,
        notes: '',
      });
    } else {
      createVersionForm.setFieldsValue({
        title: '',
        titleEn: '',
        titleJa: '',
        content: '',
        contentEn: '',
        contentJa: '',
        type: 'policy',
        notes: '',
      });
    }
    setCreateVersionModal(true);
  }, [selectedVersion, selectedKey, createVersionForm]);

  const confirmCreateVersion = async () => {
    if (!createVersionKey) return;
    try {
      const values = await createVersionForm.validateFields();
      const data = await apiPost<VersionDetail>(`/admin/policies/${createVersionKey}/versions`, {
        title: values.title,
        titleEn: values.titleEn || '',
        titleJa: values.titleJa || '',
        content: values.content,
        contentEn: values.contentEn || '',
        contentJa: values.contentJa || '',
        type: values.type,
        notes: values.notes || '',
      });
      message.success(t('policies.versionCreated', { version: data.version }));
      setCreateVersionModal(false);
      // 刷新版本列表并选中新版本
      const versionsData = await apiGet<{ key: string; currentVersion: number | null; versions: VersionInfo[] }>(`/admin/policies/${createVersionKey}/versions`);
      setVersions(versionsData.versions);
      handleEditVersion(createVersionKey, data.version);
      fetchPolicies();
    } catch (err) {
      if (err instanceof Error && err.message?.includes('require')) return;
      showApiError(err, t('error.save'));
    }
  };

  // ====== 创建新政策 ======
  const handleCreatePolicy = async () => {
    try {
      const values = await createPolicyForm.validateFields();
      // 创建第一个版本（新政策通过创建版本初始化）
      await apiPost(`/admin/policies/${values.key}/versions`, {
        title: values.title,
        titleEn: values.titleEn || '',
        titleJa: values.titleJa || '',
        content: values.content,
        contentEn: values.contentEn || '',
        contentJa: values.contentJa || '',
        type: values.type,
        notes: t('policies.initialVersion'),
      });
      message.success(t('success.save'));
      setCreatePolicyModal(false);
      createPolicyForm.resetFields();
      fetchPolicies();
    } catch (err) {
      if (err instanceof Error && err.message?.includes('require')) return;
      showApiError(err, t('error.save'));
    }
  };

  // ====== 删除版本 ======
  const handleDeleteVersion = async (key: string, version: number) => {
    try {
      await apiDelete(`/admin/policies/${key}/versions/${version}`);
      message.success(t('success.delete'));
      // 刷新
      const data = await apiGet<{ key: string; currentVersion: number | null; versions: VersionInfo[] }>(`/admin/policies/${key}/versions`);
      setVersions(data.versions);
      if (selectedKey === key && selectedVersionNum === version) {
        setSelectedVersion(null);
        setSelectedVersionNum(null);
      }
      fetchPolicies();
    } catch (err) {
      showApiError(err, t('error.delete'));
    }
  };

  // ====== 删除整个政策 ======
  const handleDeletePolicy = async (key: string) => {
    try {
      await apiDelete(`/admin/policies/${key}`);
      message.success(t('success.delete'));
      if (selectedKey === key) {
        setSelectedKey(null);
        setSelectedVersion(null);
        setSelectedVersionNum(null);
        setVersions([]);
      }
      fetchPolicies();
    } catch (err) {
      showApiError(err, t('error.delete'));
    }
  };

  // ====== 格式化日期 ======
  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return dateStr;
    }
  };

  // ====== 获取选中政策的当前发布版本信息 ======
  const selectedPolicy = policies.find((p) => p.key === selectedKey) || null;

  // ====== 版本搜索过滤 ======
  const filteredVersions = versions.filter((v) => {
    if (!versionSearch) return true;
    const q = versionSearch.toLowerCase();
    return (
      String(v.version).includes(q) ||
      v.title.toLowerCase().includes(q) ||
      v.notes?.toLowerCase().includes(q)
    );
  });

  // ====== 渲染 ======
  
  // 政策列表内容（共享）
  const policyListContent = (
    <>
      {/* 列表头部 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px' }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t('policies.list.title')}</span>
        <Button type="primary" icon={<PlusOutlined />} size="small" onClick={() => { createPolicyForm.resetFields(); setCreatePolicyModal(true); }}>
          {t('policies.list.create')}
        </Button>
      </div>

      {/* 政策列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px 12px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-tertiary, #bfbfbf)' }}>{t('common.loading')}</div>
        ) : policies.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-tertiary, #bfbfbf)' }}>{t('policies.list.empty')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {policies.map((p) => {
              const isActive = selectedKey === p.key;
              const typeCfg = TYPE_CONFIG[p.type] || TYPE_CONFIG.policy;
              return (
                <div key={p.key}
                  onClick={() => handleSelectPolicy(p.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-lg, 8px)',
                    border: `1px solid ${isActive ? typeCfg.color : 'var(--color-border, #e5e5e5)'}`,
                    background: isActive ? `${typeCfg.color}08` : 'var(--color-bg-container, #ffffff)',
                    boxShadow: isActive
                      ? `0 0 0 1px ${typeCfg.color}26`
                      : 'var(--shadow-sm, 0 1px 2px 0 rgba(0,0,0,0.05))',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.borderColor = 'var(--color-border-strong, #d4d4d4)'; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.borderColor = 'var(--color-border, #e5e5e5)'; }}
                >
                  {/* 类型图标 */}
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: 'var(--radius-md, 6px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: `${typeCfg.color}12`,
                    color: typeCfg.color,
                    flexShrink: 0,
                    fontSize: 14,
                  }}>
                    {typeCfg.icon}
                  </div>

                  {/* 信息 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary, #bfbfbf)', marginTop: 2 }}>
                      <Tag color={typeCfg.color} style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', marginRight: 4 }}>
                        {t(typeCfg.label)}
                      </Tag>
                      {p.currentVersion != null ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <CheckCircleOutlined style={{ fontSize: 10, color: themeColor.success }} />
                          v{p.currentVersion}
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: '#faad14' }}>
                          <StopOutlined style={{ fontSize: 10 }} />
                          {t('policies.list.unpublished')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 移动端隐藏时间和删除按钮 */}
                  {!isMobile && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary, #bfbfbf)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {formatDate(p.updatedAt)}
                      </span>
                      <Tooltip title={t('policies.list.deleteTooltip')}>
                        <Button
                          icon={<DeleteOutlined />}
                          size="small"
                          style={{
                            flexShrink: 0,
                            background: 'var(--color-bg-page, #f5f5f5)',
                            borderColor: 'var(--color-border, #e5e5e5)',
                            color: 'var(--color-text-secondary, #595959)',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            Modal.confirm({
                              title: t('policies.list.deleteConfirm'),
                              content: t('policies.list.deleteConfirmContent', { title: p.title }),
                              centered: true,
                              onOk: () => handleDeletePolicy(p.key),
                            });
                          }}
                        />
                      </Tooltip>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <Card style={{ padding: 0 }}>
        {isMobile ? (
          // 移动端：Tabs 布局
          <Tabs
            activeKey={mobileTab}
            onChange={(key) => setMobileTab(key as 'list' | 'edit')}
            items={[
              {
                key: 'list',
                label: <span><UnorderedListOutlined /> {t('policies.mobile.list')}</span>,
                children: (
                  <div style={{ height: 'calc(100vh - 280px)', display: 'flex', flexDirection: 'column' }}>
                    {policyListContent}
                  </div>
                ),
              },
              {
                key: 'edit',
                label: <span><EditOutlined /> {t('policies.mobile.edit')}</span>,
                children: (
                  <DetailPanel
                    selectedKey={selectedKey}
                    selectedPolicy={selectedPolicy}
                    selectedVersion={selectedVersion}
                    selectedVersionNum={selectedVersionNum}
                    versions={versions}
                    filteredVersions={filteredVersions}
                    loadingVersions={loadingVersions}
                    versionSearch={versionSearch}
                    setVersionSearch={setVersionSearch}
                    editTitle={editTitle}
                    editTitleEn={editTitleEn}
                    editTitleJa={editTitleJa}
                    editContent={editContent}
                    editContentEn={editContentEn}
                    editContentJa={editContentJa}
                    editNotes={editNotes}
                    editType={editType}
                    setEditType={setEditType}
                    editLang={editLang}
                    setEditLang={setEditLang}
                    setEditTitle={setEditTitle}
                    setEditTitleEn={setEditTitleEn}
                    setEditTitleJa={setEditTitleJa}
                    setEditContent={setEditContent}
                    setEditContentEn={setEditContentEn}
                    setEditContentJa={setEditContentJa}
                    setEditNotes={setEditNotes}
                    handleEditVersion={handleEditVersion}
                    handleCreateVersion={handleCreateVersion}
                    handlePublish={handlePublish}
                    handleDeleteVersion={handleDeleteVersion}
                    handleSave={handleSave}
                    saving={saving}
                    formatDate={formatDate}
                  />
                ),
              },
            ]}
          />
        ) : (
          // 桌面端：左右分栏布局
          <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: 500, overflow: 'hidden' }}>
            {/* 政策列表 */}
            <div style={{ width: '100%', maxWidth: 300, borderRight: '1px solid var(--color-border, #f0f0f0)', borderBottom: '1px solid var(--color-border, #f0f0f0)', display: 'flex', flexDirection: 'column' }}>
              {policyListContent}
            </div>

            {/* 详情面板 */}
            <div style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <DetailPanel
                selectedKey={selectedKey}
                selectedPolicy={selectedPolicy}
                selectedVersion={selectedVersion}
                selectedVersionNum={selectedVersionNum}
                versions={versions}
                filteredVersions={filteredVersions}
                loadingVersions={loadingVersions}
                versionSearch={versionSearch}
                setVersionSearch={setVersionSearch}
                editTitle={editTitle}
                editTitleEn={editTitleEn}
                editTitleJa={editTitleJa}
                editContent={editContent}
                editContentEn={editContentEn}
                editContentJa={editContentJa}
                editNotes={editNotes}
                editType={editType}
                setEditType={setEditType}
                editLang={editLang}
                setEditLang={setEditLang}
                setEditTitle={setEditTitle}
                setEditTitleEn={setEditTitleEn}
                setEditTitleJa={setEditTitleJa}
                setEditContent={setEditContent}
                setEditContentEn={setEditContentEn}
                setEditContentJa={setEditContentJa}
                setEditNotes={setEditNotes}
                handleEditVersion={handleEditVersion}
                handleCreateVersion={handleCreateVersion}
                handlePublish={handlePublish}
                handleDeleteVersion={handleDeleteVersion}
                handleSave={handleSave}
                saving={saving}
                formatDate={formatDate}
              />
            </div>
          </div>
        )}

      {/* ====== 新建政策弹窗 ====== */}
      <Modal
        title={t('policies.createModal.title')}
        open={createPolicyModal}
        onOk={handleCreatePolicy}
        onCancel={() => setCreatePolicyModal(false)}
        okText={t('policies.createModal.ok')}
        cancelText={t('common.cancel')}
      >
        <Form form={createPolicyForm} layout="vertical">
          <Form.Item
            name="key"
            label={t('policies.createModal.key')}
            rules={[{ required: true, message: t('policies.createModal.keyRequired') }]}
          >
            <Input placeholder={t('policies.createModal.keyPlaceholder')} />
          </Form.Item>
          <Form.Item
            name="title"
            label={t('policies.createModal.titleLabel')}
            rules={[{ required: true, message: t('policies.createModal.titleRequired') }]}
          >
            <Input placeholder={t('policies.createModal.titlePlaceholder')} />
          </Form.Item>
          <Form.Item
            name="type"
            label={t('policies.createModal.type')}
            rules={[{ required: true, message: t('policies.createModal.typeRequired') }]}
            initialValue="policy"
          >
            <Select>
              <Select.Option value="policy">{t('policies.type.policyLabel')}</Select.Option>
              <Select.Option value="announcement">{t('policies.type.announcementLabel')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="content"
            label={t('policies.createModal.content')}
          >
            <Input.TextArea rows={6} placeholder={t('policies.createModal.contentPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ====== 新建版本弹窗 ====== */}
      <Modal
        title={t('policies.versionModal.title')}
        open={createVersionModal}
        onOk={confirmCreateVersion}
        onCancel={() => setCreateVersionModal(false)}
        okText={t('policies.versionModal.ok')}
        cancelText={t('common.cancel')}
      >
        <Form form={createVersionForm} layout="vertical">
          <Form.Item
            name="title"
            label={t('policies.versionModal.titleZh')}
            rules={[{ required: true, message: t('policies.createModal.titleRequired') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="titleEn"
            label={t('policies.versionModal.titleEn')}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="titleJa"
            label={t('policies.versionModal.titleJa')}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="type"
            label={t('policies.versionModal.type')}
            rules={[{ required: true, message: t('policies.versionModal.typeRequired') }]}
          >
            <Select>
              <Select.Option value="policy">{t('policies.type.policyLabel')}</Select.Option>
              <Select.Option value="announcement">{t('policies.type.announcementLabel')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="content"
            label={t('policies.versionModal.contentZh')}
          >
            <Input.TextArea rows={6} />
          </Form.Item>
          <Form.Item
            name="contentEn"
            label={t('policies.versionModal.contentEn')}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item
            name="contentJa"
            label={t('policies.versionModal.contentJa')}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item
            name="notes"
            label={t('policies.versionModal.notes')}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
    </>
  );
}

// ====== DetailPanel 子组件 ======
interface DetailPanelProps {
  selectedKey: string | null;
  selectedPolicy: PolicyInfo | null;
  selectedVersion: VersionDetail | null;
  selectedVersionNum: number | null;
  versions: VersionInfo[];
  filteredVersions: VersionInfo[];
  loadingVersions: boolean;
  versionSearch: string;
  setVersionSearch: (v: string) => void;
  editTitle: string;
  editTitleEn: string;
  editTitleJa: string;
  editContent: string;
  editContentEn: string;
  editContentJa: string;
  editNotes: string;
  editType: 'policy' | 'announcement';
  setEditType: (v: 'policy' | 'announcement') => void;
  editLang: 'zh' | 'en' | 'ja';
  setEditLang: (v: 'zh' | 'en' | 'ja') => void;
  setEditTitle: (v: string) => void;
  setEditTitleEn: (v: string) => void;
  setEditTitleJa: (v: string) => void;
  setEditContent: (v: string) => void;
  setEditContentEn: (v: string) => void;
  setEditContentJa: (v: string) => void;
  setEditNotes: (v: string) => void;
  handleEditVersion: (key: string, version: number) => void;
  handleCreateVersion: (key: string) => void;
  handlePublish: (version: number) => void;
  handleDeleteVersion: (key: string, version: number) => void;
  handleSave: () => void;
  saving: boolean;
  formatDate: (dateStr: string) => string;
}

function DetailPanel(props: DetailPanelProps) {
  const { t } = useTranslation();
  const {
    selectedKey, selectedPolicy, selectedVersion, selectedVersionNum,
    filteredVersions, loadingVersions, versionSearch, setVersionSearch,
    editTitle, editTitleEn, editTitleJa, editContent, editContentEn, editContentJa,
    editNotes, editType, setEditType, editLang, setEditLang,
    setEditTitle, setEditTitleEn, setEditTitleJa,
    setEditContent, setEditContentEn, setEditContentJa,
    setEditNotes, handleEditVersion, handleCreateVersion,
    handlePublish, handleDeleteVersion, handleSave, saving,
  } = props;

  if (!selectedKey) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--color-text-tertiary, #bfbfbf)', fontSize: 14, minHeight: 300 }}>
        {t('policies.detail.selectPolicy')}
      </div>
    );
  }

  return (
    <>
      {/* 政策头部信息 */}
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--color-border, #f0f0f0)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>{selectedPolicy?.title || selectedKey}</span>
            {selectedPolicy && (
              <Tag color={TYPE_CONFIG[selectedPolicy.type]?.color}>
                {t(TYPE_CONFIG[selectedPolicy.type]?.label || 'policies.type.policyLabel')}
              </Tag>
            )}
            {selectedPolicy?.currentVersion != null && (
              <Tag color="green">{t('policies.detail.publishedTag', { version: selectedPolicy.currentVersion })}</Tag>
            )}
            {selectedPolicy?.currentVersion == null && (
              <Tag color="orange">{t('policies.detail.unpublishedTag')}</Tag>
            )}
          </div>
          <Space>
            <Button
              icon={<PlusOutlined />}
              size="small"
              onClick={() => handleCreateVersion(selectedKey)}
            >
              {t('policies.detail.createVersion')}
            </Button>
          </Space>
        </div>
      </div>

      {/* 版本历史 — 搜索列表 */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--color-border, #f0f0f0)', background: 'var(--color-bg-elevated, #fafafa)' }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary, #bfbfbf)', marginBottom: 8, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          <HistoryOutlined /> {t('policies.detail.versionHistory')}
        </div>
        <Input
          size="small"
          placeholder={t('policies.detail.searchVersion')}
          prefix={<SearchOutlined style={{ fontSize: 12, color: 'var(--color-text-tertiary, #bfbfbf)' }} />}
          value={versionSearch}
          onChange={(e) => setVersionSearch(e.target.value)}
          style={{ marginBottom: 8, fontSize: 12 }}
          allowClear
        />
        {filteredVersions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 16, fontSize: 12, color: 'var(--color-text-tertiary, #bfbfbf)' }}>
            {t('policies.detail.noMatchVersion')}
          </div>
        ) : (
          <div style={{ maxHeight: 150, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filteredVersions.map((v) => (
              <div
                key={v.version}
                onClick={() => handleEditVersion(selectedKey, v.version)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-md, 6px)',
                  background: selectedVersionNum === v.version ? '#e6f4ff' : 'transparent',
                  border: `1px solid ${selectedVersionNum === v.version ? themeColor.primary : 'transparent'}`,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  fontSize: 12,
                }}
                onMouseEnter={(e) => {
                  if (selectedVersionNum !== v.version) e.currentTarget.style.background = 'var(--color-bg-page, #f5f5f5)';
                }}
                onMouseLeave={(e) => {
                  if (selectedVersionNum !== v.version) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 12, minWidth: 28, color: selectedVersionNum === v.version ? themeColor.primary : 'inherit' }}>
                  v{v.version}
                </span>
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.title}
                </div>
                {v.published && <CheckCircleOutlined style={{ fontSize: 11, color: themeColor.success, flexShrink: 0 }} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 编辑器 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {loadingVersions ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-tertiary, #bfbfbf)' }}>{t('common.loading')}</div>
        ) : selectedVersion ? (
          <>
            {/* 操作栏 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {t('policies.detail.editVersion', { version: selectedVersionNum })}
                </span>
                {selectedVersion.published && (
                  <Tag color="green" style={{ fontSize: 10, lineHeight: '16px' }}>{t('policies.detail.publishedReadonly')}</Tag>
                )}
                {!selectedVersion.published && (
                  <Tag color="orange" style={{ fontSize: 10, lineHeight: '16px' }}>{t('policies.detail.draft')}</Tag>
                )}
              </div>
              <Space>
                {!selectedVersion.published && (
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    size="small"
                    onClick={() => handlePublish(selectedVersionNum!)}
                  >
                    {t('policies.detail.publish')}
                  </Button>
                )}
                <Button
                  icon={<DeleteOutlined />}
                  size="small"
                  danger
                  onClick={() => {
                    Modal.confirm({
                      title: t('policies.deleteVersion.confirm'),
                      content: selectedVersion.published
                        ? t('policies.deleteVersion.publishedContent', { version: selectedVersionNum })
                        : t('policies.deleteVersion.draftContent', { version: selectedVersionNum }),
                      centered: true,
                      onOk: () => handleDeleteVersion(selectedKey, selectedVersionNum!),
                    });
                  }}
                >
                  {t('policies.detail.delete')}
                </Button>
              </Space>
            </div>

            {/* 版本说明 */}
            <div style={{ marginBottom: 12 }}>
              <Input
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder={t('policies.detail.placeholder.notes')}
                disabled={selectedVersion.published}
                size="small"
                style={{ fontSize: 12 }}
              />
            </div>

            {/* 标题 + 类型 */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <Input
                value={editLang === 'zh' ? editTitle : editLang === 'en' ? editTitleEn : editTitleJa}
                onChange={(e) => {
                  const val = e.target.value;
                  if (editLang === 'zh') setEditTitle(val);
                  else if (editLang === 'en') setEditTitleEn(val);
                  else setEditTitleJa(val);
                }}
                placeholder={editLang === 'zh' ? t('policies.detail.placeholder.titleZh') : editLang === 'en' ? t('policies.detail.placeholder.titleEn') : t('policies.detail.placeholder.titleJa')}
                disabled={selectedVersion.published}
                size="large"
                style={{ fontSize: 16, fontWeight: 600, flex: 1, minWidth: 200 }}
              />
              <Select
                value={editType}
                onChange={(v) => setEditType(v as 'policy' | 'announcement')}
                disabled={selectedVersion.published}
                style={{ width: 120 }}
                options={[
                  { value: 'policy', label: t('policies.type.policyLabel') },
                  { value: 'announcement', label: t('policies.type.announcementLabel') },
                ]}
              />
            </div>

            {/* 语言切换 */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {(['zh', 'en', 'ja'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setEditLang(lang)}
                  style={{
                    padding: '4px 12px',
                    border: `1px solid ${editLang === lang ? themeColor.primary : 'transparent'}`,
                    borderRadius: 'var(--radius-sm, 4px)',
                    background: editLang === lang ? '#e6f4ff' : 'transparent',
                    color: editLang === lang ? themeColor.primary : 'var(--color-text-tertiary, #bfbfbf)',
                    fontSize: 12,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {lang === 'zh' ? t('policies.detail.langZh') : lang === 'en' ? t('policies.detail.langEn') : t('policies.detail.langJa')}
                </button>
              ))}
            </div>

            {/* 内容编辑器 */}
            <Input.TextArea
              value={editLang === 'zh' ? editContent : editLang === 'en' ? editContentEn : editContentJa}
              onChange={(e) => {
                const val = e.target.value;
                if (editLang === 'zh') setEditContent(val);
                else if (editLang === 'en') setEditContentEn(val);
                else setEditContentJa(val);
              }}
              placeholder={t('policies.detail.placeholder.content')}
              disabled={selectedVersion.published}
              rows={12}
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />

            {/* 保存按钮 */}
            {!selectedVersion.published && (
              <div style={{ marginTop: 12, textAlign: 'right' }}>
                <Button
                  type="primary"
                  onClick={handleSave}
                  loading={saving}
                >
                  {t('common.save')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-tertiary, #bfbfbf)' }}>
            {t('policies.detail.selectVersion')}
          </div>
        )}
      </div>
    </>
  );
}