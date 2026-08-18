/**
 * AssetSelector - 统一资产选择器
 *
 * 用于 entity_ref / image_ref 等字段编辑时选择资产。
 * 支持按类型筛选、搜索、无限滚动分页、5 种 UI 状态。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Inbox, SearchX, WifiOff, RotateCw, Image, Video, Music, User, CheckCircle } from 'lucide-react';
import { Modal, Input, Spin, Tag } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import { listSubjects } from '@/features/asset-library/subjects-api.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { AuthorizedImage } from '@/shared/components/authorized-media.js';
import type { Asset } from '@/features/asset-picker/index.js';
import type { Subject } from '@/features/asset-library/subjects-api.js';

// ─── 类型定义 ─────────────────────────────────────────────────────────

export type AssetSelectorFilterType = 'zeroexo-entity' | 'image' | 'video' | 'audio';

export interface AssetSelectorProps {
  filterType: AssetSelectorFilterType;
  value?: string;
  onChange: (assetId: string) => void;
  multiple?: boolean;
  valueList?: string[];
  onChangeList?: (assetIds: string[]) => void;
  visible?: boolean;
  onCancel?: () => void;
}

interface AssetItem {
  id: string;
  name: string;
  type: AssetSelectorFilterType;
  thumbnail?: string;
  tags?: string[];
}

type UiState = 'loading' | 'empty' | 'loaded' | 'noResult' | 'error';

// ─── 常量 ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const FILTER_LABELS: Record<AssetSelectorFilterType, string> = {
  'zeroexo-entity': 'zeroexo-entity',
  image: 'image',
  video: 'video',
  audio: 'audio',
};

// ─── 组件 ─────────────────────────────────────────────────────────────

export function AssetSelector({
  filterType,
  value,
  onChange,
  multiple = false,
  valueList = [],
  onChangeList,
  visible = false,
  onCancel,
}: AssetSelectorProps): React.ReactElement | null {
  const { theme } = useTheme();

  const isDark = theme.mode === 'dark';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const borderColor = theme.toolbar.border;
  const accentColor = theme.toolbar.accent;
  const bgColor = isDark ? '#161412' : '#ffffff';
  const cardBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const hoverBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)';

  // ── 状态 ──
  const [items, setItems] = useState<AssetItem[]>([]);
  const [uiState, setUiState] = useState<UiState>('loading');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | undefined>(value);
  const [selectedIds, setSelectedIds] = useState<string[]>(valueList);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 搜索防抖 ──
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1);
    }, 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [searchQuery]);

  // ── 加载数据 ──
  const loadItems = useCallback(async (query: string, pageNum: number, append: boolean) => {
    try {
      if (pageNum === 1 && !append) {
        setUiState('loading');
      }

      let result: AssetItem[] = [];

      if (filterType === 'zeroexo-entity') {
        const subjects = await listSubjects();
        result = subjects
          .filter((s) => {
            if (!query.trim()) return true;
            const q = query.toLowerCase();
            return (
              s.name.toLowerCase().includes(q) ||
              s.tags.some((t) => t.toLowerCase().includes(q))
            );
          })
          .map((s: Subject) => ({
            id: s.id,
            name: s.name,
            type: 'zeroexo-entity' as AssetSelectorFilterType,
            thumbnail: s.avatarKey ? getResourceUrl(s.avatarKey, 'thumb') : undefined,
            tags: s.tags,
          }));
      } else {
        const allAssets = await listAssets();
        result = allAssets
          .filter((a) => {
            if (a.kind !== filterType) return false;
            if (!query.trim()) return true;
            const q = query.toLowerCase();
            return a.title.toLowerCase().includes(q) ||
              (a.tags ?? []).some((t) => t.toLowerCase().includes(q));
          })
          .map((a: Asset) => ({
            id: a.id,
            name: a.title,
            type: filterType,
            thumbnail: a.kind === 'image'
              ? getResourceUrl((a.data as { storageKey?: string }).storageKey, 'thumb') ?? a.coverUrl
              : a.coverUrl,
            tags: a.tags,
          }));
      }

      // 分页
      const start = (pageNum - 1) * PAGE_SIZE;
      const paged = result.slice(start, start + PAGE_SIZE);
      const totalFiltered = result.length;

      if (append) {
        setItems((prev) => [...prev, ...paged]);
      } else {
        setItems(paged);
      }

      setHasMore(start + PAGE_SIZE < totalFiltered);

      if (totalFiltered === 0) {
        setUiState(query.trim() ? 'noResult' : 'empty');
      } else {
        setUiState('loaded');
      }
    } catch {
      setUiState('error');
    } finally {
      setLoadingMore(false);
    }
  }, [filterType]);

  // ── 初始加载 / 搜索变化时重新加载 ──
  useEffect(() => {
    if (!visible) return;
    setPage(1);
    setItems([]);
    setHasMore(true);
    setSelectedId(value);
    setSelectedIds(valueList);
    void loadItems(debouncedQuery, 1, false);
  }, [visible, debouncedQuery, filterType, loadItems, value, valueList]);

  // ── 滚动加载更多 ──
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || loadingMore) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      setLoadingMore(true);
      setPage((prev) => prev + 1);
    }
  }, [hasMore, loadingMore]);

  useEffect(() => {
    if (page > 1 && visible) {
      void loadItems(debouncedQuery, page, true);
    }
  }, [page, debouncedQuery, visible, loadItems]);

  // ── 选中 ──
  const handleSelect = useCallback((id: string) => {
    if (multiple) {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
      );
    } else {
      setSelectedId(id);
    }
  }, [multiple]);

  const handleConfirm = useCallback(() => {
    if (multiple) {
      onChangeList?.(selectedIds);
    } else if (selectedId) {
      onChange(selectedId);
    }
    onCancel?.();
  }, [multiple, selectedIds, selectedId, onChange, onChangeList, onCancel]);

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  const handleRetry = useCallback(() => {
    setPage(1);
    setItems([]);
    void loadItems(debouncedQuery, 1, false);
  }, [debouncedQuery, loadItems]);

  // ── 渲染缩略图 ──
  const renderThumbnail = (item: AssetItem): React.ReactNode => {
    if (item.thumbnail) {
      return (
        <AuthorizedImage
          src={item.thumbnail}
          alt={item.name}
          style={{
            width: 48,
            height: 48,
            objectFit: 'cover',
            borderRadius: 6,
            flexShrink: 0,
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      );
    }

    const IconComponent = item.type === 'zeroexo-entity' ? User
      : item.type === 'image' ? Image
      : item.type === 'video' ? Video
      : Music;

    return (
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 6,
          background: cardBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <IconComponent size={20} color={mutedColor} />
      </div>
    );
  };

  // ── 渲染卡片列表 ──
  const renderCardList = (): React.ReactNode => {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        {items.map((item) => {
          const isSelected = multiple ? selectedIds.includes(item.id) : selectedId === item.id;
          return (
            <div
              key={item.id}
              onClick={() => handleSelect(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '0 12px',
                height: 80,
                borderRadius: 8,
                background: isSelected ? `${accentColor}15` : cardBg,
                border: `1px solid ${isSelected ? accentColor : borderColor}`,
                cursor: 'pointer',
                transition: 'all 0.12s',
                overflow: 'hidden',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = hoverBg;
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = cardBg;
                }
              }}
            >
              {multiple && isSelected && (
                <div
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    color: accentColor,
                    lineHeight: 0,
                  }}
                >
                  <CheckCircle size={18} fill={accentColor} color="#fff" />
                </div>
              )}
              {renderThumbnail(item)}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: textColor,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.name}
                </span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <Tag
                    style={{
                      fontSize: 10,
                      padding: '0 6px',
                      margin: 0,
                      lineHeight: '18px',
                    }}
                  >
                    {FILTER_LABELS[item.type]}
                  </Tag>
                  {item.tags?.slice(0, 1).map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 10,
                        color: mutedColor,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 60,
                      }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── 渲染 UI 状态 ──
  const renderState = (): React.ReactNode => {
    switch (uiState) {
      case 'loading':
        return (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 60,
              color: mutedColor,
            }}
          >
            <Spin size="small" />
            <span style={{ fontSize: 13 }}>正在加载资产列表...</span>
          </div>
        );

      case 'empty':
        return (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 60,
              color: mutedColor,
            }}
          >
            <Inbox size={48} color={mutedColor} />
            <span style={{ fontSize: 13 }}>
              资产库中暂无 {filterType} 类型资产
            </span>
          </div>
        );

      case 'noResult':
        return (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 60,
              color: mutedColor,
            }}
          >
            <SearchX size={48} color={mutedColor} />
            <span style={{ fontSize: 13 }}>
              未找到匹配"{debouncedQuery}"的资产
            </span>
          </div>
        );

      case 'error':
        return (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 60,
              color: mutedColor,
            }}
          >
            <WifiOff size={48} color="#e94560" />
            <span style={{ fontSize: 13, color: mutedColor }}>
              加载失败，请检查网络后重试
            </span>
            <button
              type="button"
              onClick={handleRetry}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 16px',
                fontSize: 12,
                color: textColor,
                background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                border: `1px solid ${borderColor}`,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              <RotateCw size={14} />
              重试
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  if (!visible) return null;

  return (
    <Modal
      open={visible}
      title="选择资产"
      width={720}
      onCancel={handleCancel}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          {multiple && selectedIds.length > 0 && (
            <span
              style={{
                fontSize: 12,
                color: mutedColor,
                marginRight: 'auto',
              }}
            >
              已选择 {selectedIds.length} 个
            </span>
          )}
          <button
            type="button"
            onClick={handleCancel}
            style={{
              padding: '5px 16px',
              fontSize: 12,
              color: textColor,
              background: 'transparent',
              border: `1px solid ${borderColor}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={multiple ? selectedIds.length === 0 : !selectedId}
            style={{
              padding: '5px 16px',
              fontSize: 12,
              color: '#fff',
              background: (multiple ? selectedIds.length > 0 : !!selectedId) ? accentColor : mutedColor,
              border: 'none',
              borderRadius: 6,
              cursor: (multiple ? selectedIds.length > 0 : !!selectedId) ? 'pointer' : 'not-allowed',
              opacity: (multiple ? selectedIds.length > 0 : !!selectedId) ? 1 : 0.5,
            }}
          >
            {multiple ? `确认 (${selectedIds.length})` : '确认'}
          </button>
        </div>
      }
      styles={{
        body: {
          padding: 0,
          maxHeight: 480,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: bgColor,
        },
      }}
      centered
      destroyOnHidden
    >
      {/* 搜索框 */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${borderColor}`,
          flexShrink: 0,
        }}
      >
        <Input
          size="small"
          placeholder="搜索资产名称/标签..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          allowClear
          style={{ width: '100%' }}
        />
      </div>

      {/* 列表区 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 16,
        }}
      >
        {uiState === 'loaded' || uiState === 'noResult' ? (
          <>
            {items.length > 0 ? (
              renderCardList()
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  padding: 60,
                  color: mutedColor,
                }}
              >
                <SearchX size={48} color={mutedColor} />
                <span style={{ fontSize: 13 }}>
                  未找到匹配"{debouncedQuery}"的资产
                </span>
              </div>
            )}
            {/* 加载更多指示器 */}
            {loadingMore && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '16px 0',
                  color: mutedColor,
                  fontSize: 12,
                }}
              >
                <Spin size="small" />
                加载中...
              </div>
            )}
            {!hasMore && items.length > 0 && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '12px 0',
                  fontSize: 11,
                  color: mutedColor,
                }}
              >
                已加载全部
              </div>
            )}
          </>
        ) : (
          renderState()
        )}
      </div>
    </Modal>
  );
}