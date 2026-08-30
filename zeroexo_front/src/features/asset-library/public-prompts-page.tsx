/**
 * PublicPromptsPage - 公共提示词独立页面
 *
 * 公共提示词为只读资源，用户只能「收藏副本」创建私有副本后编辑。
 * 无收藏功能。
 *
 * 入口: 主侧边栏「公共提示词」导航 → #/public-prompts
 * 无需登录即可浏览, 收藏副本需登录后创建副本到私有提示词库
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import { App as AntdApp, Pagination } from 'antd';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PromptCard } from '@/shared/components/index.js';
import { SearchButton } from '@/shared/components/search-button.js';
import { PromptViewer } from '@/shared/components/prompt-viewer.js';
import { apiFetch } from '@/services/api-client.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { notifyPromptCopied } from './prompt-copy-feedback.js';

// ====== 类型与多语言辅助（2026-08-30 征集 #111 抽至 public-prompts-shared 切断循环依赖） ======
// 原先本文件自定义 PublicPromptItem / getLocalizedTitle，但本页面 import shared/components 大桶
// → prompt-viewer → asset-library/index → use-asset-library 形成环，循环初始化时
// getLocalizedTitle 可能是 undefined（是否触发取决于模块加载顺序，时崩时好）。
// 现从独立文件导入并 re-export，保持既有导入路径（index.ts / 各消费方）兼容。
import { getLocalizedTitle, type PublicPromptItem } from './public-prompts-shared.js';

export { getLocalizedTitle, type PublicPromptItem };

// ====== 常量 ======

// 2026-08-30 用户拍板:分类收敛为 角色/场景/道具/其他,style、shot 并入 other(后端 counts/过滤已合并)
const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'role', label: '角色' },
  { key: 'scene', label: '场景' },
  { key: 'prop', label: '道具' },
  { key: 'other', label: '其他' },
];

const PAGE_SIZE = 24;
const CARD_ANIMATION_DURATION = 300;
const EASE_ZEROEXO = 'cubic-bezier(0.22, 1, 0.36, 1)';

// ====== 样式工厂函数 ======

function pageStyle(): CSSProperties {
  return { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minWidth: 0, minHeight: 0 };
}

function toolbarStyle(theme: any): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 20px',
    background: theme.toolbar.background,
  };
}

function toolbarTitleStyle(theme: any): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 18,
    fontWeight: 600,
    color: theme.toolbar.text,
    whiteSpace: 'nowrap',
    fontFamily: "'Sora', system-ui, sans-serif",
    letterSpacing: '-0.025em',
  };
}

function filterBarStyle(theme: any): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '0 20px 12px',
    background: theme.toolbar.background,
  };
}

function filterChipStyle(theme: any, active: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 24,
    padding: '0 8px',
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    borderRadius: 6,
    cursor: 'pointer',
    border: active ? `1px solid ${theme.toolbar.accent}` : `1px solid transparent`,
    background: active ? theme.toolbar.accent : 'transparent',
    color: active ? '#fff' : theme.toolbar.textMuted,
    transition: `all ${CARD_ANIMATION_DURATION}ms ${EASE_ZEROEXO}`,
  };
}

function contentStyle(): CSSProperties {
  return { flex: 1, overflow: 'auto', padding: '0 20px 24px' };
}

function gridStyle(): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 20,
  };
}

function paginationWrapStyle(): CSSProperties {
  return { display: 'flex', justifyContent: 'center', padding: '24px 0 0' };
}

function emptyStyle(theme: any): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 80,
    color: theme.toolbar.textMuted,
  };
}

// ====== 骨架屏 ======

function renderSkeleton(theme: any): React.ReactElement[] {
  const isDark = theme.mode === 'dark';
  const shimmerBg = `linear-gradient(
    90deg,
    transparent 0%,
    ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'} 50%,
    transparent 100%
  )`;
  const shimmerStyles: CSSProperties = {
    background: shimmerBg,
    backgroundSize: '200% 100%',
    animation: 'zeroexo-shimmer 1.5s infinite',
  };

  return Array.from({ length: 6 }).map((_, i) => (
    <div
      key={`skeleton-${i}`}
      style={{
        borderRadius: 14,
        overflow: 'hidden',
        background: isDark ? 'rgba(255,255,255,0.04)' : '#f5f2ec',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
      }}
    >
      {/* 16:9 占位区 */}
      <div
        style={{
          width: '100%',
          aspectRatio: '16 / 9',
          ...shimmerStyles,
        }}
      />
      {/* 底部栏，匹配 PromptCard 的 cardBodyStyle */}
      <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          style={{
            width: '60%',
            height: 12,
            borderRadius: 4,
            ...shimmerStyles,
          }}
        />
      </div>
    </div>
  ));
}

// ====== 组件 ======

export function PublicPromptsPage(): React.ReactElement {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { message: antdMessage, modal } = AntdApp.useApp();

  const [prompts, setPrompts] = useState<PublicPromptItem[]>([]);
  const [total, setTotal] = useState(0);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [detailItem, setDetailItem] = useState<PublicPromptItem | null>(null);

  // 克隆防重复队列
  const cloningIds = useRef<Set<string>>(new Set());

  // 加载分类统计（仅挂载时一次）
  useEffect(() => {
    apiFetch<Record<string, number>>('/public/prompts/counts').then((res) => {
      setCategoryCounts(res ?? {});
    }).catch(() => {/* ignore */});
  }, []);

  // 加载数据（后端分页 + 过滤）
  const fetchPrompts = useCallback(async (p: number, cat: string, kw: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('limit', String(PAGE_SIZE));
      if (cat && cat !== 'all') params.set('category', cat);
      if (kw.trim()) params.set('keyword', kw.trim());
      const res = await apiFetch<{ items: PublicPromptItem[]; total: number }>(
        `/public/prompts?${params.toString()}`
      );
      setPrompts(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      console.error('[PublicPrompts] load failed', err);
      setPrompts([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // 分类/搜索/页码变化时重新请求
  useEffect(() => {
    void fetchPrompts(page, activeCategory, search);
  }, [page, activeCategory, search, fetchPrompts]);

  // 搜索防抖（仅输入时延迟）
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); }, 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // 切换分类时重置到第 1 页
  const handleCategoryChange = useCallback((cat: string) => {
    setActiveCategory(cat);
    setPage(1);
  }, []);

  // 收藏副本 - 创建副本
  const handleClone = useCallback(async (item: PublicPromptItem) => {
    if (cloningIds.current.has(item.id)) return;
    cloningIds.current.add(item.id);
    try {
      if (!isAuthenticated) {
        modal.confirm({
          title: '提示',
          content: '请先登录后使用此功能',
          okText: '登录',
          cancelText: '取消',
          onOk: () => { window.location.hash = '#/auth'; },
        });
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

  return (
    <div style={pageStyle()}>
      {/* 工具栏 */}
      <div style={toolbarStyle(theme)}>
        <div style={toolbarTitleStyle(theme)}>
          {t('common.publicPrompts')}
        </div>
        <SearchButton
          value={search}
          onChange={setSearch}
          placeholder="搜索提示词..."
          theme={theme}
        />
      </div>

      {/* 分类筛选 */}
      <div style={filterBarStyle(theme)}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            style={filterChipStyle(theme, activeCategory === cat.key)}
            onClick={() => handleCategoryChange(cat.key)}
          >
            {cat.label}
            {categoryCounts[cat.key] !== undefined && (
              <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.55 }}>
                {categoryCounts[cat.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div style={contentStyle()}>
        {loading ? (
          <div style={gridStyle()}>
            {renderSkeleton(theme)}
          </div>
        ) : prompts.length === 0 ? (
          <div style={emptyStyle(theme)}>
            <Globe size={36} opacity={0.2} />
            <span style={{ fontSize: 14 }}>
              {search.trim() ? '未找到匹配的提示词' : '暂无公共提示词'}
            </span>
          </div>
        ) : (
          <>
            <div style={gridStyle()}>
              {prompts.map((item, idx) => (
              <PromptCard
                key={item.id}
                mode="public"
                theme={theme}
                title={getLocalizedTitle(item, i18n.language)}
                category={item.category}
                categoryLabel={t(`promptCreate.category${item.category.charAt(0).toUpperCase() + item.category.slice(1)}`)}
                tags={item.tags ?? []}
                imageKeys={item.images?.map((img: any) => img.storageKey) ?? []}
                license={item.license || 'MIT'}
                sourceUrl={item.sourceUrl}
                animationDelay={idx * 40}
                onClone={() => handleClone(item)}
                onClick={() => setDetailItem(item)}
              />
            ))}
            </div>
            {total > PAGE_SIZE && (
              <div style={paginationWrapStyle()}>
                <Pagination
                  current={page}
                  total={total}
                  pageSize={PAGE_SIZE}
                  onChange={setPage}
                  showSizeChanger={false}
                />
              </div>
            )}
          </>
        )}
      </div>

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