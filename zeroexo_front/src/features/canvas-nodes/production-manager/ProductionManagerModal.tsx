/**
 * ProductionManagerModal - 统筹条目编辑器（Plan#29 V3）
 *
 * 布局 1:1 继承 SubjectEditorModal（Plan#20 打磨成果），禁止自由发挥：
 * - 左栏：条目垂直导航（演员/场景/道具分组，stateNavItemStyle 背景分层选中态）
 * - 中栏：剧照舞台（previewStageStyle 棋盘格 contain 大图）+ 胶卷条（filmstripStyle 76×76 缩略图，hover 删除）+ 上传块（uploadTileStyle）
 * - 右栏：条目信息表单（formLabelStyle + tagInputStyle/noteInputStyle/promptBlockStyle，提示词页面同款）
 * - Modal 壳/标题栏：modalHeaderStyle + modalTitleInputStyle（剧标题可编辑）
 * 「状态」已废弃：剧照每张挂自由标签；「发送到资产」= 创建提示词条目。
 */
import { memo, useMemo, useState } from 'react';
import { Modal, Select, App as AntdApp } from 'antd';
import {
  Clapperboard, Plus, Trash2, Upload as UploadIcon, UserRound, MapPin, Package, Send, X, ImageIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { createPrompt } from '@/features/asset-library/prompts-api.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import {
  createProductionItem,
  type ProductionItem,
  type ProductionItemKind,
  type ProductionManagerData,
} from './production-manager-types.js';
import {
  modalHeaderStyle, modalHeaderIconStyle, modalTitleInputStyle, modalIconBtnStyle,
  ghostHoverHandlers, modalEditBtnStyle,
  previewStageStyle, previewImageStyle, imageCounterStyle, emptyPreviewStyle,
  filmstripStyle, thumbItemStyle, thumbImageStyle, thumbHoverOverlayStyle, thumbActionBtnStyle, uploadTileStyle,
  formSectionStyle, formLabelStyle, tagInputStyle, noteInputStyle, promptBlockStyle, promptTextareaStyle,
  stateNavItemStyle,
} from './production-editor-styles.js';

const KIND_ICON: Record<ProductionItemKind, React.ComponentType<{ size?: number | string }>> = {
  character: UserRound,
  scene: MapPin,
  prop: Package,
};

const KIND_COLOR: Record<ProductionItemKind, string> = {
  character: '#5DDCFF',
  scene: '#4ade80',
  prop: '#fbbf24',
};

export interface ProductionManagerModalProps {
  open: boolean;
  onClose: () => void;
  data: ProductionManagerData;
  onDataChange: (next: ProductionManagerData) => void;
}

/** 剧照大图（hydration 回退 preview 级资源） */
function StillLarge({ storageKey }: { storageKey: string }): React.ReactElement {
  const hydrated = useHydratedContent(storageKey, getResourceUrl(storageKey, 'full') ?? '');
  if (!hydrated) return <div style={emptyPreviewStyle}><ImageIcon size={32} /></div>;
  return <img src={hydrated} alt="" draggable={false} style={previewImageStyle} />;
}

/** 胶卷条缩略图 */
function StillThumb({ storageKey }: { storageKey: string }): React.ReactElement {
  const hydrated = useHydratedContent(storageKey, getResourceUrl(storageKey, 'preview') ?? '');
  if (!hydrated) return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(127,127,127,0.6)' }}><ImageIcon size={16} /></div>;
  return <img src={hydrated} alt="" draggable={false} style={thumbImageStyle} />;
}

export const ProductionManagerModal = memo(function ProductionManagerModal({
  open, onClose, data, onDataChange,
}: ProductionManagerModalProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message: antdMessage } = AntdApp.useApp();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  // 表面色（背景分层，无边线风格）
  const surfaceBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
  const panelBg = isDark ? '#1c1917' : '#ffffff';

  // 草稿（保存时一次性提交）
  const [draft, setDraft] = useState<ProductionManagerData>(() => ({
    title: data.title,
    scriptId: data.scriptId,
    items: data.items.map((i) => ({ ...i, aliases: [...i.aliases], episodeIds: [...i.episodeIds], images: i.images.map((im) => ({ ...im, tags: [...im.tags] })) })),
  }));
  const [selectedId, setSelectedId] = useState<string | null>(draft.items[0]?.id ?? null);
  const [selectedImgIdx, setSelectedImgIdx] = useState(0);
  const [uploading, setUploading] = useState(false);

  const selected = useMemo(() => draft.items.find((i) => i.id === selectedId) ?? null, [draft.items, selectedId]);

  const groups = useMemo(() => {
    const order: ProductionItemKind[] = ['character', 'scene', 'prop'];
    return order.map((kind) => ({ kind, items: draft.items.filter((i) => i.kind === kind) }));
  }, [draft.items]);

  const patchItem = (id: string, patch: Partial<ProductionItem>) => {
    setDraft((prev) => ({ ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  };

  const handleAdd = (kind: ProductionItemKind) => {
    const item = createProductionItem(kind);
    setDraft((prev) => ({ ...prev, items: [...prev.items, item] }));
    setSelectedId(item.id);
    setSelectedImgIdx(0);
  };

  const handleDeleteItem = (id: string) => {
    setDraft((prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  const handleUploadStill = async (file: File) => {
    if (!selected) return;
    setUploading(true);
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data as { storageKey?: string };
      if (!d.storageKey) throw new Error('no storageKey');
      patchItem(selected.id, { images: [...selected.images, { storageKey: d.storageKey, tags: [] }] });
      setSelectedImgIdx(selected.images.length);
    } catch {
      antdMessage.error(t('productionManager.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  // Plan#29 T10: 发送到资产 → 提示词条目（资产提炼）
  const handleSendToAsset = async () => {
    if (!selected) return;
    const content = (selected.prompt || selected.consistency || '').trim();
    if (!content) { antdMessage.warning(t('productionManager.noPromptToSend')); return; }
    try {
      await createPrompt({
        title: selected.name,
        content,
        category: selected.kind === 'character' ? 'role' : selected.kind,
        tags: [...selected.aliases],
        imageKeys: selected.images.map((i) => i.storageKey),
      });
      antdMessage.success(t('productionManager.sentToAsset'));
    } catch {
      antdMessage.error(t('productionManager.sendFailed'));
    }
  };

  const handleSave = () => {
    onDataChange({ ...draft, items: draft.items.filter((i) => i.name.trim() !== '') });
    onClose();
  };

  const currentImg = selected?.images[Math.min(selectedImgIdx, Math.max(0, (selected?.images.length ?? 1) - 1))] ?? null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1180}
      centered
      destroyOnHidden
      closable={false}
      styles={{ body: { padding: 0, background: panelBg, borderRadius: 14, overflow: 'hidden' } }}
    >
      {/* ===== 标题栏（提示词页面同款） ===== */}
      <div style={modalHeaderStyle(theme)}>
        <span style={modalHeaderIconStyle(theme)}><Clapperboard size={17} /></span>
        <input
          value={draft.title}
          onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
          placeholder={t('productionManager.editorTitle')}
          style={modalTitleInputStyle(theme)}
        />
        <button type="button" {...ghostHoverHandlers(theme)} onClick={handleSave} style={{ ...modalEditBtnStyle(theme), color: accent, borderColor: `${accent}55` }}>
          {t('common.save')}
        </button>
        <button type="button" {...ghostHoverHandlers(theme)} onClick={onClose} style={modalIconBtnStyle(theme, false)}>
          <X size={16} />
        </button>
      </div>

      {/* ===== 三栏主体 ===== */}
      <div style={{ display: 'flex', height: 600 }}>
        {/* 左栏：条目导航（分组 + 背景分层选中态） */}
        <div style={{ width: 200, flexShrink: 0, borderRight: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`, display: 'flex', flexDirection: 'column', padding: 10, gap: 4, overflow: 'auto' }}>
          {groups.map((g) => {
            const GroupIcon = KIND_ICON[g.kind];
            return (
              <div key={g.kind} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: KIND_COLOR[g.kind] }}>
                  <GroupIcon size={11} />
                  {t(`entity.${g.kind}`)} · {g.items.length}
                </div>
                {g.items.map((item) => {
                  const ItemIcon = KIND_ICON[item.kind];
                  const active = item.id === selectedId;
                  return (
                    <div
                      key={item.id}
                      onClick={() => { setSelectedId(item.id); setSelectedImgIdx(0); }}
                      style={stateNavItemStyle(active, accent, 'transparent')}
                    >
                      <ItemIcon size={13} />
                      <span style={{ flex: 1, fontSize: 12, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name || t('productionManager.unnamed')}
                      </span>
                      {item.images.length > 0 && <span style={{ fontSize: 10, color: textMuted }}>{item.images.length}</span>}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id); }}
                        style={{ border: 'none', background: 'transparent', color: textMuted, cursor: 'pointer', padding: 2, display: 'inline-flex', opacity: active ? 1 : 0.5 }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {/* 新增条目 */}
          <div style={{ display: 'flex', gap: 4, marginTop: 'auto', paddingTop: 8 }}>
            {(['character', 'scene', 'prop'] as ProductionItemKind[]).map((kind) => {
              const Icon = KIND_ICON[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => handleAdd(kind)}
                  title={t(`productionManager.add_${kind}`)}
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3, height: 30, borderRadius: 8, border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`, background: 'transparent', color: KIND_COLOR[kind], fontSize: 11, cursor: 'pointer' }}
                >
                  <Plus size={11} /><Icon size={12} />
                </button>
              );
            })}
          </div>
        </div>

        {/* 中栏：剧照舞台 + 胶卷条 */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
          <div style={previewStageStyle(theme)}>
            {currentImg ? (
              <StillLarge storageKey={currentImg.storageKey} />
            ) : (
              <div style={emptyPreviewStyle}>
                <ImageIcon size={36} />
                <span style={{ fontSize: 12 }}>{selected ? t('productionManager.stills') : t('productionManager.selectToEdit')}</span>
              </div>
            )}
            {selected && selected.images.length > 0 && (
              <span style={imageCounterStyle}>{Math.min(selectedImgIdx + 1, selected.images.length)} / {selected.images.length}</span>
            )}
          </div>
          {selected && (
            <>
              <div style={filmstripStyle()}>
                {selected.images.map((img, idx) => (
                  <div
                    key={`${img.storageKey}-${idx}`}
                    onClick={() => setSelectedImgIdx(idx)}
                    onMouseEnter={(e) => { const ov = e.currentTarget.querySelector('[data-ov]') as HTMLElement | null; if (ov) ov.style.opacity = '1'; }}
                    onMouseLeave={(e) => { const ov = e.currentTarget.querySelector('[data-ov]') as HTMLElement | null; if (ov) ov.style.opacity = '0'; }}
                    style={thumbItemStyle(theme, idx === selectedImgIdx, false)}
                  >
                    <StillThumb storageKey={img.storageKey} />
                    <div data-ov style={thumbHoverOverlayStyle}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          patchItem(selected.id, { images: selected.images.filter((_, i) => i !== idx) });
                          setSelectedImgIdx(0);
                        }}
                        style={thumbActionBtnStyle}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
                <label style={uploadTileStyle(theme)}>
                  <UploadIcon size={15} />
                  <span style={{ fontSize: 10 }}>{uploading ? t('productionManager.uploading') : t('productionManager.uploadStill')}</span>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUploadStill(f); e.target.value = ''; }}
                  />
                </label>
              </div>
              {/* 当前剧照自由标签（T8：不限状态语义） */}
              {currentImg && (
                <input
                  value={currentImg.tags.join(', ')}
                  onChange={(e) => {
                    const tags = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                    patchItem(selected.id, { images: selected.images.map((x, i) => (i === selectedImgIdx ? { ...x, tags } : x)) });
                  }}
                  placeholder={t('productionManager.tagPlaceholder')}
                  style={tagInputStyle(theme)}
                />
              )}
            </>
          )}
        </div>

        {/* 右栏：条目信息表单（提示词页面同款） */}
        <div style={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!selected ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: textMuted, fontSize: 12 }}>
              {t('productionManager.selectToEdit')}
            </div>
          ) : (
            <>
              <div style={formSectionStyle()}>
                <label style={formLabelStyle(theme)}>{t('productionManager.name')}</label>
                <input value={selected.name} onChange={(e) => patchItem(selected.id, { name: e.target.value })} style={tagInputStyle(theme)} />
              </div>
              <div style={formSectionStyle()}>
                <label style={formLabelStyle(theme)}>{t('productionManager.kind')}</label>
                <Select
                  value={selected.kind}
                  onChange={(v) => patchItem(selected.id, { kind: v })}
                  size="small"
                  style={{ width: '100%' }}
                  options={[
                    { value: 'character', label: t('entity.character') },
                    { value: 'scene', label: t('entity.scene') },
                    { value: 'prop', label: t('entity.prop') },
                  ]}
                />
              </div>
              <div style={formSectionStyle()}>
                <label style={formLabelStyle(theme)}>{t('productionManager.aliases')}</label>
                <input
                  value={selected.aliases.join(', ')}
                  onChange={(e) => patchItem(selected.id, { aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder={t('productionManager.aliasesPlaceholder')}
                  style={tagInputStyle(theme)}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ ...formSectionStyle(), flex: 1 }}>
                  <label style={formLabelStyle(theme)}>{t('productionManager.voice')}</label>
                  <input value={selected.voice} onChange={(e) => patchItem(selected.id, { voice: e.target.value })} style={tagInputStyle(theme)} />
                </div>
                <div style={{ ...formSectionStyle(), flex: 1 }}>
                  <label style={formLabelStyle(theme)}>{t('productionManager.episodes')}</label>
                  <input
                    value={selected.episodeIds.join(', ')}
                    onChange={(e) => patchItem(selected.id, { episodeIds: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    placeholder="ep-1, ep-2"
                    style={tagInputStyle(theme)}
                  />
                </div>
              </div>
              <div style={formSectionStyle()}>
                <label style={formLabelStyle(theme)}>{t('productionManager.consistency')}</label>
                <textarea
                  value={selected.consistency}
                  onChange={(e) => patchItem(selected.id, { consistency: e.target.value })}
                  placeholder={t('productionManager.consistencyPlaceholder')}
                  style={noteInputStyle(theme)}
                />
              </div>
              <div style={formSectionStyle()}>
                <label style={formLabelStyle(theme)}>{t('productionManager.note')}</label>
                <input value={selected.note} onChange={(e) => patchItem(selected.id, { note: e.target.value })} style={tagInputStyle(theme)} />
              </div>
              <div style={{ ...formSectionStyle(), flex: 1, minHeight: 120 }}>
                <label style={formLabelStyle(theme)}>{t('productionManager.prompt')}</label>
                <div style={promptBlockStyle(theme)}>
                  <textarea
                    value={selected.prompt}
                    onChange={(e) => patchItem(selected.id, { prompt: e.target.value })}
                    placeholder={t('productionManager.promptPlaceholder')}
                    style={promptTextareaStyle(theme)}
                  />
                </div>
              </div>
              <button type="button" onClick={() => void handleSendToAsset()} style={{ ...modalEditBtnStyle(theme), alignSelf: 'flex-start', background: `${surfaceBg}` }}>
                <Send size={13} />
                {t('productionManager.sendToAsset')}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
});
