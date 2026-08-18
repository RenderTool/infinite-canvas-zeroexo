// TODO(拆分): 该文件超过 1000 行，计划按「状态层/交互层/渲染层」拆分，见 DESIGN.md
/**
 * SubjectCreatePage - 主体创建/编辑独立页面
 *
 * 参考 asset_manager.html 实现的表单结构,支持:
 * - 角色/场景/道具三种类型
 * - 名称、别名、简介、标签
 * - 头像(Emoji 或图片)
 * - 一致性提示词
 * - 自定义字段(根据类型不同)
 * - 配音配置(仅角色)
 * - 多张参考图
 *
 * URL:
 *   #/test/subject/new         新建
 *   #/test/subject/:subjectId  编辑
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Save,
  Trash2,
  Copy,
  PlayCircle,
  Image as ImageIcon,
  Plus,
  X,
  Upload as UploadIcon,
  Loader2,
  Theater,
  Mic,
  Crosshair,
  type LucideIcon,
} from 'lucide-react';
import { Button, Input, Select, App as AntdApp, Spin, Tag, Progress } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { addAssets as storeAddAssets } from '@/features/asset-picker/asset-store.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { AuthorizedImage } from '@/shared/components/authorized-media.js';
import {
  createSubject,
  updateSubject,
  getSubject,
  deleteSubject,
  type Subject,
  type SubjectType,
} from './subjects-api.js';
import { useAuth } from '@/features/auth/auth-store.js';

interface SubjectCreatePageProps {
  subjectId?: string;
  onBack: () => void;
  onSaved: () => void;
  /** 是否在 Modal 中渲染(隐藏页面 chrome) */
  modal?: boolean;
}

const TYPE_ICON: Record<SubjectType, LucideIcon> = {
  character: Theater,
  scene: ImageIcon,
  prop: Crosshair,
};

const TYPE_COLOR: Record<SubjectType, string> = {
  character: '#5b8fd9',
  scene: '#4ade80',
  prop: '#c9a84c',
};

/** 类型下拉选项标签（图标 + 文案） */
function typeOptionLabel(type: SubjectType, text: string): React.ReactElement {
  const Icon = TYPE_ICON[type];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Icon size={14} />
      {text}
    </span>
  );
}

const VOICE_OPTIONS: Array<{ value: string; i18nKey: string }> = [
  { value: 'voice_male_deep', i18nKey: 'voiceDeepMale' },
  { value: 'voice_male_young', i18nKey: 'voiceYoungMale' },
  { value: 'voice_male_old', i18nKey: 'voiceOldMale' },
  { value: 'voice_female_gentle', i18nKey: 'voiceGentleFemale' },
  { value: 'voice_female_cold', i18nKey: 'voiceColdFemale' },
  { value: 'voice_child', i18nKey: 'voiceChild' },
  { value: 'voice_robot', i18nKey: 'voiceRobot' },
];

const FIELDS_BY_TYPE: Record<SubjectType, Array<{ key: string; i18nKey: string; multiline?: boolean }>> = {
  character: [
    { key: 'age', i18nKey: 'fieldAge' },
    { key: 'gender', i18nKey: 'fieldGender' },
    { key: 'height', i18nKey: 'fieldHeight' },
    { key: 'build', i18nKey: 'fieldBuild' },
    { key: 'personality', i18nKey: 'fieldPersonality', multiline: true },
    { key: 'backstory', i18nKey: 'fieldBackstory', multiline: true },
  ],
  scene: [
    { key: 'era', i18nKey: 'fieldEra' },
    { key: 'scale', i18nKey: 'fieldScale' },
    { key: 'time', i18nKey: 'fieldTime' },
    { key: 'weather', i18nKey: 'fieldWeather' },
  ],
  prop: [
    { key: 'material', i18nKey: 'fieldMaterial' },
    { key: 'size', i18nKey: 'fieldSize' },
    { key: 'color', i18nKey: 'fieldColor' },
  ],
};

export function SubjectCreatePage(props: SubjectCreatePageProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const { message: antdMessage, modal } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();

  const isEdit = !!props.subjectId;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [subject, setSubject] = useState<Subject | null>(null);

  // 表单字段
  const [type, setType] = useState<SubjectType>('character');
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [description, setDescription] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState('');
  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [consistency, setConsistency] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'ok' | 'warn' | 'err'>('warn');
  const [voice, setVoice] = useState<{ id: string; name: string; note: string } | null>(null);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [voiceForm, setVoiceForm] = useState<{ id: string; note: string; testText: string }>({
    id: 'voice_male_deep',
    note: '',
    testText: '',
  });
  const [images, setImages] = useState<Array<{ id?: string; storageKey: string; preview: string; name: string }>>([]);
  // 上传进度映射: 临时id -> 百分比(0-100)
  const [uploadingProgress, setUploadingProgress] = useState<Record<string, number>>({});
  // 本地预览 URL(blob URL),在图片上传后立即显示,直到后端缩略图可访问
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const uploadIdCounter = useRef(0);

  // 文件输入 ref:头像 + 参考图
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const imagesInputRef = useRef<HTMLInputElement>(null);

  // 加载主体
  useEffect(() => {
    if (!props.subjectId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getSubject(props.subjectId!);
        if (cancelled) return;
        setSubject(s);
        setType(s.type);
        setName(s.name);
        setAliases(s.aliases);
        setDescription(s.description);
        setAvatarEmoji(s.avatarEmoji ?? '');
        setAvatarKey(s.avatarKey);
        setTags(s.tags);
        setConsistency(s.consistency);
        setFields(s.fields);
        setStatus(s.status);
        // 从 imageKeys 恢复参考图缩略图
        if (s.imageKeys && s.imageKeys.length > 0) {
          setImages(
            s.imageKeys.map((storageKey, i) => ({
              id: `loaded_${i}_${storageKey.slice(-8)}`,
              storageKey,
              preview: getResourceUrl(storageKey, 'thumb') ?? '',
              name: `image_${i + 1}`,
            })),
          );
        }
        if (s.voice) {
          setVoice({ id: s.voice.id, name: s.voice.name, note: s.voice.note ?? '' });
        }
      } catch (err) {
        antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.subjectId, antdMessage, t]);

  // 切换类型时重置 fields
  useEffect(() => {
    if (subject) return; // 编辑模式不重置
    const newKeys = FIELDS_BY_TYPE[type].map((f) => f.key);
    const next: Record<string, string> = {};
    newKeys.forEach((k) => {
      next[k] = fields[k] ?? '';
    });
    setFields(next);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async () => {
    if (!isAuthenticated) {
      antdMessage.warning(t('subjectCreate.loginRequired'));
      if (typeof window !== 'undefined') window.location.hash = '#/auth';
      return;
    }
    if (!name.trim()) {
      antdMessage.warning(t('subjectCreate.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        type,
        name: name.trim(),
        aliases: aliases.trim(),
        description: description.trim(),
        avatarKey,
        avatarEmoji: avatarEmoji || null,
        status,
        consistency: consistency.trim(),
        fields,
        tags,
        imageKeys: images.map((i) => i.storageKey),
        folderId: null,
      };
      if (isEdit && props.subjectId) {
        await updateSubject(props.subjectId, payload);
      } else {
        await createSubject(payload as any);
      }
      antdMessage.success(t('subjectCreate.savedToast'));
      props.onSaved();
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [type, name, aliases, description, avatarKey, avatarEmoji, status, consistency, fields, tags, images, isEdit, props, antdMessage, t]);

  const handleDelete = useCallback(async () => {
    if (!props.subjectId) return;
    if (!isAuthenticated) {
      antdMessage.warning(t('subjectCreate.loginRequired'));
      if (typeof window !== 'undefined') window.location.hash = '#/auth';
      return;
    }
    modal.confirm({
      title: t('subjectCreate.delete'),
      content: t('assetLibrary.confirmDeleteItem', { name: subject?.name ?? '' }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        setDeleting(true);
        try {
          await deleteSubject(props.subjectId!);
          antdMessage.success(t('subjectCreate.deletedToast'));
          props.onSaved();
        } catch (err) {
          antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
        } finally {
          setDeleting(false);
        }
      },
    });
  }, [props, subject, antdMessage, t]);

  const handleCopyPrompt = useCallback(() => {
    if (!consistency.trim()) {
      antdMessage.warning(t('subjectCreate.consistencyPlaceholder'));
      return;
    }
    void navigator.clipboard.writeText(consistency);
    antdMessage.success(t('subjectCreate.copyPromptSuccess'));
  }, [consistency, antdMessage, t]);

  const handleAddTag = useCallback(() => {
    const v = tagInput.trim();
    if (!v) return;
    if (tags.includes(v)) {
      setTagInput('');
      return;
    }
    setTags([...tags, v]);
    setTagInput('');
  }, [tagInput, tags]);

  const handleAddImage = useCallback(
    async (file: File) => {
      if (!isAuthenticated) {
        antdMessage.warning(t('subjectCreate.loginRequired'));
        if (typeof window !== 'undefined') window.location.hash = '#/auth';
        return;
      }
      const uploadId = `upload_${++uploadIdCounter.current}`;
      setUploadingProgress((prev) => ({ ...prev, [uploadId]: 0 }));
      try {
        const uploaded = await uploadAsset(file, (loaded, total) => {
          const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
          setUploadingProgress((prev) => ({ ...prev, [uploadId]: pct }));
        });
        const stored = await storeAddAssets([uploaded]);
        const created = stored[0];
        // 提取预览 URL(blob URL 立即显示,直到后端缩略图可访问)
        const previewUrl =
          uploaded.data.kind === 'image' ? uploaded.data.dataUrl :
          uploaded.data.kind === 'video' ? uploaded.data.url :
          '';
        const storageKey = uploaded.data.kind === 'image' || uploaded.data.kind === 'video' || uploaded.data.kind === 'audio'
          ? (uploaded.data as { storageKey?: string }).storageKey ?? ''
          : '';
        const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        setImages((prev) => [...prev, { id: localId, storageKey, preview: previewUrl, name: uploaded.title }]);
        // 保存本地预览 URL
        if (previewUrl) {
          setLocalPreviews((prev) => ({ ...prev, [localId]: previewUrl }));
        }
        // 记录到 asset 库(用于列表展示)
        void created;
      } catch (err) {
        antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
      } finally {
        setUploadingProgress((prev) => {
          const next = { ...prev };
          delete next[uploadId];
          return next;
        });
      }
    },
    [antdMessage, t],
  );

  const handleRemoveImage = useCallback((idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  /** 上传头像图片(优先于 emoji 显示) */
  const handleAvatarUpload = useCallback(
    async (file: File) => {
      if (!isAuthenticated) {
        antdMessage.warning(t('subjectCreate.loginRequired'));
        if (typeof window !== 'undefined') window.location.hash = '#/auth';
        return;
      }
      try {
        const uploaded = await uploadAsset(file);
        const stored = await storeAddAssets([uploaded]);
        void stored;
        if (uploaded.data.kind === 'image') {
          setAvatarKey(uploaded.data.storageKey ?? null);
          setAvatarEmoji(''); // 用图片时清空 emoji
        }
        antdMessage.success(t('subjectCreate.savedToast'));
      } catch (err) {
        antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
      }
    },
    [antdMessage, t],
  );

  if (loading) {
    return (
      <div style={pageStyle(theme, !!props.modal)}>
        <div style={loadingStyle(theme)}>
          <Spin size="large" />
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle(theme, !!props.modal)}>
      {/* 顶部栏 */}
      <div style={topBarStyle(theme, isMobile)}>
        {!props.modal && (
          <Button
            size="small"
            icon={<ArrowLeft size={14} />}
            onClick={props.onBack}
          >
            {t('subjectCreate.back')}
          </Button>
        )}
        <h2 style={{ margin: 0, fontSize: isMobile ? 14 : 16, fontWeight: 600, color: theme.toolbar.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isEdit ? t('subjectCreate.editTitle') : t('subjectCreate.title')}
          {name && <span style={{ marginLeft: 8, opacity: 0.6 }}>· {name}</span>}
        </h2>
        <Button
          size="small"
          type="primary"
          icon={<Save size={14} />}
          onClick={handleSave}
          loading={saving}
        >
          {t('subjectCreate.save')}
        </Button>
        {isEdit && (
          <Button
            size="small"
            danger
            icon={<Trash2 size={14} />}
            onClick={handleDelete}
            loading={deleting}
          >
            {t('subjectCreate.delete')}
          </Button>
        )}
      </div>

      {/* 主体内容 */}
      <div style={contentStyle(isMobile)}>
        {/* 左:基础信息 */}
        <div style={leftColStyle(isMobile, theme)}>
          {/* 类型 + 头像 */}
          <div style={cardStyle(theme)}>
            <div style={cardHeaderStyle(theme)}>
              <span style={dotStyle(TYPE_COLOR[type])} />
              <span>{t('subjectCreate.type')}</span>
            </div>
            <Select
              style={{ width: '100%' }}
              value={type}
              onChange={(v) => setType(v)}
              options={[
                { value: 'character', label: typeOptionLabel('character', t('subjectCreate.typeCharacter')) },
                { value: 'scene', label: typeOptionLabel('scene', t('subjectCreate.typeScene')) },
                { value: 'prop', label: typeOptionLabel('prop', t('subjectCreate.typeProp')) },
              ]}
              disabled={isEdit}
            />

            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={avatarStyle(theme, TYPE_COLOR[type])}
                onClick={() => avatarInputRef.current?.click()}
                title={t('subjectCreate.avatarUpload')}
                className="zeroexo-icon-btn"
              >
                {avatarKey ? (
                  <AuthorizedImage
                    src={getResourceUrl(avatarKey, 'thumb') ?? avatarKey}
                    alt="avatar"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : avatarEmoji ? (
                  <span style={{ fontSize: 36 }}>{avatarEmoji}</span>
                ) : (
                  <ImageIcon size={28} color={TYPE_COLOR[type]} />
                )}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleAvatarUpload(f);
                  e.target.value = '';
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={fieldLabelStyle(theme)}>{t('subjectCreate.avatar')}</div>
                <Input
                  value={avatarEmoji}
                  onChange={(e) => setAvatarEmoji(e.target.value)}
                  placeholder={t('subjectCreate.avatarEmoji')}
                  maxLength={4}
                  size="small"
                />
                <div style={{ fontSize: 10, color: theme.toolbar.textMuted, marginTop: 4 }}>
                  {t('subjectCreate.avatarUpload')}
                </div>
              </div>
            </div>
          </div>

          {/* 基础字段 */}
          <div style={cardStyle(theme)}>
            <div style={cardHeaderStyle(theme)}>
              <span style={dotStyle(theme.toolbar.accent)} />
              <span>{t('subjectCreate.name')}</span>
            </div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('subjectCreate.namePlaceholder')}
              maxLength={50}
            />

            <div style={{ marginTop: 12 }}>
              <div style={fieldLabelStyle(theme)}>{t('subjectCreate.aliases')}</div>
              <Input
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                placeholder={t('subjectCreate.aliasesPlaceholder')}
                maxLength={100}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={fieldLabelStyle(theme)}>{t('subjectCreate.description')}</div>
              <Input.TextArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('subjectCreate.descriptionPlaceholder')}
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={500}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={fieldLabelStyle(theme)}>{t('subjectCreate.tags')}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                {tags.map((tag) => (
                  <Tag
                    key={tag}
                    closable
                    onClose={() => setTags(tags.filter((x) => x !== tag))}
                  >
                    {tag}
                  </Tag>
                ))}
              </div>
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onPressEnter={handleAddTag}
                placeholder={t('subjectCreate.tagsPlaceholder')}
                size="small"
              />
            </div>
          </div>
        </div>

        {/* 右:详细信息 */}
        <div style={rightColStyle(isMobile, theme)}>
          {/* 类型相关字段 */}
          <div style={cardStyle(theme)}>
            <div style={cardHeaderStyle(theme)}>
              <span style={dotStyle(TYPE_COLOR[type])} />
              <span>
                {type === 'character'
                  ? t('subjectCreate.typeCharacter')
                  : type === 'scene'
                  ? t('subjectCreate.typeScene')
                  : t('subjectCreate.typeProp')}
              </span>
            </div>
            <div style={fieldsGridStyle()}>
              {FIELDS_BY_TYPE[type].map((f) => (
                <div key={f.key} style={fieldRowStyle()}>
                  <div style={fieldLabelStyle(theme)}>{t(`subjectCreate.${f.i18nKey}`)}</div>
                  {f.multiline ? (
                    <Input.TextArea
                      value={fields[f.key] ?? ''}
                      onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                      autoSize={{ minRows: 2, maxRows: 6 }}
                    />
                  ) : (
                    <Input
                      value={fields[f.key] ?? ''}
                      onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 配音(仅角色) */}
          {type === 'character' && (
            <div style={cardStyle(theme)}>
              <div style={cardHeaderStyle(theme)}>
                <span style={dotStyle(theme.toolbar.accent)} />
                <span>{t('subjectCreate.voice')}</span>
                <Button
                  size="small"
                  type="link"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => {
                    setVoiceForm({
                      id: voice?.id ?? 'voice_male_deep',
                      note: voice?.note ?? '',
                      testText: voice?.note ?? '',
                    });
                    setVoiceModalOpen(true);
                  }}
                >
                  {voice ? t('common.refresh') : t('common.add')}
                </Button>
              </div>
              {voice ? (
                <div style={voiceCardStyle(theme)}>
                  <div style={voiceIconStyle(theme)}><Mic size={16} color="#fff" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={voiceNameStyle(theme)}>{voice.name}</div>
                    <div style={voiceMetaStyle(theme)}>{voice.note || t('subjectCreate.voiceDefault')}</div>
                  </div>
                  <Button
                    size="small"
                    type="text"
                    icon={<Trash2 size={12} />}
                    onClick={() => setVoice(null)}
                  />
                </div>
              ) : (
                <div style={addVoiceStyle(theme)}>
                  <Button
                    type="dashed"
                    block
                    icon={<Plus size={12} />}
                    onClick={() => {
                      setVoiceForm({ id: 'voice_male_deep', note: '', testText: '' });
                      setVoiceModalOpen(true);
                    }}
                  >
                    {t('subjectCreate.voice')}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* 一致性提示词 */}
          <div style={cardStyle(theme)}>
            <div style={cardHeaderStyle(theme)}>
              <span style={dotStyle(theme.toolbar.accent)} />
              <span>{t('subjectCreate.consistency')}</span>
              <Button
                size="small"
                type="link"
                style={{ marginLeft: 'auto' }}
                icon={<Copy size={12} />}
                onClick={handleCopyPrompt}
              >
                {t('subjectCreate.copyPrompt')}
              </Button>
            </div>
            <Input.TextArea
              value={consistency}
              onChange={(e) => setConsistency(e.target.value)}
              placeholder={t('subjectCreate.consistencyPlaceholder')}
              autoSize={{ minRows: 4, maxRows: 8 }}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </div>

          {/* 参考图 */}
          <div style={cardStyle(theme)}>
            <div style={cardHeaderStyle(theme)}>
              <span style={dotStyle(theme.toolbar.accent)} />
              <span>{t('subjectCreate.imagesTitle')}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: theme.toolbar.textMuted }}>
                {t('subjectCreate.imagesCount', { count: images.length })}
              </span>
            </div>
            <div style={imageStripStyle()}>
              {images.map((img, i) => {
                // 优先级:本地预览(blob URL) > 后端缩略图 URL > 原 preview
                const localId = img.id;
                const thumbSrc = (localId && localPreviews[localId])
                  || (img.storageKey ? getResourceUrl(img.storageKey, 'thumb') : '')
                  || img.preview
                  || '';
                return (
                  <div key={i} style={thumbStyle(theme)}>
                    <AuthorizedImage
                      src={thumbSrc}
                      alt={img.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    <button
                      type="button"
                      style={thumbRemoveStyle()}
                      onClick={() => handleRemoveImage(i)}
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
              {/* 上传中的进度显示 */}
              {Object.entries(uploadingProgress).map(([uploadId, pct]) => (
                <div key={uploadId} style={thumbStyle(theme)}>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    width: '100%',
                    height: '100%',
                  }}>
                    <Loader2 size={14} style={{ color: theme.toolbar.accent, animation: 'zeroexo-spin 1s linear infinite' }} />
                    <Progress
                      type="circle"
                      percent={pct}
                      size={28}
                      strokeColor={theme.toolbar.accent}
                      railColor={theme.toolbar.border}
                      format={() => `${pct}%`}
                      style={{ margin: 0 }}
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                style={thumbAddStyle(theme)}
                onClick={() => imagesInputRef.current?.click()}
                title={t('subjectCreate.imageAddHint')}
              >
                <UploadIcon size={16} />
              </button>
              <input
                ref={imagesInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = e.target.files;
                  if (files) {
                    Array.from(files).forEach((f) => void handleAddImage(f));
                  }
                  e.target.value = '';
                }}
              />
            </div>
            {images.length === 0 && (
              <div style={{ fontSize: 12, color: theme.toolbar.textMuted, marginTop: 6 }}>
                {t('subjectCreate.imageAddHint')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 配音弹窗 */}
      {voiceModalOpen && (
        <div style={modalOverlayStyle()} onClick={() => setVoiceModalOpen(false)}>
          <div style={modalStyle(theme)} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle(theme)}>
              <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Mic size={14} />
                {t('subjectCreate.voice')}
              </span>
              <button
                type="button"
                onClick={() => setVoiceModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.toolbar.textMuted, padding: 4 }}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={fieldLabelStyle(theme)}>{t('subjectCreate.voiceSelect')}</div>
                <Select
                  style={{ width: '100%' }}
                  value={voiceForm.id}
                  onChange={(v) => setVoiceForm({ ...voiceForm, id: v })}
                  options={VOICE_OPTIONS.map((v) => ({ value: v.value, label: t(`subjectCreate.${v.i18nKey}`) }))}
                />
              </div>
              <div>
                <div style={fieldLabelStyle(theme)}>{t('subjectCreate.voiceNote')}</div>
                <Input
                  value={voiceForm.note}
                  onChange={(e) => setVoiceForm({ ...voiceForm, note: e.target.value })}
                  placeholder={t('subjectCreate.voiceNotePlaceholder')}
                />
              </div>
              <div>
                <div style={fieldLabelStyle(theme)}>{t('subjectCreate.voiceTestText')}</div>
                <Input.TextArea
                  value={voiceForm.testText}
                  onChange={(e) => setVoiceForm({ ...voiceForm, testText: e.target.value })}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  style={{ flex: 1 }}
                  icon={<PlayCircle size={14} />}
                  onClick={() => {
                    antdMessage.info(`${t('subjectCreate.voiceTest')}: ${(VOICE_OPTIONS.find((v) => v.value === voiceForm.id)?.i18nKey ? t(`subjectCreate.${VOICE_OPTIONS.find((v) => v.value === voiceForm.id)!.i18nKey}`) : '')}`);
                  }}
                >
                  {t('subjectCreate.voiceTest')}
                </Button>
                <Button
                  type="primary"
                  style={{ flex: 1 }}
                  onClick={() => {
                    const v = VOICE_OPTIONS.find((x) => x.value === voiceForm.id);
                    if (v) {
                      setVoice({ id: v.value, name: t(`subjectCreate.${v.i18nKey}`), note: voiceForm.note });
                    }
                    setVoiceModalOpen(false);
                  }}
                >
                  {t('subjectCreate.voiceSave')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============= 样式 =============

function pageStyle(theme: ReturnType<typeof useTheme>['theme'], modal?: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    height: modal ? 'auto' : '100%',
    maxHeight: modal ? '80vh' : undefined,
    width: '100%',
    background: modal ? 'transparent' : theme.canvas.background,
    overflow: modal ? 'visible' : 'hidden',
  };
}

function loadingStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.toolbar.textMuted,
  };
}

function topBarStyle(theme: ReturnType<typeof useTheme>['theme'], isMobile: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: isMobile ? '10px 12px' : '12px 20px',
    borderBottom: `1px solid ${theme.toolbar.border}`,
    flexShrink: 0,
  };
}

function contentStyle(isMobile: boolean): CSSProperties {
  return {
    flex: 1,
    overflow: 'auto',
    padding: isMobile ? 12 : 20,
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(0, 1.5fr)',
    gap: 16,
    minHeight: 0,
  };
}

function leftColStyle(_isMobile: boolean, _theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minWidth: 0,
  };
}

function rightColStyle(_isMobile: boolean, _theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minWidth: 0,
  };
}

function cardStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    background: theme.toolbar.background,
    border: `1px solid ${theme.toolbar.border}`,
    borderRadius: 10,
    padding: 16,
  };
}

function cardHeaderStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    fontSize: 12,
    fontWeight: 600,
    color: theme.toolbar.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  };
}

function dotStyle(color: string): CSSProperties {
  return {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: color,
  };
}

function avatarStyle(theme: ReturnType<typeof useTheme>['theme'], color: string): CSSProperties {
  return {
    width: 72,
    height: 72,
    flexShrink: 0,
    borderRadius: 14,
    background: theme.toolbar.background,
    border: `2px solid ${color}60`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };
}

function fieldLabelStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    fontSize: 11,
    color: theme.toolbar.textMuted,
    marginBottom: 4,
  };
}

function fieldsGridStyle(): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  };
}

function fieldRowStyle(): CSSProperties {
  return {
    minWidth: 0,
  };
}

function voiceCardStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    background: theme.toolbar.background,
    border: `1px solid ${theme.toolbar.border}`,
    borderRadius: 8,
  };
}

function voiceIconStyle(_theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    width: 34,
    height: 34,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #5b8fd9, #3a6cb5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    flexShrink: 0,
  };
}

function voiceNameStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 500,
    color: theme.toolbar.text,
  };
}

function voiceMetaStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    fontSize: 10,
    color: theme.toolbar.textMuted,
    marginTop: 2,
  };
}

function addVoiceStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    padding: 8,
    background: theme.toolbar.background,
    border: `1px dashed ${theme.toolbar.border}`,
    borderRadius: 8,
  };
}

function imageStripStyle(): CSSProperties {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  };
}

function thumbStyle(theme: ReturnType<typeof useTheme>['theme'], bg?: string): CSSProperties {
  return {
    position: 'relative',
    width: 56,
    height: 72,
    flexShrink: 0,
    borderRadius: 8,
    background: bg ?? theme.toolbar.background,
    border: `1px solid ${theme.toolbar.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

function thumbRemoveStyle(): CSSProperties {
  return {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#d94a4a',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

function thumbAddStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    width: 56,
    height: 72,
    flexShrink: 0,
    borderRadius: 8,
    border: `1px dashed ${theme.toolbar.border}`,
    background: 'transparent',
    color: theme.toolbar.textMuted,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

function modalOverlayStyle(): CSSProperties {
  return {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };
}

function modalStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    width: 'calc(100vw - 32px)',
    maxWidth: 420,
    background: theme.toolbar.background,
    border: `1px solid ${theme.toolbar.border}`,
    borderRadius: 12,
    boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
  };
}

function modalHeaderStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: `1px solid ${theme.toolbar.border}`,
    color: theme.toolbar.text,
  };
}