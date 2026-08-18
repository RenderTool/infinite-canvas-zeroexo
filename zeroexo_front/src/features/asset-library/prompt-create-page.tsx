// TODO(拆分): 该文件超过 1000 行，计划按「状态层/交互层/渲染层」拆分，见 DESIGN.md
/**
 * PromptCreatePage - 提示词创建/编辑独立页面
 *
 * 支持功能:
 * - 标题、内容、分类、标签
 * - 收藏
 * - 多张参考图(同个提示词可关联多张图,每张有 role 区分)
 * - 文件夹选择
 *
 * URL:
 *   #/test/prompt/new         新建
 *   #/test/prompt/:promptId  编辑
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Save,
  Trash2,
  Star,
  X,
  Copy,
  Plus,
  Loader2,
  Pencil,
  ExternalLink,
  Image as ImageIcon,
} from 'lucide-react';
import { Button, Input, Select, App as AntdApp, Spin, Tag, Progress, Tooltip } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { addAssets as storeAddAssets } from '@/features/asset-picker/asset-store.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import {
  createPrompt,
  updatePrompt,
  getPrompt,
  deletePrompt,
  type PromptCategory,
} from './prompts-api.js';
import { updatePrompt as storeUpdatePrompt, upsertPrompt as storeUpsertPrompt, removePrompt as storeRemovePrompt } from '@/features/prompt-library/prompt-store.js';
import {
  listPromptImages,
  setPromptImages,
  type PromptImage,
  type PromptImageRole,
} from './prompt-images-api.js';
import { notifyPromptCopied } from './prompt-copy-feedback.js';
import { ImageViewerStage, ZoomToolbar, useImagePanZoom } from '@/shared/components/image-viewer.js';
import { useAuthImageUrl } from '@/shared/hooks/use-auth-image.js';
import { AuthorizedImage } from '@/shared/components/authorized-media.js';

/** 公共提示词初始数据（只读模式） */
export interface PublicPromptInitialData {
  title: string;
  content: string;
  contentEn?: string;
  contentJa?: string;
  category: string;
  tags: string[];
  images: { storageKey: string }[];
}

interface PromptCreatePageProps {
  promptId?: string;
  onBack?: () => void;
  onSaved: () => void;
  /** 删除成功后的回调（用于关闭外层 Modal，缺省回退到 onBack） */
  onDeleted?: () => void;
  /** 是否在 Modal 中渲染(隐藏页面 chrome) */
  modal?: boolean;
  /** 隐藏内置标题栏（由外部 Modal title 接管） */
  hideTitle?: boolean;
  /** 只读模式（用于公共提示词查看） */
  readOnly?: boolean;
  /** 只读模式（用于公共提示词查看） */
  initialData?: PublicPromptInitialData;
  /** 标题变化回调（用于外部 Modal 同步标题） */
  onTitleChange?: (title: string) => void;
  /** 编辑脏状态变化回调（用于外部 Modal 关闭拦截） */
  onDirtyChange?: (dirty: boolean) => void;
  /** 公共提示词元信息（只读模式底部栏展示协议与来源） */
  publicMeta?: {
    license?: string;
    source: string;
    sourceName?: string;
    sourceUrl?: string;
  };
}

const CATEGORIES: Array<{ value: PromptCategory; i18nKey: string }> = [
  { value: 'role', i18nKey: 'categoryRole' },
  { value: 'scene', i18nKey: 'categoryScene' },
  { value: 'style', i18nKey: 'categoryStyle' },
  { value: 'shot', i18nKey: 'categoryShot' },
  { value: 'other', i18nKey: 'categoryOther' },
];

const ROLES: Array<{ value: PromptImageRole; i18nKey: string }> = [
  { value: 'reference', i18nKey: 'imageRoleReference' },
  { value: 'output', i18nKey: 'imageRoleOutput' },
  { value: 'cover', i18nKey: 'imageRoleCover' },
];

export function PromptCreatePage(props: PromptCreatePageProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const { message: antdMessage, modal } = AntdApp.useApp();

  const isEdit = !!props.promptId;
  const isReadOnly = !!props.readOnly;
  const [loading, setLoading] = useState(isEdit && !isReadOnly);
  const [saving, setSaving] = useState(false);
  /** 标记为从公共提示词导入的副本，保存时自动创建新副本而非编辑原提示词 */
  const [isPublicImport, setIsPublicImport] = useState(false);

  // 表单字段
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contentEn, setContentEn] = useState('');
  const [contentJa, setContentJa] = useState('');
  const [contentLang] = useState<'zh' | 'en' | 'ja'>(() => {
    const lang = i18n.language;
    if (lang.startsWith('zh')) return 'zh';
    if (lang.startsWith('ja')) return 'ja';
    return 'en';
  });
  const [note, setNote] = useState('');
  const [category, setCategory] = useState<PromptCategory>('other');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [images, setImages] = useState<PromptImage[]>([]);
  // 当前主预览图索引
  const [previewIdx, setPreviewIdx] = useState(0);
  // 图片缩放
  // 图片缩放/平移(统一图片查看框架)
  const panZoom = useImagePanZoom();
  // 上传进度映射: 临时id -> 百分比(0-100)
  const [uploadingProgress, setUploadingProgress] = useState<Record<string, number>>({});
  // 本地预览 URL(blob URL),在图片上传后立即显示,直到后端缩略图可访问
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const uploadIdCounter = useRef(0);

  // 查看/编辑模式（只读模式始终为 view）
  const [viewMode, setViewMode] = useState<'view' | 'edit'>(isReadOnly || isEdit ? 'view' : 'edit');
  const [savedState, setSavedState] = useState<{
    title: string;
    content: string;
    contentEn: string;
    contentJa: string;
    note: string;
    category: PromptCategory;
    tags: string[];
    favorite: boolean;
    images: PromptImage[];
    localPreviews: Record<string, string>;
  } | null>(null);

  // 加载提示词
  useEffect(() => {
    if (!props.promptId) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, imgs] = await Promise.all([
          getPrompt(props.promptId!),
          listPromptImages(props.promptId!).catch(() => [] as PromptImage[]),
        ]);
        if (cancelled) return;
        setTitle(p.title);
        // 根据用户语言选择合适的内容版本
        const lang = i18n.language;
        const preferLang = lang.startsWith('zh') ? 'zh' : lang.startsWith('ja') ? 'ja' : 'en';
        if (preferLang === 'en' && p.contentEn) {
          setContent(p.contentEn);
        } else if (preferLang === 'ja' && p.contentJa) {
          setContent(p.contentJa);
        } else {
          setContent(p.content);
        }
        setContentEn(p.contentEn ?? '');
        setContentJa(p.contentJa ?? '');
        setNote(p.note ?? '');
        setCategory(p.category as PromptCategory);
        setTags(p.tags);
        setFavorite(p.favorite);
        setImages(imgs);
        // 公共提示词导入的副本，保存时自动创建新副本
        if (p.source === 'public-import') {
          setIsPublicImport(true);
        }
        // 默认预览封面图(若有),否则第一张
        const coverIdx = imgs.findIndex((img) => img.role === 'cover');
        setPreviewIdx(coverIdx >= 0 ? coverIdx : 0);
      } catch (err) {
        antdMessage.error(err instanceof Error ? err.message : t('promptCreate.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.promptId, antdMessage, t, i18n]);

  // 只读模式：从 initialData 初始化表单
  useEffect(() => {
    if (!isReadOnly || !props.initialData) return;
    setTitle(props.initialData.title);
    // 根据用户语言选择合适的内容版本
    const lang = i18n.language;
    const preferLang = lang.startsWith('zh') ? 'zh' : lang.startsWith('ja') ? 'ja' : 'en';
    if (preferLang === 'en' && props.initialData.contentEn) {
      setContent(props.initialData.contentEn);
    } else if (preferLang === 'ja' && props.initialData.contentJa) {
      setContent(props.initialData.contentJa);
    } else {
      setContent(props.initialData.content);
    }
    setContentEn(props.initialData.contentEn ?? '');
    setContentJa(props.initialData.contentJa ?? '');
    setCategory((props.initialData.category as PromptCategory) || 'other');
    setTags(props.initialData.tags ?? []);
    setImages(
      (props.initialData.images ?? []).map((img, i) => ({
        id: `init_${i}`,
        promptId: '',
        storageKey: img.storageKey,
        role: i === 0 ? 'cover' as PromptImageRole : 'reference' as PromptImageRole,
        sortOrder: i,
        createdAt: '',
      })),
    );
    setLoading(false);
  }, [isReadOnly, props.initialData]);

  // 标题变化同步到外部 Modal
  useEffect(() => {
    props.onTitleChange?.(title);
  }, [title, props.onTitleChange]);

  // 生成同款（复制到个人提示词库）
  const handleGenerateSimilar = useCallback(async () => {
    setSaving(true);
    try {
      const created = await createPrompt({
        title: title.trim(),
        content: content.trim(),
        contentEn: contentEn.trim() || undefined,
        contentJa: contentJa.trim() || undefined,
        category: category as PromptCategory,
        tags,
        imageKeys: images.map((i) => i.storageKey),
      });
      // 同步更新本地 store
      await storeUpsertPrompt({
        id: created.id,
        title: created.title,
        content: created.content,
        contentEn: created.contentEn ?? undefined,
        contentJa: created.contentJa ?? undefined,
        category: created.category,
        tags: created.tags,
        imageKeys: created.imageKeys,
        favorite: created.favorite ?? false,
        source: 'local',
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      }).catch(() => {});
      notifyPromptCopied(antdMessage, created.id);
      props.onSaved();
      // 如果有关闭回调，导航到资产页
      props.onBack?.();
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('promptCreate.copyFailed'));
    } finally {
      setSaving(false);
    }
  }, [title, content, contentEn, contentJa, category, tags, images, props, antdMessage]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // 重排图片:封面图排到最前面,确保 PromptCard 中 imageKeys[0] 是封面
      const sortedImages = [...images].sort((a, b) => {
        if (a.role === 'cover') return -1;
        if (b.role === 'cover') return 1;
        return 0;
      });
      const payload = {
        title: title.trim(),
        content: content.trim(),
        contentEn: contentEn.trim() || undefined,
        contentJa: contentJa.trim() || undefined,
        note: note.trim() || undefined,
        category,
        tags,
        favorite,
        imageKeys: sortedImages.map((i) => i.storageKey),
      };
      let promptId = props.promptId;
      if (isEdit && promptId && !isPublicImport) {
        await updatePrompt(promptId, payload);
        // 同步更新本地 store（前端刷新时从本地 store 加载）
        await storeUpdatePrompt(promptId, payload).catch(() => {});
      } else {
        // 如果是从公共提示词导入的副本，始终创建新提示词而非修改原提示词
        const created = await createPrompt({
          ...payload,
          ...(isPublicImport ? { source: 'public-import' as const } : {}),
        });
        promptId = created.id;
        // 同步更新本地 store
        await storeUpsertPrompt({
          id: created.id,
          title: created.title,
          content: created.content,
          contentEn: created.contentEn ?? undefined,
          contentJa: created.contentJa ?? undefined,
          note: created.note ?? undefined,
          category: created.category,
          tags: created.tags,
          imageKeys: created.imageKeys,
          favorite: created.favorite ?? false,
          source: (created.source ?? 'local') as 'local' | 'remote' | 'public-import',
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        }).catch(() => {});
      }
      // 保存参考图(使用排序后的图片,封面排第一)
      if (promptId) {
        await setPromptImages(
          promptId,
          sortedImages.map((img, i) => ({
            storageKey: img.storageKey,
            role: img.role,
            sortOrder: i,
          })),
        );
      }
      antdMessage.success(t('promptCreate.savedToast'));
      // 保存后切换到查看模式（不关闭弹窗）
      setViewMode('view');
      props.onSaved();
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('promptCreate.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [title, content, contentEn, contentJa, category, tags, favorite, images, isEdit, props, antdMessage, t]);

  const handleDelete = useCallback(async () => {
    if (!props.promptId) return;
    modal.confirm({
      title: t('promptCreate.deleteTitle'),
      content: t('promptCreate.deleteConfirm', { name: title }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        try {
          await deletePrompt(props.promptId!);
          // 同步删除本地 store
          await storeRemovePrompt(props.promptId!).catch(() => {});
          antdMessage.success(t('promptCreate.deletedToast'));
          props.onSaved();
          // 删除后显式关闭（Modal 场景由 onDeleted 接管，页面场景回退）
          (props.onDeleted ?? props.onBack)?.();
        } catch (err) {
          antdMessage.error(err instanceof Error ? err.message : t('promptCreate.saveFailed'));
        }
      },
    });
  }, [props, title, antdMessage, t]);

  const handleCopyContent = useCallback(() => {
    const currentContent = contentLang === 'en' ? contentEn :
      contentLang === 'ja' ? contentJa : content;
    if (!currentContent.trim()) return;
    void navigator.clipboard.writeText(currentContent);
    antdMessage.success(t('subjectCreate.copyPromptSuccess'));
  }, [content, contentEn, contentJa, contentLang, antdMessage, t]);

  const handleEnterEdit = useCallback(() => {
    setSavedState({ title, content, contentEn, contentJa, note, category, tags, favorite, images, localPreviews });
    setViewMode('edit');
  }, [title, content, contentEn, contentJa, note, category, tags, favorite, images, localPreviews]);

  const handleCancelEdit = useCallback(() => {
    if (savedState) {
      setTitle(savedState.title);
      setContent(savedState.content);
      setContentEn(savedState.contentEn);
      setContentJa(savedState.contentJa);
      setNote(savedState.note);
      setCategory(savedState.category);
      setTags(savedState.tags);
      setFavorite(savedState.favorite);
      setImages(savedState.images);
      setLocalPreviews(savedState.localPreviews);
    }
    setViewMode('view');
    setSavedState(null);
  }, [savedState]);

  // 编辑态脏检查：当前表单与进入编辑时的快照（已保存版本）对比
  const isDirty = (() => {
    if (viewMode !== 'edit' || !savedState) return false;
    return (
      title !== savedState.title ||
      content !== savedState.content ||
      contentEn !== savedState.contentEn ||
      contentJa !== savedState.contentJa ||
      note !== savedState.note ||
      category !== savedState.category ||
      favorite !== savedState.favorite ||
      tags.length !== savedState.tags.length ||
      tags.some((tag, i) => tag !== savedState.tags[i]) ||
      images.length !== savedState.images.length ||
      images.some((img, i) => img.id !== savedState.images[i]?.id || img.role !== savedState.images[i]?.role)
    );
  })();

  // 脏状态同步给外层（用于 Modal 关闭拦截；卸载时复位避免残留）
  useEffect(() => {
    props.onDirtyChange?.(isDirty);
    return () => props.onDirtyChange?.(false);
  }, [isDirty, props.onDirtyChange]);

  // 切换收藏状态（仅资产库模式）
  const handleToggleFavorite = useCallback(async () => {
    const newFav = !favorite;
    setFavorite(newFav);
    if (props.promptId) {
      try {
        await updatePrompt(props.promptId, { favorite: newFav });
        // 通知父页面刷新列表，同步收藏状态
        props.onSaved();
      } catch {
        setFavorite(!newFav);
      }
    }
  }, [favorite, props.promptId, props.onSaved]);

  const MAX_TAGS = 8;
  const MAX_TAG_LENGTH = 20;
  const MAX_CONTENT_LENGTH = 7000;
  const MAX_NOTE_LENGTH = 500;

  const handleAddTag = useCallback(() => {
    const v = tagInput.trim();
    if (!v) return;
    if (tags.length >= MAX_TAGS) return;
    if (v.length > MAX_TAG_LENGTH) {
      antdMessage.warning(t('promptCreate.tagTooLong', { max: MAX_TAG_LENGTH, length: v.length }));
      setTags([...tags, v.slice(0, MAX_TAG_LENGTH)]);
      setTagInput('');
      return;
    }
    if (tags.includes(v)) {
      setTagInput('');
      return;
    }
    setTags([...tags, v]);
    setTagInput('');
  }, [tagInput, tags, antdMessage, t]);

  // 设为封面(同一时间仅一张 cover,同时重排图片使封面排第一)
  const handleSetCover = useCallback((imgId: string) => {
    setImages((prev) => {
      const updated = prev.map((img) => ({
        ...img,
        role: img.id === imgId ? 'cover' as PromptImageRole : (img.role === 'cover' ? 'reference' as PromptImageRole : img.role),
      }));
      // 重排:封面图排到最前面
      return updated.sort((a, b) => {
        if (a.role === 'cover') return -1;
        if (b.role === 'cover') return 1;
        return 0;
      });
    });
    // 预览切到封面图
    setPreviewIdx(0);
  }, []);

  // 点击缩略图切换主预览
  const handleSelectPreview = useCallback((idx: number) => {
    setPreviewIdx(idx);
    panZoom.reset();
  }, [panZoom.reset]);

  // 添加参考图(先上传到后端 storage,再关联到提示词)
  const handleAddImage = useCallback(
    async (file: File) => {
      const uploadId = `upload_${++uploadIdCounter.current}`;
      // 先添加一个占位图,显示上传中
      setUploadingProgress((prev) => ({ ...prev, [uploadId]: 0 }));
      try {
        const uploaded = await uploadAsset(file, (loaded, total) => {
          const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
          setUploadingProgress((prev) => ({ ...prev, [uploadId]: pct }));
        });
        await storeAddAssets([uploaded]);
        const storageKey = uploaded.data.kind === 'image' || uploaded.data.kind === 'video' || uploaded.data.kind === 'audio'
          ? (uploaded.data as { storageKey?: string }).storageKey ?? ''
          : '';
        // 提取预览 URL(blob URL 立即显示,直到后端缩略图可访问)
        const previewUrl = uploaded.data.kind === 'image' ? uploaded.data.dataUrl
          : uploaded.data.kind === 'video' ? uploaded.data.url
          : '';
        const newImg: PromptImage = {
          id: `local_${Date.now()}_${images.length}`,
          promptId: props.promptId ?? 'pending',
          storageKey,
          role: images.length === 0 ? 'cover' as PromptImageRole : 'reference' as PromptImageRole,
          sortOrder: images.length,
          createdAt: new Date().toISOString(),
        };
        setImages((prev) => [...prev, newImg]);
        // 保存本地预览 URL 到 map(用 image id 索引)
        if (previewUrl) {
          setLocalPreviews((prev) => ({ ...prev, [newImg.id]: previewUrl }));
        }
      } catch (err) {
        antdMessage.error(err instanceof Error ? err.message : t('promptCreate.saveFailed'));
      } finally {
        // 清除上传进度
        setUploadingProgress((prev) => {
          const next = { ...prev };
          delete next[uploadId];
          return next;
        });
      }
    },
    [images.length, props.promptId, antdMessage, t],
  );

  const handleRemoveImage = useCallback(
    (img: PromptImage) => {
      // 仅更新本地 state（draft），不调用后端 API
      // 实际删除在保存时通过 setPromptImages 整体替换完成
      setImages((prev) => prev.filter((i) => i.id !== img.id));
      // 清理本地预览
      setLocalPreviews((prev) => {
        const next = { ...prev };
        delete next[img.id];
        return next;
      });
    },
    [],
  );

  const handleChangeImageRole = useCallback((img: PromptImage, role: PromptImageRole) => {
    setImages((prev) => prev.map((i) => (i.id === img.id ? { ...i, role } : i)));
  }, []);

  // S2: 后端图片 URL 不拼接 token,预览大图经 useAuthImageUrl 认证(fetch + Authorization header → blob URL)
  const previewImage = images.length > 0 && previewIdx < images.length ? images[previewIdx]! : undefined;
  const previewRawSrc = previewImage
    ? (localPreviews[previewImage.id] || getResourceUrl(previewImage.storageKey, 'full') || '')
    : '';
  const authPreviewSrc = useAuthImageUrl(previewRawSrc || undefined);

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
      {props.modal ? (
        props.hideTitle ? null : (
          <div style={modalHeaderStyle(theme)}>
            <span style={modalHeaderIconStyle(theme)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isEdit ? t('promptCreate.editTitle') : t('promptCreate.namePlaceholder')}
              maxLength={100}
              readOnly={viewMode === 'view'}
              style={{ ...modalTitleInputStyle(theme), ...(viewMode === 'view' ? { cursor: 'default', opacity: 0.8 } : {}) }}
            />
          </div>
        )
      ) : (
        <div style={topBarStyle(theme, isMobile)}>
          <Button
            size="small"
            icon={<ArrowLeft size={14} />}
            onClick={props.onBack}
          >
            {t('promptCreate.back')}
          </Button>
          <h2 style={{ margin: 0, fontSize: isMobile ? 14 : 16, fontWeight: 600, color: theme.toolbar.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isEdit ? t('promptCreate.editTitle') : t('promptCreate.title')}
            {title && <span style={{ marginLeft: 8, opacity: 0.6 }}>· {title}</span>}
          </h2>
        </div>
      )}

      {/* 主体内容 - 根据是否modal使用不同布局 */}
      {props.modal ? (
        <>
        <div style={modalBodyStyle(isMobile)} className="zx-thin-scroll">
          <div style={modalBodyGridStyle(isMobile)}>
            {/* 左侧：图片预览区 - 自适应各种比例(1:1 / 3:2 / 2:3 / 16:9 等) */}
            <div style={previewPanelStyle(isMobile)}>
              {/* 大图预览舞台 - 居中 contain, 背景棋盘格(统一图片查看框架) */}
              {images.length > 0 && previewIdx < images.length ? (
                <ImageViewerStage
                  src={authPreviewSrc || previewRawSrc}
                  alt=""
                  panZoom={panZoom}
                  containerStyle={previewStageStyle(theme)}
                  imgStyle={previewImageStyle}
                  onImgError={(e) => {
                    e.currentTarget.style.opacity = '0.3';
                  }}
                >
                  {/* 封面标记 */}
                  {images[previewIdx]?.role === 'cover' && (
                    <div style={coverBadgeStyle}>
                      <Star size={11} fill="currentColor" />
                      {t('promptCreate.imageRoleCover')}
                    </div>
                  )}
                  {/* 图片计数 */}
                  <div style={imageCounterStyle}>
                    {previewIdx + 1} / {images.length}
                  </div>
                  {/* 垂直缩放工具栏 - 右下角 */}
                  <ZoomToolbar panZoom={panZoom} orientation="vertical" style={{ position: 'absolute', bottom: 10, right: 10 }} />
                </ImageViewerStage>
              ) : (
                <div style={previewStageStyle(theme)}>
                  <div style={emptyPreviewStyle}>
                    <span style={{ fontSize: 12, opacity: 0.5 }}>{t('promptCreate.noImages')}</span>
                  </div>
                </div>
              )}
              {/* 缩略图胶片条 */}
              <div style={filmstripStyle()}>
                {images.map((img, idx) => {
                  const thumbSrc = localPreviews[img.id] || getResourceUrl(img.storageKey, 'preview') || '';
                  const isActive = idx === previewIdx;
                  const isCover = img.role === 'cover';
                  return (
                    <div
                      key={img.id}
                      style={thumbItemStyle(theme, isActive, isCover)}
                      onClick={() => handleSelectPreview(idx)}
                    >
                      <AuthorizedImage
                        src={thumbSrc}
                        alt=""
                        style={thumbImageStyle}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      {isCover && (
                        <div style={thumbCoverBadgeStyle}>
                          <Star size={8} fill="currentColor" />
                        </div>
                      )}
                      {viewMode === 'edit' && (
                        <div
                          style={thumbHoverOverlayStyle}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
                        >
                          {!isCover && (
                            <button
                              type="button"
                              style={thumbActionBtnStyle}
                              onClick={(e) => { e.stopPropagation(); handleSetCover(img.id); }}
                              title={t('promptCreate.setCover')}
                            >
                              <ImageIcon size={11} />
                            </button>
                          )}
                          <Tooltip title={t('promptCreate.remove')}>
                            <button
                              type="button"
                              style={thumbActionBtnStyle}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveImage(img);
                                if (previewIdx >= images.length - 1) setPreviewIdx(Math.max(0, images.length - 2));
                              }}
                            >
                              <X size={11} />
                            </button>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  );
                })}
                {viewMode === 'edit' && (
                  /* 上传按钮 */
                  <label style={uploadTileStyle(theme)}>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        if (e.target.files) {
                          Array.from(e.target.files).forEach(handleAddImage);
                        }
                        e.target.value = '';
                      }}
                    />
                    <Plus size={22} />
                  </label>
                )}
              </div>
            </div>

            {/* 右侧：表单区(备注 + 提示词内容 + 标签) */}
            <div style={formPanelStyle(isMobile)} className="zx-thin-scroll">
              {/* hideTitle 时标题移入表单面板 */}
              {props.hideTitle && (
                <div style={formSectionStyle()}>
                  <label style={formLabelStyle(theme)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    {t('promptCreate.titleLabel')}
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={isEdit ? t('promptCreate.editTitle') : t('promptCreate.namePlaceholder')}
                    maxLength={100}
                    readOnly={viewMode === 'view'}
                    style={{ ...modalTitleInputStyle(theme), ...(viewMode === 'view' ? { cursor: 'default' } : {}) }}
                  />
                </div>
              )}
              {/* 分类 */}
              <div style={formSectionStyle()}>
                <label style={formLabelStyle(theme)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><path d="M4 6h16M4 12h16M4 18h7"/></svg>
                  {t('promptCreate.category')}
                </label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Select
                    style={{ width: '100%' }}
                    value={category}
                    onChange={(v) => setCategory(v)}
                    options={CATEGORIES.map((c) => ({
                      value: c.value,
                      label: t(`promptCreate.${c.i18nKey}`),
                    }))}
                    disabled={viewMode === 'view'}
                    size="small"
                  />
                </div>
              </div>
              {/* 备注 */}
              <div style={formSectionStyle()}>
                <label style={formLabelStyle(theme)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  {t('promptCreate.note')}
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('promptCreate.notePlaceholder')}
                  maxLength={MAX_NOTE_LENGTH}
                  readOnly={viewMode === 'view'}
                  style={{ ...noteInputStyle(theme), ...(viewMode === 'view' ? { cursor: 'default' } : {}) }}
                  rows={2}
                />
              </div>

              {/* 提示词内容 - 表单核心 */}
              <div style={formSectionStyle()}>
                <div style={formLabelRowStyle()}>
                  <label style={formLabelStyle(theme)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                    {t('promptCreate.content')}
                  </label>
                  <button
                    type="button"
                    onClick={handleCopyContent}
                    style={copyBtnStyle(theme)}
                    title={t('subjectCreate.copyPrompt')}
                  >
                    <Copy size={12} />
                    {t('subjectCreate.copyPrompt')}
                  </button>
                </div>
                <div style={promptBlockStyle(theme)}>
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t('promptCreate.contentPlaceholder')}
                    readOnly={viewMode === 'view'}
                    maxLength={MAX_CONTENT_LENGTH}
                    style={{ ...promptTextareaStyle(theme), ...(viewMode === 'view' ? { cursor: 'default' } : {}) }}
                  />
                </div>
              </div>

              {/* 标签 */}
              <div style={formSectionStyle()}>
                <label style={formLabelStyle(theme)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                  {t('promptCreate.tags')}
                </label>
                {tags.length > 0 && (
                  <div style={tagsRowStyle()}>
                    {tags.map((tag) => (
                      <span key={tag} style={tagChipStyle(theme)}>
                        {tag}
                        {viewMode === 'edit' && (
                          <button
                            type="button"
                            onClick={() => setTags(tags.filter((x) => x !== tag))}
                            style={tagRemoveBtnStyle}
                          >
                            <X size={10} />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {viewMode === 'edit' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        value={tagInput}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.includes(',')) {
                            const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
                            let truncated = false;
                            const newTags = [...tags];
                            for (const p of parts) {
                              if (newTags.length >= MAX_TAGS) break;
                              if (p.length > MAX_TAG_LENGTH) {
                                newTags.push(p.slice(0, MAX_TAG_LENGTH));
                                truncated = true;
                              } else if (p && !newTags.includes(p)) {
                                newTags.push(p);
                              }
                            }
                            if (truncated) antdMessage.warning(`${t('promptCreate.tagsTruncated', { max: MAX_TAG_LENGTH })}`);
                            setTags(newTags);
                            setTagInput('');
                          } else {
                            if (v.length <= MAX_TAG_LENGTH) {
                              setTagInput(v);
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddTag();
                          }
                        }}
                        placeholder={t('promptCreate.tagsPlaceholder')}
                        style={tagInputStyle(theme)}
                      />
                      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary, #bfbfbf)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {tagInput.length}/{MAX_TAG_LENGTH}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary, #bfbfbf)' }}>
                      {t('promptCreate.tagLimitHint', { maxLength: MAX_TAG_LENGTH, maxCount: MAX_TAGS, count: tags.length })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

          {/* 底部操作栏 */}
          {viewMode === 'view' ? (
            <div style={modalFooterStyle(theme)}>
              {isReadOnly ? (
                <>
                  {/* 公共提示词：协议标签 + 来源（与私有模式同一套底栏样式） */}
                  {props.publicMeta ? (
                    <>
                      <span style={licenseChipStyle(theme)}>{props.publicMeta.license || 'MIT'}</span>
                      <div style={sourceInfoStyle(theme)}>
                        {props.publicMeta.sourceUrl ? (
                          <a
                            href={props.publicMeta.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: theme.toolbar.textMuted,
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                              transition: 'color 0.15s',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = theme.toolbar.accent)}
                            onMouseLeave={(e) => (e.currentTarget.style.color = theme.toolbar.textMuted)}
                          >
                            <ExternalLink size={11} />
                            {props.publicMeta.sourceName || props.publicMeta.sourceUrl}
                          </a>
                        ) : (
                          <span style={{ opacity: 0.6 }}>{props.publicMeta.source}</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div style={{ flex: 1 }} />
                  )}
                  {/* 生成同款 — 与私有模式主按钮同款样式 */}
                  <button
                    type="button"
                    onClick={handleGenerateSimilar}
                    disabled={saving}
                    className={saving ? undefined : 'pm-btn'}
                    style={modalSaveBtnStyle(saving)}
                  >
                    <Copy size={14} />
                    {saving ? t('promptCreate.copying') : t('promptCreate.generateSimilar')}
                  </button>
                </>
              ) : (
                <>
                  {/* 收藏按钮 */}
                  <button
                    type="button"
                    onClick={handleToggleFavorite}
                    {...ghostHoverHandlers(theme)}
                    style={{
                      ...modalIconBtnStyle(theme, false),
                      color: favorite ? theme.toolbar.accent : theme.toolbar.textMuted,
                    }}
                    title={favorite ? t('promptCreate.favorited') : t('promptCreate.favorite')}
                  >
                    <Star size={14} fill={favorite ? 'currentColor' : 'none'} />
                  </button>
                  <div style={{ flex: 1 }} />
                  {/* 同款按钮 */}
                  <button
                    type="button"
                    onClick={handleGenerateSimilar}
                    disabled={saving}
                    className={saving ? undefined : 'pm-btn'}
                    style={modalSaveBtnStyle(saving)}
                  >
                    <Copy size={14} />
                    {saving ? t('promptCreate.copying') : t('promptCreate.generateSimilar')}
                  </button>
                  {/* 编辑按钮 */}
                  <button
                    type="button"
                    onClick={handleEnterEdit}
                    {...ghostHoverHandlers(theme)}
                    style={modalEditBtnStyle(theme)}
                    title={t('promptCreate.edit')}
                  >
                    <Pencil size={14} />
                    {t('promptCreate.edit')}
                  </button>
                  {/* 删除按钮 */}
                  {isEdit && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      {...dangerHoverHandlers(theme)}
                      style={modalIconBtnStyle(theme, false)}
                      title={t('promptCreate.delete')}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div style={modalFooterStyle(theme)}>
              {/* 编辑态未保存变动标识（临时变动，取消即回退） */}
              {isDirty && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: theme.toolbar.accent, flexShrink: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: theme.toolbar.accent }} />
                  {t('promptCreate.unsaved')}
                </span>
              )}
              <div style={{ flex: 1 }} />
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className={saving ? undefined : 'pm-btn'}
                style={modalSaveBtnStyle(saving)}
              >
                <Save size={14} />
                {saving ? t('promptCreate.saving') : t('promptCreate.save')}
              </button>
              {isEdit && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  {...ghostHoverHandlers(theme)}
                  style={modalCancelBtnStyle(theme)}
                >
                  {t('promptCreate.cancel')}
                </button>
              )}
              {isEdit && (
                <button
                  type="button"
                  onClick={handleDelete}
                  {...dangerHoverHandlers(theme)}
                  style={modalIconBtnStyle(theme, false)}
                  title={t('promptCreate.delete')}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          )}
          </>)
      : isMobile ? (
        <div style={contentStyle(true)} className="zx-thin-scroll">
          {/* 移动端: 大图预览 + 胶片条放在顶部 */}
          <div style={previewPanelStyle(isMobile)}>
            {images.length > 0 && previewIdx < images.length ? (
              <ImageViewerStage
                src={authPreviewSrc || previewRawSrc}
                alt=""
                panZoom={panZoom}
                containerStyle={previewStageStyle(theme)}
                imgStyle={previewImageStyle}
                onImgError={(e) => {
                  e.currentTarget.style.opacity = '0.3';
                }}
              >
                {images[previewIdx]?.role === 'cover' && (
                  <div style={coverBadgeStyle}>
                    <Star size={11} fill="currentColor" />
                    {t('promptCreate.imageRoleCover')}
                  </div>
                )}
                <div style={imageCounterStyle}>
                  {previewIdx + 1} / {images.length}
                </div>
                <ZoomToolbar panZoom={panZoom} orientation="vertical" style={{ position: 'absolute', bottom: 10, right: 10 }} />
              </ImageViewerStage>
            ) : (
              <div style={previewStageStyle(theme)}>
                <div style={emptyPreviewStyle}>
                  <span style={{ fontSize: 12, opacity: 0.5 }}>{t('promptCreate.noImages')}</span>
                </div>
              </div>
            )}
            <div style={filmstripStyle()}>
              {images.map((img, idx) => {
                const thumbSrc = localPreviews[img.id] || getResourceUrl(img.storageKey, 'preview') || '';
                const isActive = idx === previewIdx;
                const isCover = img.role === 'cover';
                return (
                  <div
                    key={img.id}
                    style={thumbItemStyle(theme, isActive, isCover)}
                    onClick={() => handleSelectPreview(idx)}
                  >
                    <AuthorizedImage
                      src={thumbSrc}
                      alt=""
                      style={thumbImageStyle}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    {isCover && (
                      <div style={thumbCoverBadgeStyle}>
                        <Star size={8} fill="currentColor" />
                      </div>
                    )}
                    {viewMode === 'edit' && (
                      <div
                        style={thumbHoverOverlayStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
                      >
                        {!isCover && (
                          <button
                            type="button"
                            style={thumbActionBtnStyle}
                            onClick={(e) => { e.stopPropagation(); handleSetCover(img.id); }}
                            title={t('promptCreate.setCover')}
                          >
                            <ImageIcon size={11} />
                          </button>
                        )}
                        <Tooltip title={t('promptCreate.remove')}>
                          <button
                            type="button"
                            style={thumbActionBtnStyle}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveImage(img);
                              if (previewIdx >= images.length - 1) setPreviewIdx(Math.max(0, images.length - 2));
                            }}
                          >
                            <X size={11} />
                          </button>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                );
              })}
              {viewMode === 'edit' && (
                <label style={uploadTileStyle(theme)}>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files) {
                        Array.from(e.target.files).forEach(handleAddImage);
                      }
                      e.target.value = '';
                    }}
                  />
                  <Plus size={22} />
                </label>
              )}
            </div>
          </div>
          {/* 移动端: 参数表单在下方 */}
          <div style={cardStyle(theme)}>
            <div style={cardHeaderStyle(theme)}>
              <span style={dotStyle(theme.toolbar.accent)} />
              <span>{t('promptCreate.name')}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: theme.toolbar.textMuted }}>
                {title.length}/100
              </span>
            </div>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('promptCreate.namePlaceholder')}
              maxLength={100}
              size="large"
              disabled={viewMode === 'view'}
            />
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div>
                <div style={fieldLabelStyle(theme)}>{t('promptCreate.category')}</div>
                <Select
                  style={{ width: '100%' }}
                  value={category}
                  onChange={(v) => setCategory(v)}
                  options={CATEGORIES.map((c) => ({
                    value: c.value,
                    label: t(`promptCreate.${c.i18nKey}`),
                  }))}
                  disabled={viewMode === 'view'}
                />
              </div>
              <div>
                <div style={fieldLabelStyle(theme)}>{t('promptCreate.tags')}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                  {tags.map((tag) => (
                    <Tag key={tag} closable={viewMode === 'edit'}
                      onClose={viewMode === 'edit' ? () => setTags(tags.filter((x) => x !== tag)) : undefined}
                    >{tag}</Tag>
                  ))}
                </div>
                {viewMode === 'edit' && (
                  <Input
                    value={tagInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.includes(',')) {
                        const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
                        const newTags = [...tags];
                        for (const p of parts) { if (!newTags.includes(p)) newTags.push(p); }
                        setTags(newTags); setTagInput('');
                      } else { setTagInput(v); }
                    }}
                    onPressEnter={handleAddTag}
                    placeholder={t('promptCreate.tagsPlaceholder')}
                    size="small"
                  />
                )}
              </div>
            </div>
          </div>
          <div style={cardStyle(theme)}>
            <div style={cardHeaderStyle(theme)}>
              <span style={dotStyle(theme.toolbar.accent)} />
              <span>{t('promptCreate.content')}</span>
              <Button size="small" type="link" style={{ marginLeft: 'auto' }}
                icon={<Copy size={12} />} onClick={handleCopyContent}
              >{t('subjectCreate.copyPrompt')}</Button>
            </div>
            <Input.TextArea
              value={content} onChange={(e) => setContent(e.target.value)}
              placeholder={t('promptCreate.contentPlaceholder')}
              autoSize={{ minRows: 8, maxRows: 20 }}
              disabled={viewMode === 'view'}
              style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}
            />
          </div>
          {/* 底部操作栏 */}
          {viewMode === 'view' ? (
            <div style={nonModalFooterStyle()}>
              {isReadOnly ? (
                <>
                  <div style={{ flex: 1 }} />
                  <Button type="primary" size="small" icon={<Copy size={14} />} onClick={handleGenerateSimilar} loading={saving}>{t('promptCreate.generateSimilar')}</Button>
                </>
              ) : (
                <>
                  <Button
                    type="text"
                    size="small"
                    icon={<Star size={14} fill={favorite ? 'currentColor' : 'none'} />}
                    onClick={handleToggleFavorite}
                    style={{ color: favorite ? '#e94560' : undefined }}
                  >
                    {favorite ? t('promptCreate.favorited') : t('promptCreate.favorite')}
                  </Button>
                  {isEdit && <Button size="small" danger icon={<Trash2 size={14} />} onClick={handleDelete}>{t('promptCreate.delete')}</Button>}
                  <div style={{ flex: 1 }} />
                  <Button size="small" icon={<Copy size={14} />} onClick={handleGenerateSimilar} loading={saving}>{t('promptCreate.generateSimilar')}</Button>
                  <Button size="small" icon={<Pencil size={14} />} onClick={handleEnterEdit}>{t('promptCreate.edit')}</Button>
                </>
              )}
            </div>
          ) : (
            <div style={nonModalFooterStyle()}>
              <Button size="small" type="primary" icon={<Save size={14} />} onClick={handleSave} loading={saving}>{t('promptCreate.save')}</Button>
              {isEdit && <Button size="small" onClick={handleCancelEdit}>{t('promptCreate.cancel')}</Button>}
              {isEdit && <Button size="small" danger icon={<Trash2 size={14} />} onClick={handleDelete}>{t('promptCreate.delete')}</Button>}
            </div>
          )}
        </div>
      ) : (
        <div style={contentStyle(false)} className="zx-thin-scroll">
          {/* 桌面端: 基础字段卡片 */}
          <div style={cardStyle(theme)}>
            <div style={cardHeaderStyle(theme)}>
              <span style={dotStyle(theme.toolbar.accent)} />
              <span>{t('promptCreate.name')}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: theme.toolbar.textMuted }}>
                {title.length}/100
              </span>
            </div>
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder={t('promptCreate.namePlaceholder')} maxLength={100} size="large" disabled={viewMode === 'view'} />
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={fieldLabelStyle(theme)}>{t('promptCreate.category')}</div>
                <Select style={{ width: '100%' }} value={category} onChange={(v) => setCategory(v)}
                  options={CATEGORIES.map((c) => ({ value: c.value, label: t(`promptCreate.${c.i18nKey}`) }))}
                  disabled={viewMode === 'view'} />
              </div>
              <div>
                <div style={fieldLabelStyle(theme)}>{t('promptCreate.tags')}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                  {tags.map((tag) => (
                    <Tag key={tag} closable={viewMode === 'edit'}
                      onClose={viewMode === 'edit' ? () => setTags(tags.filter((x) => x !== tag)) : undefined}
                    >{tag}</Tag>
                  ))}
                </div>
                {viewMode === 'edit' && (
                  <Input value={tagInput} onChange={(e) => {
                    const v = e.target.value;
                    if (v.includes(',')) {
                      const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
                      const newTags = [...tags];
                      for (const p of parts) { if (!newTags.includes(p)) newTags.push(p); }
                      setTags(newTags); setTagInput('');
                    } else { setTagInput(v); }
                  }} onPressEnter={handleAddTag}
                    placeholder={t('promptCreate.tagsPlaceholder')} size="small" />
                )}
              </div>
            </div>
          </div>
          {/* 桌面端: 提示词内容 */}
          <div style={cardStyle(theme)}>
            <div style={cardHeaderStyle(theme)}>
              <span style={dotStyle(theme.toolbar.accent)} />
              <span>{t('promptCreate.content')}</span>
              <Button size="small" type="link" style={{ marginLeft: 'auto' }}
                icon={<Copy size={12} />} onClick={handleCopyContent}
              >{t('subjectCreate.copyPrompt')}</Button>
            </div>
            <Input.TextArea value={content} onChange={(e) => setContent(e.target.value)}
              placeholder={t('promptCreate.contentPlaceholder')}
              autoSize={{ minRows: 8, maxRows: 20 }} disabled={viewMode === 'view'}
              style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }} />
          </div>
          {/* 桌面端: 参考图网格 */}
          <div style={cardStyle(theme)}>
            <div style={cardHeaderStyle(theme)}>
              <span style={dotStyle(theme.toolbar.accent)} />
              <span>{t('promptCreate.imagesTitle')}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: theme.toolbar.textMuted }}>{t('promptCreate.imagesCount', { count: images.length })}</span>
            </div>
            <div style={imageGridStyle()}>
              {images.map((img) => {
                const thumbSrc = localPreviews[img.id] || getResourceUrl(img.storageKey, 'preview') || '';
                return (
                  <div key={img.id} style={imageItemStyle(theme)}>
                    <AuthorizedImage src={thumbSrc} alt="" style={imageThumbStyle()} onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }} />
                    <div style={imageRoleRowStyle()}>
                      <Select size="small" value={img.role} onChange={(v) => handleChangeImageRole(img, v)}
                        options={ROLES.map((r) => ({ value: r.value, label: t(`promptCreate.${r.i18nKey}`) }))}
                        style={{ flex: 1, minWidth: 0 }} disabled={viewMode === 'view'} />
                      {viewMode === 'edit' && <Button size="small" type="text" danger icon={<X size={12} />} onClick={() => handleRemoveImage(img)} />}
                    </div>
                  </div>
                );
              })}
              {Object.entries(uploadingProgress).map(([uploadId, pct]) => (
                <div key={uploadId} style={imageItemStyle(theme)}>
                  <div style={{ width: '100%', aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: theme.toolbar.background }}>
                    <Loader2 size={20} style={{ color: theme.toolbar.accent, animation: 'zeroexo-spin 1s linear infinite' }} />
                    <Progress type="circle" percent={pct} size={40} strokeColor={theme.toolbar.accent} railColor={theme.toolbar.border} format={() => `${pct}%`} />
                  </div>
                  <div style={imageRoleRowStyle()}>
                    <span style={{ fontSize: 11, color: theme.toolbar.textMuted, flex: 1, textAlign: 'center' }}>{t('promptCreate.uploading')}</span>
                  </div>
                </div>
              ))}
              {viewMode === 'edit' && (
                <label style={imageAddStyle(theme)}>
                  <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                    onChange={(e) => { if (e.target.files) { Array.from(e.target.files).forEach(handleAddImage); } e.target.value = ''; }} />
                  <Plus size={22} color={theme.toolbar.textMuted} />
                </label>
              )}
            </div>
            {images.length === 0 && (
              <div style={{ fontSize: 12, color: theme.toolbar.textMuted, marginTop: 8 }}>{t('promptCreate.imageEmpty')}</div>
            )}
          </div>
          {/* 底部操作栏 */}
          {viewMode === 'view' ? (
            <div style={nonModalFooterStyle()}>
              {isReadOnly ? (
                <>
                  <div style={{ flex: 1 }} />
                  <Button type="primary" size="small" icon={<Copy size={14} />} onClick={handleGenerateSimilar} loading={saving}>{t('promptCreate.generateSimilar')}</Button>
                </>
              ) : (
                <>
                  <Button
                    type="text"
                    size="small"
                    icon={<Star size={14} fill={favorite ? 'currentColor' : 'none'} />}
                    onClick={handleToggleFavorite}
                    style={{ color: favorite ? '#e94560' : undefined }}
                  >
                    {favorite ? t('promptCreate.favorited') : t('promptCreate.favorite')}
                  </Button>
                  {isEdit && <Button size="small" danger icon={<Trash2 size={14} />} onClick={handleDelete}>{t('promptCreate.delete')}</Button>}
                  <div style={{ flex: 1 }} />
                  <Button size="small" icon={<Copy size={14} />} onClick={handleGenerateSimilar} loading={saving}>{t('promptCreate.generateSimilar')}</Button>
                  <Button size="small" icon={<Pencil size={14} />} onClick={handleEnterEdit}>{t('promptCreate.edit')}</Button>
                </>
              )}
            </div>
          ) : (
            <div style={nonModalFooterStyle()}>
              <Button size="small" type="primary" icon={<Save size={14} />} onClick={handleSave} loading={saving}>{t('promptCreate.save')}</Button>
              {isEdit && <Button size="small" onClick={handleCancelEdit}>{t('promptCreate.cancel')}</Button>}
              {isEdit && <Button size="small" danger icon={<Trash2 size={14} />} onClick={handleDelete}>{t('promptCreate.delete')}</Button>}
            </div>
          )}
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
    height: '100%',
    width: '100%',
    // 弹窗内用画布底色，让 toolbar 底色的卡片浮起产生层次
    background: theme.canvas.background,
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
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minHeight: 0,
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

function fieldLabelStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    fontSize: 11,
    color: theme.toolbar.textMuted,
    marginBottom: 4,
  };
}

function imageGridStyle(): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 10,
  };
}

function imageItemStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    borderRadius: 8,
    border: `1px solid ${theme.toolbar.border}`,
    overflow: 'hidden',
    background: theme.toolbar.background,
  };
}

function imageThumbStyle(): CSSProperties {
  return {
    width: '100%',
    aspectRatio: '1 / 1',
    objectFit: 'cover',
    display: 'block',
  };
}

function imageRoleRowStyle(): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 6px',
  };
}

function imageAddStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    aspectRatio: '1 / 1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px dashed ${theme.toolbar.border}`,
    borderRadius: 8,
    cursor: 'pointer',
    background: 'transparent',
    transition: 'all 0.15s',
  };
}

// ===== Modal 模式样式（现代提示词编辑器设计系统） =====
// 设计参考: Runway / Civitai / Midjourney 提示词管理界面
// 核心原则: 图片预览自适应各种比例, 标题内联顶部栏, 提示词内容为表单核心

function modalHeaderStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 18px',
    borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    flexShrink: 0,
  };
}

function modalHeaderIconStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    width: 34,
    height: 34,
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: theme.mode === 'dark' ? 'rgba(233,69,96,0.12)' : 'rgba(233,69,96,0.08)',
    color: theme.toolbar.accent ?? '#e94560',
    flexShrink: 0,
  };
}

function modalTitleInputStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    flex: 1,
    minWidth: 0,
    height: 36,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontFamily: "'DM Sans', system-ui, sans-serif",
    fontSize: 16,
    fontWeight: 600,
    color: isDark ? '#f5f5f4' : '#1c1917',
    padding: 0,
  };
}

function modalFooterStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 18px',
    borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    flexShrink: 0,
  };
}

function nonModalFooterStyle(): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '16px 0',
    justifyContent: 'flex-end',
  };
}

function modalIconBtnStyle(theme: ReturnType<typeof useTheme>['theme'], active: boolean): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: 'none',
    background: active
      ? 'rgba(233,69,96,0.12)'
      : 'transparent',
    color: active ? '#e94560' : (isDark ? '#a8a29e' : '#57534e'),
    cursor: 'pointer',
    transition: 'all 0.15s',
  };
}

/** ghost/图标按钮 hover 处理：透明底 → 轻底色（主题感知） */
function ghostHoverHandlers(theme: ReturnType<typeof useTheme>['theme']): {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => void;
} {
  const hoverBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  return {
    onMouseEnter: (e) => { e.currentTarget.style.background = hoverBg; },
    onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent'; },
  };
}

/** 删除图标按钮 hover 处理：轻底色 + 危险色文字 */
function dangerHoverHandlers(theme: ReturnType<typeof useTheme>['theme']): {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => void;
} {
  const isDark = theme.mode === 'dark';
  const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const defaultColor = isDark ? '#a8a29e' : '#57534e';
  return {
    onMouseEnter: (e) => {
      e.currentTarget.style.background = hoverBg;
      e.currentTarget.style.color = theme.toolbar.danger;
    },
    onMouseLeave: (e) => {
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.color = defaultColor;
    },
  };
}

function modalSaveBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    padding: '0 14px',
    // accent 微渐变（hoverColor → accent 色板）
    background: 'linear-gradient(180deg, #f06580, #e94560)',
    boxShadow: '0 2px 10px rgba(233,69,96,0.32)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    transition: 'all 0.15s',
  };
}

function modalEditBtnStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    padding: '0 14px',
    background: 'transparent',
    color: theme.toolbar.text,
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
    borderRadius: 8,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
  };
}

function modalCancelBtnStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    padding: '0 14px',
    background: 'transparent',
    color: isDark ? '#a8a29e' : '#57534e',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
    borderRadius: 8,
    fontFamily: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.15s',
  };
}

function modalBodyStyle(isMobile?: boolean): CSSProperties {
  return {
    flex: 1,
    overflow: isMobile ? 'auto' : 'hidden',
    padding: isMobile ? '12px 14px' : '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  };
}

function modalBodyGridStyle(isMobile?: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: isMobile ? 'column' : 'row',
    gap: 20,
    minHeight: 0,
    flex: 1,
  };
}

// ===== 左侧：图片预览区 =====

function previewPanelStyle(isMobile?: boolean): CSSProperties {
  return {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 0,
    ...(isMobile ? { maxHeight: '50vh', marginBottom: 16 } : {}),
  };
}

function previewStageStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    flex: 1,
    minHeight: 340,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: isDark ? '#1c1917' : '#f5f5f4',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    // 棋盘格背景 - 检测透明图片
    backgroundImage: isDark
      ? `linear-gradient(45deg, #211d1a 25%, transparent 25%), linear-gradient(-45deg, #211d1a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #211d1a 75%), linear-gradient(-45deg, transparent 75%, #211d1a 75%)`
      : `linear-gradient(45deg, #e8e6e3 25%, transparent 25%), linear-gradient(-45deg, #e8e6e3 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e8e6e3 75%), linear-gradient(-45deg, transparent 75%, #e8e6e3 75%)`,
    backgroundSize: '20px 20px',
    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  };
}

const previewImageStyle: CSSProperties = {
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  display: 'block',
  borderRadius: 4,
  // 阴影让图片在棋盘格上更立体
  filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.15))',
};

const coverBadgeStyle: CSSProperties = {
  position: 'absolute',
  top: 10,
  left: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 9px',
  borderRadius: 6,
  background: 'rgba(233,69,96,0.92)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.02em',
  backdropFilter: 'blur(6px)',
  boxShadow: '0 2px 8px rgba(233,69,96,0.3)',
};

const imageCounterStyle: CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  padding: '3px 8px',
  borderRadius: 5,
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 500,
  fontFamily: "'JetBrains Mono', monospace",
  backdropFilter: 'blur(4px)',
};

const emptyPreviewStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 48,
  color: '#78716c',
};

function filmstripStyle(): CSSProperties {
  return {
    display: 'flex',
    gap: 8,
    overflowX: 'auto',
    overflowY: 'hidden',
    padding: '4px 0 6px',
    minHeight: 84,
    alignItems: 'center',
    // 隐藏滚动条但保留滚动
    scrollbarWidth: 'thin',
  };
}

function thumbItemStyle(
  theme: ReturnType<typeof useTheme>['theme'],
  isActive: boolean,
  isCover: boolean,
): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    position: 'relative',
    width: 76,
    height: 76,
    borderRadius: 8,
    overflow: 'hidden',
    flexShrink: 0,
    cursor: 'pointer',
    background: isDark ? '#211d1a' : '#e8e6e3',
    border: isActive
      ? '2px solid #e94560'
      : isCover
        ? '2px solid rgba(233,69,96,0.4)'
        : `2px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    transition: 'border-color 0.15s, transform 0.15s',
  };
}

const thumbImageStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const thumbCoverBadgeStyle: CSSProperties = {
  position: 'absolute',
  bottom: 3,
  left: 3,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: 'rgba(233,69,96,0.92)',
  color: '#fff',
};

const thumbHoverOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'flex-end',
  gap: 3,
  padding: 4,
  opacity: 0,
  transition: 'opacity 0.15s',
  background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 55%)',
};

const thumbActionBtnStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 5,
  border: 'none',
  background: 'rgba(0,0,0,0.7)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
  backdropFilter: 'blur(4px)',
};

function uploadTileStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    width: 76,
    height: 76,
    borderRadius: 8,
    border: `1.5px dashed ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    cursor: 'pointer',
    flexShrink: 0,
    background: 'transparent',
    color: isDark ? '#78716c' : '#a8a29e',
    transition: 'all 0.15s',
  };
}

// ===== 右侧：表单区 =====

function formPanelStyle(isMobile?: boolean): CSSProperties {
  return {
    width: isMobile ? '100%' : 380,
    minHeight: isMobile ? 0 : 340,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    overflowY: 'auto',
  };
}

function formSectionStyle(): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
  };
}

function formLabelStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: isDark ? '#a8a29e' : '#78716c',
    marginBottom: 8,
  };
}

function formLabelRowStyle(): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 8,
  };
}

function copyBtnStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'transparent',
    border: 'none',
    color: isDark ? '#a8a29e' : '#78716c',
    cursor: 'pointer',
    fontSize: 11,
    padding: 0,
    transition: 'color 0.15s',
  };
}

function noteInputStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    width: '100%',
    minHeight: 56,
    maxHeight: 100,
    background: isDark ? '#211d1a' : '#f5f5f4',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    borderRadius: 8,
    outline: 'none',
    padding: '8px 12px',
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    color: isDark ? '#d6d3d1' : '#44403c',
    resize: 'none',
    transition: 'border-color 0.15s',
  };
}

function promptBlockStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    background: isDark ? '#161412' : '#fafaf9',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    borderRadius: 10,
    padding: '12px 14px',
    flex: 1,
    minHeight: 160,
    overflow: 'auto',
    resize: 'vertical',
  };
}

function promptTextareaStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    width: '100%',
    height: '100%',
    minHeight: 136,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    fontSize: 12,
    lineHeight: 1.65,
    // 随主题区分文字颜色，保证浅色主题下可读性
    color: isDark ? '#d6d3d1' : '#44403c',
    resize: 'none',
    padding: 0,
  };
}

function tagsRowStyle(): CSSProperties {
  return {
    display: 'flex',
    gap: 5,
    flexWrap: 'wrap',
    marginBottom: 8,
  };
}

function tagChipStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 9px',
    borderRadius: 9999,
    fontSize: 11,
    fontWeight: 500,
    background: isDark ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.08)',
    color: '#8b5cf6',
    border: 'none',
  };
}

const tagRemoveBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: '#a78bfa',
  display: 'inline-flex',
  alignItems: 'center',
  lineHeight: 1,
};

function tagInputStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    width: '100%',
    height: 34,
    background: isDark ? '#211d1a' : '#f5f5f4',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
    borderRadius: 8,
    outline: 'none',
    padding: '0 12px',
    fontFamily: 'inherit',
    fontSize: 13,
    color: isDark ? '#f5f5f4' : '#1c1917',
    transition: 'border-color 0.15s',
  };
}

// ===== 公共提示词底部栏（协议/来源） =====

function licenseChipStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 10px',
    borderRadius: 12,
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)'}`,
    color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
    letterSpacing: '0.3px',
    lineHeight: '18px',
    flexShrink: 0,
  };
}

function sourceInfoStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return {
    fontSize: 11,
    color: theme.toolbar.textMuted,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}
