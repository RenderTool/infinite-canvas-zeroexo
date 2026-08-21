/**
 * StoryboardAssociateModal - 分镜"关联剧本 + 选集 + 生成方式"步骤向导弹窗
 *
 * 三步向导：选择剧集 → 生成方式 → 确认
 * 确认后统一 emit `storyboard:associate` 事件（由 use-editor-interactions 处理）。
 *
 * 数据流：
 * - 剧本侧：targetNodeId 为空 → 为每个选集新建独立分镜节点并连线。
 * - 分镜侧：targetNodeId 为现有分镜节点 → 连到现有节点。
 */
import { useState, useEffect, useCallback, type CSSProperties, type ReactElement } from 'react';
import { X, Check, ChevronRight, ChevronLeft } from 'lucide-react';
import { Modal, Checkbox, Radio, Steps } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';
import { nodeActionBus } from '@zeroexo/plugin-nodes';

export interface AssociateEpisode {
  id: string;
  number?: number;
  title?: string;
}

export interface StoryboardAssociateModalProps {
  open: boolean;
  onClose: () => void;
  /** 关联的剧本节点 id */
  scriptNodeId: string;
  /** 剧本标题（用于弹窗副标题） */
  scriptTitle?: string;
  /** 剧本的全部剧集列表 */
  episodes: AssociateEpisode[];
  /** 默认生成方式：true=立即生成，false=仅关联 */
  defaultGenerate?: boolean;
  /** 目标分镜节点 id（分镜侧关联现有节点时传入；剧本侧新建节点传 undefined） */
  targetNodeId?: string;
}

export function StoryboardAssociateModal({
  open,
  onClose,
  scriptNodeId,
  scriptTitle,
  episodes,
  defaultGenerate = true,
  targetNodeId,
}: StoryboardAssociateModalProps): ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';

  const [step, setStep] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<'generate' | 'link'>(defaultGenerate ? 'generate' : 'link');
  const [createSubjects, setCreateSubjects] = useState(true); // Plan#20 T8: 同步创建主体堆叠开关

  // 每次打开时重置
  useEffect(() => {
    if (open) {
      setStep(0);
      setSelectedIds(episodes.map((e) => e.id));
      setMode(defaultGenerate ? 'generate' : 'link');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultGenerate]);

  const episodeLabel = (ep: AssociateEpisode) => {
    const defaultTitle = `第${ep.number ?? 0}集`;
    const hasCustomTitle = ep.title && ep.title !== defaultTitle;
    const localizedDefault = t('storyboard.episodeLabel', { number: ep.number ?? 0 });
    return hasCustomTitle ? `${localizedDefault} · ${ep.title}` : localizedDefault;
  };

  const handleConfirm = () => {
    if (selectedIds.length === 0) return;
    nodeActionBus.emit('storyboard:associate' as any, {
      scriptNodeId,
      targetNodeId,
      episodeIds: selectedIds,
      autoGenerate: mode === 'generate',
      createSubjects: mode === 'generate' && createSubjects, // Plan#20 T8
    } as any);
    onClose();
  };

  // 全选/取消全选
  const allSelected = selectedIds.length === episodes.length && episodes.length > 0;
  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(episodes.map((e) => e.id));
    }
  }, [allSelected, episodes]);

  // ── 主题色 ──
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;
  const accent = theme.toolbar.accent;
  const bgHeader = isDark ? '#1f1f1f' : '#fafaf7';

  // ── 样式 ──
  const contentStyle: CSSProperties = {
    background: theme.toolbar.background,
    padding: 0,
    overflow: 'hidden',
    borderRadius: 16,
    border: `1px solid ${border}`,
  };
  const modalBodyStyle: CSSProperties = { padding: 0, display: 'flex', flexDirection: 'column' };
  const maskStyle: CSSProperties = {
    background: 'transparent',
  };
  const headerStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 24px', borderBottom: `1px solid ${border}`, background: bgHeader,
  };
  const closeBtnStyle: CSSProperties = {
    width: 32, height: 32, border: 'none', borderRadius: 8,
    background: 'transparent', color: textMuted, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.15s', fontSize: 18,
  };
  const sectionTitleStyle: CSSProperties = {
    fontSize: 12, color: textMuted, marginBottom: 12, fontWeight: 600,
  };
  const footerStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, padding: '14px 24px', borderTop: `1px solid ${border}`, background: bgHeader,
  };
  const btnBase: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 20px', border: 'none', borderRadius: 10,
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    transition: 'all 0.2s', fontFamily: 'inherit',
  };
  const primaryBtn: CSSProperties = { ...btnBase, background: accent, color: '#fff' };
  const ghostBtn: CSSProperties = {
    ...btnBase, border: `1px solid ${border}`, background: 'transparent', color: textMuted,
  };
  const disabledBtn: CSSProperties = { ...primaryBtn, opacity: 0.5, cursor: 'not-allowed' };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      centered
      width={520}
      footer={null}
      destroyOnHidden
      closeIcon={null}
      styles={{ container: contentStyle, body: modalBodyStyle, mask: maskStyle }}
    >
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: text, letterSpacing: '0.3px' }}>
            {targetNodeId ? t('storyboard.associateScript') : t('storyboard.generateStoryboard')}
          </div>
          <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>
            「{scriptTitle || t('storyboard.script')}」· {targetNodeId ? t('storyboard.associateExistingNode') : t('storyboard.createNewNode')}
          </div>
        </div>
        <button type="button" style={closeBtnStyle} onClick={onClose} aria-label={t('common.close')}>
          <X size={16} />
        </button>
      </div>

      {/* Steps 导航 */}
      <div style={{ padding: '20px 24px 4px' }}>
        <Steps
          current={step}
          size="small"
          items={[
            { title: t('storyboard.selectEpisodes') },
            { title: t('storyboard.generateMode') },
            { title: t('common.confirm') },
          ]}
        />
      </div>

      {/* Step 0: 选择剧集 */}
      {step === 0 && (
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={sectionTitleStyle}>{t('storyboard.selectEpisodesToProcess')}</div>
            <button
              type="button"
              onClick={toggleSelectAll}
              style={{
                fontSize: 12, color: accent, cursor: 'pointer',
                background: 'none', border: 'none', padding: 0, fontFamily: 'inherit',
              }}
            >
              {allSelected ? t('storyboard.deselectAll') : t('storyboard.selectAll')}
            </button>
          </div>
          {episodes.length === 0 ? (
            <div style={{ fontSize: 13, color: textMuted, padding: '8px 0' }}>
              {t('storyboard.noEpisodes')}
            </div>
          ) : (
            <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 4 }}>
              <Checkbox.Group
                value={selectedIds}
                onChange={(vals) => setSelectedIds(vals as string[])}
                style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}
              >
                {episodes.map((ep) => (
                  <Checkbox key={ep.id} value={ep.id} style={{ width: '50%' }}>
                    <span style={{ fontSize: 13, color: text }}>{episodeLabel(ep)}</span>
                  </Checkbox>
                ))}
              </Checkbox.Group>
            </div>
          )}
          {selectedIds.length > 0 && (
            <div style={{ fontSize: 12, color: textMuted, marginTop: 8 }}>
              {t('storyboard.selectedEpisodes', { count: selectedIds.length })}
            </div>
          )}
        </div>
      )}

      {/* Step 1: 生成方式 */}
      {step === 1 && (
        <div style={{ padding: '20px 24px' }}>
          <div style={sectionTitleStyle}>{t('storyboard.selectGenerateMode')}</div>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <Radio value="generate" style={{ color: text }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13, color: text, fontWeight: 600 }}>{t('storyboard.generateImmediately')}</span>
                <span style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>
                  {targetNodeId
                    ? t('storyboard.generateWriteCurrentNode')
                    : t('storyboard.generateSwitchInNode')}
                </span>
              </div>
            </Radio>
            <Radio value="link" style={{ color: text }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13, color: text, fontWeight: 600 }}>{t('storyboard.linkOnly')}</span>
                <span style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>
                  {targetNodeId
                    ? t('storyboard.linkDescExisting')
                    : t('storyboard.linkDescNew')}
                </span>
              </div>
            </Radio>
          </Radio.Group>
          {/* Plan#20 T8: 同步创建主体堆叠开关 */}
          {mode === 'generate' && (
            <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 10, background: isDark ? 'rgba(167,139,250,0.08)' : 'rgba(167,139,250,0.06)', border: `1px solid ${isDark ? 'rgba(167,139,250,0.2)' : 'rgba(167,139,250,0.15)'}` }}>
              <Checkbox
                checked={createSubjects}
                onChange={(e) => setCreateSubjects(e.target.checked)}
                style={{ color: text }}
              >
                <span style={{ fontSize: 13, color: text, fontWeight: 600 }}>{t('storyboard.createSubjectStack')}</span>
              </Checkbox>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 4, marginLeft: 24 }}>
                {t('storyboard.createSubjectStackDesc')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: 确认 */}
      {step === 2 && (
        <div style={{ padding: '20px 24px' }}>
          <div style={sectionTitleStyle}>{t('storyboard.confirmInfo')}</div>
          <div style={{
            background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
            borderRadius: 10, padding: '12px 16px',
            border: `1px solid ${border}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: text, padding: '4px 0' }}>
              <span style={{ color: textMuted }}>{t('storyboard.script')}</span>
              <span>{scriptTitle || t('storyboard.script')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: text, padding: '4px 0' }}>
              <span style={{ color: textMuted }}>{t('storyboard.processingEpisode')}</span>
              <span>{t('storyboard.episodesCount', { count: selectedIds.length })}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: text, padding: '4px 0' }}>
              <span style={{ color: textMuted }}>{t('storyboard.generateMode')}</span>
              <span>{mode === 'generate' ? t('storyboard.generateImmediately') : t('storyboard.linkOnly')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: text, padding: '4px 0' }}>
              <span style={{ color: textMuted }}>{t('storyboard.operation')}</span>
              <span>{targetNodeId ? t('storyboard.writeCurrentNode') : t('storyboard.createNewNode')}</span>
            </div>
          </div>
          {selectedIds.length > 0 && (
            <div style={{ fontSize: 12, color: textMuted, marginTop: 8 }}>
              {t('storyboard.selectedEpisodesList', { list: selectedIds.map((id) => {
                const ep = episodes.find((e) => e.id === id);
                return ep ? episodeLabel(ep) : '';
              }).join('、') })}
            </div>
          )}
          {mode === 'generate' && (
            <div style={{ fontSize: 12, color: textMuted, marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Check size={12} />
              {t('storyboard.undoableAfterRegen')}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={footerStyle}>
        {step === 0 ? (
          <button type="button" style={ghostBtn} onClick={onClose}>
            {t('common.cancel')}
          </button>
        ) : (
          <button
            type="button"
            style={ghostBtn}
            onClick={() => setStep(step - 1)}
          >
            <ChevronLeft size={14} />
            {t('storyboard.previousStep')}
          </button>
        )}
        <div style={{ flex: 1 }} />
        {step < 2 ? (
          <button
            type="button"
            style={selectedIds.length === 0 ? disabledBtn : primaryBtn}
            onClick={() => {
              if (step === 0 && selectedIds.length === 0) return;
              setStep(step + 1);
            }}
            disabled={step === 0 && selectedIds.length === 0}
          >
            {step === 1 ? t('common.confirm') : t('storyboard.nextStep')}
            <ChevronRight size={14} />
          </button>
        ) : (
          <button
            type="button"
            style={primaryBtn}
            onClick={handleConfirm}
          >
            {mode === 'generate' ? t('storyboard.startGenerate', { count: selectedIds.length }) : t('storyboard.confirmAssociate')}
          </button>
        )}
      </div>
    </Modal>
  );
}