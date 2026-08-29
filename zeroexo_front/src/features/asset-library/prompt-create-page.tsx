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

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Save,
  Star,
  X,
  Copy,
  Plus,
  Loader2,
  Pencil,
  ExternalLink,
} from 'lucide-react';
import { Button, Input, Select, App as AntdApp, Spin, Progress, Tooltip } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import {
  createPrompt,
  updatePrompt,
  getPrompt,
  type PromptCategory,
  type PromptGenerationMode,
} from './prompts-api.js';
import { PromptChainCanvas, TagsOverlay } from './components/prompt-chain-canvas.js';
import { updatePrompt as storeUpdatePrompt, upsertPrompt as storeUpsertPrompt } from '@/features/prompt-library/prompt-store.js';
import {
  listPromptImages,
  setPromptImages,
  type PromptImage,
  type PromptImageRole,
} from './prompt-images-api.js';
import { notifyPromptCopied } from './prompt-copy-feedback.js';
import { AuthorizedImage } from '@/shared/components/authorized-media.js';
import { useAuth } from '@/features/auth/auth-store.js';

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
  /**
   * 嵌入模式：不渲染自身外壳（Modal/顶栏/底栏），只输出提示词画布舞台。
   * 用于接入资产浏览器 —— 由资产浏览器统一提供 Modal、标题栏与底部出血操作栏，
   * 保证提示词与图片/文档是同一套 UI 框架的变体。
   */
  embedded?: boolean;
  /** 受控视图模式（嵌入模式下由外部「编辑」按钮驱动；不传则内部自管） */
  viewMode?: 'view' | 'edit';
  /** 视图模式变更回调（受控模式下必传） */
  onViewModeChange?: (mode: 'view' | 'edit') => void;
  /**
   * 请求关闭当前外壳（2026-08-29）。
   * 嵌入模式下由资产浏览器传入其关闭回调 —— 用于「生成副本 → 点击跳转」时先关弹窗再跳转，
   * 否则跳转后详情弹窗仍遮在资产库之上。
   */
  onRequestClose?: () => void;
}

/** 命令式句柄（供嵌入模式下资产浏览器底部出血栏的按钮调用） */
export interface PromptCreatePageHandle {
  /** 保存当前编辑内容 */
  save: () => Promise<void>;
  /** 创建副本（收藏副本：复制到个人提示词库） */
  duplicate: () => Promise<void>;
  /** 进入编辑（内部记录快照，供脏检查与「取消」回退使用；受控模式下必须走这里） */
  enterEdit: () => void;
  /** 取消编辑（回退到进入编辑时的快照） */
  cancelEdit: () => void;
}

const CATEGORIES: Array<{ value: PromptCategory; i18nKey: string }> = [
  { value: 'role', i18nKey: 'categoryRole' },
  { value: 'scene', i18nKey: 'categoryScene' },
  { value: 'prop', i18nKey: 'categoryProp' },
  { value: 'style', i18nKey: 'categoryStyle' },
  { value: 'shot', i18nKey: 'categoryShot' },
  { value: 'other', i18nKey: 'categoryOther' },
];

// 2026-08-29:封面不再是 role 第三态——只保留参考/生成两角色,封面用独立 isCover 布尔标记
const ROLES: Array<{ value: PromptImageRole; i18nKey: string }> = [
  // 征集 #78 验收:角色文案改输入/输出语义(封面由设封面按钮指派,不影响角色)
  { value: 'reference', i18nKey: 'imageRoleInput' },
  { value: 'output', i18nKey: 'imageRoleOutput' },
];

export const PromptCreatePage = forwardRef<PromptCreatePageHandle, PromptCreatePageProps>(function PromptCreatePage(props, ref): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const { message: antdMessage } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();

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
  // 生成模式(征集 #79/Plan#47):文生图/图生图,存量默认文生图(右侧链路画布据此还原输入/输出)
  const [generationMode, setGenerationMode] = useState<PromptGenerationMode>('txt2img');
  const [tags, setTags] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [images, setImages] = useState<PromptImage[]>([]);
  // 当前主预览图索引(胶片条选中态;主预览已由链路画布接管,征集 #79)
  const [previewIdx, setPreviewIdx] = useState(0);
  // 上传进度映射: 临时id -> 百分比(0-100)
  const [uploadingProgress, setUploadingProgress] = useState<Record<string, number>>({});
  // 本地预览 URL(blob URL),在图片上传后立即显示,直到后端缩略图可访问
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  // 链路画布用:本地预览 URL 按 storageKey 索引(上传后即时显示)
  const localPreviewByStorageKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const img of images) {
      const lp = localPreviews[img.id];
      if (lp && img.storageKey) m[img.storageKey] = lp;
    }
    return m;
  }, [images, localPreviews]);
  const uploadIdCounter = useRef(0);
  // 征集 #90:画布 Pin 加图——隐藏 file input + 待入列角色（Pin 点击时记录,选完文件按角色追加）
  const canvasFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImageRoleRef = useRef<'reference' | 'output'>('reference');

  // 查看/编辑模式（只读模式始终为 view）
  // 2026-08-29：支持外部受控 —— 嵌入资产浏览器时由底部出血栏的「编辑」按钮驱动编辑态；
  // 未传 viewMode 时内部自管，行为与原先完全一致（受控/非受控双模式）。
  const [viewModeState, setViewModeState] = useState<'view' | 'edit'>(isReadOnly || isEdit ? 'view' : 'edit');
  const viewMode = props.viewMode ?? viewModeState;
  const setViewMode = useCallback((mode: 'view' | 'edit') => {
    if (props.viewMode === undefined) setViewModeState(mode);
    props.onViewModeChange?.(mode);
  }, [props.viewMode, props.onViewModeChange]);
  const [savedState, setSavedState] = useState<{
    title: string;
    content: string;
    contentEn: string;
    contentJa: string;
    note: string;
    category: PromptCategory;
    generationMode: PromptGenerationMode;
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
        // 存量/缺省一律回退文生图(后端 @default 同语义)
        setGenerationMode(p.generationMode === 'img2img' ? 'img2img' : 'txt2img');
        setTags(p.tags);
        setFavorite(p.favorite);
        setImages(imgs);
        // 公共提示词导入的副本，保存时自动创建新副本
        if (p.source === 'public-import') {
          setIsPublicImport(true);
        }
        // 默认预览封面图(若有,isCover 标记),否则第一张
        const coverIdx = imgs.findIndex((img) => img.isCover);
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
    // 公共提示词无模式字段,一律按文生图展示(征集 #79)
    setGenerationMode('txt2img');
    setTags(props.initialData.tags ?? []);
    setImages(
      (props.initialData.images ?? []).map((img, i) => ({
        id: `init_${i}`,
        promptId: '',
        storageKey: img.storageKey,
        // 征集 #78 验收拍板:公共提示词图片一律默认输出(不再首图转封面/余图转参考)
        role: 'output' as PromptImageRole,
        isCover: i === 0,
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

  // 收藏副本（复制到个人提示词库）
  const handleGenerateSimilar = useCallback(async () => {
    if (!isAuthenticated) {
      antdMessage.warning(t('promptCreate.loginRequired'));
      if (typeof window !== 'undefined') window.location.hash = '#/auth';
      return;
    }
    setSaving(true);
    try {
      const created = await createPrompt({
        title: title.trim(),
        content: content.trim(),
        contentEn: contentEn.trim() || undefined,
        contentJa: contentJa.trim() || undefined,
        category: category as PromptCategory,
        generationMode,
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
        generationMode: created.generationMode ?? 'txt2img',
        tags: created.tags,
        imageKeys: created.imageKeys,
        favorite: created.favorite ?? false,
        source: 'local',
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      }).catch(() => {});
      // 征集 #93(Plan#47 T9):后端 create 不再按 imageKeys 重建 PromptImage(role 由 images/set 唯一维护),
      // 收藏副本必须显式写附图 role + isCover,否则刷新后图片丢失/封面丢失
      await setPromptImages(
        created.id,
        images.map((img, i) => ({
          storageKey: img.storageKey,
          role: img.role,
          isCover: img.isCover,
          sortOrder: i,
        })),
      );
      // 点击提示里的「点击查看」时先关闭当前弹窗再跳转（嵌入模式下外壳由 onRequestClose 关闭）
      notifyPromptCopied(antdMessage, created.id, () => {
        props.onRequestClose?.();
        props.onBack?.();
      });
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
    if (!isAuthenticated) {
      antdMessage.warning(t('promptCreate.loginRequired'));
      if (typeof window !== 'undefined') window.location.hash = '#/auth';
      return;
    }
    setSaving(true);
    try {
      // 重排图片:封面图(isCover)排到最前面,确保 PromptCard 中 imageKeys[0] 是封面
      const sortedImages = [...images].sort((a, b) => {
        if (a.isCover) return -1;
        if (b.isCover) return 1;
        return 0;
      });
      const payload = {
        title: title.trim(),
        content: content.trim(),
        contentEn: contentEn.trim() || undefined,
        contentJa: contentJa.trim() || undefined,
        note: note.trim() || undefined,
        category,
        generationMode,
        tags,
        favorite,
        imageKeys: sortedImages.map((i) => i.storageKey),
      };
      let promptId = props.promptId;
      // 有 promptId = 编辑用户自己的资产（含公共导入副本）：直接更新本体；
      // 无 promptId = 新建 / 公共提示词收藏副本：创建新提示词（副本 source 标记来源，避免与公共原版混淆）
      if (isEdit && promptId) {
        await updatePrompt(promptId, payload);
        // 同步更新本地 store（前端刷新时从本地 store 加载）
        await storeUpdatePrompt(promptId, payload).catch(() => {});
      } else {
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
          generationMode: created.generationMode ?? 'txt2img',
          tags: created.tags,
          imageKeys: created.imageKeys,
          favorite: created.favorite ?? false,
          source: (created.source ?? 'local') as 'local' | 'remote' | 'public-import',
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        }).catch(() => {});
      }
      // 保存参考图(使用排序后的图片,封面排第一;封面独立 isCover 标记,不改变角色)
      if (promptId) {
        await setPromptImages(
          promptId,
          sortedImages.map((img, i) => ({
            storageKey: img.storageKey,
            role: img.role,
            isCover: img.isCover,
            sortOrder: i,
          })),
        );
      }
      antdMessage.success(t('promptCreate.savedToast'));
      // 保存后切换到查看模式（不关闭弹窗）。
      // 同时清空编辑快照：受控模式下内部 setViewMode('view') 会回调外部 onEditingChange(false)，
      // 若快照仍在，外部随之触发的 cancelEdit 会把刚保存的内容回退掉。
      setViewMode('view');
      setSavedState(null);
      props.onSaved();
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('promptCreate.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [title, content, contentEn, contentJa, note, category, generationMode, tags, favorite, images, isEdit, isPublicImport, props, antdMessage, t, setViewMode]);

  // 2026-08-29：页内删除入口已移除（统一由资产库列表负责删除），handleDelete 随之删除

  const handleCopyContent = useCallback(() => {
    const currentContent = contentLang === 'en' ? contentEn :
      contentLang === 'ja' ? contentJa : content;
    if (!currentContent.trim()) return;
    void navigator.clipboard.writeText(currentContent);
    antdMessage.success(t('subjectCreate.copyPromptSuccess'));
  }, [content, contentEn, contentJa, contentLang, antdMessage, t]);

  const handleEnterEdit = useCallback(() => {
    setSavedState({ title, content, contentEn, contentJa, note, category, generationMode, tags, favorite, images, localPreviews });
    setViewMode('edit');
  }, [title, content, contentEn, contentJa, note, category, generationMode, tags, favorite, images, localPreviews, setViewMode]);

  const handleCancelEdit = useCallback(() => {
    if (savedState) {
      setTitle(savedState.title);
      setContent(savedState.content);
      setContentEn(savedState.contentEn);
      setContentJa(savedState.contentJa);
      setNote(savedState.note);
      setCategory(savedState.category);
      setGenerationMode(savedState.generationMode);
      setTags(savedState.tags);
      setFavorite(savedState.favorite);
      setImages(savedState.images);
      setLocalPreviews(savedState.localPreviews);
    }
    setViewMode('view');
    setSavedState(null);
  }, [savedState, setViewMode]);

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
      generationMode !== savedState.generationMode ||
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

  const MAX_TAGS = 8;
  const MAX_TAG_LENGTH = 20;
  const MAX_CONTENT_LENGTH = 7000;
  // 2026-08-29：备注（说明）字段的输入入口移除，MAX_NOTE_LENGTH 随之删除（note 仅随保存透传）

  // 征集 #87:画布左上角标签区(迁入)的新增/移除回调,与表单标签同一套限额/去重规则。
  // 画布 TagsOverlay 内部自持输入草稿,提交时传入完整标签字符串。
  const handleAddTagFromCanvas = useCallback((raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (tags.length >= MAX_TAGS) {
      antdMessage.warning(t('promptCreate.tagLimitHint', { maxLength: MAX_TAG_LENGTH, maxCount: MAX_TAGS, count: tags.length }));
      return;
    }
    const final = v.length > MAX_TAG_LENGTH ? v.slice(0, MAX_TAG_LENGTH) : v;
    if (tags.includes(final)) return;
    setTags([...tags, final]);
  }, [tags, antdMessage, t]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((x) => x !== tag));
  }, []);

  // 征集 #89:右侧详情面板移除,提示词正文编辑迁入画布提示词节点;
  // 画布展示当前语言版本,编辑时按 contentLang 路由回对应字段(与脏检查字段一致)
  const handleCanvasContentChange = useCallback((v: string) => {
    if (contentLang === 'en') setContentEn(v);
    else if (contentLang === 'ja') setContentJa(v);
    else setContent(v);
  }, [contentLang]);

  // 设为封面(2026-08-29 修正模型):封面是独立布尔 isCover,不改变 reference/output 角色。
  // 同一时间仅一张封面;封面图重排到最前(供 PromptCard imageKeys[0] 取封面)。
  const handleSetCover = useCallback((imgId: string) => {
    setImages((prev) => {
      const updated = prev.map((img) => ({
        ...img,
        isCover: img.id === imgId,
      }));
      // 重排:封面图排到最前面
      return updated.sort((a, b) => {
        if (a.isCover) return -1;
        if (b.isCover) return 1;
        return 0;
      });
    });
    // 预览切到封面图
    setPreviewIdx(0);
  }, []);

  // 点击缩略图切换选中态(主预览已由链路画布接管,仅保留胶片条高亮)
  const handleSelectPreview = useCallback((idx: number) => {
    setPreviewIdx(idx);
  }, []);

  // 征集 #87:移除节点详情查看器(原征集 #78)——图片节点可双击放大查看,不再调起资源浏览器,
  // 故去掉 viewerImage 状态 / handleOpenImageDetail / viewerAsset 及 AssetDetailViewer 渲染。

  // 添加参考图(先上传到后端 storage,再关联到提示词)
  // 征集 #90:画布路径显式传 forcedRole（Pin 指定输入/输出,不再自动首图 cover,封面由节点按钮指派）
  const handleAddImage = useCallback(
    async (file: File, forcedRole?: 'reference' | 'output') => {
      const uploadId = `upload_${++uploadIdCounter.current}`;
      // 先添加一个占位图,显示上传中
      setUploadingProgress((prev) => ({ ...prev, [uploadId]: 0 }));
      try {
        const uploaded = await uploadAsset(file, (loaded, total) => {
          const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
          setUploadingProgress((prev) => ({ ...prev, [uploadId]: pct }));
        });
        // 征集 #83 修复:提示词附图禁止注册进「我的资产」—— 旧代码 storeAddAssets([uploaded])
        // 会把每张附图写入资产库并被同步推云(用户反馈"提示词录入时资产库多出图片"的泄漏源)。
        // 附图仅经 PromptImage(storageKey)关联提示词;展示走 usePreviewImage/getResourceUrl,
        // 后端键无需本地资产记录也能访问(与画布拖拽上传同契约)。
        const storageKey = uploaded.data.kind === 'image' || uploaded.data.kind === 'video' || uploaded.data.kind === 'audio'
          ? (uploaded.data as { storageKey?: string }).storageKey ?? ''
          : '';
        // 提取预览 URL(blob URL 立即显示,直到后端缩略图可访问)
        const previewUrl = uploaded.data.kind === 'image' ? uploaded.data.dataUrl
          : uploaded.data.kind === 'video' ? uploaded.data.url
          : '';
        // 2026-08-29 模型修正:首图默认输出角色 + 独立封面标记 isCover;Pin 强制角色加图不自动封面
        const newImg: PromptImage = {
          id: `local_${Date.now()}_${images.length}`,
          promptId: props.promptId ?? 'pending',
          storageKey,
          role: forcedRole ?? (images.length === 0 ? 'output' as PromptImageRole : 'reference' as PromptImageRole),
          isCover: !forcedRole && images.length === 0,
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

  // ===== 画布节点操作回调（征集 #90：胶片条退役，加图/设封面/切换角色/删除全部画布内完成） =====

  // Pin 加图（左 Pin=输入 / 右 Pin=输出）：记录待入列角色后触发隐藏文件选择
  const handleCanvasAddImage = useCallback((role: 'reference' | 'output') => {
    pendingImageRoleRef.current = role;
    canvasFileInputRef.current?.click();
  }, []);

  // 设为封面：按 storageKey 定位后复用既有 handler（封面独立标记,不改参考/生成角色,不移动列）
  const handleCanvasSetCover = useCallback((storageKey: string) => {
    const img = images.find((i) => i.storageKey === storageKey);
    if (img) handleSetCover(img.id);
  }, [images, handleSetCover]);

  // 输入 ↔ 输出互换：role 变更后画布按数据重排列（封面标记独立,封面图也可切换角色）
  const handleCanvasToggleRole = useCallback((storageKey: string) => {
    const img = images.find((i) => i.storageKey === storageKey);
    if (!img) return;
    handleChangeImageRole(img, img.role === 'reference' ? 'output' : 'reference');
  }, [images, handleChangeImageRole]);

  // 移除图片：复用既有 handler（本地 draft 删除，保存时整体替换）
  const handleCanvasRemoveImage = useCallback((storageKey: string) => {
    const img = images.find((i) => i.storageKey === storageKey);
    if (img) handleRemoveImage(img);
  }, [images, handleRemoveImage]);

  // 命令式句柄：嵌入资产浏览器时，由底部出血栏的「编辑 / 保存 / 取消 / 副本」按钮调用
  useImperativeHandle(ref, () => ({
    save: handleSave,
    duplicate: handleGenerateSimilar,
    enterEdit: handleEnterEdit,
    cancelEdit: handleCancelEdit,
  }), [handleSave, handleGenerateSimilar, handleEnterEdit, handleCancelEdit]);

  // ===== 编辑浮层内容（标题 + 分类 + 标签编辑）=====
  // 2026-08-29：备注（说明）移除，改为标签编辑；画布左上角标签只做展示，编辑入口统一在此。
  // 供 modal 分支 / 嵌入模式 / 移动端共用一份，避免三处各写一遍。
  const editOverlayContent = (
    <div style={editBarStyle(theme, isMobile)}>
      {props.hideTitle && (
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={isEdit ? t('promptCreate.editTitle') : t('promptCreate.namePlaceholder')}
          maxLength={100}
          style={editBarInputStyle(theme)}
        />
      )}
      <Select
        size="small"
        style={{ width: 132, flexShrink: 0 }}
        value={category}
        onChange={(v) => setCategory(v)}
        options={CATEGORIES.map((c) => ({
          value: c.value,
          label: t(`promptCreate.${c.i18nKey}`),
        }))}
      />
      {/* 标签编辑：画布左上角改为纯展示后，增删标签的唯一入口。
          flex 权重高于标题/分类，让标签区拿到主要横向空间 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 3, minWidth: 180 }}>
        <span style={{ fontSize: 11, color: theme.toolbar.textMuted, flexShrink: 0 }}>
          {t('promptCreate.tags')}
        </span>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <TagsOverlay
            tags={tags}
            readOnly={false}
            isDark={theme.mode === 'dark'}
            onAddTag={handleAddTagFromCanvas}
            onRemoveTag={handleRemoveTag}
          />
        </div>
      </div>
    </div>
  );

  // ===== 提示词链路画布舞台（完整页面 modal 分支 与 嵌入模式 共用同一份渲染）=====
  const promptStage = (
    <div style={{ flex: 1, minHeight: 0, borderRadius: 12, overflow: 'hidden' }}>
      <PromptChainCanvas
        content={contentLang === 'en' ? contentEn : contentLang === 'ja' ? contentJa : content}
        mode={generationMode}
        images={images}
        localPreviews={localPreviewByStorageKey}
        tags={tags}
        editable={viewMode === 'edit'}
        onContentChange={handleCanvasContentChange}
        contentMaxLength={MAX_CONTENT_LENGTH}
        onAddImage={handleCanvasAddImage}
        onSetCover={handleCanvasSetCover}
        onToggleImageRole={handleCanvasToggleRole}
        onRemoveImage={handleCanvasRemoveImage}
        onCopyPrompt={handleCopyContent}
        // 编辑控件以浮层嵌入画布内部，不占布局高度：
        // 改变浏览器高度时画布独占全部空间并自适应缩放，
        // 既不会挤压画布、也不会被容器裁剪
        editOverlay={viewMode === 'edit' ? editOverlayContent : undefined}
      />
    </div>
  );

  // 画布加图入口（征集 #90）：Pin 点击 → 记录待入列角色 → 触发文件选择 → 按角色追加
  const canvasFileInput = (
    <input
      ref={canvasFileInputRef}
      type="file"
      accept="image/*"
      multiple
      style={{ display: 'none' }}
      onChange={(e) => {
        const role = pendingImageRoleRef.current;
        if (e.target.files) {
          Array.from(e.target.files).forEach((f) => handleAddImage(f, role));
        }
        e.target.value = '';
      }}
    />
  );

  if (loading) {
    // 嵌入模式（资产浏览器内）不渲染自己的外壳，loading 也用轻量占位
    if (props.embedded) {
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" />
        </div>
      );
    }
    return (
      <div style={pageStyle(theme, !!props.modal)}>
        <div style={loadingStyle(theme)}>
          <Spin size="large" />
        </div>
      </div>
    );
  }

  // ===== 嵌入模式：只输出画布舞台，外壳（Modal/标题/底部出血栏）由资产浏览器提供 =====
  if (props.embedded) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {promptStage}
        {canvasFileInput}
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
            {title || (isEdit ? t('promptCreate.editTitle') : t('promptCreate.title'))}
          </h2>
        </div>
      )}

      {/* 主体内容 - 根据是否modal使用不同布局 */}
      {props.modal ? (
        <>
        <div style={modalBodyStyle(isMobile)} className="zx-thin-scroll">
            {/* 画布区占满全宽（征集 #89：右侧详情面板移除；征集 #90：图片录入画布化，胶片条退役） */}
            <div style={previewPanelStyle(isMobile)}>
              {/* 提示词链路画布(征集 #79/Plan#47):参考图→提示词→生成图忠实还原;
                  节点不可移动、仅视口缩放+平移;
                  编辑态正文在提示词节点内直编(征集 #89);图片录入/角色/封面/删除全在画布节点内完成(征集 #90) */}
              {promptStage}
            </div>

          {canvasFileInput}
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
                  {/* 收藏副本 — 与私有模式主按钮同款样式 */}
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
                  {/* 2026-08-29：删除按钮移除 —— 与资产浏览器统一后，删除由资产库列表负责，
                      提示词页内不再自带删除入口（避免两套 UI 的操作语义打架） */}
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
            </div>
          )}
          </>)
      : isMobile ? (
        <div style={contentStyle(true)} className="zx-thin-scroll">
          {/* 移动端: 链路画布 + 胶片条放在顶部(征集 #79) */}
          <div style={previewPanelStyle(isMobile)}>
            <div style={{ flex: 1, minHeight: 0, borderRadius: 12, overflow: 'hidden' }}>
              <PromptChainCanvas
                content={contentLang === 'en' ? contentEn : contentLang === 'ja' ? contentJa : content}
                mode={generationMode}
                images={images}
                localPreviews={localPreviewByStorageKey}
                tags={tags}
                editable={viewMode === 'edit'}
                onCopyPrompt={handleCopyContent}
                // 移动端同样用画布浮层承载标题/分类/标签编辑
                // （画布左上角标签已改为纯展示，否则移动端将失去标签编辑入口）
                editOverlay={viewMode === 'edit' ? editOverlayContent : undefined}
              />
            </div>
            <div style={filmstripStyle()}>
              {images.map((img, idx) => {
                const thumbSrc = localPreviews[img.id] || getResourceUrl(img.storageKey, 'preview') || '';
                const isActive = idx === previewIdx;
                const isCover = !!img.isCover;
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
                        {/* 设封面按钮常显(2026-08-29):封面节点也显示,星标填充;点击其他图自动切换封面 */}
                        <button
                          type="button"
                          style={{ ...thumbActionBtnStyle, color: isCover ? '#ffd166' : 'inherit' }}
                          onClick={(e) => { e.stopPropagation(); handleSetCover(img.id); }}
                          title={t('promptCreate.setCover')}
                        >
                          <Star size={11} fill={isCover ? 'currentColor' : 'none'} />
                        </button>
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
                        Array.from(e.target.files).forEach((f) => handleAddImage(f));
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
              {/* 征集 #87:标签已迁入链路画布左上角,移动端表单不再重复展示/编辑 */}
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
              {/* 征集 #87:标签已迁入链路画布左上角,移动端表单不再重复展示/编辑 */}
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
                    onChange={(e) => { if (e.target.files) { Array.from(e.target.files).forEach((f) => handleAddImage(f)); } e.target.value = ''; }} />
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
            </div>
          )}
        </div>
      )}

    </div>
  );
});

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

// 2026-08-29：页内删除按钮移除后，modalIconBtnStyle / dangerHoverHandlers 已无引用，一并删除

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
    // 2026-08-29 修复「编辑模式改变高度后内容显示不全」：PC 端原 overflow:hidden，
    // 编辑模式下 editBar 为固定高度，浏览器高度变小时画布收缩后 editBar/footer 被裁剪不可见。
    // 改为 auto —— 高度足够时无滚动条，不足时可滚动查看编辑条与操作栏，内容不再丢失。
    overflow: 'auto',
    padding: isMobile ? '12px 14px' : '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
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
    // 2026-08-29 修复「编辑模式改变高度后内容显示不全」：flex item 缺 minHeight:0 时
    // 无法随容器收缩，浏览器高度变小的编辑条/操作栏被挤出裁剪。加回以便画布正确收缩。
    minHeight: 0,
    ...(isMobile ? { maxHeight: '50vh', marginBottom: 16 } : {}),
  };
}

// 旧单图预览台样式(棋盘格/封面角标/计数器/空态)已随链路画布改造移除(征集 #79/Plan#47)

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

// ===== 编辑态浮层（2026-08-29：编辑控件嵌入画布内部悬浮显示，不再作为画布下方独立条） =====
// 悬浮于画布之上，故需不透明底色 + 投影 + 背板模糊，避免被画布内容干扰可读性；
// 不占布局高度，画布独占全部空间并随浏览器高度自适应缩放。

function editBarStyle(theme: ReturnType<typeof useTheme>['theme'], isMobile?: boolean): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    padding: isMobile ? '6px 8px' : '8px 10px',
    borderRadius: 10,
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'}`,
    background: isDark ? 'rgba(22,22,22,0.92)' : 'rgba(255,255,255,0.94)',
    boxShadow: isDark ? '0 8px 24px rgba(0,0,0,0.5)' : '0 8px 20px rgba(28,25,23,0.14)',
    backdropFilter: 'blur(8px)',
    maxWidth: '100%',
  };
}

function editBarInputStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    // 2026-08-29：标题占比调小（原 flex:2 / minWidth:160），把横向空间让给标签编辑区
    flex: 1,
    minWidth: 110,
    height: 28,
    background: 'transparent',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}`,
    borderRadius: 6,
    outline: 'none',
    padding: '0 10px',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 600,
    color: isDark ? '#f5f5f4' : '#1c1917',
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
