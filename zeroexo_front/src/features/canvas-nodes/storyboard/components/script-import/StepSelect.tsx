/**
 * StepSelect - 步骤 1：选择文本素材来源
 *
 * 用户可以从素材库选择已有文本资产，或上传新文件（自动存入素材库）。
 * 所有文本支持 MD/TEXT/HTML 切换查看。
 */
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FileText, Loader2, Eye, Search } from 'lucide-react';
import { Input, Tooltip } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { useAssets } from '@/features/asset-picker/use-assets.js';
import { TextPreviewModal } from './TextPreviewModal.js';
import type { TextAssetItem } from './types.js';

/** 统一 token 估算：按 1.5 chars/token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5);
}

/** 从 asset 中提取纯文本内容 */
function extractTextContent(asset: any): string {
  if (asset.data.kind !== 'zeroexo-text') return '';
  try {
    const parsed = JSON.parse(asset.data.content);
    const units = parsed?.data?.units ?? [];
    return units.map((u: { content: string }) => u.content).join('\n\n');
  } catch {
    return asset.data.content;
  }
}

/** 从 asset 中提取章节数 */
function getChapterCount(asset: any): number {
  if (asset.data.kind !== 'zeroexo-text') return 0;
  try {
    const parsed = JSON.parse(asset.data.content);
    return parsed?.data?.units?.length ?? 0;
  } catch {
    return 0;
  }
}

export function StepSelect({
  onNext,
  onCancel,
}: {
  onNext: (assets: TextAssetItem[]) => void;
  onCancel: () => void;
}): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;
  const bgCard = isDark ? '#1a1715' : '#f5f2ec';

  const { assets, loading, refresh } = useAssets();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [previewItem, setPreviewItem] = useState<TextAssetItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const textAssets: TextAssetItem[] = assets
    .filter((a) => (a.kind as string) === 'zeroexo-text')
    .map((a) => ({
      id: a.id,
      title: a.title,
      content: extractTextContent(a),
      chapters: getChapterCount(a),
      bytes: a.bytes,
      estimatedTokens: estimateTokens(extractTextContent(a)),
    }));

  const filteredAssets = searchQuery
    ? textAssets.filter((a) => a.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : textAssets;

  const allSelected = textAssets.length > 0 && selectedIds.size === textAssets.length;
  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(textAssets.map((a) => a.id)));
    }
  }, [allSelected, textAssets]);

  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleUpload = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.docx';
    input.multiple = false;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const text = await file.text();
        const mod = await import('@/features/asset-picker/index.js');
        await mod.addAsset({
          title: file.name,
          kind: 'zeroexo-text' as any,
          bytes: file.size,
          mimeType: file.type || 'text/plain',
          data: {
            kind: 'zeroexo-text' as any,
            content: JSON.stringify({
              data: {
                units: [{ content: text }],
              },
            }),
          },
        });
        await refresh();
      } catch (err) {
        console.error('上传失败', err);
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }, [refresh]);

  const selectedAssets = textAssets.filter((a) => selectedIds.has(a.id));
  const totalTokens = selectedAssets.reduce((sum, a) => sum + a.estimatedTokens, 0);
  const totalChars = selectedAssets.reduce((sum, a) => sum + a.content.length, 0);

  const handleNext = useCallback(() => {
    if (selectedAssets.length === 0) return;
    onNext(selectedAssets);
  }, [selectedAssets, onNext]);

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Sora', system-ui, sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
          {t('scriptImport.selectTextAssets')}
        </h2>
        <p style={{ fontSize: 13, color: textMuted, margin: 0 }}>
          {t('scriptImport.selectTextAssetsDesc')}
        </p>
      </div>

      <div
        style={{
          border: `2px dashed ${border}`, borderRadius: 10, padding: '24px 20px',
          background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
          cursor: 'pointer', marginBottom: 16, textAlign: 'center',
        }}
        onClick={handleUpload}
      >
        <Upload size={28} style={{ color: accent, marginBottom: 6 }} />
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
          {uploading ? t('scriptImport.uploading') : t('scriptImport.clickUpload')}
        </div>
        <div style={{ fontSize: 11, color: textMuted }}>{t('scriptImport.supportedFormats')}</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Input
          size="small"
          prefix={<Search size={13} style={{ opacity: 0.5 }} />}
          placeholder={t('scriptImport.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          allowClear
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t('scriptImport.existingAssets')}
          </span>
          {textAssets.length > 0 && (
            <label style={{ fontSize: 11, color: textMuted, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={allSelected} onChange={handleToggleAll} style={{ accentColor: accent }} />
              {t('scriptImport.toggleAll')}
            </label>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Loader2 size={20} style={{ color: textMuted, animation: 'spin 1s linear infinite' }} />
          </div>
        ) : filteredAssets.length === 0 ? (
          <div style={{ fontSize: 12, color: textMuted, padding: '24px 14px', textAlign: 'center', border: `1px solid ${border}`, borderRadius: 8, background: bgCard }}>
            {searchQuery ? t('scriptImport.noMatchingAssets') : t('scriptImport.noAssets')}
          </div>
        ) : (
          <div style={{ maxHeight: 280, overflow: 'auto', border: `1px solid ${border}`, borderRadius: 8 }}>
            {filteredAssets.map((item) => {
              const isSelected = selectedIds.has(item.id);
              return (
                <div key={item.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderBottom: `1px solid ${border}`,
                  background: isSelected ? `${accent}08` : 'transparent',
                }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggle(item.id)}
                    style={{ accentColor: accent, flexShrink: 0 }}
                  />
                  <FileText size={14} style={{ color: textMuted, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 10, color: textMuted, marginTop: 1 }}>
                      {t('scriptImport.chapterStats', { chapters: item.chapters, size: (item.bytes / 1024).toFixed(1) })}
                    </div>
                  </div>
                  <Tooltip title={t('scriptImport.estimatedTokens')}>
                    <span style={{ fontSize: 10, color: textMuted, whiteSpace: 'nowrap' }}>
                      ~{item.estimatedTokens.toLocaleString()} tokens
                    </span>
                  </Tooltip>
                  <button
                    type="button"
                    onClick={() => setPreviewItem(item)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      padding: '3px 8px', borderRadius: 4, border: `1px solid ${border}`,
                      background: 'transparent', color: textMuted, fontSize: 10,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    <Eye size={10} /> {t('scriptImport.preview')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', border: `1px solid ${border}`, borderRadius: 8,
        background: bgCard, marginBottom: 16,
      }}>
        <span style={{ fontSize: 12, color: textMuted }}>
          {t('scriptImport.selectedCount', { count: selectedAssets.length })}
        </span>
        {selectedAssets.length > 0 && (
          <span style={{ fontSize: 11, color: textMuted }}>
            {t('scriptImport.selectStats', { chars: totalChars.toLocaleString(), tokens: totalTokens.toLocaleString() })}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <button type="button" onClick={onCancel} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 20px', borderRadius: 8, border: `1px solid ${border}`,
          background: 'transparent', color: textMuted, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          {t('common.cancel')}
        </button>
        <button type="button" onClick={handleNext} disabled={selectedAssets.length === 0}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 24px', borderRadius: 8, border: 'none',
            background: selectedAssets.length > 0 ? accent : (isDark ? '#262626' : '#e5e5e5'),
            color: selectedAssets.length > 0 ? '#fff' : textMuted,
            fontSize: 13, fontWeight: 600, cursor: selectedAssets.length > 0 ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}>
          {t('storyboard.nextStep')}
        </button>
      </div>

      {previewItem && (
        <TextPreviewModal
          open={true}
          onClose={() => setPreviewItem(null)}
          title={previewItem.title}
          content={previewItem.content}
        />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}