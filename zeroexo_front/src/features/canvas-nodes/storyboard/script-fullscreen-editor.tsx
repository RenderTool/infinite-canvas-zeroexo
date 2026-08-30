/**
 * ScriptFullscreenEditor - 独立通用全屏剧本编辑器
 *
 * 脱离画布节点耦合，可在任意位置（资产库、画布 Modal 等）使用。
 * 内聚全屏覆盖层、纸张编辑器、剧集侧边栏、可拖拽分割线、底部工具栏。
 *
 * 用法：
 * ```tsx
 * <ScriptFullscreenEditor
 *   open={open}
 *   onClose={() => setOpen(false)}
 *   episodes={episodes}
 *   activeEpisodeId={activeId}
 *   onEpisodesChange={setEpisodes}
 *   onActiveEpisodeChange={setActiveId}
 *   title="剧本名称"
 * />
 * ```
 */
import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CircleX, FileUp, BookOpen, ListOrdered, Eye, EyeOff, ArrowUpDown, GripVertical } from 'lucide-react';
import { App, Button, ConfigProvider, Tooltip, Input, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme, AnimatedThemeToggler } from '@zeroexo/plugin-theme';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import { ScriptStructuredEditor } from '@/features/canvas-nodes/script-editor/script-structured-editor.js';
import { serializeScriptLines, buildSampleLines } from '@/features/canvas-nodes/script-editor/script-lines.js';
import { EpisodeList } from './components/EpisodeList.js';
import { getEpisodePageCount, splitContentIntoPages } from './hooks/use-episode-manager.js';
import { ScriptReader, type ReaderPage } from './components/ScriptReader.js';
import type { Episode } from './script-types.js';

export interface ScriptFullscreenEditorProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 剧本标题 */
  title?: string;
  /** 全部剧集 */
  episodes: Episode[];
  /** 当前选中剧集 id */
  activeEpisodeId: string;
  /** 剧集变更回调 */
  onEpisodesChange: (episodes: Episode[]) => void;
  /** 当前剧集变更回调 */
  onActiveEpisodeChange: (id: string) => void;
  /** 复合更新（同时写入 episodes + activeEpisodeId） */
  onEpisodesAndActiveChange: (episodes: Episode[], activeEpisodeId?: string) => void;
  /** 新增剧集回调 */
  onAddEpisode: () => void;
  /** 场景编号开关 */
  sceneNumbers?: boolean;
  onSceneNumbersChange?: (next: boolean) => void;
  /** 标签显隐开关 */
  showLabels?: boolean;
  onShowLabelsChange?: (next: boolean) => void;
  /** 是否为范文 */
  isSample?: boolean;
  onIsSampleChange?: (next: boolean) => void;
  /** 自定义导入点击回调（外部提供时使用外部导入流程，否则使用内置文件输入） */
  onImportClick?: () => void;
  /**
   * Plan#50:内嵌模式（画布顶部页签内显示）——容器改 absolute 填满父级、不做 createPortal。
   * 关闭按钮在 embedded 下隐藏（由页签的 X 关闭），避免双关闭入口。
   */
  embedded?: boolean;
}

const SAMPLE_HTML = serializeScriptLines(buildSampleLines());

/** 剧集列表默认宽度 (px) */
const DEFAULT_EPISODE_LIST_WIDTH = 216;

/** 剧集列表最小/最大宽度 */
const MIN_EPISODE_LIST_WIDTH = 160;
const MAX_EPISODE_LIST_WIDTH = 400;

export function ScriptFullscreenEditor({
  open,
  onClose,
  episodes,
  activeEpisodeId,
  onEpisodesChange,
  onActiveEpisodeChange,
  onEpisodesAndActiveChange,
  onAddEpisode,
  sceneNumbers = false,
  onSceneNumbersChange,
  showLabels = true,
  onShowLabelsChange,
  isSample = false,
  onIsSampleChange,
  onImportClick,
  embedded = false,
}: ScriptFullscreenEditorProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const isDark = theme.mode === 'dark';

  const activeEpisode = episodes.find((e) => e.id === activeEpisodeId) ?? episodes[0];

  // 剧集派生统计
  const normalizedEpisodes = useMemo(() => episodes.map((ep, index) => {
    const pageCount = getEpisodePageCount(ep);
    return { ...ep, number: index + 1, pageCount, estimatedDuration: pageCount };
  }), [episodes]);

  const totalPages = useMemo(
    () => normalizedEpisodes.reduce((acc, ep) => acc + (ep.pageCount ?? 0), 0),
    [normalizedEpisodes],
  );
  const totalDuration = totalPages;

  // 阅读模式页数据
  const readerPages = useMemo<ReaderPage[]>(() => {
    const pages: ReaderPage[] = [];
    normalizedEpisodes.forEach((ep) => {
      const epPages = splitContentIntoPages(ep.content);
      epPages.forEach((p, i) => {
        pages.push({
          episodeId: ep.id,
          episodeNumber: ep.number,
          episodeTitle: ep.title,
          pageNumber: i + 1,
          episodeTotalPages: epPages.length,
          html: p.html,
          globalIndex: pages.length + 1,
        });
      });
    });
    return pages;
  }, [normalizedEpisodes]);

  const [readerOpen, setReaderOpen] = useState(false);

  // ── 稳定化 episodes/activeEpisodeId 引用：避免 handleContentChange 闭包捕获过时数据 ──
  const episodesRef = useRef(episodes);
  episodesRef.current = episodes;
  const activeEpisodeIdRef = useRef(activeEpisodeId);
  activeEpisodeIdRef.current = activeEpisodeId;
  const activeEpisodeRef = useRef(activeEpisode);
  activeEpisodeRef.current = activeEpisode;

  // ── 本地状态兜底（当外部未提供 onChange 回调时使用） ──
  const [localSceneNumbers, setLocalSceneNumbers] = useState(sceneNumbers);
  const [localShowLabels, setLocalShowLabels] = useState(showLabels);
  const effectiveSceneNumbers = onSceneNumbersChange ? sceneNumbers : localSceneNumbers;
  const effectiveShowLabels = onShowLabelsChange ? showLabels : localShowLabels;

  const handleSceneNumbersChange = useCallback(() => {
    if (onSceneNumbersChange) {
      onSceneNumbersChange(!sceneNumbers);
    } else {
      setLocalSceneNumbers((v) => !v);
    }
  }, [onSceneNumbersChange, sceneNumbers]);

  const handleShowLabelsChange = useCallback(() => {
    if (onShowLabelsChange) {
      onShowLabelsChange(!showLabels);
    } else {
      setLocalShowLabels((v) => !v);
    }
  }, [onShowLabelsChange, showLabels]);

  // ── 文件导入 ──
  const importFileRef = useRef<HTMLInputElement>(null);
  const handleImportClick = useCallback(() => {
    if (onImportClick) {
      onImportClick();
    } else {
      importFileRef.current?.click();
    }
  }, [onImportClick]);
  /** 智能读取文本文件:UTF-8 优先,失败回落 GB18030(修复 Windows 中文 txt 常见 GBK 编码导致的中文乱码) */
  const readFileSmart = useCallback(async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer();
    try {
      // 严格 UTF-8:非法字节序列会抛错,据此判定非 UTF-8 文件
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      try {
        // GB18030 是 GBK/GB2312 超集,兼容 Windows 中文 txt 常见编码
        return new TextDecoder('gb18030').decode(buf);
      } catch {
        return new TextDecoder('utf-8').decode(buf);
      }
    }
  }, []);
  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void readFileSmart(file).then((text) => {
      if (!text.trim()) return;
      // 将导入内容作为新剧集
      const newEp: Episode = {
        id: `ep-${Date.now()}`,
        number: episodes.length + 1,
        title: file.name.replace(/\.[^/.]+$/, ''),
        content: text,
      };
      onEpisodesAndActiveChange([...episodes, newEp], newEp.id);
    });
    e.target.value = '';
  }, [episodes, onEpisodesAndActiveChange, readFileSmart]);

  // ── 可拖拽分割线 ──
  const [episodeListWidth, setEpisodeListWidth] = useState(DEFAULT_EPISODE_LIST_WIDTH);
  const [splitterHovered, setSplitterHovered] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = episodeListWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [episodeListWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = startX.current - e.clientX;
      const newWidth = Math.max(MIN_EPISODE_LIST_WIDTH, Math.min(MAX_EPISODE_LIST_WIDTH, startWidth.current + dx));
      setEpisodeListWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ── 跳转弹窗 ──
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpInput, setJumpInput] = useState('');
  const jumpInputRef = useRef<HTMLInputElement>(null);

  const handleJumpConfirm = useCallback(() => {
    const num = parseInt(jumpInput, 10);
    if (isNaN(num) || num < 1 || num > normalizedEpisodes.length) {
      modal.warning({
        title: t('storyboard.hint'),
        content: t('storyboard.episodeNotExist'),
        zIndex: Z_INDEX.FULLSCREEN_MODAL,
      });
      return;
    }
    const target = normalizedEpisodes[num - 1];
    if (target) {
      onActiveEpisodeChange(target.id);
    }
    setJumpOpen(false);
    setJumpInput('');
  }, [jumpInput, normalizedEpisodes, onActiveEpisodeChange, modal, t]);

  // 打开跳转时自动聚焦输入框
  useEffect(() => {
    if (jumpOpen && jumpInputRef.current) {
      setTimeout(() => jumpInputRef.current?.focus(), 50);
    }
  }, [jumpOpen]);

  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const accent = theme.toolbar.accent;
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;

  // 字数统计（当前剧集）
  const wordCount = useMemo(() => {
    const html = episodes.length === 0 ? SAMPLE_HTML : (activeEpisode?.content || '');
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length;
  }, [episodes.length, activeEpisode]);

  // 内容变更（使用 ref 避免 stale closure）
  const handleContentChange = useCallback((value: string) => {
    const currentEpisodes = episodesRef.current;
    const currentActiveEpisode = activeEpisodeRef.current;
    console.log('[ScriptFullscreenEditor] handleContentChange called, value length:', value.length, 'episodes count:', currentEpisodes.length, 'activeId:', currentActiveEpisode?.id);
    if (currentEpisodes.length === 0) {
      const newEp: Episode = { id: `ep-${Date.now()}`, number: 1, title: '第1集', content: value };
      console.log('[ScriptFullscreenEditor] creating new episode:', newEp.id);
      onEpisodesChange([newEp]);
      onActiveEpisodeChange(newEp.id);
      if (isSample) onIsSampleChange?.(false);
      return;
    }
    const updatedEpisodes = currentEpisodes.map((e) =>
      e.id === (currentActiveEpisode?.id) ? { ...e, content: value } : e,
    );
    console.log('[ScriptFullscreenEditor] updating episodes, matched:', currentEpisodes.some(e => e.id === currentActiveEpisode?.id));
    onEpisodesChange(updatedEpisodes);
    if (isSample) onIsSampleChange?.(false);
  }, [onEpisodesChange, onActiveEpisodeChange, isSample, onIsSampleChange]);

  // 剧集操作
  const handleAddEpisode = useCallback(() => {
    if (isSample) onIsSampleChange?.(false);
    onAddEpisode();
  }, [onAddEpisode, isSample, onIsSampleChange]);

  const handleDeleteEpisode = useCallback((ep: Episode) => {
    const filtered = episodes.filter((e) => e.id !== ep.id);
    // Plan#20 T9: 删集级联清理——通知画布层清理主体 episodeIds 与分镜按集映射
    nodeActionBus.emit('script:episodesDeleted', { nodeId: '', deletedIds: [ep.id] } as any);
    if (filtered.length === 0) {
      const newEp: Episode = { id: `ep-${Date.now()}`, number: 1, title: '第1集', content: '' };
      onEpisodesAndActiveChange([newEp], newEp.id);
    } else {
      const renumbered = filtered.map((e, i) => ({ ...e, number: i + 1 }));
      const nextActive = activeEpisode?.id === ep.id ? renumbered[0]!.id : undefined;
      onEpisodesAndActiveChange(renumbered, nextActive);
    }
  }, [episodes, activeEpisode?.id, onEpisodesAndActiveChange]);

  const handleRename = useCallback((id: string, title: string) => {
    onEpisodesChange(episodes.map((e) => (e.id === id ? { ...e, title } : e)));
  }, [episodes, onEpisodesChange]);

  const handleReorder = useCallback((ids: string[]) => {
    const reordered = ids
      .map((id) => episodes.find((e) => e.id === id))
      .filter(Boolean) as Episode[];
    if (reordered.length !== episodes.length) return;
    onEpisodesChange(reordered.map((ep, i) => ({ ...ep, number: i + 1 })));
  }, [episodes, onEpisodesChange]);

  const handleDuplicate = useCallback((id: string) => {
    const src = episodes.find((e) => e.id === id);
    if (!src) return;
    const copy: Episode = {
      ...src,
      id: `ep-${Date.now()}`,
      title: `${src.title}（副本）`,
      content: src.content,
      pageBreaks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const idx = episodes.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const next = [...episodes];
    next.splice(idx + 1, 0, copy);
    onEpisodesAndActiveChange(next, copy.id);
  }, [episodes, onEpisodesAndActiveChange]);

  const handleSplit = useCallback((id: string) => {
    const src = episodes.find((e) => e.id === id);
    if (!src) return;
    const pages = splitContentIntoPages(src.content);
    if (pages.length < 2) return;
    const now = new Date().toISOString();
    const first: Episode = {
      ...src,
      title: `${src.title}（上）`,
      content: pages[0]!.html,
      pageBreaks: [],
      updatedAt: now,
    };
    const second: Episode = {
      ...src,
      id: `ep-${Date.now()}`,
      title: `${src.title}（下）`,
      content: pages.slice(1).map((p) => p.html).join(''),
      pageBreaks: [],
      createdAt: now,
      updatedAt: now,
    };
    const idx = episodes.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const next = [...episodes];
    next.splice(idx, 1, first, second);
    onEpisodesAndActiveChange(next, second.id);
  }, [episodes, onEpisodesAndActiveChange]);

  const handleMergePrev = useCallback((id: string) => {
    const idx = episodes.findIndex((e) => e.id === id);
    if (idx <= 0) return;
    const prev = episodes[idx - 1]!;
    const cur = episodes[idx]!;
    const merged: Episode = {
      ...prev,
      content: `${prev.content}${cur.content}`,
      pageBreaks: [],
      updatedAt: new Date().toISOString(),
    };
    const next = episodes
      .filter((e) => e.id !== cur.id)
      .map((e) => (e.id === prev.id ? merged : e));
    onEpisodesAndActiveChange(next, prev.id);
  }, [episodes, onEpisodesAndActiveChange]);

  if (!open) return null;

  // Plan#50:embedded 模式(页签内嵌)——不 createPortal、容器 absolute 填满父级(页签内容层),
  // 由调用方(剧本节点)自行 portal 到页签挂载点;非 embedded 保持原全屏覆盖形态。
  const overlay = (
    // 局部提升 antd 弹层基准:自制 overlay(Z_INDEX.FULLSCREEN=30000)之上的 antd 弹层
    // (Dropdown/Tooltip/Modal)由 token 自动分配 40000,替代手动 zIndex/overlayStyle
    <ConfigProvider theme={{ token: { zIndexPopupBase: 40000 } }}>
    <div style={overlayStyle(theme, embedded)}>
      {/* ===== 顶部 header ===== */}
      <div style={headerStyle(cardBorder, theme, embedded)}>
        {/* 左侧：工具按钮 */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Tooltip title={t('scriptEditor.importScript') || '导入'}>
            <Button
              type="text"
              size="small"
              icon={<FileUp size={15} />}
              onClick={handleImportClick}
              style={{ ...toolBtnStyle, color: mutedColor }}
            >
              {t('storyboard.import')}
            </Button>
          </Tooltip>
          <Tooltip title={t('scriptEditor.readMode') || '阅读'}>
            <Button
              type="text"
              size="small"
              icon={<BookOpen size={15} />}
              onClick={() => setReaderOpen(true)}
              style={{ ...toolBtnStyle, color: mutedColor }}
            >
              {t('storyboard.read')}
            </Button>
          </Tooltip>
          <Tooltip title={t('scriptEditor.sceneNumber') || '场景编号'}>
            <Button
              type="text"
              size="small"
              icon={<ListOrdered size={15} />}
              onClick={handleSceneNumbersChange}
              style={{
                ...toolBtnStyle,
                color: effectiveSceneNumbers ? accent : mutedColor,
                ...(effectiveSceneNumbers ? { background: `${accent}18` } : {}),
              }}
            >
              {t('storyboard.sceneNo')}
            </Button>
          </Tooltip>
          <Tooltip title={effectiveShowLabels ? t('scriptEditor.hideLabels') || '隐藏标签' : t('scriptEditor.showLabels') || '显示标签'}>
            <Button
              type="text"
              size="small"
              icon={effectiveShowLabels ? <Eye size={15} /> : <EyeOff size={15} />}
              onClick={handleShowLabelsChange}
              style={{
                ...toolBtnStyle,
                color: !effectiveShowLabels ? accent : mutedColor,
                ...(!effectiveShowLabels ? { background: `${accent}18` } : {}),
              }}
            >
              {effectiveShowLabels ? t('storyboard.hideLabels') : t('storyboard.showLabels')}
            </Button>
          </Tooltip>
          <div style={{ width: 1, height: 20, background: cardBorder, margin: '0 4px', flexShrink: 0 }} />
          <span style={{
            fontWeight: 600, fontSize: 14, color: textColor,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {activeEpisode ? activeEpisode.title : t('storyboard.untitled')}
          </span>
        </div>

        {/* 中间：统计信息 */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, fontSize: 11, color: mutedColor }}>
          <span>{t('canvasNodes.wordCount', { count: wordCount })}</span>
          <span style={{ width: 1, height: 12, background: cardBorder, flexShrink: 0 }} />
          <span>{t('storyboard.totalPages')} <b style={{ color: textColor }}>{totalPages}</b></span>
          <span style={{ width: 1, height: 12, background: cardBorder, flexShrink: 0 }} />
          <span>{t('storyboard.totalDuration')} ≈<b style={{ color: textColor }}>{totalDuration}</b> {t('storyboard.minutes')}</span>
          <span style={{ width: 1, height: 12, background: cardBorder, flexShrink: 0 }} />
          <Tooltip title={t('storyboard.jumpToEpisode')}>
            <Button
              type="text"
              size="small"
              icon={<ArrowUpDown size={13} />}
              onClick={() => setJumpOpen(true)}
              style={{ ...toolBtnStyle, color: mutedColor, fontSize: 11 }}
            >
              {t('storyboard.jump')}
            </Button>
          </Tooltip>
        </div>

        {/* 右侧：范文示例、主题切换、关闭 */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {isSample && (
            <span style={sampleBadgeStyle(isDark)}>{t('storyboard.sampleBadge')}</span>
          )}
          <Tooltip title={t('storyboard.toggleTheme')}>
            <span style={{ display: 'inline-flex' }}>
              <AnimatedThemeToggler
                aria-label={t('storyboard.toggleTheme')}
                iconSize={14}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, cursor: 'pointer', background: 'transparent', border: 'none', color: textColor, borderRadius: 6 }}
              />
            </span>
          </Tooltip>
          {/* Plan#50:embedded(页签)模式隐藏自带关闭按钮——关闭统一走页签 X。
              尺寸/样式与左侧 AnimatedThemeToggler 完全对齐: 20x20 容器。
              用 CircleX(圆+叉)而非细线 X,与太阳(圆+射线)在视觉重量上对称——
              否则细 X vs 圆 sun 看起来一个轻一个重,即便容器对齐也不"水平对齐" */}
          {!embedded && (
            <Tooltip title={t('hierarchy.close')}>
              <button
                type="button"
                aria-label={t('hierarchy.close')}
                onClick={onClose}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 20, height: 20, padding: 0, border: 'none', borderRadius: 6,
                  background: 'transparent', color: textColor, cursor: 'pointer',
                }}
              >
                <CircleX size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* ===== 主内容区（编辑器 + 可拖拽分割线 + 剧集列表） ===== */}
      <div style={mainRowStyle}>
        {/* 纸张编辑器 */}
        <div style={editorAreaStyle(theme)}>
          <ScriptStructuredEditor
            key={activeEpisode?.id ?? 'empty'}
            value={activeEpisode?.content ?? ''}
            onChange={handleContentChange}
            accent={accent}
            border={cardBorder}
            text={textColor}
            textMuted={mutedColor}
            isDark={isDark}
            sceneNumbers={effectiveSceneNumbers}
            showLabels={effectiveShowLabels}
            menuZIndex={Z_INDEX.FULLSCREEN_EDITOR_MENU}
            scrollable={true}
          />
        </div>

        {/* 隐藏的文件导入输入框 */}
        <input
          ref={importFileRef}
          type="file"
          accept=".txt,.docx,.md,.html,.json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />

        {/* 可拖拽分割线 */}
        <div
          style={splitterOuterStyle(isDark, splitterHovered)}
          onMouseDown={handleSplitterMouseDown}
          onMouseEnter={() => setSplitterHovered(true)}
          onMouseLeave={() => setSplitterHovered(false)}
          title={t('storyboard.dragResizeEpisodeList')}
        >
          <div style={splitterHitAreaStyle(splitterHovered, isDark)}>
            <GripVertical size={14} />
          </div>
        </div>

        {/* 剧集列表(paddingBottom 10 与左侧 editorArea 对齐底部新增按钮基线) */}
        <div style={{ width: episodeListWidth, flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column', paddingBottom: 10 }}>
          <EpisodeList
            episodes={normalizedEpisodes}
            activeEpisodeId={activeEpisodeId}
            accent={accent}
            border={cardBorder}
            text={textColor}
            textMuted={mutedColor}
            isDark={isDark}
            actions={<></>}
            onSelect={onActiveEpisodeChange}
            onAdd={handleAddEpisode}
            onDelete={handleDeleteEpisode}
            onRename={handleRename}
            onReorder={handleReorder}
            onDuplicate={handleDuplicate}
            onSplit={handleSplit}
            onMergePrev={handleMergePrev}
          />
        </div>
      </div>

      {/* ===== 阅读模式 ===== */}
      {readerOpen && (
        <ScriptReader
          open={readerOpen}
          title={t('storyboard.readerTitle')}
          pages={readerPages}
          onClose={() => setReaderOpen(false)}
          accent={accent}
          isDark={isDark}
          zIndex={Z_INDEX.FULLSCREEN_DROPDOWN}
        />
      )}

      {/* ===== 跳转弹窗 ===== */}
      <Modal
        title={t('storyboard.jumpToEpisode')}
        open={jumpOpen}
        onCancel={() => { setJumpOpen(false); setJumpInput(''); }}
        onOk={handleJumpConfirm}
        okText={t('storyboard.jump')}
        cancelText={t('common.cancel')}
        centered
        width={320}
        destroyOnHidden
      >
        <div style={{ marginBottom: 8, fontSize: 13, color: mutedColor }}>
          {t('storyboard.enterEpisodeNumber', { count: normalizedEpisodes.length })}
        </div>
        <Input
          ref={jumpInputRef as any}
          value={jumpInput}
          onChange={(e) => setJumpInput(e.target.value)}
          placeholder={`1 ~ ${normalizedEpisodes.length}`}
          maxLength={4}
          onPressEnter={handleJumpConfirm}
          autoFocus
        />
      </Modal>
    </div>
    </ConfigProvider>
  );

  if (embedded) return overlay;
  return createPortal(overlay, document.body);
}

// ===== Styles =====

const toolBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12,
};

const overlayStyle = (
  theme: ReturnType<typeof useTheme>['theme'],
  embedded = false,
): React.CSSProperties => ({
  // Plan#50:embedded(页签内嵌)用 absolute 填满父容器;否则原全屏 fixed 覆盖
  position: embedded ? 'absolute' : 'fixed',
  inset: 0,
  zIndex: embedded ? undefined : Z_INDEX.FULLSCREEN,
  display: 'flex', flexDirection: 'column',
  background: theme.toolbar.editorPaper,
});

const headerStyle = (
  border: string,
  theme: ReturnType<typeof useTheme>['theme'],
  embedded = false,
): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  // embedded 模式被包在 antd Modal 内，Modal 右上角自带 56px 关闭按钮；
  // 留出空间避免 header 右侧的换肤/关闭按钮与 Modal 关闭按钮重叠
  padding: embedded ? '8px 56px 8px 16px' : '8px 16px',
  flexShrink: 0,
  borderBottom: `1px solid ${border}`,
  background: theme.toolbar.editorSurface,
});

const mainRowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'row', flex: 1,
  minHeight: 0, overflow: 'visible', gap: 0,
};

const editorAreaStyle = (theme: ReturnType<typeof useTheme>['theme']): React.CSSProperties => ({
  flex: 1, display: 'flex', flexDirection: 'column',
  minWidth: 0, minHeight: 0, overflow: 'hidden',
  // paddingBottom 与 EpisodeList wrap 的 paddingBottom(10) 对齐，使两侧底部按钮在同一水平线
  padding: '16px 16px 10px 16px', borderRadius: 8,
  background: theme.toolbar.editorPaper,
});

/** 可拖拽分割线外层 */
const splitterOuterStyle = (isDark: boolean, hovered: boolean): React.CSSProperties => ({
  width: 16,
  flexShrink: 0,
  cursor: 'col-resize',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: hovered
    ? (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)')
    : 'transparent',
  zIndex: Z_INDEX.BASE,
  transition: 'background 0.2s',
});

/** 分割线内部点击区域（带图标和视觉引导） */
const splitterHitAreaStyle = (hovered: boolean, isDark: boolean): React.CSSProperties => ({
  width: 4,
  height: hovered ? 64 : 40,
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: hovered
    ? (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)')
    : 'rgba(128,128,128,0.3)',
  background: hovered
    ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)')
    : 'rgba(128,128,128,0.06)',
  transition: 'background 0.2s, color 0.2s, width 0.2s, height 0.2s, border-radius 0.2s',
  cursor: 'col-resize',
  pointerEvents: 'none',
});

const sampleBadgeStyle = (isDark: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center',
  padding: '1px 8px', borderRadius: 999,
  fontSize: 11, fontWeight: 600, letterSpacing: 1,
  color: isDark ? '#fbbf24' : '#b45309',
  background: isDark ? 'rgba(251,191,36,0.14)' : 'rgba(180,83,9,0.12)',
  border: `1px solid ${isDark ? 'rgba(251,191,36,0.35)' : 'rgba(180,83,9,0.3)'}`,
  userSelect: 'none', pointerEvents: 'none',
});