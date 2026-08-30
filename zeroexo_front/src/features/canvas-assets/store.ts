/**
 * canvas-assets/store - 画布资产抽屉数据层（2026-08-30 用户拍板：与主页资产库彻底独立，数据驱动）
 *
 * 架构约定：
 * - 画布内资产抽屉（HierarchyPanelSidebar）不再复用主页 AssetLibraryPage /
 *   use-asset-library 那套编排（主页是一套、抽屉是独立一套），避免巨型文件耦合。
 * - 展示组件（PromptCard / PromptViewer / AssetDetailViewer / PromptCreatePage 等）可复用。
 * - 本文件是抽屉唯一的数据来源：全部状态 + 派生数据 + 操作 actions，
 *   组件层只做纯渲染 + 事件派发（数据驱动）。
 *
 * 数据源（均为独立 hook，非主页编排）：
 * - 素材：useAssets（asset-picker，独立）
 * - 我的提示词：useSharedPrompts（共享缓存，独立）
 * - 公共提示词：本 store 自管（后端分页 GET /public/prompts）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssets } from '@/features/asset-picker/use-assets.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { addAssets as storeAddAssets, upsertAsset } from '@/features/asset-picker/asset-store.js';
import { onAssetCreated } from '@/services/sync/sync-service.js';
import { UploadQueue } from '@zeroexo/plugin-upload-queue';
import { useAssetUploadQueue } from '@/features/upload-queue/use-upload-queue.js';
import { useSharedPrompts, refreshSharedPrompts } from '@/features/asset-library/shared-data-store.js';
import { deletePrompt, updatePrompt, createPrompt, type Prompt, type PromptCategory } from '@/features/asset-library/prompts-api.js';
import { setPromptImages } from '@/features/asset-library/prompt-images-api.js';
import { notifyPromptCopied } from '@/features/asset-library/prompt-copy-feedback.js';
import { getLocalizedTitle, type PublicPromptItem } from '@/features/asset-library/public-prompts-shared.js';
import { apiPost, apiFetch, getToken } from '@/services/api-client.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { chapterDetectPipeline } from '@/shared/utils/chapter-detect-pipeline.js';
import type { Episode } from '@/features/canvas-nodes/storyboard/script-types.js';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';

// ===== 类型 =====

export type DrawerGroup = 'hierarchy' | 'material' | 'prompt' | 'script';
export type PromptSource = 'mine' | 'public';

/** 业务分类（用户拍板收敛：style/shot 并入 other，项目不需要单独分类） */
export const PROMPT_CATEGORY_KEYS: PromptCategory[] = ['role', 'scene', 'prop', 'other'];
/** 「其他」合并的分类集合（含旧数据中的 style/shot） */
const OTHER_CATEGORY_SET = new Set<PromptCategory | string>(['other', 'style', 'shot']);

export interface SendToCanvasItem {
  type: 'asset' | 'prompt' | 'script';
  id: string;
  data: any;
}

/** 公共提示词每页条数（同主页公共提示词页） */
const PUBLIC_PAGE_SIZE = 24;

/** 公共提示词搜索防抖 */
const SEARCH_DEBOUNCE_MS = 400;

// ===== 画布资产抽屉数据 Hook（数据驱动唯一来源） =====

export interface UseCanvasAssetsOptions {
  /** 发送到画布（编辑器接线） */
  onSendToCanvas?: (item: SendToCanvasItem) => void;
}

export function useCanvasAssetsPanel({ onSendToCanvas }: UseCanvasAssetsOptions) {
  const { t } = useTranslation();
  const { message: antdMessage } = App.useApp();
  const { isAuthenticated } = useAuth();

  // ── 独立数据源 ──
  const { assets, loading: loadingAssets, refresh: refreshAssets, removeAssets, updateAsset } = useAssets();
  const { prompts, loading: loadingPrompts, refreshPrompts } = useSharedPrompts();

  // ── 视图状态（分组 / 全局搜索） ──
  const [activeGroup, setActiveGroup] = useState<DrawerGroup>('material');
  const [search, setSearch] = useState('');

  // ── 素材分组状态 ──
  const [materialKind, setMaterialKind] = useState<'all' | 'image' | 'video' | 'audio' | 'text'>('all');

  // ── 提示词分组状态（来源 + 分类） ──
  const [promptSource, setPromptSource] = useState<PromptSource>('mine');
  const [promptCategory, setPromptCategory] = useState<string | null>(null);

  // ── 公共提示词数据（后端分页，自管） ──
  const [publicItems, setPublicItems] = useState<PublicPromptItem[]>([]);
  const [publicTotal, setPublicTotal] = useState(0);
  const [publicPage, setPublicPage] = useState(1);
  const [loadingPublic, setLoadingPublic] = useState(false);
  const [publicError, setPublicError] = useState<string | null>(null);

  // ── 弹窗 / 详情状态 ──
  const [promptViewId, setPromptViewId] = useState<string | null>(null);
  const [publicViewItem, setPublicViewItem] = useState<PublicPromptItem | null>(null);
  const [assetDetail, setAssetDetail] = useState<any>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'prompt' | 'asset'; id: string; name: string } | null>(null);

  // ── 重命名状态 ──
  const [renameItemOpen, setRenameItemOpen] = useState(false);
  const [renameItemName, setRenameItemName] = useState('');
  const [renameItemTarget, setRenameItemTarget] = useState<{ type: 'prompt' | 'asset'; id: string; name: string } | null>(null);

  // ── 剧本编辑器状态（数据驱动：episodes 单一事实源） ──
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false);
  const [scriptEditorEpisodes, setScriptEditorEpisodes] = useState<Episode[]>([]);
  const [scriptEditorActiveId, setScriptEditorActiveId] = useState('');
  const [scriptEditorTitle, setScriptEditorTitle] = useState('');
  const [scriptEditorAssetId, setScriptEditorAssetId] = useState<string | null>(null);
  const [scriptNamePromptOpen, setScriptNamePromptOpen] = useState(false);
  const [scriptNameInput, setScriptNameInput] = useState('');
  // 章节检测扫描进度
  const [scanningProgress, setScanningProgress] = useState(-1);
  const [scanningMessage, setScanningMessage] = useState('');

  // 上传队列（复用独立上传组件）
  const uploadQueueRef = useRef<UploadQueue | null>(null);
  if (!uploadQueueRef.current) {
    uploadQueueRef.current = new UploadQueue({ concurrency: 5, maxRetries: 2 });
  }
  const { uploadFiles } = useAssetUploadQueue(uploadQueueRef.current);
  const cloningPromptIds = useRef<Set<string>>(new Set());

  // ===== 我的提示词：登录后自动拉取（对齐主页 use-asset-library；走共享缓存 TTL，30s 内不重复请求） =====
  useEffect(() => {
    if (isAuthenticated) {
      void refreshPrompts(false);
    }
  }, [isAuthenticated, refreshPrompts]);

  // ===== 公共提示词：数据驱动加载（分组/来源/分页/分类/搜索 变化时自动触发） =====

  const loadPublic = useCallback(async (opts?: { page?: number; category?: string | null; keyword?: string }) => {
    setLoadingPublic(true);
    setPublicError(null);
    try {
      const page = opts?.page ?? publicPage;
      const category = opts?.category !== undefined ? opts.category : promptCategory;
      const keyword = opts?.keyword !== undefined ? opts.keyword : search.trim();
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(PUBLIC_PAGE_SIZE));
      if (category && category !== 'all' && PROMPT_CATEGORY_KEYS.includes(category as PromptCategory)) {
        params.set('category', category);
      }
      if (keyword) params.set('keyword', keyword);
      const res = await apiFetch<{ items: PublicPromptItem[]; total: number }>(`/public/prompts?${params.toString()}`);
      setPublicItems(res.items ?? []);
      setPublicTotal(res.total ?? 0);
    } catch (err) {
      console.error('[canvas-assets] load public prompts failed', err);
      setPublicItems([]);
      setPublicTotal(0);
      setPublicError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPublic(false);
    }
  }, [publicPage, promptCategory, search]);

  // 切到「公共」、翻页、分类、搜索 → 自动加载（搜索带防抖；首次进入立即加载）
  useEffect(() => {
    if (activeGroup !== 'prompt' || promptSource !== 'public') {
      setPublicViewItem(null);
      return;
    }
    const delay = search.trim() ? SEARCH_DEBOUNCE_MS : 0;
    const timer = setTimeout(() => { void loadPublic(); }, delay);
    return () => clearTimeout(timer);
  }, [activeGroup, promptSource, publicPage, promptCategory, search, loadPublic]);

  // ===== 派生数据（数据驱动渲染输入） =====

  /** 我的提示词（前端分类/搜索过滤） */
  const filteredMinePrompts = useMemo(() => {
    let result = Array.isArray(prompts) ? prompts : [];
    if (promptCategory && promptCategory !== 'all' && PROMPT_CATEGORY_KEYS.includes(promptCategory as PromptCategory)) {
      result = result.filter((p) => (promptCategory === 'other' ? OTHER_CATEGORY_SET.has(p.category) : p.category === promptCategory));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q) || p.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [prompts, promptCategory, search]);

  /** 公共提示词 → 统一 Prompt 形状（复用 PromptCard 渲染；逐字段容错） */
  const publicPromptItems = useMemo<Prompt[]>(() => {
    return publicItems.map((item) => {
      const images = Array.isArray(item?.images) ? item.images : [];
      const tags = Array.isArray(item?.tags) ? item.tags : [];
      return {
        id: `pub-${item?.id ?? ''}`,
        ownerId: '',
        title: getLocalizedTitle(item, 'zh-CN'),
        content: item?.content ?? '',
        category: (PROMPT_CATEGORY_KEYS.includes(item?.category as PromptCategory) ? item.category : 'other') as PromptCategory,
        tags,
        generationMode: 'txt2img',
        imageKeys: images.map((img) => img?.storageKey).filter((k): k is string => !!k),
        favorite: false,
        folderId: null,
        source: 'public',
        createdAt: item?.createdAt ?? '',
        updatedAt: item?.updatedAt ?? '',
      };
    });
  }, [publicItems]);

  /** 素材（按类型/搜索过滤；排除剧本、plan、实体） */
  const filteredAssets = useMemo(() => {
    let result = (Array.isArray(assets) ? assets : []).filter(
      (a) => (a.kind as string) !== 'script' && (a.kind as string) !== 'zeroexo-entity' && (a.kind as string) !== 'plan',
    );
    if (materialKind !== 'all') {
      result = result.filter((a) => a.kind === materialKind);
    }
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((a) => a.title.toLowerCase().includes(q));
    return result;
  }, [assets, materialKind, search]);

  /** 剧本（素材中 kind=script） */
  const scripts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (Array.isArray(assets) ? assets : [])
      .filter((a) => (a.kind as string) === 'script')
      .filter((a) => (q ? a.title.toLowerCase().includes(q) : true));
  }, [assets, search]);

  // ===== 操作 Actions（数据驱动：事件 → action → 状态更新） =====

  /** 切分组：重置派生筛选状态 */
  const changeGroup = useCallback((group: DrawerGroup) => {
    setActiveGroup(group);
    setSearch('');
    setPromptCategory(null);
  }, []);

  /** 切提示词来源（我的/公共）：切公共立即加载第 1 页全部分类 */
  const changePromptSource = useCallback((source: PromptSource) => {
    setPromptSource(source);
    setPromptCategory(null);
    setPublicPage(1);
    setPublicViewItem(null);
    if (source === 'public') {
      void loadPublic({ page: 1, category: null, keyword: search.trim() });
    }
  }, [loadPublic, search]);

  /** 素材上传（复用独立上传队列） */
  const handleUpload = useCallback(async (files: FileList) => {
    if (files.length === 0) return;
    try {
      const inputs = await uploadFiles(Array.from(files));
      if (inputs.length === 0) {
        antdMessage.warning(t('asset.uploadFailedAll'));
        return;
      }
      const created = await storeAddAssets(inputs.map((i) => ({ ...i })));
      for (const a of created) onAssetCreated(a.id);
      await refreshAssets();
      setActiveGroup('material');
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('asset.uploadFailed'));
    }
  }, [uploadFiles, refreshAssets, antdMessage, t]);

  /** 删除提示词/素材 */
  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.type === 'prompt') {
        await deletePrompt(confirmDelete.id);
        await refreshPrompts(true);
      } else {
        await removeAssets([confirmDelete.id]);
        await refreshAssets();
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.saveFailed'));
    }
    setConfirmDelete(null);
  }, [confirmDelete, refreshPrompts, refreshAssets, removeAssets, antdMessage, t]);

  /** 重命名（素材 / 我的提示词） */
  const handleRenameItem = useCallback(async () => {
    if (!renameItemTarget || !renameItemName.trim()) return;
    try {
      let finalName = renameItemName.trim();
      if (renameItemTarget.type === 'asset' && finalName.includes('.')) {
        const lastDot = finalName.lastIndexOf('.');
        if (lastDot > 0) finalName = finalName.substring(0, lastDot);
      }
      if (renameItemTarget.type === 'prompt') {
        await updatePrompt(renameItemTarget.id, { title: finalName });
        await refreshPrompts(true);
      } else {
        await updateAsset(renameItemTarget.id, { title: finalName });
        await refreshAssets();
      }
      setRenameItemOpen(false);
      setRenameItemName('');
      setRenameItemTarget(null);
      antdMessage.success(t('assetLibrary.saveSuccess', { defaultValue: '保存成功' }));
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.saveFailed', { defaultValue: '保存失败' }));
    }
  }, [renameItemTarget, renameItemName, refreshPrompts, refreshAssets, updateAsset, antdMessage, t]);

  /** 下载（素材封面 / 提示词附图；私有资源统一经 fetch+blob 带鉴权） */
  const handleDownloadItem = useCallback(async (item: { type: 'prompt' | 'asset'; data: any }) => {
    const download = async (url: string, filename: string): Promise<void> => {
      const token = getToken();
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) return;
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    };
    try {
      if (item.type === 'asset') {
        const d = item.data.data;
        const cover = d.kind === 'image' ? d.dataUrl : d.kind === 'video' ? d.url : undefined;
        const url = getResourceUrl(d.storageKey, 'full') || cover;
        if (url) await download(url, item.data.title);
      } else if (item.type === 'prompt') {
        const promptData = item.data as Prompt;
        if (promptData.imageKeys.length > 0) {
          const url = getResourceUrl(promptData.imageKeys[0], 'full');
          if (url) await download(url, promptData.title);
        }
      }
    } catch { /* ignore */ }
  }, []);

  /** 私有提示词克隆副本 */
  const handleCloneMine = useCallback(async (prompt: Prompt) => {
    if (cloningPromptIds.current.has(prompt.id)) return;
    cloningPromptIds.current.add(prompt.id);
    try {
      const clone = await createPrompt({
        title: `${prompt.title} (${t('assetLibrary.copySuffix')})`,
        content: prompt.content,
        category: prompt.category,
        tags: prompt.tags ?? [],
        imageKeys: prompt.imageKeys ?? [],
      });
      await setPromptImages(clone.id, (prompt.imageKeys ?? []).map((key, idx) => ({ storageKey: key, role: 'reference' as const, sortOrder: idx }))).catch(() => {});
      notifyPromptCopied(antdMessage, clone.id);
    } catch {
      antdMessage.error(t('assetLibrary.copyFailed'));
    } finally {
      cloningPromptIds.current.delete(prompt.id);
    }
  }, [createPrompt, antdMessage, t]);

  /** 公共提示词收藏副本（复制到「我的」，成功后切回我的来源） */
  const handleClonePublic = useCallback(async (prompt: Prompt) => {
    if (cloningPromptIds.current.has(prompt.id)) return;
    cloningPromptIds.current.add(prompt.id);
    try {
      const clone = await createPrompt({
        title: `${prompt.title} (${t('assetLibrary.copySuffix')})`,
        content: prompt.content,
        category: prompt.category,
        tags: prompt.tags ?? [],
        imageKeys: prompt.imageKeys ?? [],
        source: 'public-import',
      });
      await setPromptImages(clone.id, (prompt.imageKeys ?? []).map((key, idx) => ({ storageKey: key, role: 'reference' as const, sortOrder: idx }))).catch(() => {});
      notifyPromptCopied(antdMessage, clone.id);
      setPromptSource('mine');
      setPromptCategory(null);
      void refreshSharedPrompts(true);
    } catch {
      antdMessage.error(t('assetLibrary.copyFailed'));
    } finally {
      cloningPromptIds.current.delete(prompt.id);
    }
  }, [createPrompt, antdMessage, t]);

  /** 打开条目（按分组/来源路由到对应详情） */
  const openItem = useCallback((item: { type: 'asset' | 'prompt'; data: any }) => {
    if (item.type === 'prompt') {
      if (promptSource === 'public') {
        const raw = publicItems.find((x) => `pub-${x.id}` === item.data.id);
        setPublicViewItem(raw ?? null);
      } else {
        setPromptViewId(item.data.id);
      }
    } else if (item.type === 'asset') {
      setAssetDetail(item.data);
    }
  }, [promptSource, publicItems]);

  /** 发送到画布 */
  const sendToCanvas = useCallback((item: SendToCanvasItem) => {
    onSendToCanvas?.(item);
  }, [onSendToCanvas]);

  /** 新建剧本入口（弹名称确认框） */
  const handleNewScript = useCallback(() => {
    setScriptNameInput('');
    setScriptNamePromptOpen(true);
  }, []);

  /** 新剧本默认名（避免连建重名） */
  const scriptNameSuggestion = useMemo(() => {
    const base = t('assetLibrary.newScriptName', { defaultValue: '新剧本' });
    const names = (Array.isArray(assets) ? assets : []).filter((a) => (a.kind as string) === 'script').map((a) => a.title);
    let max = 0;
    const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d*)$`);
    for (const name of names) {
      const m = re.exec(name.trim());
      if (!m) continue;
      const n = m[1] ? Number(m[1]) : 1;
      if (Number.isFinite(n) && n > max) max = n;
    }
    const next = max + 1;
    return next === 1 ? base : `${base}${next}`;
  }, [assets, t]);

  /** 确认新建剧本（落库 + 打开编辑器） */
  const handleConfirmNewScript = useCallback(async () => {
    const name = scriptNameInput.trim() || scriptNameSuggestion;
    setScriptNamePromptOpen(false);
    const now = Date.now();
    const newEp: Episode = { id: `ep-${now}`, number: 1, title: t('assetLibrary.defaultEpisodeTitle', { defaultValue: '第1集' }), content: '' };
    const episodes = [newEp];
    try {
      const result = await apiPost<{ id: string; kind: string; filename: string; version: number; lastSyncedAt: string; createdAt: string }>(
        '/resources/scripts',
        { filename: name, text: JSON.stringify({ episodes }), tags: [] },
      );
      if (result) {
        const localAsset = {
          id: result.id,
          title: name,
          kind: 'script' as const,
          bytes: 0,
          mimeType: 'application/json',
          tags: [] as string[],
          createdAt: result.createdAt ?? new Date().toISOString(),
          data: { kind: 'script' as const, content: JSON.stringify({ episodes }), storageKey: '' },
          folderId: null,
          cloudId: result.id,
          version: result.version ?? 1,
          lastSyncedAt: result.lastSyncedAt ?? new Date().toISOString(),
        };
        await upsertAsset(localAsset as any);
        await refreshAssets();
        setScriptEditorEpisodes(episodes);
        setScriptEditorActiveId(newEp.id);
        setScriptEditorAssetId(result.id);
        setScriptEditorTitle(name);
        setScriptEditorOpen(true);
        setActiveGroup('script');
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.scriptCreateFailed', { defaultValue: '创建剧本失败' }));
    }
  }, [scriptNameInput, scriptNameSuggestion, antdMessage, refreshAssets, t]);

  /** 打开剧本资产到编辑器 */
  const handleOpenScriptAsset = useCallback((asset: any) => {
    try {
      const scriptData = asset.data as { kind: 'script'; content: string };
      const parsed = JSON.parse(scriptData.content ?? '');
      const episodes: Episode[] = Array.isArray(parsed) ? parsed : (parsed?.episodes ?? []);
      const activeId = episodes[0]?.id ?? '';
      setScriptEditorEpisodes(episodes);
      setScriptEditorActiveId(activeId);
      setScriptEditorAssetId(asset.id);
      setScriptEditorTitle(asset.title);
      setScriptEditorOpen(true);
    } catch {
      const scriptData = asset.data as { kind: 'script'; content: string } | null;
      const fallbackEpisode: Episode = { id: `ep-${Date.now()}`, number: 0, title: asset.title, content: scriptData?.content ?? '' };
      setScriptEditorEpisodes([fallbackEpisode]);
      setScriptEditorActiveId(fallbackEpisode.id);
      setScriptEditorAssetId(asset.id);
      setScriptEditorTitle(asset.title);
      setScriptEditorOpen(true);
    }
  }, []);

  // 编辑器打开期间防抖持久化（数据驱动：episodes 变化 → 自动保存）
  const currentScriptAssetRef = useRef<any>(null);
  currentScriptAssetRef.current = (Array.isArray(assets) ? assets : []).find((a) => a.id === scriptEditorAssetId) ?? null;
  useEffect(() => {
    if (!scriptEditorOpen || !scriptEditorAssetId) return;
    if (scriptEditorEpisodes.length === 0) return;
    const timer = setTimeout(async () => {
      const asset = currentScriptAssetRef.current;
      if (!asset) return;
      const text = JSON.stringify({ episodes: scriptEditorEpisodes });
      await updateAsset(scriptEditorAssetId, {
        title: scriptEditorTitle || asset.title,
        data: { ...asset.data, content: text } as any,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [scriptEditorEpisodes, scriptEditorTitle, scriptEditorOpen, scriptEditorAssetId, updateAsset]);

  /** 关闭剧本编辑器（保存后关） */
  const handleCloseScriptEditor = useCallback(async () => {
    const assetId = scriptEditorAssetId;
    const episodes = scriptEditorEpisodes;
    const title = scriptEditorTitle;
    const asset = currentScriptAssetRef.current;
    setScriptEditorOpen(false);
    if (assetId && episodes.length > 0 && asset) {
      await updateAsset(assetId, {
        title: title || asset.title,
        data: { ...asset.data, content: JSON.stringify({ episodes }) } as any,
      });
    }
  }, [scriptEditorAssetId, scriptEditorEpisodes, scriptEditorTitle, updateAsset]);

  /** 剧本上传（章节检测管线；失败降级为文本资产） */
  const handleUploadScript = useCallback((files: FileList) => {
    const fileArray = Array.from(files);
    const totalFiles = fileArray.length;
    setScanningProgress(0);
    let completedCount = 0;
    void Promise.all(fileArray.map(async (file) => {
      try {
        const result = await chapterDetectPipeline(file, {
          onProgress: (pct, msg) => {
            const overall = Math.round(((completedCount + pct / 100) / totalFiles) * 100);
            setScanningProgress(overall);
            setScanningMessage(msg);
          },
        });
        if (result) {
          antdMessage.success(`${t('assetLibrary.scriptCreated', { defaultValue: '已创建剧本' })}：${result.filename}`);
        }
      } catch {
        try {
          const textContent = await file.text();
          await storeAddAssets([{
            title: file.name.replace(/\.[^/.]+$/, ''),
            kind: 'text',
            data: { kind: 'text', content: textContent },
            bytes: textContent.length,
            mimeType: 'text/plain',
          }]);
          antdMessage.info(`${t('assetLibrary.scriptNoChapterSaved', { defaultValue: '未检测到章节，已存为文本' })}：${file.name}`);
        } catch { /* ignore */ }
      } finally {
        completedCount++;
      }
    })).then(() => {
      void refreshAssets();
      setScanningProgress(-1);
      setScanningMessage('');
    });
  }, [antdMessage, refreshAssets, t]);

  // ===== 返回（数据驱动：组件只订阅状态 + 派发 action） =====

  return {
    // 视图
    activeGroup,
    search,
    changeGroup,
    setSearch,

    // 素材
    assets: filteredAssets,
    allAssetsCount: assets.length,
    loadingAssets,
    materialKind,
    setMaterialKind,
    handleUpload,

    // 我的提示词
    prompts: filteredMinePrompts,
    promptsCount: prompts.length,
    loadingPrompts,
    promptSource,
    promptCategory,
    setPromptCategory,
    changePromptSource,
    handleCloneMine,
    openItem,
    promptViewId,
    setPromptViewId,

    // 公共提示词
    publicPrompts: publicPromptItems,
    publicTotal,
    publicPage,
    setPublicPage,
    loadingPublic,
    publicError,
    loadPublic,
    handleClonePublic,
    publicViewItem,
    setPublicViewItem,

    // 剧本
    scripts,
    handleUploadScript,
    scriptEditorOpen,
    scriptEditorEpisodes,
    scriptEditorActiveId,
    scriptEditorTitle,
    scriptEditorAssetId,
    scriptNamePromptOpen,
    scriptNameInput,
    setScriptNameInput,
    scriptNameSuggestion,
    scanningProgress,
    scanningMessage,
    handleNewScript,
    handleConfirmNewScript,
    handleOpenScriptAsset,
    handleCloseScriptEditor,
    setScriptEditorEpisodes,
    setScriptEditorActiveId,
    setScriptNamePromptOpen,

    // 通用
    confirmDelete,
    setConfirmDelete,
    handleConfirmDelete,
    renameItemOpen,
    renameItemName,
    setRenameItemName,
    renameItemTarget,
    setRenameItemTarget,
    setRenameItemOpen,
    handleRenameItem,
    handleDownloadItem,
    assetDetail,
    setAssetDetail,
    sendToCanvas,
    refreshAssets,
    refreshPrompts,
    removeAssets,
    updateAsset,
    uploadQueueRef,
  };
}

export type CanvasAssetsPanelStore = ReturnType<typeof useCanvasAssetsPanel>;
