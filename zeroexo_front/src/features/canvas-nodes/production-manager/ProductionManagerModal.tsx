/**
 * ProductionManagerModal - 统筹条目编辑器（Plan#29 主体系统 V3）
 *
 * 左栏：条目列表（演员/场景/道具分组）+ 新增
 * 右栏：条目基本信息（名称/别名/类型/一致性提示词/音色/备注/出场集/提炼提示词）
 *       + 剧照集（上传 + 每图自由标签，替代旧「状态」枚举）
 * 草稿本地编辑，「保存」一次性 onDataChange 提交（updateNode 命令化）。
 */
import { memo, useMemo, useState } from 'react';
import { Modal, Select, App as AntdApp } from 'antd';
import { Plus, Trash2, Upload as UploadIcon, UserRound, MapPin, Package, X, Send } from 'lucide-react';
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
  type ProductionItemImage,
  type ProductionManagerData,
} from './production-manager-types.js';

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

/** 剧照缩略图（含自由标签录入） */
const ImageThumb = memo(function ImageThumb({
  img, theme, onDelete, onTagsChange,
}: {
  img: ProductionItemImage;
  theme: ReturnType<typeof useTheme>['theme'];
  onDelete: () => void;
  onTagsChange: (tags: string[]) => void;
}) {
  const hydrated = useHydratedContent(img.storageKey, getResourceUrl(img.storageKey, 'preview') ?? '');
  return (
    <div style={{ width: 132, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ position: 'relative', width: 132, height: 74, borderRadius: 6, overflow: 'hidden', background: 'rgba(127,127,127,0.12)' }}>
        {hydrated ? (
          <img src={hydrated} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : null}
        <button
          type="button"
          onClick={onDelete}
          style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 4, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#ff6b6b', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <X size={10} />
        </button>
      </div>
      <input
        value={img.tags.join(', ')}
        onChange={(e) => onTagsChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        placeholder="标签,逗号分隔"
        style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: `1px solid ${theme.toolbar.border}`, background: 'transparent', color: theme.toolbar.text, outline: 'none' }}
      />
    </div>
  );
});

export const ProductionManagerModal = memo(function ProductionManagerModal({
  open, onClose, data, onDataChange,
}: ProductionManagerModalProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message: antdMessage } = AntdApp.useApp();
  const isDark = theme.mode === 'dark';
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;
  const accent = theme.toolbar.accent;

  // 草稿（保存时一次性提交）
  const [draft, setDraft] = useState<ProductionManagerData>(() => ({ ...data, items: data.items.map((i) => ({ ...i })) }));
  const [selectedId, setSelectedId] = useState<string | null>(draft.items[0]?.id ?? null);
  const [uploading, setUploading] = useState(false);

  const selected = useMemo(() => draft.items.find((i) => i.id === selectedId) ?? null, [draft.items, selectedId]);

  const groups = useMemo(() => {
    const order: ProductionItemKind[] = ['character', 'scene', 'prop'];
    return order
      .map((kind) => ({ kind, items: draft.items.filter((i) => i.kind === kind) }))
      .filter((g) => g.items.length > 0);
  }, [draft.items]);

  const patchItem = (id: string, patch: Partial<ProductionItem>) => {
    setDraft((prev) => ({ ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  };

  const handleAdd = (kind: ProductionItemKind) => {
    const item = createProductionItem(kind);
    setDraft((prev) => ({ ...prev, items: [...prev.items, item] }));
    setSelectedId(item.id);
  };

  const handleDelete = (id: string) => {
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
    } catch {
      antdMessage.error(t('productionManager.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = () => {
    onDataChange({ ...draft, items: draft.items.filter((i) => i.name.trim() !== '') });
    onClose();
  };

  // Plan#29 T10: 发送到资产 → 提示词条目(资产提炼;主体不再作为独立资产维护)
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

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '5px 8px', borderRadius: 6,
    border: `1px solid ${border}`, background: isDark ? 'rgba(255,255,255,0.04)' : '#fff',
    color: text, outline: 'none', width: '100%',
  };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: textMuted, marginBottom: 3, display: 'block' };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1060}
      centered
      destroyOnHidden
      title={
        <span style={{ fontSize: 13, fontWeight: 700, color: text }}>
          {t('productionManager.editorTitle')} · {draft.title}
        </span>
      }
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ display: 'flex', height: 560 }}>
        {/* 左栏：条目列表 */}
        <div style={{ width: 250, borderRight: `1px solid ${border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 4, padding: 10, borderBottom: `1px solid ${border}` }}>
            {(['character', 'scene', 'prop'] as ProductionItemKind[]).map((kind) => {
              const Icon = KIND_ICON[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => handleAdd(kind)}
                  title={t(`productionManager.add_${kind}`)}
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '5px 0', borderRadius: 6, border: `1px solid ${border}`, background: 'transparent', color: KIND_COLOR[kind], fontSize: 11, cursor: 'pointer' }}
                >
                  <Plus size={11} /><Icon size={12} />
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
            {groups.length === 0 && (
              <div style={{ fontSize: 11, color: textMuted, textAlign: 'center', padding: '24px 8px' }}>
                {t('productionManager.emptyItems')}
              </div>
            )}
            {groups.map((g) => (
              <div key={g.kind} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: KIND_COLOR[g.kind], fontWeight: 700, padding: '2px 6px', marginBottom: 3 }}>
                  {t(`entity.${g.kind}`)} · {g.items.length}
                </div>
                {g.items.map((item) => {
                  const Icon = KIND_ICON[item.kind];
                  const active = item.id === selectedId;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6,
                        cursor: 'pointer', marginBottom: 2,
                        background: active ? `${accent}1f` : 'transparent',
                        border: active ? `1px solid ${accent}55` : '1px solid transparent',
                      }}
                    >
                      <Icon size={13} />
                      <span style={{ fontSize: 12, color: text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name || t('productionManager.unnamed')}
                      </span>
                      {item.images.length > 0 && <span style={{ fontSize: 10, color: textMuted }}>{item.images.length}</span>}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                        style={{ border: 'none', background: 'transparent', color: textMuted, cursor: 'pointer', padding: 2, display: 'inline-flex' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* 右栏：条目编辑表单 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {!selected ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: textMuted, fontSize: 12 }}>
              {t('productionManager.selectToEdit')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{t('productionManager.name')}</label>
                  <input style={inputStyle} value={selected.name} onChange={(e) => patchItem(selected.id, { name: e.target.value })} />
                </div>
                <div style={{ width: 120 }}>
                  <label style={labelStyle}>{t('productionManager.kind')}</label>
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
              </div>
              <div>
                <label style={labelStyle}>{t('productionManager.aliases')}</label>
                <input
                  style={inputStyle}
                  value={selected.aliases.join(', ')}
                  onChange={(e) => patchItem(selected.id, { aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder={t('productionManager.aliasesPlaceholder')}
                />
              </div>
              <div>
                <label style={labelStyle}>{t('productionManager.consistency')}</label>
                <textarea
                  style={{ ...inputStyle, height: 64, resize: 'vertical' }}
                  value={selected.consistency}
                  onChange={(e) => patchItem(selected.id, { consistency: e.target.value })}
                  placeholder={t('productionManager.consistencyPlaceholder')}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{t('productionManager.voice')}</label>
                  <input style={inputStyle} value={selected.voice} onChange={(e) => patchItem(selected.id, { voice: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{t('productionManager.episodes')}</label>
                  <input
                    style={inputStyle}
                    value={selected.episodeIds.join(', ')}
                    onChange={(e) => patchItem(selected.id, { episodeIds: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    placeholder="ep-1, ep-2"
                  />
                </div>
              </div>
              <div>
                <label style={labelStyle}>{t('productionManager.note')}</label>
                <input style={inputStyle} value={selected.note} onChange={(e) => patchItem(selected.id, { note: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>{t('productionManager.stills')}</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selected.images.map((img, idx) => (
                    <ImageThumb
                      key={`${img.storageKey}-${idx}`}
                      img={img}
                      theme={theme}
                      onDelete={() => patchItem(selected.id, { images: selected.images.filter((_, i) => i !== idx) })}
                      onTagsChange={(tags) => patchItem(selected.id, { images: selected.images.map((x, i) => (i === idx ? { ...x, tags } : x)) })}
                    />
                  ))}
                  <label
                    style={{ width: 132, height: 74, borderRadius: 6, border: `1px dashed ${border}`, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: uploading ? 'wait' : 'pointer', color: textMuted, fontSize: 10 }}
                  >
                    <UploadIcon size={14} />
                    {uploading ? t('productionManager.uploading') : t('productionManager.uploadStill')}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUploadStill(f); e.target.value = ''; }}
                    />
                  </label>
                </div>
              </div>
              <div>
                <label style={labelStyle}>{t('productionManager.prompt')}</label>
                <textarea
                  style={{ ...inputStyle, height: 56, resize: 'vertical' }}
                  value={selected.prompt}
                  onChange={(e) => patchItem(selected.id, { prompt: e.target.value })}
                  placeholder={t('productionManager.promptPlaceholder')}
                />
                <button
                  type="button"
                  onClick={() => void handleSendToAsset()}
                  style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 6, border: `1px solid ${accent}55`, background: `${accent}14`, color: accent, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  <Send size={11} />
                  {t('productionManager.sendToAsset')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部保存栏 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: `1px solid ${border}` }}>
        <button type="button" onClick={onClose} style={{ padding: '6px 18px', borderRadius: 6, border: `1px solid ${border}`, background: 'transparent', color: textMuted, fontSize: 12, cursor: 'pointer' }}>
          {t('common.cancel')}
        </button>
        <button type="button" onClick={handleSave} style={{ padding: '6px 22px', borderRadius: 6, border: 'none', background: accent, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          {t('common.save')}
        </button>
      </div>
    </Modal>
  );
});
