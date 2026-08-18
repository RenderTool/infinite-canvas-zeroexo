/**
 * StoryboardToolbar - 分镜底部工具栏 + 全屏顶部工具栏 + 弹窗组件
 *
 * 包含：底部工具栏、全屏顶部工具栏、分页、关联剧本下拉、重新生成弹窗、删除确认弹窗。
 */
import { type CSSProperties, type ReactElement } from 'react';
import { Button, Tooltip, Modal, Steps } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  Maximize, RotateCcw, Link2, Plus, CheckSquare, Trash2,
  ChevronLeft, Check, X, ListVideo, Loader2, Columns3, Table,
} from 'lucide-react';
import { useTheme, AnimatedThemeToggler } from '@zeroexo/plugin-theme';
import { FullscreenDropdown, fullToolBtnStyle } from './FullscreenDropdown';
import type { Shot } from '../storyboard-types';
import { Z_INDEX } from '@/shared/constants/z-index.js';

// ===== 样式函数 =====

export const fullscreenOverlayStyle = (bgPage: string): CSSProperties => ({
  position: 'fixed', inset: 0, zIndex: Z_INDEX.FULLSCREEN,
  display: 'flex', flexDirection: 'column',
  background: bgPage,
});

export const fullscreenHeaderStyle = (border: string, bgHeader: string): CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 16px', flexShrink: 0,
  borderBottom: `1px solid ${border}`,
  background: bgHeader,
});

export const regenOptionBtnStyle = (border: string): CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
  width: '100%', padding: '12px 16px', cursor: 'pointer',
  border: `1px solid ${border}`, borderRadius: 10,
  background: 'transparent', fontFamily: 'inherit',
  transition: 'all 0.15s', textAlign: 'left',
});

export const regenOptionActiveStyle = (accent: string): CSSProperties => ({
  borderColor: accent, background: `${accent}14`,
});

// ===== 底部工具栏 =====

export interface StoryboardToolbarProps {
  linkedScript: { id: string; title?: string } | undefined;
  scriptNodes: Array<{ id: string; title?: string }>;
  scriptOptionLabel: (n: { id: string; title?: string }) => string;
  openFullscreen: () => void;
  openRegenModal: () => void;
  openAssociateModal: (scriptId: string) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  shotCount: number;
  /** 当前集是否已有分镜内容（否则显示"生成"按钮） */
  hasGenerated?: boolean;
  /** 生成当前集分镜（未生成态按钮点击） */
  onGenerateEpisode?: () => void;
  /** 当前集生成状态(用于内联加载指示) */
  episodeStatus?: 'idle' | 'generating' | 'ready' | 'error';
  /** 视图模式切换 */
  viewMode: 'table' | 'step';
  onViewModeChange: (mode: 'table' | 'step') => void;
}

export function StoryboardToolbar({
  linkedScript,
  scriptNodes,
  scriptOptionLabel,
  openFullscreen,
  openAssociateModal,
  currentPage,
  totalPages,
  onPageChange,
  onGenerateEpisode,
  episodeStatus,
  viewMode,
  onViewModeChange,
}: StoryboardToolbarProps): ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  return (
    <div style={{ padding: '8px 12px', borderTop: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Tooltip title={t('storyboard.enterFullscreen')}>
        <Button
          size="small"
          type="text"
          icon={<Maximize size={14} />}
          style={{ ...fullToolBtnStyle, color: textColor }}
          onClick={openFullscreen}
        >
          {t('storyboard.edit')}
        </Button>
      </Tooltip>
      {linkedScript && onGenerateEpisode && (
        <Tooltip title={episodeStatus === 'generating' ? t('storyboard.generating') : t('storyboard.generateEpisode')}>
          <Button
            size="small"
            type="text"
            icon={episodeStatus === 'generating' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={14} />}
            style={{ ...fullToolBtnStyle, color: episodeStatus === 'generating' ? mutedColor : textColor, fontWeight: 600 }}
            onClick={onGenerateEpisode}
            disabled={episodeStatus === 'generating'}
          >
            {episodeStatus === 'generating' ? t('storyboard.generatingShort') : t('storyboard.regenerate')}
          </Button>
        </Tooltip>
      )}
      {linkedScript ? (
        <FullscreenDropdown
          onSelect={(key) => {
            if (key === '__none') return;
            openAssociateModal(key);
          }}
          options={scriptNodes.filter((n) => n.id !== linkedScript.id).length > 0
            ? scriptNodes.filter((n) => n.id !== linkedScript.id).map((n) => ({ key: n.id, label: scriptOptionLabel(n) }))
            : [{ key: '__none', label: t('storyboard.noOtherScriptNodes'), disabled: true }]}
        >
          <Button size="small" type="text" icon={<Link2 size={14} />} style={{ ...fullToolBtnStyle, color: textColor }}>
            {t('storyboard.switchAssociate')}
          </Button>
        </FullscreenDropdown>
      ) : (
        <FullscreenDropdown
          onSelect={(key) => {
            if (key === '__none') return;
            openAssociateModal(key);
          }}
          options={scriptNodes.length > 0
            ? scriptNodes.map((n) => ({ key: n.id, label: scriptOptionLabel(n) }))
            : [{ key: '__none', label: t('storyboard.noScriptNodes'), disabled: true }]}
        >
          <Button size="small" type="text" icon={<Link2 size={14} />} style={{ ...fullToolBtnStyle, color: textColor }}>
            {t('storyboard.associateScript')}
          </Button>
        </FullscreenDropdown>
      )}
      <div style={{ flex: 1 }} />
      <Tooltip title={viewMode === 'step' ? t('storyboard.switchToTableView') : t('storyboard.switchToStepView')}>
        <Button
          size="small"
          type="text"
          icon={viewMode === 'step' ? <Table size={14} /> : <Columns3 size={14} />}
          style={{ color: textColor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28 }}
          onClick={() => onViewModeChange(viewMode === 'table' ? 'step' : 'table')}
        />
      </Tooltip>
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
          <Button
            size="small"
            type="text"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            style={{ fontSize: 11, padding: '0 4px', minWidth: 24, height: 22 }}
          >
            ‹
          </Button>
          <span style={{ fontSize: 11, color: mutedColor, whiteSpace: 'nowrap', padding: '0 4px' }}>
            {currentPage} / {totalPages}
          </span>
          <Button
            size="small"
            type="text"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            style={{ fontSize: 11, padding: '0 4px', minWidth: 24, height: 22 }}
          >
            ›
          </Button>
        </div>
      )}
    </div>
  );
}

// ===== 全屏顶部工具栏 =====

export interface FullscreenToolbarProps {
  linkedScript: { id: string; title?: string } | undefined;
  scriptNodes: Array<{ id: string; title?: string }>;
  scriptOptionLabel: (n: { id: string; title?: string }) => string;
  scriptEpisodes: Array<{ id: string; title?: string; content?: string }>;
  activeEpisodeId: string;
  activeEpisodeIndex: number;
  episodeLabel: (ep: { title?: string }, idx: number) => string;
  handleEpisodeChange: (epId: string) => void;
  openAssociateModal: (scriptId: string) => void;
  handleAddShot: () => void;
  handleToggleSelectAll: () => void;
  selectedShotIds: Set<string>;
  shotCount: number;
  handleBatchDelete: () => void;
  isSample: boolean | undefined;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onCloseFullscreen: () => void;
  viewMode: 'table' | 'step';
  onViewModeChange: (mode: 'table' | 'step') => void;
}

export function FullscreenToolbar({
  linkedScript,
  scriptNodes,
  scriptOptionLabel,
  scriptEpisodes,
  activeEpisodeId,
  activeEpisodeIndex,
  episodeLabel,
  handleEpisodeChange,
  openAssociateModal,
  handleAddShot,
  handleToggleSelectAll,
  selectedShotIds,
  shotCount,
  handleBatchDelete,
  isSample,
  currentPage,
  totalPages,
  onPageChange,
  onCloseFullscreen,
  viewMode,
  onViewModeChange,
}: FullscreenToolbarProps): ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const bgHeader = isDark ? '#1f1f1f' : '#f5f5f5';

  return (
    <div style={fullscreenHeaderStyle(cardBorder, bgHeader)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
        <Button size="small" type="text" icon={<Plus size={14} />} onClick={handleAddShot} style={{ ...fullToolBtnStyle, color: textColor }}>
          {t('storyboard.addShot')}
        </Button>
        {/* 集数切换(全屏内切换当前集) */}
        {linkedScript && scriptEpisodes.length > 0 && (
          <FullscreenDropdown
            onSelect={handleEpisodeChange}
            options={scriptEpisodes.map((ep, idx) => ({ key: ep.id, label: episodeLabel(ep, idx), active: ep.id === activeEpisodeId }))}
          >
            <Button size="small" type="text" icon={<ListVideo size={14} />} style={{ ...fullToolBtnStyle, color: textColor }}>
              {episodeLabel(scriptEpisodes[activeEpisodeIndex] ?? { title: undefined }, activeEpisodeIndex)}
            </Button>
          </FullscreenDropdown>
        )}
        {/* 关联剧本/切换关联(全屏内) */}
        <FullscreenDropdown
          onSelect={(key) => {
            if (key === '__none') return;
            openAssociateModal(key);
          }}
          options={linkedScript
            ? (scriptNodes.filter((n) => n.id !== linkedScript.id).length > 0
              ? scriptNodes.filter((n) => n.id !== linkedScript.id).map((n) => ({ key: n.id, label: scriptOptionLabel(n) }))
              : [{ key: '__none', label: t('storyboard.noOtherScriptNodes'), disabled: true }])
            : (scriptNodes.length > 0
              ? scriptNodes.map((n) => ({ key: n.id, label: scriptOptionLabel(n) }))
              : [{ key: '__none', label: t('storyboard.noScriptNodes'), disabled: true }])}
        >
          <Button size="small" type="text" icon={<Link2 size={14} />} style={{ ...fullToolBtnStyle, color: textColor }}>
            {linkedScript ? t('storyboard.switchAssociate') : t('storyboard.associateScript')}
          </Button>
        </FullscreenDropdown>
        <Button
          size="small"
          type="text"
          icon={<CheckSquare size={14} />}
          onClick={handleToggleSelectAll}
          style={{ ...fullToolBtnStyle, color: selectedShotIds.size > 0 ? accent : mutedColor }}
        >
          {selectedShotIds.size === shotCount ? t('storyboard.deselectAll') : t('storyboard.selectAll')}
        </Button>
        {selectedShotIds.size > 0 && (
          <Button size="small" type="text" danger icon={<Trash2 size={14} />} onClick={handleBatchDelete} style={{ ...fullToolBtnStyle, color: '#ff4d4f' }}>
            {t('storyboard.batchDeleteShotsCount', { count: selectedShotIds.size })}
          </Button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {isSample && (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '1px 8px', borderRadius: 999,
              fontSize: 11, fontWeight: 600, letterSpacing: 1,
              color: isDark ? '#fbbf24' : '#b45309',
              background: isDark ? 'rgba(251,191,36,0.14)' : 'rgba(180,83,9,0.12)',
              border: `1px solid ${isDark ? 'rgba(251,191,36,0.35)' : 'rgba(180,83,9,0.3)'}`,
              userSelect: 'none', pointerEvents: 'none',
            }}
          >
            {t('storyboard.sampleBadge')}
          </span>
        )}
        <span style={{ fontSize: 11, color: mutedColor, whiteSpace: 'nowrap' }}>
          {t('storyboard.shotCountSummary', { count: shotCount })}
          {selectedShotIds.size > 0 ? ` · ${t('storyboard.selectedShots', { count: selectedShotIds.size })}` : ''}
        </span>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Button
              size="small"
              type="text"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              style={{ fontSize: 11, padding: '0 4px', minWidth: 24, height: 22, color: mutedColor }}
            >
              ‹
            </Button>
            <span style={{ fontSize: 11, color: mutedColor, whiteSpace: 'nowrap', padding: '0 4px' }}>
              {currentPage} / {totalPages}
            </span>
            <Button
              size="small"
              type="text"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              style={{ fontSize: 11, padding: '0 4px', minWidth: 24, height: 22, color: mutedColor }}
            >
              ›
            </Button>
          </div>
        )}
        <Tooltip title={viewMode === 'step' ? t('storyboard.switchToTableView') : t('storyboard.switchToStepView')}>
          <Button
            size="small"
            type="text"
            icon={viewMode === 'step' ? <Table size={14} /> : <Columns3 size={14} />}
            style={{ color: textColor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28 }}
            onClick={() => onViewModeChange(viewMode === 'table' ? 'step' : 'table')}
          />
        </Tooltip>
        <Tooltip title={t('storyboard.toggleTheme')}>
          <span style={{ display: 'inline-flex' }}>
            <AnimatedThemeToggler
              aria-label={t('storyboard.toggleTheme')}
              iconSize={14}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, cursor: 'pointer', background: 'transparent', border: 'none', color: textColor, borderRadius: 6 }}
            />
          </span>
        </Tooltip>
        <Tooltip title={t('storyboard.exitFullscreen')}>
          <Button type="text" size="small" icon={<X size={16} />} onClick={onCloseFullscreen} style={{ color: textColor }} />
        </Tooltip>
      </div>
    </div>
  );
}

// ===== 删除确认弹窗 =====

export interface DeleteConfirmModalProps {
  deleteConfirm: null | { type: 'single'; shotId: string } | { type: 'batch' };
  onCancel: () => void;
  onOk: () => void;
  shots: Shot[];
  selectedShotIds: Set<string>;
}

export function DeleteConfirmModal({
  deleteConfirm,
  onCancel,
  onOk,
  shots,
  selectedShotIds,
}: DeleteConfirmModalProps): ReactElement | null {
  const { t } = useTranslation();
  if (!deleteConfirm) return null;

  return (
    <Modal
      open={!!deleteConfirm}
      onCancel={onCancel}
      title={deleteConfirm.type === 'batch' ? t('storyboard.batchDeleteShots') : t('storyboard.deleteShot')}
      okText={t('common.delete')}
      cancelText={t('common.cancel')}
      okButtonProps={{ danger: true }}
      centered
      zIndex={Z_INDEX.FULLSCREEN_DROPDOWN}
      onOk={onOk}
    >
      {deleteConfirm.type === 'single' ? (
        <span style={{ fontSize: 13 }}>
          {t('storyboard.confirmDeleteShot', { number: shots.find((s) => s.id === deleteConfirm.shotId)?.number ?? '' })}
          <br />
          <span style={{ fontSize: 12, color: '#999' }}>{t('storyboard.undoableAfterDelete')}</span>
        </span>
      ) : (
        <span style={{ fontSize: 13 }}>
          {t('storyboard.confirmDeleteShots', { count: selectedShotIds.size })}
          <br />
          <span style={{ fontSize: 12, color: '#999' }}>{t('storyboard.undoableAfterDelete')}</span>
        </span>
      )}
    </Modal>
  );
}

// ===== 重新生成弹窗 =====

export interface RegenModalProps {
  regenMeta: null | { episodeId: string; episodeTitle?: string };
  regenStep: number;
  regenOption: 'overwrite' | 'compare';
  onStepChange: (step: number) => void;
  onOptionChange: (option: 'overwrite' | 'compare') => void;
  onCancel: () => void;
  onOverwriteRegen: () => void;
  onNewCompareRegen: () => void;
  linkedScript: { id: string; title?: string } | undefined;
}

export function RegenModal({
  regenMeta,
  regenStep,
  regenOption,
  onStepChange,
  onOptionChange,
  onCancel,
  onOverwriteRegen,
  onNewCompareRegen,
  linkedScript,
}: RegenModalProps): ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  if (!regenMeta) return null;

  return (
    <Modal
      open={!!regenMeta}
      onCancel={onCancel}
      centered
      width={480}
      footer={null}
      title={null}
      styles={{
        container: { background: theme.toolbar.background, padding: 0, overflow: 'hidden', borderRadius: 16, border: `1px solid ${cardBorder}` },
        mask: { background: 'transparent' },
      }}
    >
      <div style={{ padding: '20px 24px', borderBottom: `1px solid ${cardBorder}` }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: textColor }}>{t('storyboard.regenerateStoryboard')}</div>
        <div style={{ fontSize: 12, color: mutedColor, marginTop: 4 }}>
          {linkedScript?.title ? `「${linkedScript.title}」` : ''}
          {regenMeta.episodeTitle ? ` · ${regenMeta.episodeTitle}` : ''}
        </div>
      </div>

      {/* Steps 导航 */}
      <div style={{ padding: '20px 24px 4px' }}>
        <Steps
          current={regenStep}
          size="small"
          items={[
            { title: t('storyboard.selectAction') },
            { title: t('common.confirm') },
          ]}
        />
      </div>

      {/* Step 0: 选择操作 */}
      {regenStep === 0 && (
        <div style={{ padding: '20px 24px' }}>
          <div style={{ fontSize: 12, color: mutedColor, marginBottom: 12, fontWeight: 600 }}>
            {t('storyboard.selectMethod')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              onClick={() => { onOptionChange('overwrite'); onStepChange(1); }}
              style={{ ...regenOptionBtnStyle(cardBorder), ...(regenOption === 'overwrite' ? regenOptionActiveStyle(accent) : {}) }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{t('storyboard.overwriteEpisode')}</span>
                <span style={{ fontSize: 12, color: mutedColor, marginTop: 2 }}>{t('storyboard.overwriteEpisodeDesc')}</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => { onOptionChange('compare'); onStepChange(1); }}
              style={{ ...regenOptionBtnStyle(cardBorder), ...(regenOption === 'compare' ? regenOptionActiveStyle(accent) : {}) }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{t('storyboard.newCompareNode')}</span>
                <span style={{ fontSize: 12, color: mutedColor, marginTop: 2 }}>{t('storyboard.newCompareNodeDesc')}</span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Step 1: 确认 */}
      {regenStep === 1 && (
        <div style={{ padding: '20px 24px' }}>
          <div style={{ fontSize: 12, color: mutedColor, marginBottom: 12, fontWeight: 600 }}>
            {t('storyboard.confirmInfo')}
          </div>
          <div style={{
            background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
            borderRadius: 10, padding: '12px 16px',
            border: `1px solid ${cardBorder}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: textColor, padding: '4px 0' }}>
              <span style={{ color: mutedColor }}>{t('storyboard.operation')}</span>
              <span>{regenOption === 'overwrite' ? t('storyboard.overwriteEpisode') : t('storyboard.newCompareNode')}</span>
            </div>
            {linkedScript && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: textColor, padding: '4px 0' }}>
                <span style={{ color: mutedColor }}>{t('storyboard.associateScript')}</span>
                <span>{linkedScript.title || t('storyboard.script')}</span>
              </div>
            )}
            {regenMeta.episodeTitle && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: textColor, padding: '4px 0' }}>
                <span style={{ color: mutedColor }}>{t('storyboard.processingEpisode')}</span>
                <span>{regenMeta.episodeTitle}</span>
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: mutedColor, marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Check size={12} />
            {t('storyboard.undoableAfterRegen')}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '12px 24px', borderTop: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {regenStep === 0 ? (
          <Button size="small" type="text" onClick={onCancel} style={{ color: mutedColor }}>
            {t('common.cancel')}
          </Button>
        ) : (
          <Button size="small" type="text" icon={<ChevronLeft size={14} />} onClick={() => onStepChange(0)} style={{ color: mutedColor }}>
            {t('storyboard.previousStep')}
          </Button>
        )}
        <div style={{ flex: 1 }} />
        {regenStep === 1 && (
          <Button
            size="small"
            type="primary"
            onClick={() => {
              if (regenOption === 'overwrite') onOverwriteRegen();
              else onNewCompareRegen();
            }}
            style={{ fontSize: 12 }}
          >
            {regenOption === 'overwrite' ? t('storyboard.startOverwrite') : t('storyboard.createNode')}
          </Button>
        )}
      </div>
    </Modal>
  );
}