/**
 * ParagraphSelectorModal - 段落选择弹窗
 *
 * 在用户上传的文本未检测到章节标记时，展示段落选择弹窗，
 * 允许用户选择要导入的段落并选择处理方式。
 */
import { useState, useEffect, useMemo, useCallback, type CSSProperties } from 'react';
import { FileText, X } from 'lucide-react';
import { Modal, Checkbox, Radio } from 'antd';

export interface ParagraphSelectorModalProps {
  open: boolean;
  fileName: string;
  paragraphs: Array<{ index: number; content: string; charCount: number; autoSkip: boolean }>;
  autoSkipIndices: number[];
  divisionMode: 'empty_line' | 'char_count' | 'sentence';
  onDivisionModeChange: (mode: 'empty_line' | 'char_count' | 'sentence') => void;
  onConfirm: (selectedIndices: number[], processingMode: 'per_paragraph' | 'merge_all') => void;
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

export function ParagraphSelectorModal({
  open,
  fileName,
  paragraphs,
  autoSkipIndices,
  divisionMode,
  onDivisionModeChange,
  onConfirm,
  onCancel,
  theme: themeProp,
}: ParagraphSelectorModalProps): React.ReactElement {
  const theme = themeProp ?? { mode: 'light' as const, toolbar: { background: '#ffffff', text: '#1a1a1a', textMuted: '#999999', border: '#e5e5e5', accent: '#1677ff' } };
  const isDark = theme.mode === 'dark';

  // 初始选中状态：所有非 autoSkip 的段落默认勾选
  const safeAutoSkipIndices = autoSkipIndices ?? [];
  const initialSelectedIndices = useMemo(
    () => paragraphs.filter((p) => !safeAutoSkipIndices.includes(p.index)).map((p) => p.index),
    [paragraphs, safeAutoSkipIndices],
  );

  const [selectedIndices, setSelectedIndices] = useState<number[]>(initialSelectedIndices);
  const [processingMode, setProcessingMode] = useState<'per_paragraph' | 'merge_all'>('per_paragraph');
  const [showLongOnly, setShowLongOnly] = useState(false);

  // 每次打开弹窗时重置状态
  useEffect(() => {
    if (open) {
      setSelectedIndices(initialSelectedIndices);
      setProcessingMode('per_paragraph');
      setShowLongOnly(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 根据筛选条件显示段落
  const displayedParagraphs = useMemo(
    () => (showLongOnly ? paragraphs.filter((p) => p.charCount > 20) : paragraphs),
    [paragraphs, showLongOnly],
  );

  // 已选段落的统计数据
  const selectedParagraphs = useMemo(
    () => paragraphs.filter((p) => selectedIndices.includes(p.index)),
    [paragraphs, selectedIndices],
  );
  const totalSelectedChars = useMemo(
    () => selectedParagraphs.reduce((sum, p) => sum + p.charCount, 0),
    [selectedParagraphs],
  );
  const totalChars = useMemo(
    () => paragraphs.reduce((sum, p) => sum + p.charCount, 0),
    [paragraphs],
  );

  // 全选/取消全选（仅操作非 autoSkip 段落）
  const nonAutoSkipDisplayed = useMemo(
    () => displayedParagraphs.filter((p) => !p.autoSkip),
    [displayedParagraphs],
  );
  const allSelected = useMemo(
    () =>
      nonAutoSkipDisplayed.length > 0 &&
      nonAutoSkipDisplayed.every((p) => selectedIndices.includes(p.index)),
    [nonAutoSkipDisplayed, selectedIndices],
  );

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIndices((prev) => {
        const skipIds = new Set(nonAutoSkipDisplayed.map((p) => p.index));
        return prev.filter((idx) => !skipIds.has(idx));
      });
    } else {
      setSelectedIndices((prev) => {
        const set = new Set(prev);
        nonAutoSkipDisplayed.forEach((p) => set.add(p.index));
        return Array.from(set);
      });
    }
  }, [allSelected, nonAutoSkipDisplayed]);

  // 切换单个段落的选中状态
  const toggleParagraph = useCallback((index: number) => {
    setSelectedIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }, []);

  // 确认
  const handleConfirm = useCallback(() => {
    if (selectedIndices.length === 0) return;
    onConfirm(selectedIndices, processingMode);
  }, [selectedIndices, processingMode, onConfirm]);

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
  };
  const listContainerStyle: CSSProperties = {
    maxHeight: 360,
    overflowY: 'auto',
    padding: '4px 0',
  };
  const paragraphRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 24px',
    transition: 'background 0.1s',
    cursor: 'pointer',
  };
  const paragraphIndexStyle: CSSProperties = {
    fontSize: 12,
    color: textMuted,
    minWidth: 28,
    textAlign: 'right',
    flexShrink: 0,
    lineHeight: '22px',
  };
  const paragraphContentStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  const paragraphContentAutoSkipStyle: CSSProperties = {
    ...paragraphContentStyle,
    color: textMuted,
    fontStyle: 'italic',
  };
  const paragraphCharCountStyle: CSSProperties = {
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
  };
  const summaryHighlightStyle: CSSProperties = {
    color: accent,
    fontWeight: 600,
  };
  const modeSectionStyle: CSSProperties = {
    padding: '14px 24px',
    borderTop: `1px solid ${border}`,
  };
  const modeLabelStyle: CSSProperties = {
    fontSize: 13,
    color: text,
    marginBottom: 10,
    fontWeight: 500,
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

  // 内容预览
  const previewContent = (content: string): string => {
    if (content.length <= 50) return content;
    return content.slice(0, 50) + '...';
  };

  // 列表滚动条样式
  const listScrollbarStyle = `
    .paragraph-list::-webkit-scrollbar { width: 4px; }
    .paragraph-list::-webkit-scrollbar-thumb { background: ${border}; border-radius: 2px; }
  `;

  return (
    <>
      <style>{listScrollbarStyle}</style>
      <Modal
        open={open}
        onCancel={onCancel}
        centered
        width={600}
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
              {fileName} -- 未检测到章节标记
            </div>
            <div style={headerInfoStyle}>
              按空行分割为 {paragraphs.length} 段 &nbsp;|&nbsp; 共 {totalChars.toLocaleString()} chars
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
          <Checkbox checked={allSelected} indeterminate={!allSelected && nonAutoSkipDisplayed.some((p) => selectedIndices.includes(p.index))} onChange={toggleSelectAll}>
            <span style={{ fontSize: 13, color: text }}>全选</span>
          </Checkbox>
          <Checkbox checked={showLongOnly} onChange={() => setShowLongOnly((prev) => !prev)}>
            <span style={{ fontSize: 13, color: text }}>只看长段落</span>
          </Checkbox>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: textMuted }}>分割方式</span>
            <Radio.Group
              value={divisionMode}
              size="small"
              onChange={(e) => onDivisionModeChange(e.target.value)}
            >
              <Radio.Button value="empty_line" style={{ fontSize: 12 }}>按空行</Radio.Button>
              <Radio.Button value="char_count" style={{ fontSize: 12 }}>按字符数</Radio.Button>
              <Radio.Button value="sentence" style={{ fontSize: 12 }}>按句号</Radio.Button>
            </Radio.Group>
          </div>
        </div>

        {/* Paragraph List */}
        <div className="paragraph-list" style={listContainerStyle}>
          {displayedParagraphs.map((p) => {
            const isSelected = selectedIndices.includes(p.index);
            const isAutoSkip = p.autoSkip;
            return (
              <div
                key={p.index}
                style={{
                  ...paragraphRowStyle,
                  background:
                    isAutoSkip && !isSelected
                      ? 'transparent'
                      : isSelected
                        ? isDark
                          ? 'rgba(255,255,255,0.03)'
                          : 'rgba(0,0,0,0.02)'
                        : 'transparent',
                }}
                onClick={() => toggleParagraph(p.index)}
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
                  onChange={() => toggleParagraph(p.index)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span style={paragraphIndexStyle}>{p.index + 1}</span>
                <span
                  style={isAutoSkip ? paragraphContentAutoSkipStyle : paragraphContentStyle}
                  title={p.content}
                >
                  {previewContent(p.content)}
                  {isAutoSkip && <span style={{ color: textMuted, marginLeft: 4 }}>(自动跳过)</span>}
                </span>
                <span style={paragraphCharCountStyle}>{p.charCount.toLocaleString()} ch</span>
              </div>
            );
          })}
          {displayedParagraphs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: textMuted, fontSize: 13 }}>
              没有符合条件的段落
            </div>
          )}
        </div>

        {/* Summary */}
        <div style={summaryStyle}>
          <span>
            已选 <span style={summaryHighlightStyle}>{selectedParagraphs.length}</span> 段
          </span>
          <span style={{ color: textMuted }}>
            共 <span style={{ color: text }}>{totalSelectedChars.toLocaleString()}</span> chars
          </span>
        </div>

        {/* Processing Mode */}
        <div style={modeSectionStyle}>
          <div style={modeLabelStyle}>处理方式</div>
          <Radio.Group
            value={processingMode}
            onChange={(e) => setProcessingMode(e.target.value)}
          >
            <Radio value="per_paragraph" style={{ color: text }}>
              <span style={{ fontSize: 13, color: text }}>每段作为一集</span>
            </Radio>
            <Radio value="merge_all" style={{ color: text, marginLeft: 24 }}>
              <span style={{ fontSize: 13, color: text }}>合并所有段落</span>
            </Radio>
          </Radio.Group>
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <button type="button" style={ghostBtn} onClick={onCancel}>
            重新检测
          </button>
          <button
            type="button"
            style={selectedParagraphs.length === 0 ? disabledBtn : primaryBtn}
            disabled={selectedParagraphs.length === 0}
            onClick={handleConfirm}
          >
            确认导入 {selectedParagraphs.length} 段
          </button>
        </div>
      </Modal>
    </>
  );
}