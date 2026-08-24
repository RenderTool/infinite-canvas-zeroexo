/**
 * HomePage - 主页
 *
 * 布局：
 * - 创意输入区（带打字机效果的占位文本）
 * - 最近项目网格
 */

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Form, Skeleton, Modal, Input, App as AntdApp } from 'antd';

import { useTranslation } from 'react-i18next';
import i18n from '@/i18n/config';
import { useTheme } from '@zeroexo/plugin-theme';
import { AntdThemeProvider, ProjectCard, CoverUploadModal } from '@/shared/components/index.js';
import type { ProjectCardAction } from '@/shared/components/index.js';
import { useCoverUpload } from '@/shared/hooks/use-cover-upload.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { CreativeInputArea } from '@/features/creative-wizard/index.js';
import { AgentPanel } from '@/features/agent-panel/index.js';
import { listArtifacts, createArtifact, updateArtifact, deleteArtifact } from '@/services/artifact-service.js';
import type { Project } from '@/services/artifact-service.js';
import { PublicPromptSection } from './components/PublicPromptSection.js';
import { BackToTop } from './components/BackToTop.js';

export interface HomePageProps {
  onOpenProject: (id: string) => void;
  onOpenCanvas: (id: string) => void;
  onNavigate: (route: 'canvas' | 'home' | 'assets' | 'publicPrompts' | { name: 'auth'; mode: 'login' }) => void;
}

export function HomePage({ onOpenProject, onNavigate }: HomePageProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message: antdMessage, modal } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();

  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [agentOpen, setAgentOpen] = useState(false);

  // 封面上传 (使用共享 hook，与 CanvasPage 保持同一逻辑)
  const { coverState, openCoverUpload, closeCoverUpload, confirmCoverUpload } = useCoverUpload();

  // 重命名状态
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // 删除确认
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);

  // 新建项目弹窗
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [createBusy, setCreateBusy] = useState(false);

  const handleAiBusyChange = useCallback((_busy: boolean) => {
    // AI忙碌状态回调，可用于未来扩展
  }, []);

  const handleRenameStart = useCallback((id: string, title: string) => {
    setRenameProjectId(id);
    setRenameDraft(title);
  }, []);

  const handleRenameCancel = useCallback(() => {
    setRenameProjectId(null);
    setRenameDraft('');
  }, []);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameProjectId || !renameDraft.trim()) return;
    try {
      await updateArtifact(renameProjectId, { title: renameDraft.trim() });
      setRecentProjects((prev) =>
        prev.map((p) => (p.id === renameProjectId ? { ...p, title: renameDraft.trim() } : p))
      );
      antdMessage.success(t('home.renameSuccess'));
    } catch {
      antdMessage.error(t('home.renameFailed'));
    } finally {
      setRenameProjectId(null);
      setRenameDraft('');
    }
  }, [renameProjectId, renameDraft, antdMessage, t]);

  // 创建空白项目 - 打开弹窗
  const handleCreateBlank = useCallback(() => {
    if (!isAuthenticated) {
      modal.confirm({
        title: t('home.loginRequiredTitle'),
        content: t('home.loginRequiredContent'),
        okText: t('home.goLogin'),
        cancelText: t('home.stayLoggedOut'),
        centered: true,
        zIndex: 1050,
        onOk: () => onNavigate?.({ name: 'auth', mode: 'login' }),
      });
      return;
    }
    createForm.resetFields();
    setCreateModalOpen(true);
  }, [createForm, isAuthenticated, onNavigate, t]);

  /** 自动递增命名 */
  const getNextProjectName = useCallback((): string => {
    const baseName = t('home.untitledProject');
    const existingNames = recentProjects.map((p) => p.title);
    if (!existingNames.includes(baseName)) return baseName;
    let i = 2;
    while (existingNames.includes(`${baseName} ${i}`)) i++;
    return `${baseName} ${i}`;
  }, [recentProjects, t]);

  /** 新建项目确认 */
  const handleCreateConfirm = useCallback(async () => {
    try {
      const values = await createForm.validateFields();
      const title = (values.title || '').trim() || getNextProjectName();
      setCreateBusy(true);
      setCreateModalOpen(false);
      const project = await createArtifact({ title });
      if (project) {
        antdMessage.success(t('home.projectCreated'));
        onOpenProject(project.id);
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      setCreateModalOpen(false);
    } finally {
      setCreateBusy(false);
    }
  }, [createForm, getNextProjectName, antdMessage, onOpenProject, t]);

  const handleCreateCancel = useCallback(() => {
    setCreateModalOpen(false);
    createForm.resetFields();
  }, [createForm]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteProjectId) return;
    try {
      await deleteArtifact(deleteProjectId);
      setRecentProjects((prev) => prev.filter((p) => p.id !== deleteProjectId));
      antdMessage.success(t('home.deleteSuccess'));
    } catch {
      antdMessage.error(t('home.deleteFailed'));
    } finally {
      setDeleteProjectId(null);
    }
  }, [deleteProjectId, antdMessage, t]);

  // 封面上传确认
  const handleCoverConfirm = useCallback(async (file: File) => {
    if (!coverState.target) return;
    const cloudUrl = await confirmCoverUpload(file, antdMessage as any);
    if (!cloudUrl) return;

    try {
      await updateArtifact(coverState.target.id, { thumbnailUrl: cloudUrl });
      setRecentProjects((prev) =>
        prev.map((p) => p.id === coverState.target!.id ? { ...p, thumbnailUrl: cloudUrl } : p)
      );
      antdMessage.success(t('home.coverSetSuccess'));
    } catch {
      antdMessage.error(t('home.coverSetFailed'));
    }
    closeCoverUpload();
  }, [coverState.target, confirmCoverUpload, closeCoverUpload, antdMessage, t]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await listArtifacts();
        if (!cancelled) {
          const sorted = [...res.items].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
          setRecentProjects(sorted.slice(0, 8));
        }
      } catch {
        // 静默失败
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <AntdThemeProvider>
      <div style={pageStyle}>
        <div style={contentScrollStyle}>
          {/* 创意输入区 */}
          <CreativeInputArea
            onOpenProject={onOpenProject}
            onAiBusyChange={handleAiBusyChange}
          />

          {/* 最近项目 */}
          <div style={{ marginTop: 48, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div
                style={{
                  fontFamily: 'Sora, system-ui, sans-serif',
                  fontSize: 24,
                  fontWeight: 300,
                  letterSpacing: '-0.03em',
                  color: theme.toolbar.text,
                }}
              >
                {t('home.recentProjects')}
              </div>
            </div>
              {loadingProjects ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i}>
                      <Skeleton.Input active size="small" style={{ width: '100%', height: 120, borderRadius: 12, marginBottom: 8 }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
                  {/* 空白创建卡片 */}
                  <ProjectCard
                    variant="create"
                    onClick={handleCreateBlank}
                  />
                  {/* V2 引擎调研画布入口（Plan#26：Three.js 画布引擎 demo） */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { window.location.hash = '#/canvas-v2'; }}
                    onKeyDown={(e) => { if (e.key === 'Enter') window.location.hash = '#/canvas-v2'; }}
                    style={{
                      height: 120, borderRadius: 12, cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                      border: '1px dashed rgba(88,166,255,0.5)',
                      background: 'rgba(88,166,255,0.06)',
                      color: '#9ecbff', fontSize: 14, fontWeight: 600,
                    }}
                  >
                    <span style={{ fontSize: 24 }}>🧪</span>
                    V2 引擎调研画布
                    <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}>Three.js · Plan#26 demo</span>
                  </div>
                  {recentProjects.map((project) => {
                    const updatedAt = new Date(project.updatedAt);
                    const dateStr = formatRelativeDate(updatedAt);
                    const actions: ProjectCardAction[] = [
                      { type: 'cover', onClick: () => openCoverUpload(project.id, project.thumbnailUrl ?? null) },
                      { type: 'rename', onClick: () => handleRenameStart(project.id, project.title) },
                      { type: 'delete', onClick: () => setDeleteProjectId(project.id) },
                    ];
                    return (
                      <ProjectCard
                        key={project.id}
                        title={project.title}
                        updateTime={`${t('home.updatedAt')} ${dateStr}`}
                        cover={project.thumbnailUrl ?? undefined}
                        onClick={() => onOpenProject(project.id)}
                        actions={actions}
                      />
                    );
                  })}
                </div>
              )}
            </div>

          {/* 公共提示词（门户体验：最近项目下方精选展示） */}
          <PublicPromptSection onViewAll={() => onNavigate('publicPrompts')} />

          {/* 返回顶部浮动按钮（契合主题） */}
          <BackToTop />
          </div>
          <AgentPanel
          open={agentOpen}
          onClose={() => setAgentOpen(false)}
          activePhase="setup"
        />

        {/* 重命名弹窗 */}
        <Modal
          title={t('home.renameModalTitle')}
          open={!!renameProjectId}
          onCancel={handleRenameCancel}
          onOk={handleRenameConfirm}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
          centered
          zIndex={1050}
          width="calc(100vw - 32px)"
          style={{ maxWidth: 420 }}
        >
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            placeholder={t('home.namePlaceholder')}
            maxLength={50}
            autoFocus
            onPressEnter={handleRenameConfirm}
          />
        </Modal>

        {/* 删除确认弹窗 */}
        <Modal
          title={t('home.deleteProjectTitle')}
          open={!!deleteProjectId}
          onCancel={() => setDeleteProjectId(null)}
          onOk={handleDeleteConfirm}
          okText={t('home.deleteProjectOk')}
          cancelText={t('common.cancel')}
          okButtonProps={{ danger: true }}
          centered
          zIndex={1050}
          width="calc(100vw - 32px)"
          style={{ maxWidth: 420 }}
        >
          <p style={{ fontSize: 13, margin: 0 }}>
            {t('home.deleteProjectContent')}
          </p>
        </Modal>

        {/* 新建项目弹窗 */}
        <Modal
          title={t('home.createProjectTitle')}
          open={createModalOpen}
          onOk={handleCreateConfirm}
          onCancel={handleCreateCancel}
          okText={t('home.create')}
          cancelText={t('common.cancel')}
          destroyOnHidden
          centered
          forceRender
          confirmLoading={createBusy}
          width="calc(100vw - 32px)"
          style={{ maxWidth: 420 }}
        >
          <Form form={createForm} layout="vertical" autoComplete="off" initialValues={{ title: '' }}>
            <Form.Item
              name="title"
              label={t('home.projectNameLabel')}
              rules={[{ max: 100, message: t('home.nameMaxLengthMessage') }]}
            >
              <Input
                placeholder={t('home.nameCreatePlaceholder')}
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
            initialCover={(coverState.target as any).coverUrl ?? undefined}
          />
        )}
      </div>
    </AntdThemeProvider>
  );
}

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return i18n.t('home.today');
  if (days === 1) return i18n.t('home.yesterday');
  if (days < 7) return i18n.t('home.daysAgo', { days });
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ===== 样式 =====
const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  overflow: 'hidden',
};

const contentScrollStyle: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '16px 40px 40px',
  display: 'flex',
  flexDirection: 'column',
};