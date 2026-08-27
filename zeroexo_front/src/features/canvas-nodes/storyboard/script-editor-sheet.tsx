/**
 * ScriptEditorSheet - 画布"剧本节点"独立页面壳
 *
 * 独立页面壳特性:
 * - 不依赖任何创作项目,内容直接写入 node.data,随画布 Yjs 同步。
 * - 单版本维护(移除多版本生成):用户通过多个剧本节点维护独立版本,故无需版本管理。
 * - 移除剧本助手(Agent)面板:画布统一以顶部 Agent 智能处理;仅保留"唤起顶部 Agent 进入剧本模式"入口。
 * - 节点本体 = 只读阅读态:隐藏标签 + 不可编辑;剧集切换位于底部工具栏(与分镜一致)。
 * - 编辑/导入/阅读均通过底部工具栏进入(编辑=全屏)。
 * - episodes / activeEpisodeId 持久化到 node.data,随画布 Yjs 同步。
 *
 * 布局(内容在上、工具栏在下,与分镜节点统一):
 * ┌──────────────────────────────────────────────────────────────┐
 * │  状态栏: [第N集 · 标题] ..... 字数 N                         │
 * ├──────────────────────────────────────────────────────────────┤
 * │  紧凑纸张只读渲染(当前集内容,隐藏标签)                         │
 * │  (重叠 .zx-script-page .zx-page-compact)                     │
 * ├──────────────────────────────────────────────────────────────┤
 * │ [第N集 ▾] | 编辑 | 导入 | 阅读 | 生成分镜                    │
 * └──────────────────────────────────────────────────────────────┘
 * 全屏编辑(底部"编辑"进入):纸张编辑器 + 剧集侧边栏
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ListVideo } from 'lucide-react';
import { Button, App } from 'antd';
import DOMPurify from 'dompurify';
import ReactMarkdown from 'react-markdown';
import { useTheme } from '@zeroexo/plugin-theme';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { serializeScriptLines, buildSampleLines, plainTextToScriptHtml } from '@/features/canvas-nodes/script-editor/script-lines.js';
import { getEpisodePageCount, splitContentIntoPages } from './hooks/use-episode-manager.js';
import { ScriptReader, type ReaderPage } from './components/ScriptReader.js';
import { ScriptImportFlow } from './components/script-import-flow.js';
import { StoryboardAssociateModal } from './storyboard-associate-modal.js';
import { FullscreenDropdown, fullToolBtnStyle } from './components/FullscreenDropdown.js';
import { ScriptFullscreenEditor } from './script-fullscreen-editor.js';
import { addAssets } from '@/features/asset-picker/asset-store.js';
import { onAssetCreated } from '@/services/sync/sync-service.js';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import { useTranslation } from 'react-i18next';
import type { Episode } from './script-types.js';
import './components/script-viewer.css';

export interface ScriptEditorSheetProps {
  nodeId: string;
  /** 节点标题(用于关联弹窗展示) */
  title?: string;
  /** 全部剧集(持久化到 node.data.episodes) */
  episodes: Episode[];
  /** 当前选中剧集 id(持久化到 node.data.activeEpisodeId) */
  activeEpisodeId: string;
  onEpisodesChange: (episodes: Episode[]) => void;
  onActiveEpisodeChange: (id: string) => void;
  /** 复合更新(同时写入 episodes + activeEpisodeId,避免 stale closure) */
  onEpisodesAndActiveChange: (episodes: Episode[], activeEpisodeId?: string) => void;
  /** 新增剧集(由父组件合并写入,避免 stale closure) */
  onAddEpisode: () => void;
  /** 场景编号开关(持久化到 node.data,供全屏编辑使用) */
  sceneNumbers: boolean;
  onSceneNumbersChange: (next: boolean) => void;
  /** 标签显隐开关(持久化到 node.data,供全屏编辑使用) */
  showLabels: boolean;
  onShowLabelsChange: (next: boolean) => void;
  /** 是否为范文(持久化到 node.data.isSample);范文态显示"范文示例",生成分镜走模板模式 */
  isSample: boolean;
  /** 范文态开关变更(回写 node.data.isSample) */
  onIsSampleChange: (next: boolean) => void;
  /** 打开时是否默认全屏（锚点模式下使用，默认 false） */
  defaultFullscreen?: boolean;
}

/** 范文剧本(空内容时填充为结构化范文序列化后的 HTML) */
const SAMPLE_HTML = serializeScriptLines(buildSampleLines());

export function ScriptEditorSheet({
  nodeId,
  title,
  episodes,
  activeEpisodeId,
  onEpisodesChange,
  onActiveEpisodeChange,
  onEpisodesAndActiveChange,
  onAddEpisode,
  sceneNumbers,
  onSceneNumbersChange,
  showLabels,
  onShowLabelsChange,
  isSample,
  onIsSampleChange,
  defaultFullscreen = false,
}: ScriptEditorSheetProps): React.ReactElement {
  const { theme } = useTheme();
  const { message, modal } = App.useApp();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  // 空预览背景：与分镜空背景保持一致
  const bgCanvas = isDark ? '#171717' : '#ffffff';

  const activeEpisode = episodes.find((e) => e.id === activeEpisodeId) ?? episodes[0];

  // 剧集派生统计（Phase 5：页数 / 时长，1 页 ≈ 1 分钟）
  const normalizedEpisodes = useMemo(() => episodes.map((ep, index) => {
    const pageCount = getEpisodePageCount(ep);
    return { ...ep, number: index + 1, pageCount, estimatedDuration: pageCount };
  }), [episodes]);

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

  // 全屏翻阅阅读模式（Phase 5 第二阶段）
  const [readerOpen, setReaderOpen] = useState(false);

  // 全屏沉浸式编辑（节点铺满全屏）
  const [fullscreenOpen, setFullscreenOpen] = useState(defaultFullscreen);

  // 剧本导入流程弹窗（SourceTextListModal 源文本列表）
  const [importFlowOpen, setImportFlowOpen] = useState(false);

  // R2：生成分镜选集向导（不再跳过选集；确认后走 storyboard:associate 统一链路）
  const [associateOpen, setAssociateOpen] = useState(false);

  // 主题
  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const accent = theme.toolbar.accent;
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;

  // 字数统计(空态统计范文,有内容统计当前集)
  const wordCount = useMemo(() => {
    const html = episodes.length === 0 ? SAMPLE_HTML : (activeEpisode?.content || '');
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length;
  }, [episodes.length, activeEpisode]);

  // 生成分镜:范文态走"模板分镜"(标注范文示例);真实剧本走原逻辑——直接新建分镜节点 + 连线 + AI 生成
  // 节点语义重构(Plan#33 延伸):不再创建独立生成器节点,分镜节点自身即为生成宿主(空节点+直连剧本)
  const handleGenerateStoryboard = useCallback(() => {
    if (isSample) {
      nodeActionBus.emit('script:generateStoryboard', { nodeId, mode: 'template' });
      return;
    }
    // R2：真实剧本先弹选集向导（选集 + 生成方式），不再直接全量生成
    setAssociateOpen(true);
  }, [nodeId, isSample]);

  // ========== 内容变更 ==========

  // 范文态变更时同步通知画布（ScriptFullscreenEditor 内部会调用 onIsSampleChange）
  const handleSampleChange = useCallback((next: boolean) => {
    onIsSampleChange(next);
    if (next === false) {
      nodeActionBus.emit('script:realized', { nodeId });
    }
  }, [onIsSampleChange, nodeId]);

  // ========== 剧集选择 ==========
  // 剧集切换已统一置于底部工具栏 Select(见 render),不再使用上一集/下一集按钮。

  // ========== 胶囊工具栏事件订阅 ==========
  // 编辑/导入/阅读已注册到通用悬浮胶囊(extensions.tsx getScriptTools),
  // 通过 nodeActionBus 广播动作,此处按 nodeId 过滤后执行对应操作。

  useEffect(() => {
    const unsubs = [
      nodeActionBus.on('script:import', (e) => {
        if (e.nodeId !== nodeId) return;
        setImportFlowOpen(true);
      }),
      nodeActionBus.on('script:read', (e) => {
        if (e.nodeId !== nodeId) return;
        setReaderOpen(true);
      }),
      nodeActionBus.on('script:edit', (e) => {
        if (e.nodeId !== nodeId) return;
        setFullscreenOpen(true);
      }),
      // Plan#20 T0(征集#13): 胶囊「分镜」按钮请求事件——按 isSample 分流,
      // 范文→模板分镜 / 真实剧本→选集 Modal 走 AI 链路(修复胶囊入口永远范文 bug)
      nodeActionBus.on('script:requestGenerateStoryboard', (e: { nodeId: string }) => {
        if (e.nodeId !== nodeId) return;
        handleGenerateStoryboard();
      }),
      // 注意:不订阅 script:generateStoryboard 事件
      // 该事件由 handleGenerateStoryboard 范文分支/其他入口 emit,use-editor-interactions.ts 处理创建分镜节点,
      // 此处订阅会导致 handleGenerateStoryboard(isSample=true 时重新 emit 同一事件)触发无限循环。
    ];
    return () => unsubs.forEach((unsub) => unsub?.());
  }, [nodeId, handleGenerateStoryboard]);

  // ========== 剧集管理 ==========

  const handleAddEpisode = useCallback(() => {
    if (isSample) {
      onIsSampleChange(false);
      nodeActionBus.emit('script:realized', { nodeId });
    }
    onAddEpisode();
  }, [onAddEpisode, isSample, onIsSampleChange, nodeId]);

  // ========== 剧本导入完成回调（含历史内容覆盖/备份提醒） ==========

  const handleImportComplete = useCallback((scriptState: import('./script-types.js').ScriptEditorState | null) => {
    setImportFlowOpen(false);
    if (!scriptState || !scriptState.versions.length) return;
    // AI 导入内容为 MD/纯文本：统一转为结构化 HTML 序列化，保证编辑/分页/阅读格式正确
    const newEpisodes = scriptState.versions[0]!.episodes.map((ep) => ({
      ...ep,
      content: /<\/?[a-z][\s\S]*>/i.test(ep.content || '') ? ep.content : plainTextToScriptHtml(ep.content || ''),
    }));
    if (!newEpisodes.length) return;

    // 检查是否有历史内容
    const hasExistingContent = episodes.some((ep) => ep.content && ep.content.length > 0);

    if (hasExistingContent) {
      modal.confirm({
        title: t('storyboard.importConfirmTitle'),
        content: (
          <span style={{ fontSize: 13 }}>
            {t('storyboard.scriptHasExistingContent')}
          </span>
        ),
        okText: t('storyboard.overwrite'),
        cancelText: t('storyboard.backup'),
        centered: true,
        zIndex: Z_INDEX.FULLSCREEN_MODAL,
        onOk: () => {
          // 覆盖：直接替换当前剧集
          onEpisodesChange(newEpisodes);
          onActiveEpisodeChange(newEpisodes[0]!.id);
          message.success(t('storyboard.importedEpisodes', { count: newEpisodes.length }));
        },
        onCancel: () => {
          // 创建副本备份：保留原有内容，新增导入内容为额外剧集
          const renamedEpisodes: Episode[] = newEpisodes.map((ep, idx) => ({
            ...ep,
            id: `ep-${Date.now()}-${idx}`,
            number: episodes.length + idx + 1,
            title: `导入-${ep.title || `第${idx + 1}集`}`,
          }));
          onEpisodesChange([...episodes, ...renamedEpisodes]);
          onActiveEpisodeChange(renamedEpisodes[0]!.id);
          message.success(t('storyboard.importedEpisodesKeepOriginal', { count: newEpisodes.length }));
        },
      });
    } else {
      // 无历史内容，直接替换
      onEpisodesChange(newEpisodes);
      onActiveEpisodeChange(newEpisodes[0]!.id);
      message.success(t('storyboard.importedEpisodes', { count: newEpisodes.length }));
    }
  }, [message, modal, episodes, onEpisodesChange, onActiveEpisodeChange, t]);

  // ========== 加入资产库 ==========

  const handleSendToAsset = useCallback(async () => {
    if (episodes.length === 0) {
      message.warning(t('storyboard.noScriptContent'));
      return;
    }
    const content = JSON.stringify(episodes.map((ep) => ({
      id: ep.id,
      number: ep.number,
      title: ep.title,
      content: ep.content,
    })));
    const assetTitle = title || t('storyboard.untitledScript');
    try {
      const [asset] = await addAssets([{
        title: assetTitle,
        kind: 'script',
        tags: [],
        bytes: new Blob([content]).size,
        mimeType: 'application/json',
        data: { kind: 'script', content },
      }]);
      if (asset) {
        onAssetCreated(asset.id);
        // FIX-6: 通知画布层打开资产库展示结果（资产库 Modal 每次打开时强制重挂载刷新）
        nodeActionBus.emit('script:assetSaved', { nodeId, assetId: asset.id, title: assetTitle });
        message.success(t('storyboard.addedToAssetLibrary'));
      }
    } catch (err) {
      console.error('send to asset failed:', err);
      message.error(t('storyboard.addToAssetLibraryFailed'));
    }
  }, [episodes, title, message, t]);

  // 加入资产 — 胶囊工具栏事件订阅
  useEffect(() => {
    const unsub = nodeActionBus.on('script:saveAsset', (e) => {
      if (e.nodeId !== nodeId) return;
      handleSendToAsset();
    });
    return () => unsub?.();
  }, [nodeId, handleSendToAsset]);

  // ========== Render ==========

  return (
    <div style={containerStyle()}>
      {renderImportFlow()}

      {/* 顶部状态栏 — 剧集下拉居中,字数靠右;工具全部在底部工具栏 */}
      <div style={{ padding: '6px 12px', borderBottom: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: isDark ? '#1b1b1b' : '#fafaf7', flexShrink: 0 }}>
        <div style={{ flex: 1 }} />
        {/* 剧集切换(顶部居中,复用全屏模式按钮式下拉) */}
        {episodes.length > 0 ? (
          <FullscreenDropdown
            onSelect={onActiveEpisodeChange}
            options={normalizedEpisodes.map((ep) => {
              // 标题为默认"第N集"或为空时，避免与编号重复(第N集 · 第N集)
              const defaultTitle = `第${ep.number}集`;
              const hasCustomTitle = ep.title && ep.title !== defaultTitle;
              const localizedDefault = t('storyboard.episodeLabel', { number: ep.number });
              return {
                key: ep.id,
                label: hasCustomTitle ? `${localizedDefault} · ${ep.title}` : localizedDefault,
                active: ep.id === activeEpisode?.id,
              };
            })}
          >
            <Button size="small" type="text" icon={<ListVideo size={14} />} style={{ ...fullToolBtnStyle, color: textColor }}>
              {normalizedEpisodes.find((ep) => ep.id === activeEpisode?.id)?.title || t('storyboard.episodeLabel', { number: 1 })}
            </Button>
          </FullscreenDropdown>
        ) : (
          <span style={{ fontSize: 11, color: mutedColor, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ListVideo size={14} />
            {t('storyboard.episodeLabel', { number: 1 })}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {isSample && (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '1px 8px', borderRadius: 999,
              fontSize: 11, fontWeight: 600, letterSpacing: 1,
              color: isDark ? '#fbbf24' : '#b45309',
              background: isDark ? 'rgba(251,191,36,0.14)' : 'rgba(180,83,9,0.12)',
              border: `1px solid ${isDark ? 'rgba(251,191,36,0.35)' : 'rgba(180,83,9,0.3)'}`,
              userSelect: 'none', pointerEvents: 'none',
            }}
          >
            {t('storyboard.sampleBadge')}
          </span>
        )}
        <span style={{ fontSize: 11, color: mutedColor }}>{t('canvasNodes.wordCount', { count: wordCount })}</span>
      </div>

      {/* 全屏翻阅阅读模式（Phase 5 第二阶段）—— portal 到 body，脱离节点 transform 约束实现真正全屏 */}
      {createPortal(
        <ScriptReader
          open={readerOpen}
          title={t('storyboard.readerTitle')}
          pages={readerPages}
          accent={accent}
          isDark={isDark}
          onClose={() => setReaderOpen(false)}
          zIndex={fullscreenOpen ? Z_INDEX.FULLSCREEN_EDITOR_MENU : Z_INDEX.DROPDOWN}
        />,
        document.body,
      )}

      {/* R2：生成分镜选集向导（剧本侧：每选集新建分镜节点 + 可选自动生成分镜，剧管作为分镜下游产物由生成链路创建） */}
      <StoryboardAssociateModal
        open={associateOpen}
        onClose={() => setAssociateOpen(false)}
        scriptNodeId={nodeId}
        scriptTitle={title}
        episodes={episodes.map((ep, idx) => ({ id: ep.id, number: idx + 1, title: ep.title }))}
        defaultGenerate={true}
        zIndex={Z_INDEX.FULLSCREEN_MODAL}
      />

      {/* 全屏沉浸式编辑覆盖层(空剧集也可进入,用于新增首集) — 使用统一全屏编辑器组件 */}
      <ScriptFullscreenEditor
        open={fullscreenOpen}
        onClose={() => setFullscreenOpen(false)}
        title={title}
        episodes={episodes}
        activeEpisodeId={activeEpisodeId}
        onEpisodesChange={onEpisodesChange}
        onActiveEpisodeChange={onActiveEpisodeChange}
        onEpisodesAndActiveChange={onEpisodesAndActiveChange}
        onAddEpisode={handleAddEpisode}
        sceneNumbers={sceneNumbers}
        onSceneNumbersChange={onSceneNumbersChange}
        showLabels={showLabels}
        onShowLabelsChange={onShowLabelsChange}
        isSample={isSample}
        onIsSampleChange={handleSampleChange}
        onImportClick={() => setImportFlowOpen(true)}
      />

      {/* 主体：只读阅读态(紧凑纸张;剧集切换已移至底部工具栏) */}
      {/* 只读紧凑纸张 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8, cursor: 'default' }}>
        {episodes.length === 0 ? (
          <div style={{ position: 'relative', height: '100%', overflow: 'hidden', borderRadius: 6, background: bgCanvas }}>
            {/* 范文剧本预览作为背景，让用户直观看到节点最终的样子（可滚动查看全文，背景与分镜空背景一致） */}
            <div
              className="zx-script-page zx-page-compact zx-page-compact-preview"
              data-theme={isDark ? 'dark' : 'light'}
              style={{ height: '100%', overflow: 'auto' }}
            >
              <div
                className="ql-editor"
                style={{ minHeight: '100%', boxSizing: 'border-box', cursor: 'default' }}
                dangerouslySetInnerHTML={{ __html: SAMPLE_HTML }}
              />
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative', height: '100%', overflow: 'auto', borderRadius: 6, background: bgCanvas }}>
            <div
              className="zx-script-page zx-page-compact zx-page-compact-preview"
              data-theme={isDark ? 'dark' : 'light'}
              style={{ minHeight: '100%' }}
            >
              <ScriptContentView content={activeEpisode?.content || ''} />
            </div>
          </div>
        )}
      </div>

      {/* 底部工具操作栏 — 已注释,功能移至胶囊菜单 */}
      {/*
      <div style={footerToolbarStyle(cardBorder)}>
        <Tooltip title="进入全屏编辑">
          <Button size="small" type="text" icon={<Maximize size={14} />} style={{ ...fullToolBtnStyle, color: textColor }} onClick={() => setFullscreenOpen(true)}>
            编辑
          </Button>
        </Tooltip>
        <span style={{ width: 1, height: 16, background: cardBorder, flexShrink: 0 }} />
        <Tooltip title="导入剧本">
          <Button size="small" type="text" icon={<FileUp size={14} />} style={{ ...fullToolBtnStyle, color: textColor }} onClick={() => setImportFlowOpen(true)}>
            导入
          </Button>
        </Tooltip>
        <span style={{ width: 1, height: 16, background: cardBorder, flexShrink: 0 }} />
        <Tooltip title="全屏翻阅阅读">
          <Button size="small" type="text" icon={<BookOpen size={14} />} style={{ ...fullToolBtnStyle, color: textColor }} onClick={() => setReaderOpen(true)}>
            阅读
          </Button>
        </Tooltip>
        <span style={{ width: 1, height: 16, background: cardBorder, flexShrink: 0 }} />
        <Tooltip title="加入资产库">
          <Button size="small" type="text" icon={<FolderOpen size={14} />} style={{ ...fullToolBtnStyle, color: textColor }} onClick={handleSendToAsset}>
            加入资产
          </Button>
        </Tooltip>
        <span style={{ width: 1, height: 16, background: cardBorder, flexShrink: 0 }} />
        <Tooltip title="根据当前剧本生成分镜节点并自动连线">
          <Button size="small" type="primary" icon={<Clapperboard size={14} />} style={{ ...fullToolBtnStyle }} onClick={handleGenerateStoryboard}>
            生成分镜
          </Button>
        </Tooltip>
      </div>
      */}

    </div>
  );

  // ===== 子渲染函数 =====

  function renderImportFlow() {
    return (
      <ScriptImportFlow
        open={importFlowOpen}
        onClose={() => setImportFlowOpen(false)}
        onComplete={handleImportComplete}
      />
    );
  }
}

// ===== ScriptContentView：剧本只读渲染（兼容 MD 与 HTML 序列化） =====

/**
 * AI 导入的剧本内容多为 Markdown（`# 第一集`、`## 场景`、`**加粗**`），
 * 而结构化编辑器/旧数据存 HTML（`.ql-editor` 序列化）。
 * 这里自动识别：含 HTML 标签则原样渲染，否则按 Markdown 渲染，
 * 保证两种来源都不再显示丑陋的原始标记文本。
 */
function ScriptContentView({ content }: { content: string }): React.ReactElement {
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(content);
  if (looksLikeHtml) {
    return (
      <div
        className="ql-editor"
        style={{ minHeight: '100%', boxSizing: 'border-box', cursor: 'default' }}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }}
      />
    );
  }
  return (
    <div
      className="ql-editor zx-script-md"
      style={{ minHeight: '100%', boxSizing: 'border-box', cursor: 'default' }}
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

// ===== Styles =====

const containerStyle = (): CSSProperties => ({
  display: 'flex', flexDirection: 'column', flex: 1,
  minHeight: 0, overflow: 'hidden',
});

