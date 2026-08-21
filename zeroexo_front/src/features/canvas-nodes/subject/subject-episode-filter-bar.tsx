import { memo, useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useGraph } from '@zeroexo/plugin-render-react';
import { useSubjectFilterStore } from './subject-filter-store.js';

/**
 * Plan#20 T9b: 画布主体按集过滤 chips 条(全部 / 第N集)。
 * 数据源 = 画布 subject 节点 episodeIds 并集 + script 节点 episodes 顺序编号。
 * 选中某集 → subject-filter-store 广播 → SubjectNodeView 未关联卡降噪。
 * 仅当存在已关联集的主体卡时显示;纯 UI 过滤不落数据。
 */
export const SubjectEpisodeFilterBar = memo(function SubjectEpisodeFilterBar({ store }: { store: unknown }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const text = theme.toolbar.text;
  const muted = theme.toolbar.textMuted;
  const graph = useGraph(store as never);
  const episodeId = useSubjectFilterStore((s) => s.episodeId);
  const setEpisode = useSubjectFilterStore((s) => s.setEpisode);

  // 主体已关联集(按剧本 episodes 出现顺序稳定编号,跨多剧本节点去重)
  const episodeList = useMemo(() => {
    const linked = new Set<string>();
    for (const n of graph.nodes) {
      if (n.type !== 'subject') continue;
      const ids = (n.data as { episodeIds?: string[] } | null)?.episodeIds;
      if (Array.isArray(ids)) for (const id of ids) if (id) linked.add(id);
    }
    if (linked.size === 0) return [];
    const list: Array<{ id: string; label: string }> = [];
    const seen = new Set<string>();
    for (const n of graph.nodes) {
      if (n.type !== 'script') continue;
      const eps = ((n.data as { episodes?: Array<{ id: string; title?: string }> } | null)?.episodes) ?? [];
      for (let i = 0; i < eps.length; i++) {
        const ep = eps[i];
        if (!ep?.id || seen.has(ep.id)) continue;
        seen.add(ep.id);
        if (linked.has(ep.id)) {
          const hasCustom = !!ep.title && ep.title !== `第${i + 1}集`;
          list.push({ id: ep.id, label: hasCustom ? `第${i + 1}集 · ${ep.title}` : `第${i + 1}集` });
        }
      }
    }
    return list;
  }, [graph.nodes]);

  if (episodeList.length === 0) return null;

  const chipBase: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 10px',
    borderRadius: 999,
    fontSize: 12,
    lineHeight: '20px',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    border: '1px solid transparent',
    transition: 'all 160ms ease',
  };

  const renderChip = (id: string | null, label: string) => {
    const active = episodeId === id;
    return (
      <span
        key={id ?? '__all__'}
        onClick={() => setEpisode(active ? null : id)}
        style={{
          ...chipBase,
          color: active ? '#fff' : text,
          background: active ? '#5DDCFF' : 'transparent',
          borderColor: isDark ? '#333' : '#e5e5e5',
          opacity: episodeId !== null && !active ? 0.55 : 1,
        }}
      >
        {label}
      </span>
    );
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        right: 20,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        maxWidth: '60vw',
        padding: '4px 8px',
        borderRadius: 999,
        background: isDark ? 'rgba(30,30,30,0.92)' : 'rgba(255,255,255,0.94)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
        border: `1px solid ${isDark ? '#333' : '#e5e5e5'}`,
        backdropFilter: 'blur(6px)',
      }}
    >
      <span style={{ fontSize: 11, color: muted, padding: '0 4px 0 2px', whiteSpace: 'nowrap' }}>{t('subject.filterByEpisode')}</span>
      {renderChip(null, t('subject.filterAll'))}
      {episodeList.map((ep) => renderChip(ep.id, ep.label))}
    </div>
  );
});
