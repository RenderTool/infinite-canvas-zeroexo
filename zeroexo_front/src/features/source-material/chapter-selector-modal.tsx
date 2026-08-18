/**
 * ChapterSelectorModal - 章节选择弹窗
 *
 * 在用户上传并检测到章节后，展示弹窗让用户选择保留哪些章节。
 * 支持搜索过滤、模型选择、Token/费用估算。
 */
import { useState, useEffect, useMemo, useCallback, type CSSProperties } from 'react';
import { Search, X, FileText } from 'lucide-react';
import { Modal, Checkbox, Select, Input } from 'antd';
import { estimateTokenCost } from '@/shared/utils/token-estimator';
import { getModelPricing, MODEL_PRICING_LIST } from '@/shared/utils/model-pricing';

export interface ChapterSelectorModalProps {
  open: boolean;
  fileName: string;
  chapters: Array<{ index: number; title: string; content?: string; charCount: number; autoSkip: boolean }>;
  autoSkipIndices: number[];
  onConfirm: (selectedIndices: number[]) => void;
  onCancel: () => void;
  theme?: {
    mode: 'light' | 'dark';
    toolbar: {
      background: string;
      text: string;
      textMuted: string;
      border: string;
      accent: string;
    };
  };
}

export function ChapterSelectorModal({
  open,
  fileName,
  chapters,
  autoSkipIndices,
  onConfirm,
  onCancel,
  theme: themeProp,
}: ChapterSelectorModalProps): React.ReactElement {
  const theme = themeProp ?? { mode: 'light' as const, toolbar: { background: '#ffffff', text: '#1a1a1a', textMuted: '#999999', border: '#e5e5e5', accent: '#1677ff' } };
  const isDark = theme.mode === 'dark';

  // 初始选中状态：所有非 autoSkip 的章节默认勾选
  const initialSelectedIndices = useMemo(
    () => chapters.filter((ch) => !autoSkipIndices.includes(ch.index)).map((ch) => ch.index),
    [chapters, autoSkipIndices],
  );

  const [selectedIndices, setSelectedIndices] = useState<number[]>(initialSelectedIndices);
  const [searchText, setSearchText] = useState('');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODEL_PRICING_LIST[0]?.id ?? 'gpt-4o');

  // 每次打开弹窗时重置状态
  useEffect(() => {
    if (open) {
      setSelectedIndices(initialSelectedIndices);
      setSearchText('');
      setShowSelectedOnly(false);
      setSelectedModel(MODEL_PRICING_LIST[0]?.id ?? 'gpt-4o');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 搜索过滤 + 只显示已选过滤
  const displayedChapters = useMemo(() => {
    let list = chapters;
    // 搜索过滤：按标题或序号过滤
    if (searchText.trim()) {
      const query = searchText.trim().toLowerCase();
      list = list.filter((ch) => {
        const indexStr = String(ch.index + 1);
        const titleLower = ch.title.toLowerCase();
        return indexStr.includes(query) || titleLower.includes(query);
      });
    }
    // 只显示已选
    if (showSelectedOnly) {
      list = list.filter((ch) => selectedIndices.includes(ch.index));
    }
    return list;
  }, [chapters, searchText, showSelectedOnly, selectedIndices]);

  // 已选章节的统计数据
  const selectedChapters = useMemo(
    () => chapters.filter((ch) => selectedIndices.includes(ch.index)),
    [chapters, selectedIndices],
  );
  const totalSelectedChars = useMemo(
    () => selectedChapters.reduce((sum, ch) => sum + ch.charCount, 0),
    [selectedChapters],
  );
  // Token 估算和费用
  const tokenEstimate = useMemo(() => {
    if (selectedChapters.length === 0) return null;
    const pricing = getModelPricing(selectedModel);
    if (!pricing) return null;
    return estimateTokenCost({
      unitCharCounts: selectedChapters.map((ch) => ch.charCount),
      pricing,
    });
  }, [selectedChapters, selectedModel]);

  // 当前模型定价
  const currentPricing = useMemo(
    () => getModelPricing(selectedModel),
    [selectedModel],
  );

  // autoSkip 章节数量
  const autoSkipCount = useMemo(
    () => chapters.filter((ch) => ch.autoSkip).length,
    [chapters],
  );

  // 全选/取消全选（仅操作非 autoSkip 章节）
  const nonAutoSkipDisplayed = useMemo(
    () => displayedChapters.filter((ch) => !ch.autoSkip),
    [displayedChapters],
  );
  const allSelected = useMemo(
    () =>
      nonAutoSkipDisplayed.length > 0 &&
      nonAutoSkipDisplayed.every((ch) => selectedIndices.includes(ch.index)),
    [nonAutoSkipDisplayed, selectedIndices],
  );

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIndices((prev) => {
        const skipIds = new Set(nonAutoSkipDisplayed.map((ch) => ch.index));
        return prev.filter((idx) => !skipIds.has(idx));
      });
    } else {
      setSelectedIndices((prev) => {
        const set = new Set(prev);
        nonAutoSkipDisplayed.forEach((ch) => set.add(ch.index));
        return Array.from(set);
      });
    }
  }, [allSelected, nonAutoSkipDisplayed]);

  // 切换单个章节的选中状态
  const toggleChapter = useCallback((index: number) => {
    setSelectedIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }, []);

  // 确认
  const handleConfirm = useCallback(() => {
    if (selectedIndices.length === 0) return;
    onConfirm(selectedIndices);
  }, [selectedIndices, onConfirm]);

  // 格式化字符数
  const formatCharCount = (count: number): string => count.toLocaleString();

  // ── 主题色 ──
  const bg = theme.toolbar.background;
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;
  const accent = theme.toolbar.accent;
  const bgHeader = isDark ? '#1f1f1f' : '#fafaf7';

  // ── 样式 ──
  const contentStyle: CSSProperties = {
    background: bg,
    padding: 0,
    overflow: 'hidden',
    borderRadius: 16,
    border: `1px solid ${border}`,
  };
  const modalBodyStyle: CSSProperties = { padding: 0, display: 'flex', flexDirection: 'column' };
  const maskStyle: CSSProperties = {
    background: 'transparent',
  };
  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 24px',
    borderBottom: `1px solid ${border}`,
    background: bgHeader,
  };
  const closeBtnStyle: CSSProperties = {
    width: 32,
    height: 32,
    border: 'none',
    borderRadius: 8,
    background: 'transparent',
    color: textMuted,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
    fontSize: 18,
  };
  const headerInfoStyle: CSSProperties = {
    fontSize: 12,
    color: textMuted,
    marginTop: 2,
  };
  const toolbarStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '12px 24px',
    borderBottom: `1px solid ${border}`,
    flexWrap: 'wrap',
  };
  const searchInputStyle: CSSProperties = {
    flex: 1,
    minWidth: 160,
  };
  const listContainerStyle: CSSProperties = {
    maxHeight: 400,
    overflowY: 'auto',
    padding: '4px 0',
  };
  const chapterRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 24px',
    transition: 'background 0.1s',
    cursor: 'pointer',
  };
  const chapterIndexStyle: CSSProperties = {
    fontSize: 12,
    color: textMuted,
    minWidth: 28,
    textAlign: 'right',
    flexShrink: 0,
    lineHeight: '22px',
  };
  const chapterTitleStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  const chapterTitleAutoSkipStyle: CSSProperties = {
    ...chapterTitleStyle,
    color: textMuted,
    fontStyle: 'italic',
  };
  const chapterCharCountStyle: CSSProperties = {
    fontSize: 11,
    color: textMuted,
    flexShrink: 0,
    marginLeft: 8,
    lineHeight: '22px',
  };
  const summaryStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 24px',
    borderTop: `1px solid ${border}`,
    fontSize: 13,
    color: text,
    flexWrap: 'wrap',
    gap: 4,
  };
  const summaryHighlightStyle: CSSProperties = {
    color: accent,
    fontWeight: 600,
  };
  const costSectionStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 24px',
    borderTop: `1px solid ${border}`,
    fontSize: 13,
    color: text,
    gap: 8,
  };
  const modelSelectStyle: CSSProperties = {
    minWidth: 150,
  };
  const footerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    padding: '14px 24px',
    borderTop: `1px solid ${border}`,
    background: bgHeader,
  };
  const btnBase: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 20px',
    border: 'none',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'inherit',
  };
  const primaryBtn: CSSProperties = { ...btnBase, background: accent, color: '#fff' };
  const ghostBtn: CSSProperties = {
    ...btnBase,
    border: `1px solid ${border}`,
    background: 'transparent',
    color: textMuted,
  };
  const disabledBtn: CSSProperties = { ...primaryBtn, opacity: 0.5, cursor: 'not-allowed' };

  // 列表滚动条样式
  const listScrollbarStyle = `
    .chapter-list::-webkit-scrollbar { width: 4px; }
    .chapter-list::-webkit-scrollbar-thumb { background: ${border}; border-radius: 2px; }
  `;

  return (
    <>
      <style>{listScrollbarStyle}</style>
      <Modal
        open={open}
        onCancel={onCancel}
        centered
        width={640}
        footer={null}
        destroyOnHidden
        closeIcon={null}
        styles={{ container: contentStyle, body: modalBodyStyle, mask: maskStyle }}
      >
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: text, letterSpacing: '0.3px' }}>
              <FileText
                size={18}
                style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8, color: textMuted }}
              />
              {fileName} -- 检测到 {chapters.length} 章
            </div>
            <div style={headerInfoStyle}>
              章节模式 &nbsp;|&nbsp; 跳过 {autoSkipCount} 章
            </div>
          </div>
          <button
            type="button"
            style={closeBtnStyle}
            onClick={onCancel}
            aria-label="关闭"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
              e.currentTarget.style.color = text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = textMuted;
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Toolbar */}
        <div style={toolbarStyle}>
          <Checkbox
            checked={allSelected}
            indeterminate={!allSelected && nonAutoSkipDisplayed.some((ch) => selectedIndices.includes(ch.index))}
            onChange={toggleSelectAll}
          >
            <span style={{ fontSize: 13, color: text }}>全选</span>
          </Checkbox>
          <Checkbox checked={showSelectedOnly} onChange={() => setShowSelectedOnly((prev) => !prev)}>
            <span style={{ fontSize: 13, color: text }}>只显示已选</span>
          </Checkbox>
          <Input
            placeholder="搜索章节..."
            prefix={<Search size={14} style={{ color: textMuted }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            size="small"
            style={searchInputStyle}
            allowClear
          />
        </div>

        {/* Chapter List */}
        <div className="chapter-list" style={listContainerStyle}>
          {displayedChapters.map((ch) => {
            const isSelected = selectedIndices.includes(ch.index);
            const isAutoSkip = ch.autoSkip;
            return (
              <div
                key={ch.index}
                style={{
                  ...chapterRowStyle,
                  background:
                    isAutoSkip && !isSelected
                      ? 'transparent'
                      : isSelected
                        ? isDark
                          ? 'rgba(255,255,255,0.03)'
                          : 'rgba(0,0,0,0.02)'
                        : 'transparent',
                }}
                onClick={() => toggleChapter(ch.index)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background =
                    isAutoSkip && !isSelected
                      ? 'transparent'
                      : isSelected
                        ? isDark
                          ? 'rgba(255,255,255,0.03)'
                          : 'rgba(0,0,0,0.02)'
                        : 'transparent';
                }}
              >
                <Checkbox
                  checked={isSelected}
                  onChange={() => toggleChapter(ch.index)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span style={chapterIndexStyle}>{ch.index + 1}</span>
                <span
                  style={isAutoSkip ? chapterTitleAutoSkipStyle : chapterTitleStyle}
                  title={ch.title}
                >
                  {ch.title}
                  {isAutoSkip && <span style={{ color: textMuted, marginLeft: 4 }}>(自动跳过)</span>}
                </span>
                <span style={chapterCharCountStyle}>{formatCharCount(ch.charCount)} ch</span>
              </div>
            );
          })}
          {displayedChapters.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: textMuted, fontSize: 13 }}>
              没有符合条件的章节
            </div>
          )}
        </div>

        {/* Summary */}
        <div style={summaryStyle}>
          <span>
            已选 <span style={summaryHighlightStyle}>{selectedChapters.length}</span> 章
          </span>
          <span style={{ color: textMuted }}>
            共 <span style={{ color: text }}>{formatCharCount(totalSelectedChars)}</span> chars
          </span>
          {tokenEstimate && (
            <span style={{ color: textMuted }}>
              &asymp; {tokenEstimate.totalTokens.toLocaleString()} tokens
            </span>
          )}
        </div>

        {/* Model & Cost */}
        <div style={costSectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: textMuted, flexShrink: 0 }}>模型:</span>
            <Select
              value={selectedModel}
              onChange={(value) => setSelectedModel(value)}
              size="small"
              style={modelSelectStyle}
              options={MODEL_PRICING_LIST.map((m) => ({ value: m.id, label: m.label }))}
            />
          </div>
          <span style={{ color: textMuted }}>
            {tokenEstimate && currentPricing
              ? `&asymp; $${tokenEstimate.estimatedCost.toFixed(4)}`
              : '--'}
          </span>
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <button type="button" style={ghostBtn} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            style={selectedChapters.length === 0 ? disabledBtn : primaryBtn}
            disabled={selectedChapters.length === 0}
            onClick={handleConfirm}
          >
            确认导入 {selectedChapters.length} 章
          </button>
        </div>
      </Modal>
    </>
  );
}