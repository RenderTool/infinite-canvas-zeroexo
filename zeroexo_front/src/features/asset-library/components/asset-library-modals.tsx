/**
 * asset-library-modals - 资产库所有弹窗组件
 *
 * 从 asset-library-page.tsx 抽出所有 Modal/弹窗。
 */

import { memo, useState } from 'react';
import { Input, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { ContextMenuItem } from '@/shared/components/index.js';
import { ContextMenu, AssetDetailViewer } from '@/shared/components/index.js';
import { PromptViewer } from '@/shared/components/index.js';
import { PromptCreatePage, SubjectCreatePage } from '../index.js';
import { ScriptFullscreenEditor } from '@/features/canvas-nodes/storyboard/script-fullscreen-editor.js';
import { ScriptImportFlow } from '@/features/canvas-nodes/storyboard/components/script-import-flow.js';
import { UploadQueueOverlay } from '@/features/upload-queue/index.js';
import type { Episode } from '@/features/canvas-nodes/storyboard/script-types.js';
import type { ConfirmDeleteState, RenameItemTarget } from '../types.js';

export interface AssetLibraryModalsProps {
  // 删除确认
  confirmDelete: ConfirmDeleteState | null;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;

  // 重命名
  renameItemOpen: boolean;
  renameItemName: string;
  renameItemTarget: RenameItemTarget | null;
  onRenameNameChange: (value: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;

  // 新建剧本
  scriptNamePromptOpen: boolean;
  scriptNameInput: string;
  /** 空名时的建议默认名(新剧本N 递增) */
  scriptNamePlaceholder?: string;
  onScriptNameChange: (value: string) => void;
  onScriptNameConfirm: () => void;
  onScriptNameCancel: () => void;

  // 资源详情
  assetDetail: any;
  onAssetDetailClose: () => void;

  // 剧本编辑器
  scriptEditorOpen: boolean;
  scriptEditorTitle: string;
  scriptEditorEpisodes: Episode[];
  scriptEditorActiveId: string;
  onScriptEditorClose: () => void;
  onScriptEditorEpisodesChange: (eps: Episode[]) => void;
  onScriptEditorActiveChange: (id: string) => void;
  onScriptEditorEpisodesAndActiveChange: (eps: Episode[], activeId?: string) => void;
  onScriptEditorAddEpisode: () => void;
  onScriptEditorImportClick: () => void;

  // 剧本导入
  scriptImportOpen: boolean;
  onScriptImportClose: () => void;
  onScriptImportComplete: (result: any) => void;

  // 提示词查看
  promptViewId: string | null;
  onPromptViewClose: () => void;
  onPromptViewSaved: () => void;

  // 右键菜单
  ctxMenuPosition: { x: number; y: number } | null;
  ctxMenuItems: ContextMenuItem[];
  onCtxMenuClose: () => void;

  // 主体创建
  subjectCreateOpen: boolean;
  subjectCreateId: string | undefined;
  onSubjectCreateClose: () => void;
  onSubjectCreateSaved: () => void;

  // 提示词创建
  promptCreateOpen: boolean;
  promptCreateId: string | undefined;
  onPromptCreateClose: () => void;
  onPromptCreateSaved: () => void;

  // 上传队列
  onUploadRetry: (failedFiles: File[]) => void;

  theme: ThemeConfig;
}

export const AssetLibraryModals = memo(function AssetLibraryModals(props: AssetLibraryModalsProps): React.ReactElement {
  const { t } = useTranslation();
  const theme = props.theme;
  const isDark = theme.mode === 'dark';
  const [promptTitle, setPromptTitle] = useState('');

  return (
    <>
      {/* 上传队列 */}
      <UploadQueueOverlay
        onRetryFailed={(failedFiles) => {
          props.onUploadRetry(failedFiles);
        }}
      />

      {/* 确认删除 */}
      <Modal
        title={t('assetLibrary.confirmDeleteTitle')}
        open={!!props.confirmDelete}
        onCancel={props.onCancelDelete}
        onOk={props.onConfirmDelete}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        okButtonProps={{ danger: true }}
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 420 }}
      >
        <p style={{ fontSize: 13, color: theme.toolbar.text, margin: 0 }}>
          {t('assetLibrary.confirmDeleteItem', { name: props.confirmDelete?.name ?? '' })}
        </p>
      </Modal>

      {/* 重命名 */}
      <Modal
        title={t('assetLibrary.renameTitle')}
        open={props.renameItemOpen}
        onCancel={props.onRenameCancel}
        onOk={props.onRenameConfirm}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 420 }}
      >
        <Input
          value={props.renameItemName}
          onChange={(e) => props.onRenameNameChange(e.target.value)}
          placeholder={t('assetLibrary.renamePlaceholder')}
          maxLength={50}
          autoFocus
        />
      </Modal>

      {/* 新建剧本名称确认 */}
      <Modal
        title="新建剧本"
        open={props.scriptNamePromptOpen}
        onCancel={props.onScriptNameCancel}
        onOk={props.onScriptNameConfirm}
        okText="创建"
        cancelText="取消"
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 420 }}
        destroyOnHidden
      >
        <div style={{ marginBottom: 8, fontSize: 13, color: theme.toolbar.textMuted }}>
          请输入剧本名称
        </div>
        <Input
          value={props.scriptNameInput}
          onChange={(e) => props.onScriptNameChange(e.target.value)}
          placeholder={props.scriptNamePlaceholder || '新剧本'}
          maxLength={50}
          autoFocus
          onPressEnter={props.onScriptNameConfirm}
        />
      </Modal>

      {/* 资源详情查看 */}
      {props.assetDetail && (
        <AssetDetailViewer
          asset={props.assetDetail}
          onClose={props.onAssetDetailClose}
        />
      )}

      {/* 剧本编辑器 */}
      <ScriptFullscreenEditor
        open={props.scriptEditorOpen}
        onClose={props.onScriptEditorClose}
        title={props.scriptEditorTitle}
        episodes={props.scriptEditorEpisodes}
        activeEpisodeId={props.scriptEditorActiveId}
        onEpisodesChange={props.onScriptEditorEpisodesChange}
        onActiveEpisodeChange={props.onScriptEditorActiveChange}
        onEpisodesAndActiveChange={props.onScriptEditorEpisodesAndActiveChange}
        onAddEpisode={props.onScriptEditorAddEpisode}
        onImportClick={props.onScriptEditorImportClick}
      />

      {/* 剧本导入弹窗 */}
      <ScriptImportFlow
        open={props.scriptImportOpen}
        onClose={props.onScriptImportClose}
        onComplete={props.onScriptImportComplete}
      />

      {/* 提示词查看器 */}
      <PromptViewer
        promptId={props.promptViewId ?? undefined}
        open={!!props.promptViewId}
        onClose={props.onPromptViewClose}
        onSaved={props.onPromptViewSaved}
        onTitleChange={setPromptTitle}
      />

      {/* 右键上下文菜单 */}
      <ContextMenu
        items={props.ctxMenuItems}
        position={props.ctxMenuPosition}
        onClose={props.onCtxMenuClose}
      />

      {/* 主体创建/编辑弹窗 */}
      <Modal
        title={null}
        open={props.subjectCreateOpen}
        onCancel={props.onSubjectCreateClose}
        footer={null}
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 900 }}
        destroyOnHidden
      >
        <SubjectCreatePage
          modal
          subjectId={props.subjectCreateId}
          onBack={props.onSubjectCreateClose}
          onSaved={props.onSubjectCreateSaved}
        />
      </Modal>

      {/* 提示词创建/编辑弹窗 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 9999,
              background: `${theme.toolbar.accent}20`,
              color: theme.toolbar.accent,
              fontWeight: 600,
              flexShrink: 0,
            }}>
              {t('asset.kindPrompt', 'Prompt')}
            </span>
            <span style={{
              fontSize: 13,
              fontWeight: 600,
              color: theme.toolbar.text,
              opacity: 0.92,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}>
              {promptTitle || '提示词'}
            </span>
          </div>
        }
        open={props.promptCreateOpen}
        onCancel={props.onPromptCreateClose}
        footer={null}
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 1300 }}
        destroyOnHidden
        styles={{
          header: {
            marginBottom: 0,
            paddingBottom: 10,
            borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
          },
          body: {
            padding: 0,
            background: theme.toolbar.background,
            height: 'calc(100vh - 140px)',
            overflow: 'hidden',
          },
          container: {
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: isDark
              ? '0 24px 80px rgba(0,0,0,0.5)'
              : '0 24px 64px rgba(28,25,23,0.18)',
          },
        } as React.ComponentProps<typeof Modal>['styles']}
      >
        <PromptCreatePage
          modal
          hideTitle
          promptId={props.promptCreateId}
          onBack={props.onPromptCreateClose}
          onSaved={props.onPromptCreateSaved}
          onTitleChange={setPromptTitle}
        />
      </Modal>
    </>
  );
});