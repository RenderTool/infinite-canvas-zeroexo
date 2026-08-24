/**
 * CanvasPage - 画布项目列表页
 *
 * 从原 HomePage 提取的画布项目列表功能。
 * 展示用户创建的所有画布项目，支持新建、删除、重命名、搜索、选择模式、导入/导出。
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Trash2, CheckSquare, Square, Download, Upload, Users, LogOut } from 'lucide-react';
import { App, Button, Input, Modal, Typography, Space, Form, Skeleton, Tooltip, Select } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { AntdThemeProvider, ProjectCard, CoverUploadModal } from '@/shared/components/index.js';
import type { ProjectCardAction } from '@/shared/components/index.js';
import { useCoverUpload } from '@/shared/hooks/use-cover-upload.js';
import { useProjects } from './use-projects.js';
import { updateProject, loadProjectGraph, saveProjectGraph } from '@zeroexo/plugin-persistence';
import { exportProjects } from './services/export-projects.js';
import { importProjectsFromZip } from './services/import-projects.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { fullSync, onProjectUpdated } from '@/services/sync/sync-service.js';
import { CollaborationModal } from '@/features/collaboration/collaboration-modal.js';
import { listMyCanvases, listParticipating, removeSelfFromRoom } from '@/features/collaboration/collaboration-api.js';
import type { MyCanvasItem, ParticipatingCanvasItem } from '@/features/collaboration/collaboration-types.js';

const { Text, Title } = Typography;

export interface CanvasPageProps {
  onOpen: (canvasId: string) => void;
}

export function CanvasPage({ onOpen }: CanvasPageProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const isMobile = useIsMobile();
  const { projects, loading, error, createProject, copyProject, deleteProjects, renameProject, refresh } = useProjects();

  const [search, setSearch] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // 协作入口（发起协作模式 + 我参与的协作画布 + 协作筛选）
  const [collabMode, setCollabMode] = useState(false);
  const [collabFilter, setCollabFilter] = useState<'all' | 'mine' | 'joined'>('all');
  const [myCanvases, setMyCanvases] = useState<MyCanvasItem[]>([]);
  const [participating, setParticipating] = useState<ParticipatingCanvasItem[]>([]);
  const [collabModalOpen, setCollabModalOpen] = useState(false);
  const [collabTargetId, setCollabTargetId] = useState<string | null>(null);

  // 加载协作列表（自有画布协作状态 + 我参与的协作画布）；失败静默，C端不展示后端细节
  const loadCollabLists = useCallback(async () => {
    try {
      const [mine, joined] = await Promise.all([listMyCanvases(), listParticipating()]);
      setMyCanvases(mine);
      setParticipating(joined);
    } catch {
      // 静默失败
    }
  }, []);

  useEffect(() => {
    void loadCollabLists();
  }, [loadCollabLists]);

  /** 失效协作：点击/更多操作 → 确认弹窗告知"已失效"后从列表移除（不打开协作设置页） */
  const handleRemoveExpired = useCallback(
    (item: ParticipatingCanvasItem) => {
      modal.confirm({
        title: t('collab.expiredRemoveTitle'),
        content: t('collab.expiredRemoveContent'),
        okText: t('collab.removeFromList'),
        cancelText: t('common.cancel'),
        okType: 'danger',
        centered: true,
        onOk: async () => {
          try {
            await removeSelfFromRoom(item.canvasId);
            message.success(t('collab.removedSuccess'));
            // 本地立即移除（即使后台刷新失败也保证列表即时更新），再后台刷新保持一致
            setParticipating((prev) => prev.filter((p) => p.canvasId !== item.canvasId));
            void loadCollabLists();
          } catch {
            message.error(t('collab.operationFailed'));
          }
        },
      });
    },
    [modal, t, message, loadCollabLists],
  );

  /** 我参与的活跃协作：更多菜单「退出协作」→ 书面化确认后移除成员身份并从列表移除（Plan#38 Phase 9.6） */
  const handleExitParticipating = useCallback(
    (item: ParticipatingCanvasItem) => {
      modal.confirm({
        title: t('collab.exitConfirmTitle'),
        content: t('collab.exitConfirmContent'),
        okText: t('collab.exitCollaboration'),
        cancelText: t('common.cancel'),
        okType: 'danger',
        centered: true,
        onOk: async () => {
          try {
            await removeSelfFromRoom(item.canvasId);
            message.success(t('collab.exitSuccess'));
            setParticipating((prev) => prev.filter((p) => p.canvasId !== item.canvasId));
            void loadCollabLists();
          } catch {
            message.error(t('collab.operationFailed'));
          }
        },
      });
    },
    [modal, t, message, loadCollabLists],
  );

  // 重命名弹窗
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);

  // 封面上传 (使用共享 hook，与 HomePage 保持同一逻辑)
  const { coverState, openCoverUpload, closeCoverUpload, confirmCoverUpload } = useCoverUpload();

  const [busy, setBusy] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form] = Form.useForm();

  const allProjects = useMemo(() => projects, [projects]);

  /** 搜索过滤后的全部自有画布 */
  const searchFilteredAll = useMemo(() => {
    if (!search.trim()) return allProjects;
    const keyword = search.toLowerCase();
    return allProjects.filter((p) => p.title.toLowerCase().includes(keyword));
  }, [allProjects, search]);

  /** 自有画布 → 协作状态映射（来自 listMyCanvases） */
  const myCanvasStatus = useMemo(() => {
    const map = new Map<string, MyCanvasItem>();
    myCanvases.forEach((m) => map.set(m.canvasId, m));
    return map;
  }, [myCanvases]);

  /** 画布列表展示的自有画布（受协作模式 / 协作筛选影响） */
  const displayOwnProjects = useMemo(() => {
    if (collabMode) return searchFilteredAll;
    if (collabFilter === 'joined') return [];
    let list = searchFilteredAll;
    if (collabFilter === 'mine') {
      // 我发起的协作：自有画布且协作已开启/曾开启
      list = list.filter((p) => {
        const s = myCanvasStatus.get(p.id)?.collaborationStatus;
        return s === 'active' || s === 'expired';
      });
    }
    return list;
  }, [collabMode, collabFilter, searchFilteredAll, myCanvasStatus]);

  /** 我参与的协作画布（普通模式下展示；选择/发起协作模式下不展示） */
  const displayParticipating = useMemo(() => {
    if (collabMode || collabFilter === 'mine') return [];
    let list = participating;
    if (search.trim()) {
      const keyword = search.toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(keyword));
    }
    return list;
  }, [collabMode, collabFilter, participating, search]);

  /** 选择模式可批量操作的自有画布（参与的画布不可批量操作） */
  const displayForSelect = searchFilteredAll;

  const listForRender = selectMode ? displayForSelect : displayOwnProjects;
  const isEmpty = listForRender.length === 0 && (selectMode || displayParticipating.length === 0);

  /** 自动递增命名：生成 "未命名项目", "未命名项目 2", "未命名项目 3"... */
  const getNextProjectName = useCallback((): string => {
    const baseName = '未命名项目';
    const existingNames = projects.map((p) => p.title);
    if (!existingNames.includes(baseName)) return baseName;
    let i = 2;
    while (existingNames.includes(`${baseName} ${i}`)) i++;
    return `${baseName} ${i}`;
  }, [projects]);

  const handleCreate = useCallback(() => {
    form.resetFields();
    setCreateModalOpen(true);
  }, [form]);

  const handleCreateConfirm = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const title = (values.title || '').trim() || getNextProjectName();
      setBusy(true);
      setCreateModalOpen(false);
      const project = await createProject(title);
      if (project) {
        message.success(t('home.createSuccess'));
        // 创建后不自动打开,仅提示成功并刷新列表(与剧创行为一致,等待用户主动点击进入)
        await refresh();
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      setCreateModalOpen(false);
    } finally {
      setBusy(false);
    }
  }, [createProject, t, message, form, getNextProjectName, refresh]);

  const handleCreateCancel = useCallback(() => {
    setCreateModalOpen(false);
    form.resetFields();
  }, [form]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const enterSelectMode = useCallback(() => {
    setSelectMode(true);
    setCollabMode(false);
    setSelectedIds(new Set());
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  // 发起协作模式（与选择模式互斥）
  const toggleCollabMode = useCallback(() => {
    if (collabMode) {
      setCollabMode(false);
      return;
    }
    setSelectMode(false);
    setSelectedIds(new Set());
    setCollabMode(true);
  }, [collabMode]);

  const openCollabModal = useCallback((canvasId: string) => {
    setCollabTargetId(canvasId);
    setCollabModalOpen(true);
  }, []);

  // 关闭协作弹窗后刷新协作列表（开启/关闭/移除会改变画布协作状态）
  const closeCollabModal = useCallback(() => {
    setCollabModalOpen(false);
    void loadCollabLists();
  }, [loadCollabLists]);

  const handleDelete = useCallback((id: string) => {
    setPendingDeleteId(id);
    setDeleteConfirmOpen(true);
  }, []);

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    setPendingDeleteId(null);
    setDeleteConfirmOpen(true);
  }, [selectedIds]);

  const confirmDelete = useCallback(async () => {
    if (pendingDeleteId) {
      await deleteProjects([pendingDeleteId]);
    } else if (selectedIds.size > 0) {
      await deleteProjects(Array.from(selectedIds));
      exitSelectMode();
    }
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);
  }, [pendingDeleteId, selectedIds, deleteProjects, exitSelectMode]);

  const cancelDelete = useCallback(() => {
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);
  }, []);

  // 重命名
  const handleRenameOpen = useCallback((id: string, title: string) => {
    setRenameTarget({ id, title });
    setRenameModalOpen(true);
  }, []);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameTarget) return;
    try {
      await renameProject(renameTarget.id, renameTarget.title);
      setRenameModalOpen(false);
      setRenameTarget(null);
    } catch (err) {
      message.error(t('errors.BAD_REQUEST'));
    }
  }, [renameTarget, renameProject, t, message]);

  const handleRenameCancel = useCallback(() => {
    setRenameModalOpen(false);
    setRenameTarget(null);
  }, []);

  // 拷贝项目
  const handleCopy = useCallback(async (id: string) => {
    const project = await copyProject(id);
    if (project) {
      message.success(`${t('home.copySuccess')}「${project.title}」`);
      await refresh();
    }
  }, [copyProject, t, message, refresh]);

  // 封面上传
  const handleCoverConfirm = useCallback(async (file: File) => {
    if (!coverState.target) return;
    const cloudUrl = await confirmCoverUpload(file, message as any);
    if (!cloudUrl) return;

    // 持久化到画布 graph.metadata + 本地元数据 + 云同步
    const coverId = coverState.target.id;
    try {
      const graph = await loadProjectGraph(coverId);
      if (graph) {
        graph.metadata = { ...graph.metadata, coverUrl: cloudUrl };
        await saveProjectGraph(coverId, graph);
      }
    } catch (err) {
      console.warn('[cover] save to graph metadata failed:', err);
    }

    await updateProject(coverId, { thumbnailUrl: cloudUrl });
    onProjectUpdated(coverId);

    message.success('封面设置成功');
    closeCoverUpload();
    await refresh();
  }, [coverState.target, confirmCoverUpload, closeCoverUpload, refresh, message]);

  const refreshProjects = useCallback(async () => {
    if (selectedIds.size === 0 || busy) return;
    setBusy(true);
    try {
      await exportProjects(Array.from(selectedIds), `zeroexo-${selectedIds.size}projects`);
    } catch (err) {
      message.error(t('home.exportFailed'));
    } finally {
      setBusy(false);
    }
  }, [selectedIds, busy, t, message]);

  const handleImportClick = useCallback(() => {
    if (busy) return;
    fileInputRef.current?.click();
  }, [busy]);

  const handleImportFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const imported = await importProjectsFromZip(file);
      if (imported.length > 0) {
        await refresh();
        void fullSync();
      } else {
        message.error(t('home.importFailed'));
      }
    } catch (err) {
      message.error(t('home.importFailed'));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [refresh, t, message]);

  const hasSelection = selectedIds.size > 0;
  const deleteTargetCount = pendingDeleteId ? 1 : selectedIds.size;

  if (loading) {
    return (
      <AntdThemeProvider>
        <div style={pageStyle}>
          <div style={toolbarStyle(theme, isMobile)}>
            <Skeleton.Input active size="small" style={{ width: 100, borderRadius: 4 }} />
            <Space size={8}>
              <Skeleton.Input active size="small" style={{ width: 220, borderRadius: 4 }} />
              <Skeleton.Button active size="small" style={{ borderRadius: 6 }} />
              <Skeleton.Button active size="small" style={{ borderRadius: 6 }} />
              <Skeleton.Button active size="small" style={{ borderRadius: 6 }} />
            </Space>
          </div>
          <div style={contentScrollStyle}>
            <div style={gridStyle(isMobile)}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Skeleton.Image active style={{ width: '100%', height: 160, borderRadius: 12 }} />
                  <Skeleton.Input active size="small" style={{ width: '55%', borderRadius: 4 }} />
                  <Skeleton.Input active size="small" style={{ width: '35%', borderRadius: 4 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </AntdThemeProvider>
    );
  }

  return (
    <AntdThemeProvider>
      <div style={pageStyle}>
        {error && (
          <div style={errorStyle}>
            {t('home.loadFailed')}: {error}
          </div>
        )}

        <div style={toolbarStyle(theme, isMobile)}>
          <Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>
            画布
          </Title>

          <Space size={8} wrap>
            <Tooltip title={t('home.searchPlaceholder')}>
              <Input
                prefix={<Search size={14} style={{ opacity: 0.5 }} />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('home.searchPlaceholder')}
                allowClear
                style={{ width: isMobile ? '100%' : 180 }}
                size="small"
              />
            </Tooltip>

            {!collabMode && !selectMode && (
              <Select
                size="small"
                value={collabFilter}
                onChange={(v) => setCollabFilter((v ?? 'all') as 'all' | 'mine' | 'joined')}
                allowClear
                style={{ width: 140 }}
                options={[
                  { value: 'all', label: t('home.collabFilterAll') },
                  { value: 'mine', label: t('home.collabFilterMine') },
                  { value: 'joined', label: t('home.collabFilterJoined') },
                ]}
              />
            )}

            {allProjects.length > 0 && (
              <Tooltip title={selectMode ? t('home.exitSelect') : t('home.selectMode')}>
                <Button
                  icon={selectMode ? <CheckSquare size={14} /> : <Square size={14} />}
                  size="small"
                  onClick={selectMode ? exitSelectMode : enterSelectMode}
                />
              </Tooltip>
            )}

            {allProjects.length > 0 && (
              <Tooltip title={collabMode ? t('home.exitCollaborationMode') : t('home.startCollaboration')}>
                <Button
                  icon={<Users size={14} />}
                  size="small"
                  type={collabMode ? 'primary' : 'default'}
                  ghost={collabMode}
                  onClick={toggleCollabMode}
                  // Phase 9.7：激活态呼吸闪烁，提醒用户仍处于发起协作模式（再次点击可退出）
                  style={collabMode ? { animation: 'zeroexo-collab-pulse 1.5s ease-in-out infinite' } : undefined}
                />
              </Tooltip>
            )}
            {collabMode && (
              <>
                <style>{`@keyframes zeroexo-collab-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(22,119,255,0.6); opacity: 1; } 50% { box-shadow: 0 0 0 7px rgba(22,119,255,0); opacity: 0.75; } }`}</style>
                <span style={{ fontSize: 12, color: theme.toolbar.textMuted, marginLeft: 2 }}>
                  {t('home.collabModeHint')}
                </span>
              </>
            )}

            {selectMode && displayForSelect.length > 0 && (
              <Button
                size="small"
                onClick={() => {
                  if (selectedIds.size === displayForSelect.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(displayForSelect.map((p) => p.id)));
                  }
                }}
              >
                {selectedIds.size === displayForSelect.length ? '取消全选' : '全选'}
              </Button>
            )}

            {selectMode && hasSelection && (
              <Tooltip title={`${t('home.deleteSelected')}(${selectedIds.size})`}>
                <Button
                  icon={<Trash2 size={14} />}
                  size="small"
                  danger
                  onClick={handleBatchDelete}
                />
              </Tooltip>
            )}

            {selectMode && hasSelection && (
              <Tooltip title={t('home.exportZip')}>
                <Button
                  icon={<Download size={14} />}
                  size="small"
                  onClick={refreshProjects}
                  disabled={busy}
                />
              </Tooltip>
            )}

            {!collabMode && (
              <Tooltip title={t('home.importZip')}>
                <Button icon={<Upload size={14} />} size="small" onClick={handleImportClick} disabled={busy} />
              </Tooltip>
            )}

            {!collabMode && (
              <Tooltip title={t('home.newCanvas')}>
                <Button type="primary" icon={<Plus size={14} />} size="small" onClick={handleCreate} disabled={busy} />
              </Tooltip>
            )}
          </Space>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/zip,.zip"
          style={{ display: 'none' }}
          onChange={(e) => void handleImportFile(e)}
        />

        <div style={contentScrollStyle}>
          {isEmpty ? (
            collabMode ? (
              <div style={emptyStyle()}>
                <Text strong style={{ fontSize: 15, marginBottom: 4 }}>
                  {t('home.collabModeEmpty')}
                </Text>
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
                  {t('home.collabModeEmpty')}
                </Text>
              </div>
            ) : collabFilter === 'joined' ? (
              <div style={emptyStyle()}>
                <Text strong style={{ fontSize: 15, marginBottom: 4 }}>
                  {t('home.collabJoinedEmpty')}
                </Text>
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
                  {t('home.collabFilterJoined')}
                </Text>
              </div>
            ) : (
              <div style={emptyStyle()}>
                <div
                  style={emptyIconStyle}
                  onClick={handleCreate}
                  title={t('home.newCanvas')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCreate(); }}
                >
                  <Plus size={32} style={{ opacity: 0.3 }} />
                </div>
                <Text strong style={{ fontSize: 15, marginBottom: 4 }}>
                  {search ? t('home.empty') : t('home.empty')}
                </Text>
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
                  {search ? t('home.searchPlaceholder') : t('home.emptyHint')}
                </Text>
              </div>
            )
          ) : (
            <div style={gridStyle(isMobile)}>
              {!collabMode && !selectMode && collabFilter !== 'joined' && (
                <ProjectCard variant="create" onClick={handleCreate} />
              )}
              {listForRender.map((project, index) => {
                const collabStatus = myCanvasStatus.get(project.id)?.collaborationStatus;
                const actions: ProjectCardAction[] = [
                  {
                    type: 'cover',
                    onClick: () => openCoverUpload(project.id, project.thumbnailUrl),
                  },
                  {
                    type: 'copy',
                    onClick: () => handleCopy(project.id),
                  },
                  {
                    type: 'rename',
                    onClick: () => handleRenameOpen(project.id, project.title),
                  },
                  { type: 'delete', onClick: () => handleDelete(project.id) },
                  { type: 'collab', onClick: () => openCollabModal(project.id) },
                ];
                return (
                  <div
                    key={project.id}
                    style={{
                      animation: 'zeroexo-fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
                      animationDelay: `${Math.min(index * 40, 400)}ms`,
                    }}
                  >
                    <ProjectCard
                      title={project.title}
                      cover={project.thumbnailUrl ?? undefined}
                      updateTime={`${t('home.updatedAt')} ${new Date(project.updatedAt).toLocaleDateString()}`}
                      onClick={() => {
                        if (collabMode) { openCollabModal(project.id); return; }
                        if (selectMode) { handleToggleSelect(project.id); return; }
                        onOpen(project.id);
                      }}
                      actions={actions}
                      selected={selectedIds.has(project.id)}
                      onToggleSelect={selectMode ? () => handleToggleSelect(project.id) : undefined}
                      statusTag={collabStatus === 'active'
                        ? { label: t('home.collabActive'), tone: 'success' }
                        : undefined}
                    />
                  </div>
                );
              })}
              {!selectMode && displayParticipating.map((item) => {
                const expired = item.roomStatus === 'expired' || item.roomStatus === 'closed';
                // 失效协作 → 仅"从列表移除"；活跃协作 → 协作详情 + 退出协作（Phase 9.6）
                const actions: ProjectCardAction[] = expired
                  ? [{ type: 'collab', label: t('projectCard.removeFromList'), onClick: () => handleRemoveExpired(item) }]
                  : [
                      { type: 'collab', label: t('projectCard.collabDetail'), onClick: () => openCollabModal(item.canvasId) },
                      { type: 'custom', label: t('collab.exitCollaboration'), icon: <LogOut size={14} />, danger: true, onClick: () => handleExitParticipating(item) },
                    ];
                return (
                  <div
                    key={`collab-${item.canvasId}`}
                    style={{
                      animation: 'zeroexo-fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
                    }}
                  >
                    <ProjectCard
                      title={item.title}
                      cover={item.thumbnailUrl ?? undefined}
                      updateTime={`${t('home.updatedAt')} ${new Date(item.lastActiveAt).toLocaleDateString()}`}
                      onClick={expired ? () => handleRemoveExpired(item) : () => onOpen(item.canvasId)}
                      actions={actions}
                      statusTag={expired
                        ? { label: t('home.collabExpired'), tone: 'error' }
                        : { label: t('home.collabParticipating'), tone: 'processing' }}
                      expiredOverlay={expired}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Modal
          title={t('home.deleteConfirmTitle')}
          open={deleteConfirmOpen}
          onOk={confirmDelete}
          onCancel={cancelDelete}
          okText={t('home.delete')}
          cancelText={t('home.cancel')}
          okButtonProps={{ danger: true }}
          destroyOnHidden
          centered
        >
          <Text>
            {t('home.deleteConfirm')}
            <Text strong>（{deleteTargetCount} 个）</Text>
          </Text>
        </Modal>

        {/* 重命名弹窗 */}
        <Modal
          title={t('home.rename')}
          open={renameModalOpen}
          onOk={handleRenameConfirm}
          onCancel={handleRenameCancel}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
          destroyOnHidden
          centered
        >
          <Input
            value={renameTarget?.title ?? ''}
            onChange={(e) => setRenameTarget((prev) => prev ? { ...prev, title: e.target.value } : null)}
            onPressEnter={handleRenameConfirm}
            autoFocus
          />
        </Modal>

        <Modal
          title={t('home.createCanvas')}
          open={createModalOpen}
          onOk={handleCreateConfirm}
          onCancel={handleCreateCancel}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
          destroyOnHidden
          centered
          forceRender
        >
          <Form form={form} layout="vertical" autoComplete="off" initialValues={{ title: '' }}>
            <Form.Item
              name="title"
              label={t('home.canvasName')}
              rules={[{ max: 100, message: t('home.canvasNameMaxLength') }]}
            >
              <Input
                placeholder="为项目命名（可选，留空将自动命名）"
                autoFocus
                onPressEnter={handleCreateConfirm}
              />
            </Form.Item>
          </Form>
        </Modal>

        {/* 封面上传弹窗 */}
        {coverState.target && (
          <CoverUploadModal
            open={coverState.modalOpen}
            onCancel={closeCoverUpload}
            onConfirm={handleCoverConfirm}
            initialCover={coverState.target.thumbnailUrl ?? undefined}
          />
        )}

        {/* 协作设置弹窗（发起协作 / 协作详情，与画布内共用同一组件） */}
        {collabTargetId && (
          <CollaborationModal
            open={collabModalOpen}
            canvasId={collabTargetId}
            onClose={closeCollabModal}
            theme={theme}
          />
        )}
      </div>
    </AntdThemeProvider>
  );
}

// ===== 样式 =====
const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  overflow: 'hidden',
};

const errorStyle: CSSProperties = {
  padding: '8px 12px',
  marginBottom: 12,
  borderRadius: 8,
  background: 'rgba(239,68,68,0.1)',
  border: '1px solid rgba(239,68,68,0.3)',
  fontSize: 12,
};

const contentScrollStyle: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 24,
};

function toolbarStyle(_theme: { toolbar: { border: string } }, isMobile: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: isMobile ? 'column' : 'row',
    alignItems: isMobile ? 'stretch' : 'center',
    justifyContent: 'flex-start',
    padding: isMobile ? '10px 12px' : '12px 20px',
    flexShrink: 0,
    gap: isMobile ? 8 : 16,
  };
}

function gridStyle(isMobile: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isMobile
      ? '1fr'
      : 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: isMobile ? 12 : 20,
    alignContent: 'start',
  };
}

function emptyStyle(): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 12,
    padding: '60px 20px',
  };
}

const emptyIconStyle: CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 16,
  border: '2px dashed rgba(128,128,128,0.25)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'all .2s',
};