/**
 * PublicPromptSection - 主页公共提示词区块
 *
 * 展示公共提示词列表（每页 20 条），滚动至底部自动加载更多；
 * 每次刷新生成随机 seed 配合后端 order=random，让首页内容随机换一批；
 * 右上角「查看更多」跳转公共提示词页面。
 * 数据接口免登录；初始加载失败或空数据时整块隐藏，不影响主页其余内容。
 * 点击卡片打开 PromptViewer 详情弹窗；hover 时显示「收藏副本」按钮。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { App as AntdApp, Skeleton, Spin } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/auth-store.js';
import { PromptCard } from '@/shared/components/index.js';
import { PromptViewer } from '@/shared/components/prompt-viewer.js';
import { apiFetch } from '@/services/api-client.js';
import { getLocalizedTitle, type PublicPromptItem } from '@/features/asset-library/index.js';
import { notifyPromptCopied } from '@/features/asset-library/prompt-copy-feedback.js';

export interface PublicPromptSectionProps {
  /** 点击「查看更多」回调（跳转公共提示词页面） */
  onViewAll: () => void;
}

/** 每页条数（首屏至少 20 条） */
const PAGE_SIZE = 20;
/** 最多展示条数：达到后停止加载，底部出现跳转浮台（控制 DOM 规模与性能） */
const MAX_ITEMS = 50;
/** 距滚动容器底部多少像素内触发加载更多 */
const LOAD_MORE_THRESHOLD = 300;
/** 首屏骨架占位数 */
const SKELETON_COUNT = 8;

// ===== 样式 =====

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 20,
};

function loadingMoreStyle(theme: any): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '20px 0',
    fontSize: 12,
    color: theme.toolbar.textMuted,
  };
}

/** 达到展示上限后的跳转浮台（花瓣式：引导前往完整页继续浏览） */
function capBarStyle(theme: any): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 24,
    padding: '14px 20px',
    borderRadius: 16,
    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.7)',
    backdropFilter: 'blur(12px)',
    border: '1px solid transparent',
    boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
    fontSize: 13,
    color: theme.toolbar.textMuted,
  };
}

function capBarButtonStyle(theme: any): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    border: 'none',
    padding: '6px 14px',
    borderRadius: 9999,
    background: `${theme.toolbar.accent}15`,
    color: theme.toolbar.accent,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all .2s',
  };
}

function sectionHeaderStyle(): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  };
}

function sectionTitleStyle(theme: any): CSSProperties {
  return {
    fontFamily: 'Sora, system-ui, sans-serif',
    fontSize: 24,
    fontWeight: 300,
    letterSpacing: '-0.03em',
    color: theme.toolbar.text,
  };
}

function viewAllStyle(theme: any): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    border: 'none',
    background: 'transparent',
    padding: '4px 8px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    color: theme.toolbar.textMuted,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'color .2s',
  };
}

// ===== 组件 =====

export function PublicPromptSection({ onViewAll }: PublicPromptSectionProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { modal, message: antdMessage } = AntdApp.useApp();
  // 防止同个卡片重复点击
  const cloningIds = useRef(new Set<string>());
  // 每次挂载(刷新)生成新随机种子: 同一 seed 下滚动分页稳定不重复,不同 seed 下每次刷新换一批
  const [seed] = useState(() => Math.random().toString(36).slice(2));
  const [prompts, setPrompts] = useState<PublicPromptItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [failed, setFailed] = useState(false);
  const [detailItem, setDetailItem] = useState<PublicPromptItem | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const fetchNextRef = useRef<() => void>(() => {});

  // 初始加载第一页
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ items: PublicPromptItem[]; total: number }>(
          `/public/prompts?page=1&limit=${PAGE_SIZE}&order=random&seed=${seed}`
        );
        if (!cancelled) {
          const items = res.items ?? [];
          setPrompts(items);
          setTotal(res.total ?? 0);
          setHasMore(items.length < (res.total ?? 0) && items.length < MAX_ITEMS);
        }
      } catch {
        // 静默失败，隐藏整块
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // 加载下一页（滚动触达底部时调用；最后一页裁剪到 MAX_ITEMS 上限）
  const fetchNext = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const remaining = MAX_ITEMS - prompts.length;
      const limit = Math.min(PAGE_SIZE, remaining);
      const res = await apiFetch<{ items: PublicPromptItem[]; total: number }>(
        `/public/prompts?page=${next}&limit=${limit}&order=random&seed=${seed}`
      );
      const items = res.items ?? [];
      const mergedCount = prompts.length + items.length;
      setPrompts((prev) => [...prev, ...items]);
      setTotal(res.total ?? 0);
      setPage(next);
      setHasMore(items.length > 0 && mergedCount < (res.total ?? 0) && mergedCount < MAX_ITEMS);
    } catch {
      // 加载更多失败：静默保留已有数据，下次滚动可重试
    } finally {
      setLoadingMore(false);
    }
  }, [page, loadingMore, hasMore, prompts.length, seed]);

  // 同步最新 fetchNext 到 ref，供稳定的滚动监听器使用
  fetchNextRef.current = () => { void fetchNext(); };

  // 收藏副本 - 创建副本
  const handleClone = useCallback(async (item: PublicPromptItem) => {
    if (cloningIds.current.has(item.id)) return;
    cloningIds.current.add(item.id);
    try {
      if (!isAuthenticated) {
        antdMessage.warning(t('promptCard.pleaseLoginFirst'));
        if (typeof window !== 'undefined') window.location.hash = '#/auth';
        return;
      }
      const clone = await apiFetch<{ id: string }>('/prompts', {
        method: 'POST',
        body: JSON.stringify({
          title: item.title + ' (副本)',
          content: item.content,
          category: item.category,
          tags: item.tags ?? [],
          imageKeys: (item.images ?? []).map((img: any) => img.storageKey),
        }),
      });
      notifyPromptCopied(antdMessage, clone?.id);
    } catch {
      antdMessage.error('创建副本失败，请重试');
    } finally {
      cloningIds.current.delete(item.id);
    }
  }, [isAuthenticated, antdMessage]);

  // 监听主页滚动容器（向上查找 overflow 祖先），接近底部时加载更多
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    let scroller: HTMLElement | null = section.parentElement;
    while (scroller) {
      const overflowY = getComputedStyle(scroller).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const handleScroll = () => {
      if (scroller!.scrollTop + scroller!.clientHeight >= scroller!.scrollHeight - LOAD_MORE_THRESHOLD) {
        fetchNextRef.current();
      }
    };
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', handleScroll);
  }, []);

  // 失败或空数据: 整块隐藏，不影响主页其余内容
  if (failed || (!loading && prompts.length === 0)) return null;

  return (
    <div ref={sectionRef} style={{ marginTop: 48, marginBottom: 24 }}>
      <div style={sectionHeaderStyle()}>
        <span style={sectionTitleStyle(theme)}>{t('common.publicPromptsSectionTitle')}</span>
        <button type="button" style={viewAllStyle(theme)} onClick={onViewAll}>
          {t('common.viewAllPrompts')} →
        </button>
      </div>

      {loading ? (
        <div style={gridStyle}>
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div key={i}>
              <Skeleton.Input active size="small" style={{ width: '100%', height: 120, borderRadius: 12, marginBottom: 8 }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div style={gridStyle}>
            {prompts.map((item, idx) => (
              <PromptCard
                key={item.id}
                mode="public"
                theme={theme}
                title={getLocalizedTitle(item, i18n.language)}
                category={item.category}
                categoryLabel={t(`promptCreate.category${item.category.charAt(0).toUpperCase() + item.category.slice(1)}`)}
                tags={item.tags ?? []}
                imageKeys={item.images?.map((img) => img.storageKey) ?? []}
                license={item.license || 'MIT'}
                sourceUrl={item.sourceUrl}
                animationDelay={idx * 40}
                onClick={() => setDetailItem(item)}
                onClone={() => handleClone(item)}
              />
            ))}
          </div>
          {loadingMore && (
            <div style={loadingMoreStyle(theme)}>
              <Spin size="small" />
              {t('common.loading')}
            </div>
          )}
          {/* 达到上限：花瓣式跳转浮台，引导前往完整页继续浏览 */}
          {!hasMore && prompts.length >= MAX_ITEMS && (
            <div style={capBarStyle(theme)}>
              <span>{t('common.promptsSectionCap', { count: MAX_ITEMS, total })}</span>
              <button type="button" style={capBarButtonStyle(theme)} onClick={onViewAll}>
                {t('common.viewAllFull')} →
              </button>
            </div>
          )}
        </>
      )}

      {/* 详情弹窗 */}
      <PromptViewer
        publicItem={detailItem ? {
          id: detailItem.id,
          title: getLocalizedTitle(detailItem, i18n.language),
          content: detailItem.content,
          category: detailItem.category,
          tags: detailItem.tags,
          images: detailItem.images,
          source: detailItem.source,
          sourceId: detailItem.sourceId,
          sourceName: detailItem.sourceName,
          sourceUrl: detailItem.sourceUrl,
          license: detailItem.license || 'MIT',
        } : undefined}
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
      />
    </div>
  );
}
