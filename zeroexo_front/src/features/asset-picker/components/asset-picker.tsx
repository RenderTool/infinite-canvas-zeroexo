/**
 * AssetPicker - 资源选择器容器
 *
 * 受控模式: 父组件传入 assets + onInsert + onClose。
 * 容器调 useTheme() 解构 theme,内部管理 keyword / kindFilter / page。
 * 用 shared/components 的 Modal(零 antd),搜索/类型筛选/分页均自研。
 *
 * 支持选择模式(批量删除):
 * - 点击"选择模式"按钮进入选择态
 * - 每张卡片左上角显示复选框
 * - 点击卡片只切换选中,不触发插入画布
 * - 支持"全选"当前页
 * - 选中后显示"批量删除"按钮
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, CheckCircle2, AlertCircle, CheckSquare, Square, Trash2 } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { Modal } from '@/shared/components/index.js';
import { ConfirmDialog } from '@/shared/components/confirm-dialog.js';
import { PickerCard, toInsertPayload } from './picker-card.js';
import type { Asset, AssetKind, AssetPickerProps, InsertAssetPayload } from '../index.js';
import { uploadAsset } from '../services/upload-asset.js';
import type { CreateAssetInput } from '../asset-store.js';

const PAGE_SIZE = 8;
type KindFilter = 'all' | AssetKind;

export interface AssetPickerExtraProps {
  /** 上传素材回调(由父组件传入 useAssets.addAsset) */
  onUpload?: (inputs: CreateAssetInput[]) => Promise<void>;
  /** 是否正在上传(由父组件控制) */
  uploading?: boolean;
  /**
   * 批量文件上传处理器(可选)
   * 提供时替代内部的逐文件上传循环，支持 upload-queue 覆盖层显示进度。
   * 返回已上传的 CreateAssetInput[]，onUpload 会接着处理。
   */
  processFiles?: (files: File[]) => Promise<CreateAssetInput[]>;
}

export function AssetPicker({
  open,
  assets,
  onInsert,
  onClose,
  onUpload,
  uploading = false,
  onDelete,
  processFiles: externalProcessFiles,
}: AssetPickerProps & AssetPickerExtraProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [page, setPage] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 选择模式状态
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // 上传进度状态:跟踪每个文件的上传状态
  const [uploadProgress, setUploadProgress] = useState<{
    items: { name: string; status: 'uploading' | 'done' | 'error'; error?: string }[];
    current: number;
    total: number;
  } | null>(null);
  const [unsupportedFiles, setUnsupportedFiles] = useState<{ name: string; type: string }[]>([]);

  const KIND_OPTIONS: { label: string; value: KindFilter }[] = useMemo(() => [
    { label: t('asset.filterAll'), value: 'all' },
    { label: t('asset.filterText'), value: 'text' },
    { label: t('asset.filterImage'), value: 'image' },
    { label: t('asset.filterVideo'), value: 'video' },
    { label: t('asset.filterAudio'), value: 'audio' },
  ], [t]);

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return assets
      .filter((a) => a.kind === 'text' || a.kind === 'image' || a.kind === 'video' || a.kind === 'audio')
      .filter((a) => kindFilter === 'all' || a.kind === kindFilter)
      .filter((a) => !query || [a.title, ...(a.tags ?? [])].join(' ').toLowerCase().includes(query));
  }, [assets, keyword, kindFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    setPage((v) => (v > totalPages ? totalPages : v));
  }, [totalPages]);

  const visible = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // 退出选择模式时清空选中
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  // 进入选择模式
  const enterSelectMode = useCallback(() => {
    setSelectMode(true);
    setSelectedIds(new Set());
  }, []);

  // 切换单个素材选中
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 全选当前页
  const selectAllPage = useCallback(() => {
    const visibleIds = visible.map((a) => a.id);
    setSelectedIds((prev) => {
      // 如果当前页全部已选中,则取消全选;否则全选
      const allSelected = visibleIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }, [visible]);

  // 点击卡片:选择模式下切换选中,非选择模式插入画布
  const handleCardClick = useCallback((asset: Asset): void => {
    if (selectMode) {
      toggleSelect(asset.id);
    } else {
      onInsert(toInsertPayload(asset) satisfies InsertAssetPayload);
    }
  }, [selectMode, toggleSelect, onInsert]);

  // 批量删除(打开二次确认弹窗)
  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0 || !onDelete) return;
    setConfirmDeleteOpen(true);
  }, [selectedIds, onDelete]);

  // 确认删除:执行删除并退出选择模式
  const confirmBatchDelete = useCallback(() => {
    if (selectedIds.size === 0 || !onDelete) return;
    onDelete(Array.from(selectedIds));
    setConfirmDeleteOpen(false);
    exitSelectMode();
  }, [selectedIds, onDelete, exitSelectMode]);

  // 文件上传处理(拖拽 / 点击选择)— 逐文件上传并跟踪进度
  const handleFiles = useCallback(async (files: FileList | File[]): Promise<void> => {
    if (!onUpload) return;
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;

    const unsupported: { name: string; type: string }[] = [];
    const supportedFiles: File[] = [];

    for (const file of fileArr) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const type = ext ? `.${ext}` : file.type;
      if (!isSupportedFileType(file)) {
        unsupported.push({ name: file.name, type });
      } else {
        supportedFiles.push(file);
      }
    }

    if (unsupported.length > 0) {
      setUnsupportedFiles(unsupported);
    }

    if (supportedFiles.length === 0) {
      return;
    }

    // 若外部提供了 processFiles（upload-queue 集成），优先使用
    // 此时不设置内部 uploadProgress（upload-queue 覆盖层已显示进度），
    // 避免 AssetPicker 内部进度面板与覆盖层重叠显示。
    if (externalProcessFiles) {
      try {
        const inputs = await externalProcessFiles(supportedFiles);
        if (inputs.length > 0) {
          await onUpload(inputs);
        }
      } catch (err) {
        console.error('[AssetPicker] external upload failed:', err);
      }
      return;
    }

    // 降级：内部逐文件上传 + 内联进度
    const items = supportedFiles.map((f) => ({ name: f.name, status: 'uploading' as const }));
    setUploadProgress({ items, current: 0, total: supportedFiles.length });

    const inputs: CreateAssetInput[] = [];
    for (let i = 0; i < supportedFiles.length; i += 1) {
      const file = supportedFiles[i];
      if (!file) continue;
      try {
        const input = await uploadAsset(file);
        inputs.push(input);
        setUploadProgress((prev) => {
          if (!prev) return prev;
          const newItems = [...prev.items];
          newItems[i] = { name: file.name, status: 'done' };
          return { ...prev, items: newItems, current: i + 1 };
        });
      } catch (err) {
        setUploadProgress((prev) => {
          if (!prev) return prev;
          const newItems = [...prev.items];
          newItems[i] = {
            name: file.name,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          };
          return { ...prev, items: newItems, current: i + 1 };
        });
      }
    }

    setTimeout(() => setUploadProgress(null), 1500);

    if (inputs.length > 0) {
      await onUpload(inputs);
    }
  }, [onUpload, externalProcessFiles]);

  const isSupportedFileType = (file: File): boolean => {
    const SUPPORTED_EXTENSIONS = [
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
      'mp4', 'webm', 'ogg', 'mkv', 'mov',
      'mp3', 'wav', 'webm', 'ogg', 'aac',
      'txt', 'md', 'html', 'json',
    ];
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext && SUPPORTED_EXTENSIONS.includes(ext)) return true;
    const supportedMimeTypes = [
      'image/', 'video/', 'audio/', 'text/', 'application/json',
    ];
    return supportedMimeTypes.some((mt) => file.type.startsWith(mt));
  };

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void handleFiles(files);
    }
    // 清空 input value,允许重复选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFiles]);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  // 粘贴上传
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>): void => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      void handleFiles(files);
    }
  }, [handleFiles]);

  const pickerBodyStyle: CSSProperties = { margin: -20, padding: '0 24px 24px', height: 480, display: 'flex', flexDirection: 'column', overflow: 'hidden' };
  const toolbarStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 0', flexShrink: 0 };
  const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 140px), 1fr))', gap: 12, flex: 1, overflow: 'auto', alignContent: 'start' };
  const emptyStyle: CSSProperties = { display: 'grid', placeItems: 'center', padding: '48px 0', color: theme.toolbar.textMuted, fontSize: 13, gap: 8 };
  const pagerStyle: CSSProperties = { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '12px 0 0' };
  const inputStyle: CSSProperties = {
    width: '100%', height: 30, padding: '0 8px 0 26px', fontSize: 12,
    background: 'transparent', border: `1px solid ${theme.toolbar.border}`,
    borderRadius: 6, color: theme.toolbar.text, outline: 'none',
  };
  const searchIconStyle: CSSProperties = { position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: theme.toolbar.textMuted, pointerEvents: 'none' };
  const tagBtn = (active: boolean): CSSProperties => ({
    height: 26, padding: '0 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${active ? theme.toolbar.accent : theme.toolbar.border}`,
    background: active ? theme.toolbar.accent : 'transparent',
    color: active ? '#ffffff' : theme.toolbar.text,
  });
  const pageBtn = (disabled: boolean): CSSProperties => ({
    height: 26, padding: '0 10px', fontSize: 12, borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: `1px solid ${disabled ? theme.toolbar.border : theme.toolbar.accent}`,
    background: 'transparent', color: disabled ? theme.toolbar.textMuted : theme.toolbar.text,
    opacity: disabled ? 0.5 : 1,
  });
  const pageInfoStyle: CSSProperties = { fontSize: 12, color: theme.toolbar.textMuted, minWidth: 56, textAlign: 'center' };

  // 选择模式按钮样式
  const selectBtnStyle = (active: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
    fontSize: 13, fontWeight: 500, borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${active ? theme.toolbar.accent : theme.toolbar.border}`,
    background: active ? theme.toolbar.accent : 'transparent',
    color: active ? '#ffffff' : theme.toolbar.text,
    transition: 'all 0.15s',
  });

  // 危险按钮样式(批量删除)
  const dangerBtnStyle: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
    fontSize: 13, fontWeight: 500, borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${theme.toolbar.danger ?? '#ef4444'}`,
    background: 'transparent', color: theme.toolbar.danger ?? '#ef4444',
    transition: 'all 0.15s',
  };

  // 精致云朵上传图标
  const CloudUploadIcon = ({ size = 32 }: { size?: number }): React.ReactElement => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
      <path d="M12 13v5"/>
      <path d="m9 16 3-3 3 3"/>
    </svg>
  );

  // 上传区域样式(自定义虚线密度:6px dash + 4px gap,较默认更密)
  const borderColor = dragOver ? theme.toolbar.accent : theme.toolbar.border;
  const uploadAreaStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '20px 24px 18px',
    marginBottom: 12,
    borderRadius: 8,
    border: '3px solid transparent',
    background: [
      `repeating-linear-gradient(90deg, ${borderColor} 0 6px, transparent 6px 10px) 0 0 / 100% 3px no-repeat`,
      `repeating-linear-gradient(90deg, ${borderColor} 0 6px, transparent 6px 10px) 0 100% / 100% 3px no-repeat`,
      `repeating-linear-gradient(0deg, ${borderColor} 0 6px, transparent 6px 10px) 0 0 / 3px 100% no-repeat`,
      `repeating-linear-gradient(0deg, ${borderColor} 0 6px, transparent 6px 10px) 100% 0 / 3px 100% no-repeat`,
      dragOver ? 'rgba(109,193,84,0.08)' : 'transparent',
    ].join(','),
    cursor: onUpload ? 'pointer' : 'default',
    fontSize: 12,
    color: theme.toolbar.textMuted,
    transition: 'all 0.15s',
  };

  // 上传进度面板样式
  const progressPanelStyle: CSSProperties = {
    marginBottom: 12,
    padding: '10px 14px',
    borderRadius: 8,
    background: theme.toolbar.background,
    border: `1px solid ${theme.toolbar.border}`,
  };
  const progressBarBgStyle: CSSProperties = {
    width: '100%',
    height: 4,
    borderRadius: 2,
    background: theme.toolbar.border,
    overflow: 'hidden',
  };
  const progressBarFillStyle: CSSProperties = {
    height: '100%',
    borderRadius: 2,
    background: theme.toolbar.accent,
    transition: 'width 0.3s ease',
  };

  return (
    <Modal open={open} title={t('asset.pickerTitle')} width={860} onClose={onClose} theme={theme}>
      <div style={pickerBodyStyle} onPaste={onUpload ? handlePaste : undefined}>
        {/* 上传区域(仅当 onUpload 提供时显示) */}
        {onUpload && (
          <div
            style={uploadAreaStyle}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={uploadProgress || uploading ? undefined : () => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            {uploadProgress || uploading ? (
              <>
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
                <span>{t('asset.uploading')}</span>
              </>
            ) : (
              <>
                <CloudUploadIcon size={28} />
                <span style={{ fontSize: 13, opacity: 0.7 }}>{dragOver ? t('asset.dropHere') : t('asset.clickToSelect')}</span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileInput}
              accept="image/jpeg,image/png,image/gif,image/webp,image/bmp,image/svg+xml,video/mp4,video/webm,video/ogg,video/mkv,video/quicktime,audio/mpeg,audio/wav,audio/webm,audio/ogg,audio/aac,text/plain,text/markdown,text/html,application/json"
            />
          </div>
        )}

        {/* 上传进度面板(逐文件显示状态,确保素材正确上传) */}
        {uploadProgress ? (
          <div style={progressPanelStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.toolbar.text }}>
                {t('asset.uploading')} ({uploadProgress.current}/{uploadProgress.total})
              </span>
              {uploadProgress.current >= uploadProgress.total ? (
                <span style={{ fontSize: 11, color: '#10b981' }}>{t('asset.uploadComplete')}</span>
              ) : null}
            </div>
            {/* 进度条 */}
            <div style={progressBarBgStyle}>
              <div
                style={{
                  ...progressBarFillStyle,
                  width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                }}
              />
            </div>
            {/* 文件列表 */}
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
              {uploadProgress.items.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  {item.status === 'uploading' ? (
                    <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: theme.toolbar.accent, flexShrink: 0 } as CSSProperties} />
                  ) : item.status === 'done' ? (
                    <CheckCircle2 size={12} style={{ color: '#10b981', flexShrink: 0 }} />
                  ) : (
                    <AlertCircle size={12} style={{ color: '#ef4444', flexShrink: 0 }} />
                  )}
                  <span style={{
                    color: item.status === 'error' ? '#ef4444' : theme.toolbar.textMuted,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}>
                    {item.name}
                  </span>
                  {item.status === 'error' && item.error ? (
                    <span style={{ color: '#ef4444', fontSize: 10, flexShrink: 0 }}>{item.error}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* 工具栏:搜索 + 类型筛选 + 选择模式按钮 */}
        <div style={toolbarStyle}>
          <div style={{ position: 'relative', width: 220 }}>
            <Search size={14} style={searchIconStyle} />
            <input
              type="text"
              placeholder={t('asset.searchPlaceholder')}
              value={keyword}
              onChange={(e) => { setPage(1); setKeyword(e.target.value); }}
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {KIND_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { setPage(1); setKindFilter(opt.value); }}
                style={tagBtn(kindFilter === opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          {/* 选择模式按钮 */}
          {assets.length > 0 && onDelete && (
            <button
              type="button"
              onClick={selectMode ? exitSelectMode : enterSelectMode}
              style={selectBtnStyle(selectMode)}
            >
              {selectMode ? <CheckSquare size={14} /> : <Square size={14} />}
              {selectMode ? t('asset.exitSelect') : t('asset.selectMode')}
            </button>
          )}
          {/* 选择模式下的操作按钮组 */}
          {selectMode && (
            <>
              {/* 全选按钮 */}
              <button
                type="button"
                onClick={selectAllPage}
                style={selectBtnStyle(false)}
              >
                {t('asset.selectAll')}
              </button>
              {/* 选中计数 */}
              {selectedIds.size > 0 && (
                <span style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
                  {t('asset.selectedCount', { count: selectedIds.size })}
                </span>
              )}
              {/* 批量删除按钮 */}
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={handleBatchDelete}
                  style={dangerBtnStyle}
                >
                  <Trash2 size={14} />
                  {t('asset.deleteSelected')}
                </button>
              )}
            </>
          )}
        </div>

        {visible.length > 0 ? (
          <div style={gridStyle}>
            {visible.map((asset) => (
              <PickerCard
                key={asset.id}
                asset={asset}
                theme={theme}
                selectMode={selectMode}
                selected={selectedIds.has(asset.id)}
                onClick={() => handleCardClick(asset)}
                onDragStart={onClose}
              />
            ))}
          </div>
        ) : (
          <div style={emptyStyle}>
            <span>{t('asset.empty')}</span>
            {!onUpload && <span style={{ fontSize: 11, opacity: 0.6 }}>{t('asset.emptyHint')}</span>}
          </div>
        )}

        {filtered.length > PAGE_SIZE && (
          <div style={pagerStyle}>
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={pageBtn(page <= 1)}>
              {t('asset.prevPage')}
            </button>
            <span style={pageInfoStyle}>{page} / {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} style={pageBtn(page >= totalPages)}>
              {t('asset.nextPage')}
            </button>
          </div>
        )}
      </div>

      {/* 批量删除二次确认 */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t('confirm.deleteAssetTitle')}
        confirmLabel={t('home.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={confirmBatchDelete}
      >
        {t('confirm.deleteAssetMessage', { count: selectedIds.size })}
      </ConfirmDialog>

      {/* 不支持的文件类型提示弹窗 */}
      {unsupportedFiles.length > 0 && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.5)',
          animation: 'zeroexo-fade-in 0.2s ease',
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 12,
            padding: '24px 28px',
            width: 400,
            maxWidth: '90vw',
            boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
            animation: 'zeroexo-fade-up 0.25s cubic-bezier(0.22,1,0.36,1) both',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: 'rgba(239,68,68,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <AlertCircle size={20} style={{ color: '#ef4444' }} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: '#1c1917' }}>
                  {t('asset.unsupportedTitle')}
                </h3>
                <p style={{ margin: '0 0 16px', fontSize: 13, color: '#78716c', lineHeight: 1.5 }}>
                  {t('asset.unsupportedMessage')}
                </p>
                <div style={{
                  maxHeight: 160,
                  overflowY: 'auto',
                  marginBottom: 16,
                  padding: '8px 0',
                  borderTop: `1px solid ${theme.toolbar.border}`,
                  borderBottom: `1px solid ${theme.toolbar.border}`,
                }}>
                  {unsupportedFiles.map((file, idx) => (
                    <div key={idx} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      fontSize: 13,
                      color: '#44403c',
                    }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                        {file.name}
                      </span>
                      <span style={{ color: '#a8a29e', fontSize: 12, flexShrink: 0, marginLeft: 8 }}>
                        {file.type}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setUnsupportedFiles([])}
                  style={{
                    width: '100%',
                    height: 40,
                    fontSize: 14,
                    fontWeight: 500,
                    borderRadius: 8,
                    border: 'none',
                    background: '#e94560',
                    color: '#ffffff',
                    cursor: 'pointer',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                >
                  {t('asset.unsupportedConfirm')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}