/**
 * SourceMaterialPanel - 项目级原材料面板
 *
 * 展示已处理的 .zeroexo 资产，支持上传文件、粘贴文本、
 * 查看、生成剧本、删除等操作。
 */
import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Upload, Plus, BookOpen, X, Loader2, FileType } from 'lucide-react';
import { App as AntdApp, Modal } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { detectStructure } from '@/shared/utils/chapter-detector.js';
import { buildZeroexoText } from '@/shared/utils/zeroexo-builder.js';
import { apiGet, apiPost, apiDelete } from '@/services/api-client.js';
import { ParagraphSelectorModal } from './paragraph-selector-modal.js';
import { Z_INDEX } from '@/shared/constants/z-index.js';

// ─── 类型定义 ───────────────────────────────────────────────────────

export interface SourceMaterialPanelProps {
  projectId: string;
  visible: boolean;
  onClose: () => void;
}

/** 后端返回的 SourceMaterial 条目 */
interface SourceMaterialItem {
  id: string;
  assetId: string;
  title: string;
  description?: string;
  charCount: number;
  episodeCount?: number;
  status: 'imported' | 'pending' | 'processing';
  createdAt: number;
  updatedAt: number;
}

/** 章节选择弹窗数据 */
interface ChapterSelectData {
  rawText: string;
  fileName: string;
  structure: ReturnType<typeof detectStructure>;
}

// ─── 样式常量 ───────────────────────────────────────────────────────

const PANEL_WIDTH = 420;

// ─── 组件 ───────────────────────────────────────────────────────────

export function SourceMaterialPanel({
  projectId,
  visible,
  onClose,
}: SourceMaterialPanelProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { message: antdMessage } = AntdApp.useApp();
  const isDark = theme.mode === 'dark';
  const panelBg = theme.toolbar.panel;
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;
  const accent = theme.toolbar.accent;
  const danger = theme.toolbar.danger;

  // ── 数据状态 ──
  const [materials, setMaterials] = useState<SourceMaterialItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  // ── 弹窗状态 ──
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [chapterSelectData, setChapterSelectData] = useState<ChapterSelectData | null>(null);
  const [chapterSelectOpen, setChapterSelectOpen] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState<number[]>([]);
  const [paragraphSelectOpen, setParagraphSelectOpen] = useState(false);
  const [paragraphData, setParagraphData] = useState<{
    fileName: string;
    paragraphs: Array<{ index: number; content: string; charCount: number; autoSkip: boolean }>;
    autoSkipIndices: number[];
    rawText: string;
  } | null>(null);
  const [divisionMode, setDivisionMode] = useState<'empty_line' | 'char_count' | 'sentence'>('empty_line');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 数据获取 ──
  const fetchMaterials = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      // TODO: 连接后端 API - GET /projects/:projectId/source-materials
      const data = await apiGet<SourceMaterialItem[]>(
        `/projects/${projectId}/source-materials`,
      );
      setMaterials(data ?? []);
    } catch {
      antdMessage.error(t('sourceMaterial.fetchListFailed'));
      setMaterials([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, antdMessage]);

  useEffect(() => {
    if (visible && projectId) {
      fetchMaterials();
    }
  }, [visible, projectId, fetchMaterials]);

  // ── 上传文件 ──
  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file) return;
    const allowedTypes = ['.txt', '.docx', '.md', '.pdf'];
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowedTypes.includes(ext)) {
      antdMessage.warning(t('sourceMaterial.fileTypeNotSupported'));
      return;
    }

    setUploading(true);
    try {
      // 读取文件内容
      const rawText = await readFileAsText(file);

      // 检测结构
      const structure = detectStructure(rawText);

      if (structure.structure === 'chaptered') {
        // 打开章节选择弹窗
        setChapterSelectData({
          rawText,
          fileName: file.name,
          structure,
        });
        setSelectedChapters(
          structure.chapters
            .filter((c) => !structure.autoSkipIndices.includes(c.index))
            .map((c) => c.index),
        );
        setChapterSelectOpen(true);
      } else {
        // 段落模式 → 打开段落选择弹窗
        setParagraphData({
          fileName: file.name,
          paragraphs: structure.paragraphs,
          autoSkipIndices: structure.autoSkipIndices,
          rawText,
        });
        setParagraphSelectOpen(true);
      }
    } catch {
      antdMessage.error(t('sourceMaterial.fileReadFailed'));
    } finally {
      setUploading(false);
      // 重置 input 以允许重复选择同一文件
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [antdMessage]);

  // ── 粘贴文本 ──
  const handlePasteDetect = useCallback(async () => {
    if (!pasteText.trim()) {
      antdMessage.warning(t('sourceMaterial.pasteEmpty'));
      return;
    }

    setDetecting(true);
    try {
      const structure = detectStructure(pasteText);

      if (structure.structure === 'chaptered') {
        setChapterSelectData({
          rawText: pasteText,
          fileName: `粘贴文本_${Date.now()}`,
          structure,
        });
        setSelectedChapters(
          structure.chapters
            .filter((c) => !structure.autoSkipIndices.includes(c.index))
            .map((c) => c.index),
        );
        setChapterSelectOpen(true);
        setPasteModalOpen(false);
      } else {
        setParagraphData({
          fileName: `粘贴文本_${Date.now()}`,
          paragraphs: structure.paragraphs,
          autoSkipIndices: structure.autoSkipIndices,
          rawText: pasteText,
        });
        setParagraphSelectOpen(true);
        setPasteModalOpen(false);
      }
    } catch {
      antdMessage.error(t('sourceMaterial.textDetectFailed'));
    } finally {
      setDetecting(false);
    }
  }, [pasteText, antdMessage]);

  // ── 构建并上传 .zeroexo ──
  const handleBuildAndUpload = useCallback(async (
    rawText: string,
    structure: ReturnType<typeof detectStructure>,
    selectedIndices: number[],
    fileName: string,
  ) => {
    setUploading(true);
    try {
      // 构建 .zeroexo 产物
      const zeroexoData = buildZeroexoText(rawText, structure, selectedIndices, fileName);

      // TODO: 连接后端 API - POST /projects/:projectId/source-materials
      const result = await apiPost<{ id: string }>(
        `/projects/${projectId}/source-materials`,
        {
          ...zeroexoData,
          // 附加元数据
          source: {
            ...zeroexoData.source,
            projectId,
          },
        },
      );

      if (result) {
        antdMessage.success(t('sourceMaterial.importSuccess'));
        setChapterSelectOpen(false);
        setParagraphSelectOpen(false);
        setChapterSelectData(null);
        setParagraphData(null);
        setPasteText('');
        fetchMaterials();
      }
    } catch {
      antdMessage.error(t('sourceMaterial.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }, [projectId, antdMessage, fetchMaterials]);

  // ── 章节确认回调 ──
  const handleChapterConfirm = useCallback(() => {
    if (!chapterSelectData) return;
    handleBuildAndUpload(
      chapterSelectData.rawText,
      chapterSelectData.structure,
      selectedChapters,
      chapterSelectData.fileName,
    );
  }, [chapterSelectData, selectedChapters, handleBuildAndUpload]);

  // ── 段落确认回调 ──
  const handleParagraphConfirm = useCallback((
    selectedIndices: number[],
    _processingMode: 'per_paragraph' | 'merge_all',
  ) => {
    if (!paragraphData) return;
    const structure = detectStructure(paragraphData.rawText);
    handleBuildAndUpload(
      paragraphData.rawText,
      structure,
      selectedIndices,
      paragraphData.fileName,
    );
  }, [paragraphData, handleBuildAndUpload]);

  // ── 删除素材 ──
  const handleDelete = useCallback(async (material: SourceMaterialItem) => {
    try {
      // TODO: 连接后端 API - DELETE /projects/:projectId/source-materials/:id
      await apiDelete(`/projects/${projectId}/source-materials/${material.id}`);
      antdMessage.success(t('sourceMaterial.deleteSuccess'));
      fetchMaterials();
    } catch {
      antdMessage.error(t('sourceMaterial.deleteFailed'));
    }
  }, [projectId, antdMessage, fetchMaterials]);

  // ── 查看素材 ──
  const handleView = useCallback((_material: SourceMaterialItem) => {
    // TODO: 打开对应 asset-viewer
    // 使用 assetViewerRegistry 查找查看器组件
    antdMessage.info(t('sourceMaterial.viewPending'));
  }, [antdMessage]);

  // ── 生成剧本 ──
  const handleGenerateScript = useCallback((_material: SourceMaterialItem) => {
    // TODO: 进入 LLM 剧本格式化流程
    antdMessage.info(t('sourceMaterial.generateScriptPending'));
  }, [antdMessage]);

  // ── 统计 ──
  const totalChars = useMemo(
    () => materials.reduce((sum, m) => sum + m.charCount, 0),
    [materials],
  );

  // ── 主题色 ──
  const panelStyle: CSSProperties = {
    position: 'fixed',
    top: 0,
    right: 0,
    width: PANEL_WIDTH,
    height: '100vh',
    background: panelBg,
    borderLeft: `1px solid ${border}`,
    display: 'flex',
    flexDirection: 'column',
    zIndex: Z_INDEX.DROPDOWN,
    transform: visible ? 'translateX(0)' : 'translateX(100%)',
    transition: 'transform 0.25s ease',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: `1px solid ${border}`,
    flexShrink: 0,
  };

  const headerTitleStyle: CSSProperties = {
    fontSize: 16,
    fontWeight: 700,
    fontFamily: "'Sora', system-ui, sans-serif",
    color: text,
    margin: 0,
  };

  const actionBarStyle: CSSProperties = {
    display: 'flex',
    gap: 8,
    padding: '12px 20px',
    borderBottom: `1px solid ${border}`,
    flexShrink: 0,
  };

  const actionBtnStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 8,
    border: `1px solid ${border}`,
    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    color: text,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flex: 1,
    justifyContent: 'center',
    transition: 'all 0.15s',
  };

  const listStyle: CSSProperties = {
    flex: 1,
    overflow: 'auto',
    padding: '12px 16px',
  };

  const cardStyle: CSSProperties = {
    border: `1px solid ${border}`,
    borderRadius: 10,
    padding: '14px 16px',
    marginBottom: 10,
    background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
  };

  const cardTitleStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    fontWeight: 600,
    color: text,
    marginBottom: 8,
  };

  const statStyle: CSSProperties = {
    fontSize: 11,
    color: textMuted,
    marginBottom: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  };

  const tagStyle: CSSProperties = {
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 4,
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
  };

  const actionRowStyle: CSSProperties = {
    display: 'flex',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTop: `1px solid ${border}`,
  };

  const smallBtnStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    borderRadius: 6,
    border: 'none',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  };

  const footerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    borderTop: `1px solid ${border}`,
    fontSize: 11,
    color: textMuted,
    flexShrink: 0,
  };

  const emptyStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
    color: textMuted,
    textAlign: 'center',
  };

  return (
    <>
      {/* 面板遮罩 */}
      {visible && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: Z_INDEX.NODE_CREATE_MENU,
            background: 'transparent',
          }}
        />
      )}

      {/* 主面板 */}
      <div style={panelStyle}>
        {/* 头部 */}
        <div style={headerStyle}>
          <h3 style={headerTitleStyle}>{t('sourceMaterial.panelTitle')}</h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: textMuted,
              padding: 4,
              display: 'flex',
              borderRadius: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 操作栏 */}
        <div style={actionBarStyle}>
          <button
            type="button"
            style={actionBtnStyle}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 size={14} /> : <Upload size={14} />}
            {t('sourceMaterial.uploadFile')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.docx,.md,.pdf"
            onChange={handleFileSelected}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            style={actionBtnStyle}
            onClick={() => setPasteModalOpen(true)}
          >
            <Plus size={14} />
            {t('sourceMaterial.pasteText')}
          </button>
        </div>

        {/* 素材列表 */}
        <div style={listStyle}>
          {loading ? (
            <div style={emptyStyle}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
              <span style={{ fontSize: 12 }}>{t('common.loading')}</span>
            </div>
          ) : materials.length === 0 ? (
            <div style={emptyStyle}>
              <BookOpen size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('sourceMaterial.emptyTitle')}</div>
              <div style={{ fontSize: 11 }}>{t('sourceMaterial.emptyHint')}</div>
            </div>
          ) : (
            materials.map((material) => (
              <div key={material.id} style={cardStyle}>
                {/* 标题行 */}
                <div style={cardTitleStyle}>
                  <BookOpen size={16} style={{ color: accent, flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {material.title}
                  </span>
                </div>

                {/* 统计信息 */}
                <div style={statStyle}>
                  <FileType size={11} />
                  {material.charCount.toLocaleString()} chars
                </div>

                <div style={statStyle}>
                  {material.status === 'imported' ? (
                    <span style={{ ...tagStyle, background: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                      {t('sourceMaterial.statusImported')}
                    </span>
                  ) : material.status === 'processing' ? (
                    <span style={{ ...tagStyle, background: isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
                      {t('sourceMaterial.statusProcessing')}
                    </span>
                  ) : (
                    <span style={{ ...tagStyle, background: isDark ? 'rgba(234,179,8,0.15)' : 'rgba(234,179,8,0.1)', color: '#eab308' }}>
                      {t('sourceMaterial.statusPending')}
                    </span>
                  )}
                  {material.episodeCount != null && (
                    <span style={{ marginLeft: 8 }}>
                      · {t('sourceMaterial.episodeCount', { count: material.episodeCount })}
                    </span>
                  )}
                </div>

                {/* 操作按钮 */}
                <div style={actionRowStyle}>
                  <button
                    type="button"
                    style={{ ...smallBtnStyle, color: accent, background: 'transparent' }}
                    onClick={() => handleView(material)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <FileText size={11} />
                    {t('common.view')}
                  </button>
                  <button
                    type="button"
                    style={{ ...smallBtnStyle, color: accent, background: 'transparent' }}
                    onClick={() => handleGenerateScript(material)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Plus size={11} />
                    {t('sourceMaterial.generateScript')}
                  </button>
                  <button
                    type="button"
                    style={{ ...smallBtnStyle, color: textMuted, background: 'transparent', marginLeft: 'auto' }}
                    onClick={() => handleDelete(material)}
                    onMouseEnter={(e) => { e.currentTarget.style.color = danger; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = textMuted; }}
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 底部统计 */}
        {materials.length > 0 && (
          <div style={footerStyle}>
            <span>{t('sourceMaterial.footerCount', { count: materials.length })}</span>
            <span>{totalChars.toLocaleString()} chars</span>
          </div>
        )}
      </div>

      {/* 粘贴文本弹窗 */}
      <Modal
        title={t('sourceMaterial.pasteText')}
        open={pasteModalOpen}
        onCancel={() => setPasteModalOpen(false)}
        onOk={handlePasteDetect}
        okText={detecting ? t('sourceMaterial.detecting') : t('sourceMaterial.detectStructure')}
        confirmLoading={detecting}
        destroyOnHidden
        width={520}
        styles={{
          body: { padding: '16px 24px' },
        }}
      >
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={t('sourceMaterial.pastePlaceholder')}
          style={{
            width: '100%',
            minHeight: 200,
            padding: 12,
            borderRadius: 8,
            border: `1px solid ${border}`,
            background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
            color: text,
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
            lineHeight: 1.6,
          }}
        />
        <div style={{ fontSize: 11, color: textMuted, marginTop: 8 }}>
          {t('sourceMaterial.charCount', { count: pasteText.length })}
        </div>
      </Modal>

      {/* 章节选择弹窗 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookOpen size={16} style={{ color: accent }} />
            <span>{t('sourceMaterial.chapterModalTitle', { fileName: chapterSelectData?.fileName ?? '' })}</span>
          </div>
        }
        open={chapterSelectOpen}
        onCancel={() => setChapterSelectOpen(false)}
        onOk={handleChapterConfirm}
        okText={uploading ? t('sourceMaterial.uploading') : t('sourceMaterial.confirmImportChapters', { count: selectedChapters.length })}
        confirmLoading={uploading}
        destroyOnHidden
        width={600}
        styles={{
          body: { padding: '16px 24px', maxHeight: 480, overflow: 'auto' },
        }}
      >
        {chapterSelectData && (
          <div>
            {/* 全选/取消 */}
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button"
                onClick={() => {
                  const allNonSkip = chapterSelectData.structure.chapters
                    .filter((c) => !chapterSelectData.structure.autoSkipIndices.includes(c.index))
                    .map((c) => c.index);
                  const allSelected = allNonSkip.every((i) => selectedChapters.includes(i));
                  setSelectedChapters(
                    allSelected
                      ? selectedChapters.filter((i) => !allNonSkip.includes(i))
                      : [...new Set([...selectedChapters, ...allNonSkip])],
                  );
                }}
                style={{
                  background: 'transparent',
                  border: `1px solid ${border}`,
                  borderRadius: 6,
                  padding: '4px 12px',
                  fontSize: 11,
                  color: textMuted,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {chapterSelectData.structure.chapters
                  .filter((c) => !chapterSelectData.structure.autoSkipIndices.includes(c.index))
                  .every((i) => selectedChapters.includes(i.index))
                  ? t('sourceMaterial.deselectAll')
                  : t('sourceMaterial.selectAll')}
              </button>
              <span style={{ fontSize: 11, color: textMuted }}>
                {t('sourceMaterial.selectedChapters', { selected: selectedChapters.length, total: chapterSelectData.structure.chapters.length })}
                {' | '}
                {t('sourceMaterial.totalChars', { count: selectedChapters.reduce((sum, idx) => {
                  const ch = chapterSelectData.structure.chapters.find((c) => c.index === idx);
                  return sum + (ch?.charCount ?? 0);
                }, 0).toLocaleString() })}
              </span>
            </div>

            {/* 章节列表 */}
            {chapterSelectData.structure.chapters.map((chapter) => {
              const isAutoSkip = chapterSelectData.structure.autoSkipIndices.includes(chapter.index);
              const isSelected = selectedChapters.includes(chapter.index);
              return (
                <label
                  key={chapter.index}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    marginBottom: 4,
                    background: isSelected
                      ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
                      : 'transparent',
                    cursor: 'pointer',
                    opacity: isAutoSkip ? 0.5 : 1,
                    border: `1px solid ${isSelected ? accent : 'transparent'}`,
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={isAutoSkip}
                    onChange={() => {
                      setSelectedChapters((prev) =>
                        prev.includes(chapter.index)
                          ? prev.filter((i) => i !== chapter.index)
                          : [...prev, chapter.index],
                      );
                    }}
                    style={{ accentColor: accent, marginTop: 2 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: text, marginBottom: 2 }}>
                      {chapter.title || t('sourceMaterial.chapterTitle', { number: chapter.index + 1 })}
                    </div>
                    <div style={{ fontSize: 11, color: textMuted }}>
                      {chapter.charCount.toLocaleString()} chars
                      {isAutoSkip && ' ' + t('sourceMaterial.autoSkip')}
                    </div>
                    <div style={{
                      fontSize: 11,
                      color: textMuted,
                      marginTop: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {chapter.content.slice(0, 120)}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </Modal>

      {/* 段落选择弹窗 — 复用已有 ParagraphSelectorModal */}
      {paragraphData && (
        <ParagraphSelectorModal
          theme={theme}
          open={paragraphSelectOpen}
          fileName={paragraphData.fileName}
          paragraphs={paragraphData.paragraphs}
          autoSkipIndices={paragraphData.autoSkipIndices}
          divisionMode={divisionMode}
          onDivisionModeChange={setDivisionMode}
          onConfirm={handleParagraphConfirm}
          onCancel={() => {
            setParagraphSelectOpen(false);
            setParagraphData(null);
          }}
        />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

// ─── 工具函数 ───────────────────────────────────────────────────────

/** 读取 File 为文本字符串：UTF-8 优先，失败回落 GB18030（修复 Windows 中文 txt 常见 GBK 编码导致的中文乱码） */
async function readFileAsText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    // 严格 UTF-8：非法字节序列会抛错，据此判定非 UTF-8 文件
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      // GB18030 是 GBK/GB2312 超集，兼容 Windows 中文 txt 常见编码
      return new TextDecoder('gb18030').decode(buf);
    } catch {
      return new TextDecoder('utf-8').decode(buf);
    }
  }
}