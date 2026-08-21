// TODO(拆分): 该文件超过 1000 行，计划按「状态层/交互层/渲染层」拆分，见 DESIGN.md
/**
 * use-asset-library - 资产库业务逻辑 Hook
 *
 * 从 asset-library-page.tsx 抽出所有状态定义、数据加载、筛选逻辑、操作回调。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App as AntdApp } from 'antd';
import { Package, FileText, BookOpen } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { useAssets } from '@/features/asset-picker/use-assets.js';
import { addAssets as storeAddAssets, upsertAsset } from '@/features/asset-picker/asset-store.js';
import { onAssetCreated } from '@/services/sync/sync-service.js';
import { UploadQueue } from '@zeroexo/plugin-upload-queue';
import { useAssetUploadQueue } from '@/features/upload-queue/use-upload-queue.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { deleteSubject, updateSubject, type Subject } from './subjects-api.js';
import { deletePrompt, updatePrompt, createPrompt, type Prompt } from './prompts-api.js';
import { useSharedSubjects, useSharedPrompts, updatePromptFavoriteLocal, updateSubjectFavoriteLocal } from './shared-data-store.js';
import { notifyPromptCopied } from './prompt-copy-feedback.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { apiPost, getToken } from '@/services/api-client.js';
import { chapterDetectPipeline } from '@/shared/utils/chapter-detect-pipeline.js';
import type { Episode } from '@/features/canvas-nodes/storyboard/script-types.js';
import type { AssetCategory, ViewMode } from '@/shared/components/index.js';
import type {
  ContentType,
  SubjectTypeFilter,
  AssetKindFilter,
  PageItem,
  ConfirmDeleteState,
  RenameItemTarget,
  SendToCanvasItem,
} from './types.js';

// ===== Hook 返回类型 =====

/** 剧本上传（含章节检测）回调 */
export type UploadScriptHandler = (files: FileList) => void;

export interface UseAssetLibraryReturn {
  // 基础
  isAuthenticated: boolean;
  isMobile: boolean;
  theme: ReturnType<typeof useTheme>['theme'];

  // 数据
  subjects: Subject[];
  prompts: Prompt[];
  assets: ReturnType<typeof useAssets>['assets'];
  loadingSubjects: boolean;
  loadingPrompts: boolean;
  loadingAssets: boolean;
  refreshSubjects: () => Promise<void>;
  refreshPrompts: () => Promise<void>;
  refreshAssets: () => Promise<void>;

  // 分类
  categories: AssetCategory[];
  activeGroup: string | null;
  activeChild: string | null;
  contentType: ContentType;

  // 搜索
  search: string;

  // 视图
  viewMode: ViewMode;
  multiSelectEnabled: boolean;
  selectedIds: Set<string>;
  page: number;
  PAGE_SIZE: number;

  // 筛选后数据
  allItems: PageItem[];
  pageItems: PageItem[];

  // 拖拽上传
  dragOver: boolean;
  dragCounterRef: React.MutableRefObject<number>;

  // 弹窗状态
  confirmDelete: ConfirmDeleteState | null;
  renameItemOpen: boolean;
  renameItemName: string;
  renameItemTarget: RenameItemTarget | null;
  scriptNamePromptOpen: boolean;
  scriptNameInput: string;
  /** 新剧本建议默认名(新剧本/新剧本2...递增) */
  scriptNameSuggestion: string;
  scriptEditorOpen: boolean;
  scriptEditorEpisodes: Episode[];
  scriptEditorActiveId: string;
  scriptEditorTitle: string;
  scriptEditorAssetId: string | null;
  scriptImportOpen: boolean;
  scanningProgress: number;
  scanningMessage: string;
  promptViewId: string | null;
  assetDetail: any;
  subjectCreateOpen: boolean;
  subjectCreateId: string | undefined;
  promptCreateOpen: boolean;
  promptCreateId: string | undefined;

  // 操作回调
  handleUpload: (files: FileList) => Promise<void>;
  handleUploadScript: UploadScriptHandler;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleNewScript: () => void;
  handleConfirmNewScript: () => Promise<void>;
  handleOpenScriptAsset: (asset: any) => void;
  handleScriptImportComplete: (scriptState: any) => void;
  handleCloseScriptEditor: () => void;
  handleConfirmDelete: () => Promise<void>;
  handleToggleSelect: (id: string) => void;
  handleToggleSelectAll: () => void;
  handleToggleFavorite: (item: { type: 'subject' | 'prompt' | 'asset'; id: string; data: any }) => Promise<void>;
  handleClonePrompt: (prompt: Prompt) => Promise<void>;
  handleBatchDelete: () => void;
  handleSendToCanvas: (item: SendToCanvasItem) => void;
  handleDownloadItem: (item: { type: 'subject' | 'prompt' | 'asset'; data: any }) => void;
  handleRenameItem: () => Promise<void>;
  handleOpenItem: (item: PageItem) => void;

  // 状态设置
  setActiveGroup: (group: string | null) => void;
  setActiveChild: (child: string | null) => void;
  setSearch: (value: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setMultiSelectEnabled: (v: boolean) => void;
  setPage: (page: number) => void;
  setConfirmDelete: (state: ConfirmDeleteState | null) => void;
  setRenameItemOpen: (open: boolean) => void;
  setRenameItemName: (name: string) => void;
  setRenameItemTarget: (target: RenameItemTarget | null) => void;
  setScriptNamePromptOpen: (open: boolean) => void;
  setScriptNameInput: (name: string) => void;
  setScriptEditorOpen: (open: boolean) => void;
  setScriptEditorEpisodes: (eps: Episode[]) => void;
  setScriptEditorActiveId: (id: string) => void;
  setScriptEditorTitle: (title: string) => void;
  setScriptImportOpen: (open: boolean) => void;
  setScanningProgress: (p: number) => void;
  setScanningMessage: (msg: string) => void;
  setPromptViewId: (id: string | null) => void;
  setAssetDetail: (detail: any) => void;
  setSubjectCreateOpen: (open: boolean) => void;
  setSubjectCreateId: (id: string | undefined) => void;
  setPromptCreateOpen: (open: boolean) => void;
  setPromptCreateId: (id: string | undefined) => void;
}

// ===== Props =====

export interface UseAssetLibraryProps {
  defaultAssetKind?: AssetKindFilter;
  defaultGroup?: string;
  defaultChild?: string;
  onSendToCanvas?: (item: SendToCanvasItem) => void;
}

// ===== 辅助 =====

/** 生成新剧本默认名 */
function nextScriptName(existingTitles: string[], baseName: string): string {
  let max = 0;
  for (const title of existingTitles) {
    const pattern = new RegExp(`^${escapeRegex(baseName)}(\\d*)$`);
    const m = pattern.exec(title.trim());
    if (!m) continue;
    const n = m[1] ? Number(m[1]) : 1;
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = max + 1;
  return next === 1 ? baseName : `${baseName}${next}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ===== Hook =====

export function useAssetLibrary(props: UseAssetLibraryProps): UseAssetLibraryReturn {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const { message: antdMessage, modal } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();

  // ── 数据状态（subjects/prompts 来自共享缓存层，多实例共用，减少重复 API 请求） ──
  const { subjects, loading: loadingSubjects, refreshSubjects } = useSharedSubjects();
  const { prompts, loading: loadingPrompts, refreshPrompts } = useSharedPrompts();
  const [prevDefaultAssetKind, setPrevDefaultAssetKind] = useState<AssetKindFilter | undefined>(props.defaultAssetKind);

  const [search, setSearch] = useState('');

  // ── 弹窗状态 ──
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState | null>(null);
  const [subjectCreateOpen, setSubjectCreateOpen] = useState(false);
  const [subjectCreateId, setSubjectCreateId] = useState<string | undefined>(undefined);
  const [promptCreateOpen, setPromptCreateOpen] = useState(false);
  const [promptCreateId, setPromptCreateId] = useState<string | undefined>(undefined);
  const [promptViewId, setPromptViewId] = useState<string | null>(null);

  // ── 分页 ──
  const PAGE_SIZE = 24;
  const [page, setPage] = useState(1);

  // ── 视图 ──
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [activeGroup, setActiveGroupState] = useState<string | null>(props.defaultGroup ?? 'material');
  const [activeChild, setActiveChild] = useState<string | null>(props.defaultChild ?? null);

  // 外部 defaultAssetKind 变化时同步（映射到分组 + 子分类，由派生筛选消费）
  if (props.defaultAssetKind !== prevDefaultAssetKind) {
    setPrevDefaultAssetKind(props.defaultAssetKind);
    if (props.defaultAssetKind) {
      setActiveGroupState('material');
      setActiveChild(props.defaultAssetKind === 'all' ? null : props.defaultAssetKind);
    }
  }

  // 切换大分类时重置子分类，避免旧子分类残留到新分组导致列表为空
  const setActiveGroup = useCallback((group: string | null) => {
    setActiveGroupState(group);
    setActiveChild(null);
  }, []);

  // ── 多选 ──
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── 重命名 ──
  const [renameItemOpen, setRenameItemOpen] = useState(false);
  const [renameItemName, setRenameItemName] = useState('');
  const [renameItemTarget, setRenameItemTarget] = useState<RenameItemTarget | null>(null);

  // ── 资源详情 ──
  const [assetDetail, setAssetDetail] = useState<any>(null);

  // ── 资产数据 ──
  const { assets, loading: loadingAssets, refresh: refreshAssets, removeAssets, updateAsset } = useAssets();
  const uploadQueueRef = useRef<UploadQueue | null>(null);
  const cloningPromptIds = useRef<Set<string>>(new Set());
  if (!uploadQueueRef.current) {
    uploadQueueRef.current = new UploadQueue({ concurrency: 5, maxRetries: 2 });
  }
  const { uploadFiles } = useAssetUploadQueue(uploadQueueRef.current);

  // ── 剧本编辑器状态 ──
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false);
  const [scriptEditorEpisodes, setScriptEditorEpisodes] = useState<Episode[]>([]);
  const [scriptEditorActiveId, setScriptEditorActiveId] = useState('');
  const [scriptEditorAssetId, setScriptEditorAssetId] = useState<string | null>(null);
  const [scriptEditorTitle, setScriptEditorTitle] = useState('');
  const [scriptImportOpen, setScriptImportOpen] = useState(false);

  // ── 章节检测扫描进度 ──
  const [scanningProgress, setScanningProgress] = useState(-1);
  const [scanningMessage, setScanningMessage] = useState('');

  // ── 分类定义 ──
  const categories: AssetCategory[] = useMemo(() => [
    {
      group: 'material',
      label: t('assetLibrary.filterMaterial'),
      icon: <Package size={16} />,
      color: '#f59e0b',
      count: assets.filter((a) => (a.kind as string) !== 'script' && (a.kind as string) !== 'zeroexo-entity').length,
      children: [
        { key: 'favorite', label: t('assetLibrary.filterFavorite'), count: assets.filter((a) => a.favorite && (a.kind as string) !== 'script' && (a.kind as string) !== 'zeroexo-entity').length },
        { key: 'all', label: t('assetLibrary.filterAll'), count: assets.filter((a) => (a.kind as string) !== 'script' && (a.kind as string) !== 'zeroexo-entity').length },
        { key: 'image', label: t('assetLibrary.filterImage'), count: assets.filter((a) => a.kind === 'image').length },
        { key: 'video', label: t('assetLibrary.filterVideo'), count: assets.filter((a) => a.kind === 'video').length },
        { key: 'audio', label: t('assetLibrary.filterAudio'), count: assets.filter((a) => a.kind === 'audio').length },
        { key: 'text', label: t('assetLibrary.filterText'), count: assets.filter((a) => (a.kind as string) === 'text' || (a.kind as string) === 'zeroexo-text').length },
      ],
    },
    // Plan#29 V3: 「主体」分组已移除(主体升维为画布统筹节点,资产库不再存主体)
    {
      group: 'prompt',
      label: t('assetLibrary.filterPrompt'),
      icon: <FileText size={16} />,
      color: '#8b5cf6',
      count: prompts.length,
      children: [
        { key: 'favorite', label: t('assetLibrary.filterFavorite'), count: prompts.filter((p) => p.favorite).length },
        { key: 'all', label: t('assetLibrary.filterAll'), count: prompts.length },
        { key: 'role', label: t('assetLibrary.filterRole'), count: prompts.filter((p) => p.category === 'role').length },
        { key: 'scene', label: t('assetLibrary.filterScene'), count: prompts.filter((p) => p.category === 'scene').length },
        { key: 'prop', label: t('assetLibrary.filterProp'), count: prompts.filter((p) => p.category === 'prop').length },
        { key: 'style', label: t('assetLibrary.filterStyle'), count: prompts.filter((p) => p.category === 'style').length },
        { key: 'shot', label: t('assetLibrary.filterShot'), count: prompts.filter((p) => p.category === 'shot').length },
        { key: 'other', label: t('assetLibrary.filterOther'), count: prompts.filter((p) => p.category === 'other').length },
      ],
    },
    {
      group: 'script',
      label: t('assetLibrary.filterScript'),
      icon: <BookOpen size={16} />,
      color: '#ec4899',
      count: assets.filter((a) => (a.kind as string) === 'script').length,
      children: [],
    },
  ], [subjects, prompts, assets, t]);

  // ── 分类筛选逻辑（子分类值做合法性校验，非法残留值回退 all） ──
  const filteredByGroup = useMemo(() => {
    if (!activeGroup) {
      return { contentType: 'all' as ContentType, subjectType: 'all' as SubjectTypeFilter, assetKind: 'all' as AssetKindFilter };
    }
    switch (activeGroup) {
      case 'subject': {
        const validSubjects: SubjectTypeFilter[] = ['all', 'favorite', 'character', 'scene', 'prop'];
        const child = validSubjects.includes(activeChild as SubjectTypeFilter) ? (activeChild as SubjectTypeFilter) : 'all';
        return { contentType: 'subject' as ContentType, subjectType: child, assetKind: 'all' as AssetKindFilter };
      }
      case 'prompt':
        return { contentType: 'prompt' as ContentType, subjectType: 'all' as SubjectTypeFilter, assetKind: 'all' as AssetKindFilter };
      case 'material': {
        const validKinds: AssetKindFilter[] = ['all', 'favorite', 'image', 'video', 'audio', 'text'];
        const child = validKinds.includes(activeChild as AssetKindFilter) ? (activeChild as AssetKindFilter) : 'all';
        return { contentType: 'asset' as ContentType, subjectType: 'all' as SubjectTypeFilter, assetKind: child };
      }
      case 'script':
        return { contentType: 'script' as ContentType, subjectType: 'all' as SubjectTypeFilter, assetKind: 'all' as AssetKindFilter };
      default:
        return { contentType: 'all' as ContentType, subjectType: 'all' as SubjectTypeFilter, assetKind: 'all' as AssetKindFilter };
    }
  }, [activeGroup, activeChild]);

  // 筛选维度全部从 filteredByGroup 派生（不再用 effect 同步 state，切换分类单次渲染生效）
  const contentType = filteredByGroup.contentType;
  const subjectTypeFilter = filteredByGroup.subjectType;
  const assetKindFilter = filteredByGroup.assetKind;

  useEffect(() => {
    if (isAuthenticated) {
      // force=false：走共享缓存 TTL，30s 内重复挂载不发请求
      void refreshSubjects(false);
      void refreshPrompts(false);
    }
  }, [isAuthenticated, refreshSubjects, refreshPrompts]);

  // ── 数据筛选 ──
  const safeSubjects = Array.isArray(subjects) ? subjects : [];
  const safePrompts = Array.isArray(prompts) ? prompts : [];

  const filteredSubjects = useMemo(() => {
    let result = safeSubjects;
    if (subjectTypeFilter === 'favorite') {
      result = result.filter((s) => s.favorite);
    } else if (subjectTypeFilter !== 'all') {
      result = result.filter((s) => s.type === subjectTypeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [safeSubjects, subjectTypeFilter, search]);

  const filteredPrompts = useMemo(() => {
    let result = safePrompts;
    if (activeChild && activeChild !== 'all') {
      if (activeChild === 'favorite') {
        result = result.filter((p) => p.favorite);
      } else if (['role', 'scene', 'style', 'shot', 'other'].includes(activeChild)) {
        result = result.filter((p) => p.category === activeChild);
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q) ||
          p.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [safePrompts, activeChild, search]);

  const filteredAssets = useMemo(() => {
    let result = assets;
    if (activeGroup === 'material') {
      result = result.filter((a) => (a.kind as string) !== 'script' && (a.kind as string) !== 'zeroexo-entity');
    }
    if (assetKindFilter === 'favorite') {
      result = result.filter((a) => a.favorite);
    } else if (assetKindFilter !== 'all') {
      result = result.filter((a) => (a.kind as string) === assetKindFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((a) => a.title.toLowerCase().includes(q));
    }
    return result;
  }, [assets, assetKindFilter, search, activeGroup]);

  const showSubjects = filteredByGroup.contentType === 'all' || filteredByGroup.contentType === 'subject';
  const showPrompts = filteredByGroup.contentType === 'all' || filteredByGroup.contentType === 'prompt';
  const showAssets = filteredByGroup.contentType === 'all' || filteredByGroup.contentType === 'asset';
  const showScripts = filteredByGroup.contentType === 'script';

  const filteredScripts = useMemo(() => {
    return filteredAssets.filter((a) => (a.kind as string) === 'script');
  }, [filteredAssets]);

  const allItems = useMemo((): PageItem[] => {
    const items: PageItem[] = [];
    if (showSubjects) filteredSubjects.forEach((s) => items.push({ type: 'subject', data: s }));
    if (showPrompts) filteredPrompts.forEach((p) => items.push({ type: 'prompt', data: p }));
    if (showAssets) {
      filteredAssets
        .filter((a) => (a.kind as string) !== 'script')
        .forEach((a) => items.push({ type: 'asset', data: a }));
    }
    if (showScripts) {
      filteredScripts.forEach((a) => items.push({ type: 'asset', data: a }));
    }
    return items;
  }, [showSubjects, filteredSubjects, showPrompts, filteredPrompts, showAssets, filteredAssets, showScripts, filteredScripts]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return allItems.slice(start, start + PAGE_SIZE);
  }, [allItems, page]);

  // ── 操作回调 ──

  const handleUpload = useCallback(
    async (files: FileList): Promise<void> => {
      if (files.length === 0) return;
      try {
        const inputs = await uploadFiles(Array.from(files));
        const failedCount = Array.from(files).length - inputs.length;
        if (inputs.length === 0) {
          antdMessage.warning(t('asset.uploadFailedAll'));
          return;
        }
        const created = await storeAddAssets(inputs.map((i) => ({ ...i })));
        for (const a of created) {
          onAssetCreated(a.id);
        }
        await refreshAssets();
        setActiveGroup('material');
        if (failedCount > 0) {
          antdMessage.warning(t('asset.uploadPartial', { success: inputs.length, total: Array.from(files).length }));
        } else {
          antdMessage.success(t('asset.uploadComplete'));
        }
      } catch (err) {
        antdMessage.error(err instanceof Error ? err.message : t('asset.uploadFailed'));
      }
    },
    [uploadFiles, refreshAssets, antdMessage, t, setActiveGroup],
  );

  // ── 剧本上传（含章节检测） ──
  const handleUploadScript: UploadScriptHandler = useCallback(
    (files: FileList) => {
      const fileArray = Array.from(files);
      const totalFiles = fileArray.length;
      setScanningProgress(0);
      setScanningMessage(`${t('assetLibrary.scanningFile', { current: 1, total: totalFiles })}`);
      let completedCount = 0;
      void Promise.all(fileArray.map(async (file, idx) => {
        try {
          const result = await chapterDetectPipeline(file, {
            onProgress: (pct, msg) => {
              const overall = Math.round(((completedCount + pct / 100) / totalFiles) * 100);
              setScanningProgress(overall);
              setScanningMessage(`${t('assetLibrary.scanningFileDetail', { current: idx + 1, total: totalFiles, message: msg })}`);
            },
          });
          if (result) {
            antdMessage.success(`${t('assetLibrary.scriptCreated', { filename: result.filename })}`);
          }
        } catch (err) {
          try {
            const textContent = await file.text();
            await storeAddAssets([{
              title: file.name.replace(/\.[^/.]+$/, ''),
              kind: 'text',
              data: { kind: 'text', content: textContent },
              bytes: textContent.length,
              mimeType: 'text/plain',
            }]);
            antdMessage.info(`${t('assetLibrary.scriptNoChapterSaved', { name: file.name })}`);
          } catch {
            antdMessage.error(err instanceof Error ? err.message : `${t('assetLibrary.scriptProcessFailed', { name: file.name })}`);
          }
        } finally {
          completedCount++;
        }
      })).then(() => {
        refreshAssets();
        setScanningProgress(-1);
        setScanningMessage('');
      });
    },
    [antdMessage, refreshAssets, t],
  );

  // ── 拖拽上传 ──
  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types?.includes('Files')) {
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleUpload(e.dataTransfer.files);
    }
  }, [handleUpload]);

  // ── 剧本 ──
  const [scriptNamePromptOpen, setScriptNamePromptOpen] = useState(false);
  const [scriptNameInput, setScriptNameInput] = useState('');

  // 新剧本建议名:新剧本 / 新剧本2 / 新剧本3...(避免连建重名)
  const scriptNameSuggestion = useMemo(
    () => nextScriptName(assets.filter((a) => (a.kind as string) === 'script').map((a) => a.title), t('assetLibrary.newScriptName')),
    [assets, t],
  );

  const handleNewScript = useCallback(() => {
    setScriptNameInput('');
    setScriptNamePromptOpen(true);
  }, []);

  const handleConfirmNewScript = useCallback(async () => {
    const name = scriptNameInput.trim() || scriptNameSuggestion;
    setScriptNamePromptOpen(false);
    const now = Date.now();
    const newEp: Episode = {
      id: `ep-${now}`,
      number: 1,
      title: t('assetLibrary.defaultEpisodeTitle'),
      content: '',
    };
    const episodes = [newEp];
    const text = JSON.stringify({ episodes });
    try {
      const result = await apiPost<{ id: string; kind: string; filename: string; version: number; lastSyncedAt: string; createdAt: string }>(
        '/resources/scripts',
        { filename: name, text, tags: [] },
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
          data: { kind: 'script' as const, content: text, storageKey: '' },
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
    } catch {
      antdMessage.error(t('assetLibrary.scriptCreateFailed'));
    }
  }, [scriptNameInput, scriptNameSuggestion, antdMessage, refreshAssets, setActiveGroup, t]);

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
      const rawContent = scriptData?.content ?? '';
      const fallbackEpisode: Episode = { id: `ep-${Date.now()}`, number: 0, title: asset.title, content: rawContent };
      setScriptEditorEpisodes([fallbackEpisode]);
      setScriptEditorActiveId(fallbackEpisode.id);
      setScriptEditorAssetId(asset.id);
      setScriptEditorTitle(asset.title);
      setScriptEditorOpen(true);
    }
  }, []);

  const handleScriptImportComplete = useCallback((scriptState: any) => {
    setScriptImportOpen(false);
    if (!scriptState || !scriptState.versions.length) return;
    const newEpisodes = scriptState.versions[0]!.episodes;
    if (!newEpisodes.length) return;
    setScriptEditorEpisodes(newEpisodes);
    setScriptEditorActiveId(newEpisodes[0]!.id);
  }, []);

  const currentScriptAsset = useMemo(() => {
    if (!scriptEditorAssetId) return null;
    return assets.find(a => a.id === scriptEditorAssetId) || null;
  }, [assets, scriptEditorAssetId]);

  const currentScriptAssetRef = useRef(currentScriptAsset);
  currentScriptAssetRef.current = currentScriptAsset;

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

  const handleCloseScriptEditor = useCallback(() => {
    const assetId = scriptEditorAssetId;
    const episodes = scriptEditorEpisodes;
    const title = scriptEditorTitle;
    const asset = currentScriptAssetRef.current;
    setScriptEditorOpen(false);
    if (assetId && episodes.length > 0 && asset) {
      const text = JSON.stringify({ episodes });
      updateAsset(assetId, {
        title: title || asset.title,
        data: { ...asset.data, content: text } as any,
      });
    }
  }, [scriptEditorAssetId, scriptEditorEpisodes, scriptEditorTitle, updateAsset]);

  // ── 删除 ──
  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.type === 'subject') {
        await deleteSubject(confirmDelete.id);
        await refreshSubjects();
      } else if (confirmDelete.type === 'prompt') {
        await deletePrompt(confirmDelete.id);
        await refreshPrompts();
      } else if (confirmDelete.type === 'asset') {
        await removeAssets([confirmDelete.id]);
        await refreshAssets();
      }
      antdMessage.success(t('assetLibrary.saveSuccess'));
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.saveFailed'));
    }
    setConfirmDelete(null);
  }, [confirmDelete, refreshSubjects, refreshPrompts, refreshAssets, removeAssets, antdMessage, t]);

  // ── 多选 ──
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === allItems.length) {
        return new Set();
      }
      return new Set(allItems.map((item) => item.data.id));
    });
  }, [allItems]);

  // ── 收藏 ──
  const handleToggleFavorite = useCallback(async (item: { type: 'subject' | 'prompt' | 'asset'; id: string; data: any }) => {
    if (!isAuthenticated) {
      antdMessage.warning(t('assetLibrary.loginRequired'));
      if (typeof window !== 'undefined') window.location.hash = '#/auth';
      return;
    }
    try {
      const currentFavorite = item.data.favorite ?? false;
      const newFavState = !currentFavorite;
      if (item.type === 'prompt') {
        // 乐观更新本地数据，避免刷新后列表重新排列
        updatePromptFavoriteLocal(item.id, newFavState);
        await updatePrompt(item.id, { favorite: newFavState });
      } else if (item.type === 'subject') {
        updateSubjectFavoriteLocal(item.id, newFavState);
        await updateSubject(item.id, { favorite: newFavState });
      } else if (item.type === 'asset') {
        // 素材暂不支持乐观更新，走原有刷新逻辑
        await updateAsset(item.id, { favorite: newFavState });
        await refreshAssets();
      }
    } catch (err) {
      console.error('Toggle favorite failed', err);
    }
  }, [refreshAssets]);

  // ── 克隆提示词 ──
  const handleClonePrompt = useCallback(async (prompt: Prompt) => {
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
      notifyPromptCopied(antdMessage, clone.id);
    } catch {
      antdMessage.error(t('assetLibrary.copyFailed'));
    } finally {
      cloningPromptIds.current.delete(prompt.id);
    }
  }, [createPrompt, antdMessage, t]);

  // ── 批量删除 ──
  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    modal.confirm({
      title: t('assetLibrary.batchDeleteTitle'),
      content: t('assetLibrary.batchDeleteConfirm', { count: selectedIds.size }),
      okText: t('assetLibrary.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        try {
          const subjectIds = allItems.filter((item) => item.type === 'subject' && selectedIds.has(item.data.id)).map((item) => item.data.id);
          const promptIds = allItems.filter((item) => item.type === 'prompt' && selectedIds.has(item.data.id)).map((item) => item.data.id);
          const assetIds = allItems.filter((item) => item.type === 'asset' && selectedIds.has(item.data.id)).map((item) => item.data.id);
          await Promise.all([
            ...subjectIds.map((id) => deleteSubject(id)),
            ...promptIds.map((id) => deletePrompt(id)),
          ]);
          if (assetIds.length > 0) {
            await removeAssets(assetIds);
          }
          await refreshSubjects();
          await refreshPrompts();
          await refreshAssets();
          setSelectedIds(new Set());
          setMultiSelectEnabled(false);
          antdMessage.success(t('assetLibrary.deleteSuccess'));
        } catch (err) {
          antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.deleteFailed'));
        }
      },
    });
  }, [selectedIds, allItems, removeAssets, refreshSubjects, refreshPrompts, refreshAssets, antdMessage, t]);

  useEffect(() => {
    if (!multiSelectEnabled) {
      setSelectedIds(new Set());
    }
  }, [multiSelectEnabled]);

  // ── 发送到画布 ──
  const handleSendToCanvas = useCallback((item: SendToCanvasItem) => {
    props.onSendToCanvas?.(item);
  }, [props.onSendToCanvas]);

  // ── 下载 ──
  // 私有资源依赖 JWT 鉴权,a.href 无法携带 Authorization header,统一经 fetch + blob 下载
  const handleDownloadItem = useCallback(async (item: { type: 'subject' | 'prompt' | 'asset'; data: any }): Promise<void> => {
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
    if (item.type === 'asset') {
      const assetData = item.data;
      const d = assetData.data;
      const cover = d.kind === 'image' ? d.dataUrl : d.kind === 'video' ? d.url : undefined;
      const url = getResourceUrl(d.storageKey, 'full') || cover;
      if (!url) return;
      await download(url, assetData.title);
    } else if (item.type === 'prompt') {
      const promptData = item.data as Prompt;
      if (promptData.imageKeys.length > 0) {
        const url = getResourceUrl(promptData.imageKeys[0], 'full');
        if (url) {
          await download(url, promptData.title);
        }
      }
    }
  }, []);

  // ── 重命名 ──
  const handleRenameItem = useCallback(async () => {
    if (!renameItemTarget || !renameItemName.trim()) return;
    try {
      let finalName = renameItemName.trim();
      if (renameItemTarget.type === 'asset' && finalName.includes('.')) {
        const lastDot = finalName.lastIndexOf('.');
        if (lastDot > 0) {
          finalName = finalName.substring(0, lastDot);
        }
      }
      if (renameItemTarget.type === 'subject') {
        await updateSubject(renameItemTarget.id, { name: finalName });
        await refreshSubjects();
      } else if (renameItemTarget.type === 'prompt') {
        await updatePrompt(renameItemTarget.id, { title: finalName });
        await refreshPrompts();
      } else if (renameItemTarget.type === 'asset') {
        await updateAsset(renameItemTarget.id, { title: finalName });
        await refreshAssets();
      }
      setRenameItemOpen(false);
      setRenameItemName('');
      setRenameItemTarget(null);
      antdMessage.success(t('assetLibrary.saveSuccess'));
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.saveFailed'));
    }
  }, [renameItemTarget, renameItemName, refreshSubjects, refreshPrompts, refreshAssets, updateAsset, antdMessage, t]);

  // ── 打开项目 ──
  const handleOpenItem = useCallback((item: PageItem) => {
    if (item.type === 'subject') {
      setSubjectCreateId(item.data.id);
      setSubjectCreateOpen(true);
    } else if (item.type === 'prompt') {
      setPromptViewId(item.data.id);
    } else if (item.type === 'asset') {
      if (item.data.kind === 'script') {
        handleOpenScriptAsset(item.data);
      } else if (item.data.kind === 'zeroexo-entity') {
        setSubjectCreateId(item.data.id);
        setSubjectCreateOpen(true);
      } else {
        setAssetDetail(item.data);
      }
    }
  }, [handleOpenScriptAsset]);

  // ── 分类/搜索变化时重置分页（筛选维度已派生，无需多 effect 同步） ──
  useEffect(() => {
    setPage(1);
  }, [activeGroup, activeChild, search]);

  // ── 返回 ──
  return {
    isAuthenticated,
    isMobile,
    theme,
    subjects,
    prompts,
    assets,
    loadingSubjects,
    loadingPrompts,
    loadingAssets,
    refreshSubjects,
    refreshPrompts,
    refreshAssets,
    categories,
    activeGroup,
    activeChild,
    contentType,
    search,
    viewMode,
    multiSelectEnabled,
    selectedIds,
    page,
    PAGE_SIZE,
    allItems,
    pageItems,
    dragOver,
    dragCounterRef,
    confirmDelete,
    renameItemOpen,
    renameItemName,
    renameItemTarget,
    scriptNamePromptOpen,
    scriptNameInput,
    scriptNameSuggestion,
    scriptEditorOpen,
    scriptEditorEpisodes,
    scriptEditorActiveId,
    scriptEditorTitle,
    scriptEditorAssetId,
    scriptImportOpen,
    scanningProgress,
    scanningMessage,
    promptViewId,
    assetDetail,
    subjectCreateOpen,
    subjectCreateId,
    promptCreateOpen,
    promptCreateId,
    handleUpload,
    handleUploadScript,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleNewScript,
    handleConfirmNewScript,
    handleOpenScriptAsset,
    handleScriptImportComplete,
    handleCloseScriptEditor,
    handleConfirmDelete,
    handleToggleSelect,
    handleToggleSelectAll,
    handleToggleFavorite,
    handleClonePrompt,
    handleBatchDelete,
    handleSendToCanvas,
    handleDownloadItem,
    handleRenameItem,
    handleOpenItem,
    setActiveGroup,
    setActiveChild,
    setSearch,
    setViewMode,
    setMultiSelectEnabled,
    setPage,
    setConfirmDelete,
    setRenameItemOpen,
    setRenameItemName,
    setRenameItemTarget,
    setScriptNamePromptOpen,
    setScriptNameInput,
    setScriptEditorOpen,
    setScriptEditorEpisodes,
    setScriptEditorActiveId,
    setScriptEditorTitle,
    setScriptImportOpen,
    setScanningProgress,
    setScanningMessage,
    setPromptViewId,
    setAssetDetail,
    setSubjectCreateOpen,
    setSubjectCreateId,
    setPromptCreateOpen,
    setPromptCreateId,
  };
}