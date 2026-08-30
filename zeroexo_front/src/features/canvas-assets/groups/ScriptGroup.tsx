/**
 * canvas-assets/groups/ScriptGroup - 画布资产抽屉「剧本」分组
 *
 * 数据驱动：剧本列表来自 store；卡片渲染复用主页剧本卡片 ScriptCardGrid
 * （2026-08-30 用户要求 UI 组件可复用，禁止另起一套卡片样式）。
 * 编辑走复用 ScriptFullscreenEditor。
 */

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Modal, Progress } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';
import { ScriptCardGrid } from '@/features/asset-library/cards/script-card.js';
import { ScriptFullscreenEditor } from '@/features/canvas-nodes/storyboard/script-fullscreen-editor.js';
import type { CanvasAssetsPanelStore } from '../store.js';
import { AddTile, EmptyState, SearchBox, ToolbarRow } from '../components/common.js';

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 16,
  alignContent: 'start',
  padding: '0 20px 16px',
};

export function ScriptGroup({ store, theme }: {
  store: CanvasAssetsPanelStore;
  theme: ThemeConfig;
}): React.ReactElement {
  const { t } = useTranslation();
  const {
    scripts, handleUploadScript, handleOpenScriptAsset,
    scriptEditorOpen, scriptEditorEpisodes, scriptEditorActiveId, scriptEditorTitle,
    scriptNamePromptOpen, scriptNameInput, setScriptNameInput, scriptNameSuggestion,
    scanningProgress, scanningMessage,
    handleNewScript, handleConfirmNewScript, handleCloseScriptEditor,
    setScriptEditorEpisodes, setScriptEditorActiveId,
    search, setSearch,
    setConfirmDelete, setRenameItemTarget, setRenameItemOpen, handleDownloadItem, sendToCanvas,
  } = store;
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <ToolbarRow>
        <span style={{ fontSize: 12, color: theme.toolbar.textMuted, flexShrink: 0 }}>
          {t('assetLibrary.scriptCount', { defaultValue: '共' })} {scripts.length} {t('assetLibrary.scriptUnit', { defaultValue: '个剧本' })}
        </span>
      </ToolbarRow>
      {/* 搜索统一在标签下方 */}
      <ToolbarRow style={{ paddingTop: 0 }}>
        <SearchBox value={search} onChange={setSearch} placeholder={t('assetLibrary.searchPlaceholder')} theme={theme} />
      </ToolbarRow>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {scanningProgress >= 0 && (
          <div style={{ padding: '8px 20px' }}>
            <Progress percent={scanningProgress} size="small" showInfo={false} strokeColor={theme.toolbar.accent} />
            <div style={{ fontSize: 11, color: theme.toolbar.textMuted, marginTop: 4 }}>{scanningMessage}</div>
          </div>
        )}
        {scripts.length === 0 ? (
          <EmptyState theme={theme} />
        ) : (
          <div style={GRID_STYLE}>
            {scripts.map((script) => (
              <ScriptCardGrid
                key={script.id}
                item={script}
                selected={false}
                multiSelectEnabled={false}
                onToggleSelect={() => undefined}
                onOpen={() => handleOpenScriptAsset(script)}
                onRename={() => { setRenameItemTarget({ type: 'asset', id: script.id, name: script.title }); setRenameItemOpen(true); }}
                onDelete={() => setConfirmDelete({ type: 'asset', id: script.id, name: script.title })}
                onDownload={() => void handleDownloadItem({ type: 'asset', data: script })}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onSendToCanvas={() => sendToCanvas({ type: 'script', id: script.id, data: script })}
                theme={theme}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '0 20px 12px', flexShrink: 0 }}>
        <AddTile label={t('assetLibrary.newScript', { defaultValue: '新建剧本' })} onClick={handleNewScript} theme={theme} />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.md,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) handleUploadScript(e.target.files); e.target.value = ''; }}
      />

      {/* 新建剧本名称确认 */}
      <Modal
        title={t('assetLibrary.newScript', { defaultValue: '新建剧本' })}
        open={scriptNamePromptOpen}
        onCancel={() => store.setScriptNamePromptOpen(false)}
        onOk={() => void handleConfirmNewScript()}
        okText={t('common.confirm', { defaultValue: '确认' })}
        cancelText={t('common.cancel', { defaultValue: '取消' })}
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 420 }}
        destroyOnHidden
      >
        <div style={{ marginBottom: 8, fontSize: 13, color: theme.toolbar.textMuted }}>
          {t('assetLibrary.scriptNameInput', { defaultValue: '请输入剧本名称' })}
        </div>
        <Input
          value={scriptNameInput}
          onChange={(e) => setScriptNameInput(e.target.value)}
          placeholder={scriptNameSuggestion}
          maxLength={50}
          autoFocus
          onPressEnter={() => void handleConfirmNewScript()}
        />
      </Modal>

      {/* 剧本编辑器（复用共享全屏编辑器） */}
      <Modal
        open={scriptEditorOpen}
        onCancel={handleCloseScriptEditor}
        footer={null}
        width="calc(100vw - 32px)"
        style={{ maxWidth: 1400 }}
        centered
        destroyOnHidden
        styles={{ body: { height: 'calc(100vh - 140px)', padding: 0, overflow: 'hidden' } }}
      >
        {scriptEditorOpen && (
          <ScriptFullscreenEditor
            open
            embedded
            onClose={handleCloseScriptEditor}
            title={scriptEditorTitle}
            episodes={scriptEditorEpisodes}
            activeEpisodeId={scriptEditorActiveId}
            onEpisodesChange={setScriptEditorEpisodes}
            onActiveEpisodeChange={setScriptEditorActiveId}
            onEpisodesAndActiveChange={(eps, activeId) => {
              setScriptEditorEpisodes(eps);
              if (activeId !== undefined) setScriptEditorActiveId(activeId);
            }}
            onAddEpisode={() => {
              const nextNum = scriptEditorEpisodes.length + 1;
              const newEp = { id: `ep-${Date.now()}`, number: nextNum, title: `${t('assetLibrary.defaultEpisodeTitle', { defaultValue: '第' })}${nextNum}${t('assetLibrary.episodeSuffix', { defaultValue: '集' })}`, content: '' };
              setScriptEditorEpisodes([...scriptEditorEpisodes, newEp]);
              setScriptEditorActiveId(newEp.id);
            }}
            onImportClick={() => fileInputRef.current?.click()}
          />
        )}
      </Modal>
    </>
  );
}
