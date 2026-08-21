/**
 * SubjectEditorModal - 主体编辑器（Plan#20 重设计 v4）
 *
 * 用户验收反馈返工（禁止自由发挥，全部 1:1 复用现有实现）：
 * - 网格卡片 = asset-library/cards/asset-card.tsx **同款**
 *   （封面 239.2/135.4 + cover 填充 + 底部两行信息 + hover 浮条）
 * - 图册模式 = asset-library/prompt-create-page.tsx **同款预览区**
 *   （棋盘格舞台 + contain 完整显示 + 封面徽标 + 计数 + 右下角垂直缩放 + 76×76 胶片条）
 * - 详情面板输入 = prompt-create-page.tsx **同款表单**
 *   （formLabelStyle 标签 + promptBlock/promptTextarea 等宽输入 + copyBtn 复制）
 * - 设封面入口唯一：胶片条缩略图 hover 小按钮（提示词页面同款）
 * - 文案全部 i18n，专业描述，不写需求原话
 * - 块间无边线（背景分层 + 阴影），控件（输入框/按钮）按提示词页面保留边线
 *
 * 三栏布局：左状态导航 | 中图库（网格/图册）| 右单图详情
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Select, App as AntdApp, Tooltip, Empty } from 'antd';
import {
  Plus, Trash2, LayoutGrid, Image as ImageIcon, Star, X, Copy, Upload as UploadIcon,
  UserRound, MapPin, Package, Loader2, Play, Pause, Mic, ListMusic, Sparkles, Send, GitFork, CircleOff,
} from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { ProxyProvider } from '@zeroexo/plugin-ai-provider';
import type { SubjectCardData, SubjectState, SubjectStateImage, EntityKind } from '../storyboard/storyboard-types';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import { createSubject } from '@/features/asset-library/subjects-api.js';
import { apiFetch } from '@/services/api-client.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { actionBtnStyle } from '@/features/asset-library/asset-library-styles.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { ImageViewerStage, ZoomToolbar, useImagePanZoom } from '@/shared/components/image-viewer.js';
import { AuthorizedImage } from '@/shared/components/authorized-media.js';
import { useAuth } from '@/features/auth/auth-store.js';
import {
  modalHeaderStyle, modalHeaderIconStyle, modalTitleInputStyle, modalIconBtnStyle, ghostHoverHandlers,
  modalEditBtnStyle, previewStageStyle, previewImageStyle, coverBadgeStyle, imageCounterStyle,
  emptyPreviewStyle, filmstripStyle, thumbItemStyle, thumbImageStyle, thumbCoverBadgeStyle,
  thumbHoverOverlayStyle, thumbActionBtnStyle, uploadTileStyle, formSectionStyle, formLabelStyle,
  formLabelRowStyle, copyBtnStyle, noteInputStyle, promptBlockStyle, promptTextareaStyle, tagInputStyle,
  cardCoverStyle, stateNavItemStyle, viewSwitchBtnStyle, voiceCardStyle, pickerPanelStyle,
} from './subject-editor-styles.js';

const KIND_ICON: Record<EntityKind, React.ComponentType<{ size?: number | string }>> = {
  character: UserRound,
  scene: MapPin,
  prop: Package,
};

/**
 * AI 生成形象图提示词模板（Plan#20 T8: 占位真生成）
 * 基底 = 用户提供的「Cinematic Character Lineup Sheet」定妆规范（邵氏风格）
 * 角色用完整定妆模板；场景/道具用简化环境模板；一致性描述与状态备注动态拼入。
 */
const LINEUP_TEMPLATE = `专业电影级角色定妆参考图(Cinematic Character Lineup Sheet):
16:9 横向宽银幕构图,左侧 35% 正面大头特写,右侧为三视图(正面、侧身、背面)。
严格锁定同一真人演员,自然放松站姿(非T-pose/A-pose),杜绝僵硬模型感。
左侧特写:微侧15°,中性自然表情,真实眼神,极致写实皮肤,85mm人像镜头,浅景深,电影级布光。
右侧三视图:身高对齐底部平齐,真实演员试装照风格,高级电影戏服质感,自然褶皱,哑光材质。
风格:邵氏电影风格,经典摄影棚搭景感,戏剧性主光,高对比度,特艺彩色(Technicolor)取向,
老胶片颗粒感,模拟1970s香港片场氛围。背景纯净中性灰(#C8C8C8)无缝背景纸,无道具。
质量:AAA级电影制作质量,超高分辨率,写实人体解剖,复古胶片感,非动漫,非游戏渲染。`;

export interface SubjectEditorModalProps {
  open: boolean;
  onClose: () => void;
  data: SubjectCardData;
  onDataChange: (next: SubjectCardData) => void;
  /** 节点 id（拆分主体事件上报用） */
  nodeId?: string;
  /** 被引用状态 id → 引用镜头数（停用保护：被引用状态禁删只可停用） */
  referencedStateIds?: Map<string, number>;
}

export const SubjectEditorModal = memo(function SubjectEditorModal({
  open, onClose, data, onDataChange, nodeId, referencedStateIds,
}: SubjectEditorModalProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message: antdMessage, modal: antdModal } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();

  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const pageBg = theme.canvas.background;
  const surfaceBg = theme.node.fill;

  // ===== 当前活跃状态 =====
  const activeState = useMemo(
    () => data.states.find((s) => s.id === data.activeStateId) ?? data.states[0] ?? null,
    [data.states, data.activeStateId],
  );

  // ===== 图库视图模式 =====
  const [galleryView, setGalleryView] = useState<'grid' | 'album'>('grid');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idCounter = useRef(0);
  const panZoom = useImagePanZoom();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [audioAssets, setAudioAssets] = useState<Asset[]>([]);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const voiceFileInputRef = useRef<HTMLInputElement>(null);
  // Plan#20 T8: AI 形象图生成中 / T7: 发送资产中
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);

  // ===== 音色播放生命周期（修复"状态切换音色跳变"：切换状态/关闭 Modal 时停播 + 重置） =====
  // 切换状态：旧状态音频必须立即停止（否则新状态卡片显示新音色名、耳朵里还是旧声音）
  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setVoicePlaying(false);
  }, [activeState?.id]);
  // 关闭 Modal：new Audio 不随 DOM 销毁，必须显式停播（否则关掉编辑器声音还在响）
  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
      audioRef.current = null;
      setVoicePlaying(false);
    }
  }, [open]);
  // 卸载兜底
  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  const images = activeState?.images ?? [];
  const selectedImage = useMemo(
    () => images.find((img) => img.storageKey === selectedKey) ?? null,
    [images, selectedKey],
  );

  // 状态切换时重置选中图（封面优先，否则首图）
  useEffect(() => {
    if (images.length === 0) { setSelectedKey(null); return; }
    const coverImg = data.coverKey ? images.find((i) => i.storageKey === data.coverKey) : undefined;
    setSelectedKey((coverImg ?? images[0]!).storageKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeState?.id]);

  // 打开音色选择器时加载音频资产
  useEffect(() => {
    if (!voicePickerOpen) return;
    let cancelled = false;
    void listAssets().then((all) => {
      if (!cancelled) setAudioAssets(all.filter((a) => a.kind === 'audio'));
    }).catch(() => { /* 静默 */ });
    return () => { cancelled = true; };
  }, [voicePickerOpen]);

  // ===== 复制 =====
  const handleCopy = useCallback(async (text: string) => {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    antdMessage.success(t('subject.copied'));
  }, [antdMessage, t]);

  // ===== 主体级字段 =====
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onDataChange({ ...data, name: e.target.value });
  }, [data, onDataChange]);

  const handleKindChange = useCallback((kind: EntityKind) => {
    onDataChange({ ...data, kind });
  }, [data, onDataChange]);

  const handleAliasesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onDataChange({ ...data, aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) });
  }, [data, onDataChange]);

  const handleConsistencyChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onDataChange({ ...data, consistency: e.target.value });
  }, [data, onDataChange]);

  // ===== 状态管理 =====
  const handleSelectState = useCallback((stateId: string) => {
    onDataChange({ ...data, activeStateId: stateId });
  }, [data, onDataChange]);

  const handleAddState = useCallback(() => {
    const newId = `state-${Date.now()}`;
    const newState: SubjectState = {
      id: newId, name: `${t('subject.newStateName')}${data.states.length + 1}`, images: [], note: '',
    };
    onDataChange({ ...data, states: [...data.states, newState], activeStateId: newId });
  }, [data, onDataChange, t]);

  // Plan#20 T12c: 停用保护——被引用状态禁删只可停用（防引用断裂）
  const handleDeleteState = useCallback((stateId: string) => {
    if (data.states.length <= 1) return;
    const refCount = referencedStateIds?.get(stateId) ?? 0;
    if (refCount > 0) {
      antdModal.warning({
        title: t('subject.deleteState'),
        content: t('subject.stateReferencedCannotDelete', { count: refCount }),
        centered: true,
        okText: t('common.confirm'),
      });
      return;
    }
    antdModal.confirm({
      title: t('subject.deleteState'),
      content: t('subject.deleteStateConfirm'),
      centered: true,
      okButtonProps: { danger: true },
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: () => {
        const nextStates = data.states.filter((s) => s.id !== stateId);
        const nextActive = data.activeStateId === stateId ? (nextStates[0]?.id ?? null) : data.activeStateId;
        onDataChange({ ...data, states: nextStates, activeStateId: nextActive });
      },
    });
  }, [data, onDataChange, antdModal, t, referencedStateIds]);

  // 停用/启用切换（停用后镜头状态下拉不再可选，已引用仍可显示）
  const handleToggleStateDisabled = useCallback((stateId: string) => {
    const target = data.states.find((s) => s.id === stateId);
    if (!target) return;
    const nextStates = data.states.map((s) => (s.id === stateId ? { ...s, disabled: !s.disabled } : s));
    onDataChange({ ...data, states: nextStates });
  }, [data, onDataChange]);

  // ===== 当前状态补丁 =====
  const patchActiveState = useCallback((patch: Partial<SubjectState>) => {
    if (!activeState) return;
    const nextStates = data.states.map((s) => (s.id === activeState.id ? { ...s, ...patch } : s));
    onDataChange({ ...data, states: nextStates });
  }, [data, activeState, onDataChange]);

  // ===== 图片导入 =====
  const handleImportImage = useCallback(async (file: File) => {
    if (!isAuthenticated) { antdMessage.warning(t('subjectCreate.loginRequired')); return; }
    const localId = `up_${++idCounter.current}`;
    setUploading((prev) => ({ ...prev, [localId]: 0 }));
    try {
      const uploaded = await uploadAsset(file, (loaded, total) => {
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        setUploading((prev) => ({ ...prev, [localId]: pct }));
      });
      const d = uploaded.data as { kind?: string; storageKey?: string; dataUrl?: string };
      const storageKey = d.storageKey ?? '';
      if (storageKey) {
        if (d.kind === 'image' && d.dataUrl) setLocalPreviews((prev) => ({ ...prev, [storageKey]: d.dataUrl! }));
        patchActiveState({ images: [...images, { storageKey }] });
        setSelectedKey(storageKey);
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
    } finally {
      setUploading((prev) => { const n = { ...prev }; delete n[localId]; return n; });
    }
  }, [isAuthenticated, antdMessage, t, images, patchActiveState]);

  // ===== AI 生成形象图（Plan#20 T8: 占位真生成 + 失败重试） =====
  const buildImagePrompt = useCallback((): string => {
    const desc = [data.consistency?.trim(), activeState?.note?.trim()].filter(Boolean).join('。');
    const kindWord = data.kind === 'character' ? '角色' : data.kind === 'scene' ? '场景' : '道具';
    if (data.kind !== 'character') {
      return `专业电影级${kindWord}设定参考图,16:9 横向构图。${desc ? `核心特征:${desc}。` : ''}风格:邵氏电影风格,特艺彩色(Technicolor)取向,老胶片颗粒感,电影级布光,超高分辨率,非动漫,非游戏渲染。`;
    }
    return `${LINEUP_TEMPLATE}\n角色名称:${data.name}${desc ? `。角色特征:${desc}` : ''}`;
  }, [data.name, data.kind, data.consistency, activeState]);

  const handleAiGenerate = useCallback(async () => {
    if (!isAuthenticated) { antdMessage.warning(t('subjectCreate.loginRequired')); return; }
    if (!data.name?.trim()) { antdMessage.warning(t('subject.aiGenerateEmptyName')); return; }
    if (generating) return;
    setGenerating(true);
    try {
      const provider = new ProxyProvider(apiFetch);
      const results = await provider.generateImage({
        prompt: buildImagePrompt(),
        model: 'gpt-4o',
        size: '1792x1024',
        quality: 'standard',
        count: 1,
      });
      const first = results[0];
      if (!first) throw new Error(t('nodes.noImageReturned'));
      // dataUrl → File → 上传落库 → storageKey 追加到当前状态图集（生成结果直接落主体，画布节点仅引用）
      const blob = await (await fetch(first.dataUrl)).blob();
      const file = new File([blob], `${data.name}-${Date.now()}.png`, { type: first.mimeType || 'image/png' });
      const uploaded = await uploadAsset(file);
      const d = uploaded.data as { kind?: string; storageKey?: string; dataUrl?: string };
      const storageKey = d.storageKey ?? '';
      if (!storageKey) throw new Error(t('subject.aiGenerateFailed'));
      if (d.dataUrl) setLocalPreviews((prev) => ({ ...prev, [storageKey]: d.dataUrl! }));
      patchActiveState({ images: [...images, { storageKey, prompt: buildImagePrompt() }] });
      setSelectedKey(storageKey);
      if (!data.coverKey) onDataChange({ ...data, coverKey: storageKey });
      antdMessage.success(t('subject.aiGenerateSuccess'));
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subject.aiGenerateFailed'));
    } finally {
      setGenerating(false);
    }
  }, [isAuthenticated, antdMessage, t, generating, buildImagePrompt, images, patchActiveState, data, onDataChange]);

  // ===== 发送到资产库（Plan#20 T7: 资产可选录入，assetSubjectId 幂等回填防重复） =====
  const handleSendToAsset = useCallback(async () => {
    if (!isAuthenticated) { antdMessage.warning(t('subjectCreate.loginRequired')); return; }
    if (data.assetSubjectId) { antdMessage.info(t('subject.alreadySent')); return; }
    if (!data.name?.trim()) { antdMessage.warning(t('subject.aiGenerateEmptyName')); return; }
    if (sending) return;
    setSending(true);
    try {
      const allImageKeys = Array.from(new Set(data.states.flatMap((s) => s.images.map((i) => i.storageKey))));
      const subject = await createSubject({
        type: data.kind,
        name: data.name.trim(),
        aliases: data.aliases.join(', '),
        description: data.consistency,
        consistency: data.consistency,
        avatarKey: data.coverKey ?? allImageKeys[0] ?? null,
        imageKeys: allImageKeys,
        status: allImageKeys.length > 0 ? 'ok' : 'warn',
      });
      onDataChange({ ...data, assetSubjectId: subject.id });
      antdMessage.success(t('subject.sentToAsset'));
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subject.sendFailed'));
    } finally {
      setSending(false);
    }
  }, [isAuthenticated, antdMessage, t, sending, data, onDataChange]);

  // ===== 单图操作 =====
  const patchImage = useCallback((storageKey: string, patch: Partial<SubjectStateImage>) => {
    patchActiveState({ images: images.map((i) => (i.storageKey === storageKey ? { ...i, ...patch } : i)) });
  }, [images, patchActiveState]);

  const handleRemoveImage = useCallback((storageKey: string) => {
    patchActiveState({ images: images.filter((i) => i.storageKey !== storageKey) });
    if (data.coverKey === storageKey) onDataChange({ ...data, coverKey: null });
    if (selectedKey === storageKey) setSelectedKey(images.find((i) => i.storageKey !== storageKey)?.storageKey ?? null);
  }, [images, patchActiveState, data, onDataChange, selectedKey]);

  const handleSelectPreview = useCallback((key: string) => {
    setSelectedKey(key);
    panZoom.reset();
  }, [panZoom]);

  /** 网格卡片点击 → 进入图册模式细看（类似商品详情） */
  const handleOpenAlbum = useCallback((key: string) => {
    setSelectedKey(key);
    panZoom.reset();
    setGalleryView('album');
  }, [panZoom]);

  const handleSetCover = useCallback((storageKey: string) => {
    onDataChange({ ...data, coverKey: storageKey });
  }, [data, onDataChange]);

  // ===== 音色 =====
  const handlePickVoiceAsset = useCallback((asset: Asset) => {
    const storageKey = asset.data.kind === 'audio' ? asset.data.storageKey ?? '' : '';
    patchActiveState({ voice: { key: storageKey || asset.id, name: asset.title } });
    setVoicePickerOpen(false);
  }, [patchActiveState]);

  const handleUploadVoice = useCallback(async (file: File) => {
    if (!isAuthenticated) { antdMessage.warning(t('subjectCreate.loginRequired')); return; }
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data as { kind?: string; storageKey?: string };
      if (d.storageKey) {
        patchActiveState({ voice: { key: d.storageKey, name: file.name.replace(/\.[^.]+$/, '') } });
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
    }
  }, [isAuthenticated, antdMessage, t, patchActiveState]);

  const handleToggleVoicePlay = useCallback(() => {
    const voice = activeState?.voice;
    if (!voice) return;
    const url = getResourceUrl(voice.key, 'full');
    if (!url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setVoicePlaying(false);
    }
    if (!audioRef.current.src.endsWith(url)) audioRef.current.src = url;
    if (voicePlaying) { audioRef.current.pause(); setVoicePlaying(false); }
    else { void audioRef.current.play(); setVoicePlaying(true); }
  }, [activeState, voicePlaying]);

  const KindIcon = KIND_ICON[data.kind];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="calc(100vw - 32px)"
      centered
      destroyOnHidden
      styles={{ body: { padding: 0, height: 'calc(100vh - 130px)', overflow: 'hidden', background: pageBg } }}
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* ===== 标题栏（提示词页面同款 modalHeaderStyle） ===== */}
        <div style={modalHeaderStyle(theme)}>
          <span style={modalHeaderIconStyle(theme)}>
            <KindIcon size={16} />
          </span>
          <input
            value={data.name}
            onChange={handleNameChange}
            placeholder={t('subject.untitled')}
            style={modalTitleInputStyle(theme)}
          />
          <Select
            value={data.kind}
            onChange={handleKindChange}
            size="small"
            style={{ width: 104, flexShrink: 0 }}
            options={[
              { value: 'character', label: t('entity.character') },
              { value: 'scene', label: t('entity.scene') },
              { value: 'prop', label: t('entity.prop') },
            ]}
          />
          <input
            value={data.aliases.join(', ')}
            onChange={handleAliasesChange}
            placeholder={t('subject.aliasesPlaceholder')}
            style={{ ...tagInputStyle(theme), width: 200, flexShrink: 0 }}
          />
          {/* Plan#20 T12b: 拆分主体（引用按镜头勾选归属到新主体） */}
          <button
            type="button"
            {...ghostHoverHandlers(theme)}
            style={{ ...modalEditBtnStyle(theme), flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, color: accent }}
            onClick={() => { if (nodeId) nodeActionBus.emit('subject:splitRequested', { nodeId }); }}
            title={t('subject.splitDesc')}
          >
            <GitFork size={13} />
            {t('subject.splitSubject')}
          </button>
          {/* Plan#20 T7: 发送到资产库（幂等:已发送仅提示） */}
          <button
            type="button"
            {...ghostHoverHandlers(theme)}
            style={{ ...modalEditBtnStyle(theme), flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, color: data.assetSubjectId ? textMuted : accent }}
            onClick={() => void handleSendToAsset()}
            title={t('subject.sendToAssetDesc')}
          >
            {sending ? <Loader2 size={13} style={{ animation: 'zeroexo-spin 1s linear infinite' }} /> : <Send size={13} />}
            {t('subject.sendToAsset')}
          </button>
        </div>

        {/* ===== 三栏主体 ===== */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, color: textPrimary }}>
          {/* 左栏：一致性 + 状态导航 + 音色 */}
          <div style={{ width: 232, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 12px 16px 20px', overflowY: 'auto', minHeight: 0 }} className="zx-thin-scroll">
            {/* 一致性（提示词页面同款表单） */}
            <div style={formSectionStyle()}>
              <label style={formLabelStyle(theme)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                {t('subject.consistencyLabel')}
              </label>
              <textarea
                value={data.consistency}
                onChange={handleConsistencyChange}
                placeholder={t('subject.consistencyPlaceholder')}
                style={noteInputStyle(theme)}
                rows={4}
              />
            </div>

            {/* Plan#20 T9: 跨集归属 chips（多集续写自动累积，展示不可编辑） */}
            {data.episodeIds.length > 0 && (
              <div style={formSectionStyle()}>
                <label style={formLabelStyle(theme)}>{t('subject.episodesLabel')}</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {data.episodeIds.map((ep) => (
                    <span
                      key={ep}
                      title={ep}
                      style={{ fontSize: 11, color: textMuted, background: surfaceBg, borderRadius: 999, padding: '2px 10px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {ep}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 状态导航（无边线：背景分层 + 色块指示） */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
              <label style={formLabelStyle(theme)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                {t('subject.statesLabel')}
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', minHeight: 0 }} className="zx-thin-scroll">
                {data.states.map((s, i) => {
                  const isActive = activeState?.id === s.id;
                  const refCount = referencedStateIds?.get(s.id) ?? 0;
                  return (
                    <StateNavItem
                      key={s.id}
                      index={i}
                      name={s.name}
                      count={s.images.length}
                      isActive={isActive}
                      isDisabled={s.disabled === true}
                      refCount={refCount}
                      accent={accent}
                      surfaceBg={surfaceBg}
                      textMuted={textMuted}
                      deletable={data.states.length > 1}
                      onClick={() => handleSelectState(s.id)}
                      onDelete={() => handleDeleteState(s.id)}
                      onToggleDisabled={() => handleToggleStateDisabled(s.id)}
                    />
                  );
                })}
                <button
                  type="button"
                  onClick={handleAddState}
                  {...ghostHoverHandlers(theme)}
                  style={{ ...modalEditBtnStyle(theme), justifyContent: 'center', gap: 6, marginTop: 2 }}
                >
                  <Plus size={13} />
                  {t('subject.addState')}
                </button>
              </div>
            </div>

            {/* 音色（音频资产引用） */}
            <div style={formSectionStyle()}>
              <label style={formLabelStyle(theme)}>
                <Mic size={12} style={{ opacity: 0.6 }} />
                {t('subject.voiceLabel')}
                <span style={{ fontSize: 10, opacity: 0.6, textTransform: 'none' }}>({t('subject.voiceOptional')})</span>
              </label>
              {activeState?.voice ? (
                <div style={voiceCardStyle(surfaceBg)}>
                  <button
                    type="button"
                    {...ghostHoverHandlers(theme)}
                    style={{ ...modalIconBtnStyle(theme, true), width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }}
                    onClick={handleToggleVoicePlay}
                    title={voicePlaying ? t('common.cancel') : t('subject.playVoice')}
                  >
                    {voicePlaying ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                  <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeState.voice.name}
                  </span>
                  <Tooltip title={t('common.delete')}>
                    <button
                      type="button"
                      {...ghostHoverHandlers(theme)}
                      style={modalIconBtnStyle(theme, false)}
                      onClick={() => patchActiveState({ voice: undefined })}
                    >
                      <X size={13} />
                    </button>
                  </Tooltip>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setVoicePickerOpen(true)}
                    {...ghostHoverHandlers(theme)}
                    style={{ ...modalEditBtnStyle(theme), flex: 1, justifyContent: 'center' }}
                  >
                    <ListMusic size={13} />
                    {t('subject.voiceFromAsset')}
                  </button>
                  <Tooltip title={t('subject.voiceUpload')}>
                    <button
                      type="button"
                      onClick={() => voiceFileInputRef.current?.click()}
                      {...ghostHoverHandlers(theme)}
                      style={modalEditBtnStyle(theme)}
                    >
                      <UploadIcon size={13} />
                    </button>
                  </Tooltip>
                  <input ref={voiceFileInputRef} type="file" accept="audio/*" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUploadVoice(f); e.target.value = ''; }} />
                </div>
              )}
            </div>
          </div>

          {/* 中栏：图库区 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, padding: '16px 16px 16px 8px' }}>
            {/* 图库工具栏 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, flexShrink: 0 }}>
              <input
                value={activeState?.name ?? ''}
                onChange={(e) => patchActiveState({ name: e.target.value })}
                style={{ ...modalTitleInputStyle(theme), flex: 1, minWidth: 80, fontSize: 15 }}
              />
              <span style={{ fontSize: 12, color: textMuted, flexShrink: 0 }}>
                {t('subject.imagesCount', { count: images.length })}
              </span>
              <div style={{ display: 'flex', gap: 2, background: surfaceBg, borderRadius: 10, padding: 3, flexShrink: 0 }}>
                <Tooltip title={t('subject.gridView')}>
                  <button
                    type="button"
                    style={viewSwitchBtnStyle(galleryView === 'grid', accent, textMuted)}
                    onClick={() => setGalleryView('grid')}
                  >
                    <LayoutGrid size={15} />
                  </button>
                </Tooltip>
                <Tooltip title={t('subject.albumView')}>
                  <button
                    type="button"
                    style={viewSwitchBtnStyle(galleryView === 'album', accent, textMuted)}
                    onClick={() => setGalleryView('album')}
                  >
                    <ImageIcon size={15} />
                  </button>
                </Tooltip>
              </div>
              {/* Plan#20 T8: AI 生成形象图（占位真生成,失败可重试） */}
              <Tooltip title={t('subject.aiGenerateImageDesc')}>
                <button
                  type="button"
                  {...ghostHoverHandlers(theme)}
                  style={modalEditBtnStyle(theme)}
                  onClick={() => void handleAiGenerate()}
                >
                  {generating ? <Loader2 size={13} style={{ animation: 'zeroexo-spin 1s linear infinite' }} /> : <Sparkles size={13} />}
                  {generating ? t('subject.aiGenerating') : t('subject.aiGenerateImage')}
                </button>
              </Tooltip>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                {...ghostHoverHandlers(theme)}
                style={modalEditBtnStyle(theme)}
              >
                <UploadIcon size={13} />
                {t('subject.importImage')}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={(e) => { const fs = e.target.files; if (fs) Array.from(fs).forEach((f) => void handleImportImage(f)); e.target.value = ''; }} />
            </div>

            {/* 图库内容 */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {galleryView === 'grid' ? (
                /* 网格模式：资产浏览器同款卡片（asset-card.tsx 1:1） */
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }} className="zx-thin-scroll">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, alignContent: 'start' }}>
                    {images.map((img, i) => (
                      <SubjectImageCard
                        key={img.storageKey}
                        storageKey={img.storageKey}
                        localPreview={localPreviews[img.storageKey]}
                        ordinal={i + 1}
                        isCover={data.coverKey === img.storageKey}
                        hasPrompt={!!img.prompt}
                        theme={theme}
                        onClick={() => handleOpenAlbum(img.storageKey)}
                        onDelete={() => handleRemoveImage(img.storageKey)}
                      />
                    ))}
                    {/* 上传中占位 */}
                    {Object.entries(uploading).map(([id, pct]) => (
                      <div key={id} style={{ ...cardCoverStyle(theme), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Loader2 size={20} style={{ color: accent, animation: 'zeroexo-spin 1s linear infinite' }} />
                        <span style={{ fontSize: 11, color: textMuted }}>{pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* 图册模式：提示词页面同款预览区（prompt-create-page.tsx 1:1） */
                <AlbumPanel
                  images={images}
                  selectedKey={selectedKey}
                  coverKey={data.coverKey}
                  localPreviews={localPreviews}
                  theme={theme}
                  panZoom={panZoom}
                  t={t}
                  uploading={Object.keys(uploading).length > 0}
                  onSelect={handleSelectPreview}
                  onSetCover={handleSetCover}
                  onRemove={handleRemoveImage}
                  onAddFiles={(files) => Array.from(files).forEach((f) => void handleImportImage(f))}
                />
              )}
            </div>
          </div>

          {/* 右栏：单图详情（提示词页面同款表单） */}
          <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18, padding: '16px 20px 16px 8px', overflowY: 'auto', minHeight: 0 }} className="zx-thin-scroll">
            {selectedImage ? (
              <SelectedImageDetail
                image={selectedImage}
                ordinal={images.findIndex((i) => i.storageKey === selectedImage.storageKey) + 1}
                theme={theme}
                t={t}
                onPromptChange={(v) => patchImage(selectedImage.storageKey, { prompt: v })}
                onCopy={() => void handleCopy(selectedImage.prompt ?? '')}
              />
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span style={{ color: textMuted, fontSize: 12 }}>{t('subject.noImageSelected')}</span>} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 音色资产选择器 */}
      {voicePickerOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setVoicePickerOpen(false)}>
          <div style={pickerPanelStyle(theme.toolbar.background)} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle(theme)}>
              <span style={{ fontSize: 13, fontWeight: 600, color: textPrimary }}>{t('subject.voiceFromAsset')}</span>
              <button
                type="button"
                {...ghostHoverHandlers(theme)}
                style={{ ...modalIconBtnStyle(theme, false), marginLeft: 'auto' }}
                onClick={() => setVoicePickerOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 12px 12px' }} className="zx-thin-scroll">
              {audioAssets.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: textMuted }}>{t('subject.noVoiceAssets')}</div>
              ) : (
                audioAssets.map((a) => (
                  <div key={a.id} onClick={() => handlePickVoiceAsset(a)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', transition: 'background 0.12s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = surfaceBg; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <ListMusic size={14} style={{ color: accent, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
});

// ===== 网格图片卡片（资产浏览器 asset-card.tsx AssetCardGrid 1:1） =====

interface SubjectImageCardProps {
  storageKey: string;
  localPreview?: string;
  ordinal: number;
  isCover: boolean;
  hasPrompt: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
  onClick: () => void;
  onDelete: () => void;
}

const SubjectImageCard = memo(function SubjectImageCard({
  storageKey, localPreview, ordinal, isCover, hasPrompt, theme, onClick, onDelete,
}: SubjectImageCardProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const fallback = localPreview ?? getResourceUrl(storageKey, 'preview') ?? '';
  const hydrated = useHydratedContent(storageKey, fallback);
  const [imgError, setImgError] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: '100%',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {/* 封面区域（资产浏览器同款：239.2/135.4 + 底色 + 边框） */}
      <div style={cardCoverStyle(theme)}>
        {hydrated && !imgError ? (
          <img
            src={hydrated}
            alt=""
            loading="lazy"
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={() => setImgError(true)}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ImageIcon size={40} color={theme.toolbar.textMuted} />
          </div>
        )}
        {/* Hover 遮罩（资产浏览器同款） */}
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.05)',
          opacity: hovered ? 1 : 0, transition: 'opacity 0.3s', pointerEvents: 'none',
        }} />
        {/* 封面角标（提示词页面胶片条同款 16px 圆点） */}
        {isCover && (
          <div style={{ ...thumbCoverBadgeStyle, zIndex: 2 }}>
            <Star size={8} fill="currentColor" />
          </div>
        )}
      </div>

      {/* 底部信息（资产浏览器同款两行） */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, paddingLeft: 4, paddingRight: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 24 }}>
          <span style={{
            fontSize: 14, lineHeight: '22px', fontWeight: 500, color: theme.toolbar.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
          }}>
            {t('subject.imageOrdinal', { n: ordinal })}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: theme.toolbar.textMuted, fontWeight: 500 }}>
            {hasPrompt ? t('subject.promptReady') : t('subject.promptEmpty')}
          </span>
        </div>
      </div>

      {/* Hover 操作浮条（资产浏览器同款：删除） */}
      {hovered && (
        <div style={{
          position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4,
          background: theme.toolbar.background, border: `1px solid ${theme.toolbar.border}`,
          borderRadius: 8, padding: '2px 4px', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', zIndex: 10,
        }} onClick={(e) => e.stopPropagation()}>
          <Tooltip title={t('common.delete')}>
            <button type="button" onClick={onDelete} style={{ ...actionBtnStyle(), color: theme.toolbar.danger }}>
              <Trash2 size={13} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
});

// ===== 图册模式（提示词页面 prompt-create-page.tsx 预览区 1:1） =====

function AlbumPanel({ images, selectedKey, coverKey, localPreviews, theme, panZoom, t, uploading, onSelect, onSetCover, onRemove, onAddFiles }: {
  images: SubjectStateImage[];
  selectedKey: string | null;
  coverKey: string | null;
  localPreviews: Record<string, string>;
  theme: ReturnType<typeof useTheme>['theme'];
  panZoom: ReturnType<typeof useImagePanZoom>;
  t: ReturnType<typeof useTranslation>['t'];
  uploading: boolean;
  onSelect: (key: string) => void;
  onSetCover: (key: string) => void;
  onRemove: (key: string) => void;
  onAddFiles: (files: FileList) => void;
}) {
  const idx = images.findIndex((i) => i.storageKey === selectedKey);
  const current = idx >= 0 ? images[idx] : undefined;
  const rawSrc = current
    ? (localPreviews[current.storageKey] || getResourceUrl(current.storageKey, 'full') || '')
    : '';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      {/* 大图预览舞台（提示词页面同款：棋盘格 + contain 完整显示） */}
      {current ? (
        <ImageViewerStage
          src={rawSrc}
          alt=""
          panZoom={panZoom}
          containerStyle={previewStageStyle(theme)}
          imgStyle={previewImageStyle}
          onImgError={(e) => { e.currentTarget.style.opacity = '0.3'; }}
        >
          {/* 封面标记（提示词页面同款徽标） */}
          {coverKey === current.storageKey && (
            <div style={coverBadgeStyle}>
              <Star size={11} fill="currentColor" />
              {t('subject.coverImage')}
            </div>
          )}
          {/* 图片计数（提示词页面同款） */}
          <div style={imageCounterStyle}>
            {idx + 1} / {images.length}
          </div>
          {/* 垂直缩放工具栏 - 右下角（提示词页面同款） */}
          <ZoomToolbar panZoom={panZoom} orientation="vertical" style={{ position: 'absolute', bottom: 10, right: 10 }} />
        </ImageViewerStage>
      ) : (
        <div style={previewStageStyle(theme)}>
          <div style={emptyPreviewStyle}>
            <span style={{ fontSize: 12, opacity: 0.5 }}>{t('subject.noImages')}</span>
          </div>
        </div>
      )}

      {/* 缩略图胶片条（提示词页面同款 76×76，hover 设封面/删除，设封面唯一入口） */}
      <div style={filmstripStyle()}>
        {images.map((img) => {
          const thumbSrc = localPreviews[img.storageKey] || getResourceUrl(img.storageKey, 'preview') || '';
          const isActive = img.storageKey === selectedKey;
          const isCover = coverKey === img.storageKey;
          return (
            <div
              key={img.storageKey}
              style={thumbItemStyle(theme, isActive, isCover)}
              onClick={() => onSelect(img.storageKey)}
            >
              <AuthorizedImage
                src={thumbSrc}
                alt=""
                style={thumbImageStyle}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              {isCover && (
                <div style={thumbCoverBadgeStyle}>
                  <Star size={8} fill="currentColor" />
                </div>
              )}
              <div
                style={thumbHoverOverlayStyle}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
              >
                {!isCover && (
                  <button
                    type="button"
                    style={thumbActionBtnStyle}
                    onClick={(e) => { e.stopPropagation(); onSetCover(img.storageKey); }}
                    title={t('subject.setAsCover')}
                  >
                    <ImageIcon size={11} />
                  </button>
                )}
                <Tooltip title={t('promptCreate.remove')}>
                  <button
                    type="button"
                    style={thumbActionBtnStyle}
                    onClick={(e) => { e.stopPropagation(); onRemove(img.storageKey); }}
                  >
                    <X size={11} />
                  </button>
                </Tooltip>
              </div>
            </div>
          );
        })}
        {/* 上传按钮（提示词页面同款加号 tile） */}
        <label style={uploadTileStyle(theme)}>
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files && e.target.files.length > 0) onAddFiles(e.target.files); e.target.value = ''; }}
          />
          {uploading ? <Loader2 size={20} style={{ animation: 'zeroexo-spin 1s linear infinite' }} /> : <Plus size={22} />}
        </label>
      </div>
    </div>
  );
}

// ===== 右栏单图详情（提示词页面同款表单） =====

function SelectedImageDetail({ image, ordinal, theme, t, onPromptChange, onCopy }: {
  image: SubjectStateImage;
  ordinal: number;
  theme: ReturnType<typeof useTheme>['theme'];
  t: ReturnType<typeof useTranslation>['t'];
  onPromptChange: (v: string) => void;
  onCopy: () => void;
}) {
  return (
    <div style={{ ...formSectionStyle(), flex: 1, minHeight: 0 }}>
      <div style={formLabelRowStyle()}>
        <label style={formLabelStyle(theme)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          {t('subject.promptLabel')}
        </label>
        <button
          type="button"
          onClick={onCopy}
          style={copyBtnStyle(theme)}
          title={t('subject.copyPrompt')}
        >
          <Copy size={12} />
          {t('subject.copyPrompt')}
        </button>
      </div>
      <div style={{ ...promptBlockStyle(theme), flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <textarea
          value={image.prompt ?? ''}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder={t('subject.imagePromptPlaceholder')}
          style={{ ...promptTextareaStyle(theme), flex: 1 }}
        />
      </div>
      <span style={{ fontSize: 11, color: theme.toolbar.textMuted, marginTop: 10 }}>
        {t('subject.imageOrdinal', { n: ordinal })}
      </span>
    </div>
  );
}

// ===== 状态导航条目（无边线：背景分层，删除按钮在条目上 hover 显示） =====

interface StateNavItemProps {
  index: number;
  name: string;
  count: number;
  isActive: boolean;
  /** 停用标记（镜头状态下拉不可选；条目名划线 + 停用按钮激活态） */
  isDisabled?: boolean;
  /** 被引用镜头数（>0 时删除按钮替换为停用提示） */
  refCount?: number;
  accent: string;
  surfaceBg: string;
  textMuted: string;
  deletable: boolean;
  onClick: () => void;
  onDelete: () => void;
  onToggleDisabled?: () => void;
}

function StateNavItem({ index, name, count, isActive, isDisabled, refCount, accent, surfaceBg, textMuted, deletable, onClick, onDelete, onToggleDisabled }: StateNavItemProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={stateNavItemStyle(isActive, accent, surfaceBg)}
      title={isDisabled ? (refCount && refCount > 0 ? undefined : '已停用') : undefined}
    >
      <span style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, background: isActive ? accent : 'rgba(128,128,128,0.2)', color: isActive ? '#fff' : 'inherit',
        opacity: isDisabled ? 0.45 : 1,
      }}>
        {index + 1}
      </span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: isActive ? 600 : 400, textDecoration: isDisabled ? 'line-through' : undefined, opacity: isDisabled ? 0.55 : 1 }}>{name}</span>
      <span style={{ fontSize: 10, color: textMuted, flexShrink: 0, opacity: isDisabled ? 0.55 : 1 }}>{count}</span>
      {hovered && onToggleDisabled && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggleDisabled(); }}
          title={isDisabled ? undefined : '停用'}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: isDisabled ? accent : textMuted, flexShrink: 0 }}>
          <CircleOff size={11} />
        </button>
      )}
      {deletable && hovered && !(refCount && refCount > 0) && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: textMuted, flexShrink: 0 }}>
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}
