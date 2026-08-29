/**
 * asset-library-modals - 资产库所有弹窗组件
 *
 * 从 asset-library-page.tsx 抽出所有 Modal/弹窗。
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { buildTabKey, useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import type { ThemeConfig } from '@zeroexo/shared';
import type { ContextMenuItem } from '@/shared/components/index.js';
import { ContextMenu, AssetDetailViewer } from '@/shared/components/index.js';
import type { AssetDetailData } from '@/shared/components/asset-detail-viewer.js';
import { PromptViewer } from '@/shared/components/index.js';
import { PromptCreatePage, type PromptCreatePageHandle } from '../index.js';
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
  /** 文本类资产保存正文（编辑模式启用后由底部出血栏「保存」触发） */
  onAssetDetailSave?: (content: string) => Promise<void>;

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
  /** 剧本资产 id（Plan#50:页签幂等 key 用，画布抽屉内嵌模式必需） */
  scriptAssetId?: string | null;
  /** 画布抽屉内嵌（Plan#50:抽屉内剧本编辑器改为顶部页签呈现，而非全屏 Modal） */
  embeddedInCanvas?: boolean;

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

  // 提示词创建/编辑
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
  const [promptTitle, setPromptTitle] = useState('');

  // ===== 提示词新建/编辑：统一走资产浏览器框架（与图片/文档同 UI，尺寸一致）=====
  const promptPageRef = useRef<PromptCreatePageHandle | null>(null);
  const [promptEditing, setPromptEditing] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  // 打开时重置编辑态：新建直接进编辑，已有提示词先进查看
  useEffect(() => {
    if (props.promptCreateOpen) setPromptEditing(!props.promptCreateId);
  }, [props.promptCreateOpen, props.promptCreateId]);

  // 编辑态变更：进入编辑要交给页面内部记录快照（脏检查 / 取消回退依赖它）。
  // 用 ref 守卫，避免内部 setViewMode 回调 → 再次触发本函数的死循环。
  const promptEditingRef = useRef(false);
  useEffect(() => { promptEditingRef.current = promptEditing; }, [promptEditing]);
  const handlePromptEditingChange = useCallback((v: boolean) => {
    if (promptEditingRef.current === v) return;
    promptEditingRef.current = v;
    if (v) promptPageRef.current?.enterEdit();
    else promptPageRef.current?.cancelEdit();
    setPromptEditing(v);
  }, []);

  const handlePromptSave = useCallback(async () => {
    setPromptSaving(true);
    try {
      await promptPageRef.current?.save();
      setPromptEditing(false);
    } finally {
      setPromptSaving(false);
    }
  }, []);

  const handlePromptDuplicate = useCallback(async () => {
    setPromptSaving(true);
    try {
      await promptPageRef.current?.duplicate();
    } finally {
      setPromptSaving(false);
    }
  }, []);

  // ===== 文本类资产（text）：与提示词同款的「编辑 → 保存」语义 =====
  const isTextAsset = props.assetDetail?.data?.kind === 'text';
  const [textEditing, setTextEditing] = useState(false);
  const [textSaving, setTextSaving] = useState(false);
  const [textDraft, setTextDraft] = useState<string | null>(null);
  // 打开/切换资产时重置编辑态与草稿
  useEffect(() => {
    setTextEditing(false);
    setTextDraft(null);
  }, [props.assetDetail?.id]);

  const handleTextEditingChange = useCallback((v: boolean) => {
    setTextEditing(v);
    // 进入编辑时以当前正文作为草稿起点；退出时丢弃草稿
    if (v) setTextDraft(props.assetDetail?.data?.content ?? '');
    else setTextDraft(null);
  }, [props.assetDetail]);

  const handleTextSave = useCallback(async () => {
    if (textDraft === null) { setTextEditing(false); return; }
    setTextSaving(true);
    try {
      await props.onAssetDetailSave?.(textDraft);
      setTextEditing(false);
      setTextDraft(null);
    } finally {
      setTextSaving(false);
    }
  }, [textDraft, props.onAssetDetailSave]);

  // Plan#50:画布抽屉内嵌时,剧本编辑器改为顶部页签呈现(幂等 key = script:<assetId>)
  const scriptTabKey = props.embeddedInCanvas && props.scriptAssetId
    ? buildTabKey('script', props.scriptAssetId)
    : null;
  const scriptTabActive = useCanvasTabStore((s) => (scriptTabKey ? s.activeTabKey === scriptTabKey : false));
  const scriptTabHost = useCanvasTabStore((s) => s.contentHost);
  const closeScriptTab = useCanvasTabStore((s) => s.closeTab);
  useEffect(() => {
    if (!props.embeddedInCanvas || !props.scriptEditorOpen || !props.scriptAssetId) return;
    useCanvasTabStore.getState().openTab({
      kind: 'script',
      id: props.scriptAssetId,
      title: props.scriptEditorTitle,
    });
  }, [props.embeddedInCanvas, props.scriptEditorOpen, props.scriptAssetId, props.scriptEditorTitle]);

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
          // 文本类资产可编辑：与提示词同一套「编辑 → 保存」交互（图片/视频/音频仍只读）
          editable={isTextAsset}
          editing={textEditing}
          onEditingChange={handleTextEditingChange}
          onSave={handleTextSave}
          saving={textSaving}
          onContentChange={setTextDraft}
        />
      )}

      {/* 剧本编辑器(Plan#50:画布抽屉内嵌 → 顶部页签呈现;主页/独立页 → 保持全屏 Modal) */}
      {props.embeddedInCanvas && scriptTabKey ? (
        scriptTabActive && scriptTabHost ? createPortal(
          <ScriptFullscreenEditor
            open
            embedded
            onClose={() => {
              closeScriptTab(scriptTabKey);
              props.onScriptEditorClose();
            }}
            title={props.scriptEditorTitle}
            episodes={props.scriptEditorEpisodes}
            activeEpisodeId={props.scriptEditorActiveId}
            onEpisodesChange={props.onScriptEditorEpisodesChange}
            onActiveEpisodeChange={props.onScriptEditorActiveChange}
            onEpisodesAndActiveChange={props.onScriptEditorEpisodesAndActiveChange}
            onAddEpisode={props.onScriptEditorAddEpisode}
            onImportClick={props.onScriptEditorImportClick}
          />,
          scriptTabHost,
        ) : null
      ) : (
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
      )}

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

      {/* Plan#29 V3: 主体编辑入口已移除(主体升维为画布统筹节点,资产库不再存主体) */}

      {/* 提示词创建/编辑：与图片/文档共用同一套资产浏览器框架（同尺寸、同底部出血栏、同视觉），
          展示区换成提示词链路画布；删除统一由资产库列表负责，页内不再自带删除按钮 */}
      {props.promptCreateOpen && (
        <AssetDetailViewer
          asset={{
            id: props.promptCreateId ?? 'new',
            title: promptTitle || t('asset.kindPrompt', 'Prompt'),
            kind: 'prompt',
            bytes: 0,
            data: { kind: 'prompt' },
          } as AssetDetailData}
          onClose={props.onPromptCreateClose}
          renderPromptStage={({ editing }) => (
            <PromptCreatePage
              ref={promptPageRef}
              embedded
              hideTitle
              promptId={props.promptCreateId}
              viewMode={editing ? 'edit' : 'view'}
              onSaved={props.onPromptCreateSaved}
              onTitleChange={setPromptTitle}
              // 「副本 → 点击跳转」时先关掉本弹窗，否则跳转后仍遮挡资产库
              onRequestClose={props.onPromptCreateClose}
            />
          )}
          editable
          editing={promptEditing}
          onEditingChange={handlePromptEditingChange}
          onSave={handlePromptSave}
          saving={promptSaving}
          onDuplicate={handlePromptDuplicate}
        />
      )}
    </>
  );
});