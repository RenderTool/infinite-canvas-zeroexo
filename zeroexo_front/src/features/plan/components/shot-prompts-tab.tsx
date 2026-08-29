/**
 * plan/components/shot-prompts-tab — 视频提示词 Tab（Plan#51 T8）
 *
 * Agent 把剧本拆解成 N 个分镜块（每块对应一段生成单元，如 15s）。
 * 每块展示：
 * - 参考素材槽位映射表（图1 → 小狼崽·受伤，带缩略图/缺失标）
 * - 提示词正文（用「图1/图2」指代槽位，等宽展示）
 * - 操作：确认 / 发送到 Agent / 发送到画布
 *
 * 槽位解析走 resolveSlots：图N → refId → 变体 → assetId → storageKey。
 * 未就绪槽位会列在「缺素材」里并阻止发送到画布，避免用户误生成。
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { Send, Layers, AlertTriangle, Check } from 'lucide-react';
import type { Asset } from '@/features/asset-picker/index.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import type { PlanDoc, Shot, ShotStatus } from '../types.js';
import { resolveSlots, validateShotSlots } from '../resolve-slots.js';

export interface ShotPromptsTabProps {
  plan: PlanDoc;
  assets: Asset[];
  isMobile: boolean;
  onSave: (next: PlanDoc, by?: 'ai' | 'user') => Promise<void>;
  onSendToAgent?: (payload: { scope: 'subject' | 'shot'; refId: string; text: string }) => void;
  onSendToCanvas?: (payload: { shotId: string; images: string[]; prompt: string; title: string }) => void;
}

const STATUS_META: Record<ShotStatus, { label: string; color: string }> = {
  draft: { label: '草稿', color: '#8a8a8a' },
  confirmed: { label: '已确认', color: '#3ecf8e' },
  sent: { label: '已发送', color: '#4a9eff' },
};

export function ShotPromptsTab({
  plan,
  assets,
  isMobile,
  onSave,
  onSendToAgent,
  onSendToCanvas,
}: ShotPromptsTabProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [episodeFilter, setEpisodeFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /** 集列表（用于分组筛选） */
  const episodes = useMemo(() => {
    const set = new Set<string>();
    plan.shots.forEach((s) => { if (s.episodeId) set.add(s.episodeId); });
    return [...set].sort();
  }, [plan.shots]);

  const shots = useMemo(
    () => episodeFilter === 'all'
      ? plan.shots
      : plan.shots.filter((s) => (s.episodeId ?? '') === episodeFilter),
    [plan.shots, episodeFilter],
  );

  /** 槽位缩略图 */
  const thumbOfAsset = useCallback((assetId: string | null | undefined): string | null => {
    if (!assetId) return null;
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return null;
    if (asset.coverUrl) return asset.coverUrl;
    const d = asset.data as { kind: string; storageKey?: string; dataUrl?: string };
    if (d.kind !== 'image') return null;
    return d.dataUrl || (d.storageKey ? getResourceUrl(d.storageKey, 'preview') : '') || null;
  }, [assets]);

  const handleConfirm = useCallback(async (shot: Shot) => {
    const next: PlanDoc = {
      ...plan,
      shots: plan.shots.map((s) => s.id === shot.id ? { ...s, status: 'confirmed' as ShotStatus } : s),
    };
    await onSave(next);
  }, [plan, onSave]);

  const handleSendToCanvas = useCallback((shot: Shot) => {
    const result = resolveSlots(shot, plan, assets);
    if (!result.ready) return;
    onSendToCanvas?.({
      shotId: shot.id,
      images: result.images,
      prompt: shot.prompt,
      title: `${shot.id} ${shot.title}`,
    });
  }, [plan, assets, onSendToCanvas]);

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: isMobile ? 12 : 16 }}>
      {/* 集筛选 */}
      {episodes.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => setEpisodeFilter('all')}
            style={{
              padding: '3px 10px', borderRadius: 9999, cursor: 'pointer', fontSize: 11,
              border: `1px solid ${episodeFilter === 'all' ? theme.toolbar.accent : theme.toolbar.border}`,
              background: episodeFilter === 'all' ? `${theme.toolbar.accent}1a` : 'transparent',
              color: episodeFilter === 'all' ? theme.toolbar.accent : theme.toolbar.textMuted,
            }}
          >
            {t('plan.filterAll', '全部')}
          </button>
          {episodes.map((ep) => (
            <button
              key={ep}
              type="button"
              onClick={() => setEpisodeFilter(ep)}
              style={{
                padding: '3px 10px', borderRadius: 9999, cursor: 'pointer', fontSize: 11,
                border: `1px solid ${episodeFilter === ep ? theme.toolbar.accent : theme.toolbar.border}`,
                background: episodeFilter === ep ? `${theme.toolbar.accent}1a` : 'transparent',
                color: episodeFilter === ep ? theme.toolbar.accent : theme.toolbar.textMuted,
              }}
            >
              {ep}
            </button>
          ))}
        </div>
      )}

      {shots.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: theme.toolbar.textMuted, fontSize: 12 }}>
          {t('plan.emptyShots', '暂无分镜块。让 Agent 拆解剧本生成视频提示词。')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shots.map((shot) => {
            const result = resolveSlots(shot, plan, assets);
            const validation = validateShotSlots(shot);
            const expanded = expandedId === shot.id;
            const meta = STATUS_META[shot.status];

            return (
              <div
                key={shot.id}
                style={{
                  borderRadius: 10, overflow: 'hidden',
                  border: `1px solid ${expanded ? theme.toolbar.accent : theme.toolbar.border}`,
                  background: theme.mode === 'dark' ? '#161616' : '#ffffff',
                }}
              >
                {/* 块头 */}
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : shot.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 12px', background: 'transparent', border: 'none',
                    cursor: 'pointer', textAlign: 'left', color: theme.toolbar.text,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{shot.id}</span>
                  <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {shot.title}
                  </span>
                  {shot.timeRange && (
                    <span style={{ fontSize: 10, color: theme.toolbar.textMuted, flexShrink: 0 }}>{shot.timeRange}</span>
                  )}
                  <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 9999, background: `${meta.color}22`, color: meta.color, flexShrink: 0 }}>
                    {meta.label}
                  </span>
                </button>

                {/* 展开内容 */}
                {expanded && (
                  <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* 槽位映射表 */}
                    <div>
                      <div style={{ fontSize: 11, color: theme.toolbar.textMuted, marginBottom: 6 }}>
                        {t('plan.slotMap', '参考素材映射')}
                      </div>
                      {result.slots.length === 0 ? (
                        <div style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
                          {t('plan.noSlots', '无槽位引用')}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {result.slots.map((slot) => {
                            const thumb = thumbOfAsset(slot.assetId);
                            const ok = !!slot.storageKey;
                            return (
                              <div key={`${shot.id}-${slot.slot}`} style={{ width: 84 }}>
                                <div style={{
                                  height: 52, borderRadius: 8, overflow: 'hidden',
                                  border: `1px solid ${ok ? 'transparent' : theme.toolbar.border}`,
                                  background: thumb ? 'transparent' : (theme.mode === 'dark' ? '#0d0d0d' : '#f5f5f4'),
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  {thumb ? (
                                    <img src={thumb} alt={slot.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  ) : (
                                    <span style={{ fontSize: 9, color: theme.toolbar.textMuted }}>
                                      {t('plan.slotMissing', '缺素材')}
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 9, marginTop: 3, color: theme.toolbar.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  图{slot.slot} {slot.label}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 提示词正文 */}
                    <div>
                      <div style={{ fontSize: 11, color: theme.toolbar.textMuted, marginBottom: 6 }}>
                        {t('plan.promptBody', '提示词')}
                      </div>
                      <pre style={{
                        margin: 0, padding: 10, borderRadius: 8, fontSize: 11, lineHeight: 1.6,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        background: theme.mode === 'dark' ? '#0d0d0d' : '#f5f5f4',
                        color: theme.toolbar.text,
                        maxHeight: 260, overflow: 'auto',
                      }}>
                        {shot.prompt}
                      </pre>
                    </div>

                    {/* 校验提示 */}
                    {validation.missingInMap.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#e9a13b' }}>
                        <AlertTriangle size={12} />
                        {t('plan.slotNotInMap', '正文引用了未定义的槽位：图{{list}}', { list: validation.missingInMap.join('、图') })}
                      </div>
                    )}
                    {!result.ready && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#e9a13b' }}>
                        <AlertTriangle size={12} />
                        {t('plan.slotsUnresolved', '缺素材：{{list}}（补齐后才能发送到画布）', { list: result.unresolved.join('、') })}
                      </div>
                    )}

                    {/* 操作 */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => onSendToAgent?.({
                          scope: 'shot',
                          refId: shot.id,
                          text: `请修改分镜块「${shot.id} ${shot.title}」的提示词`,
                        })}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                          borderRadius: 6, cursor: 'pointer', fontSize: 11,
                          border: `1px solid ${theme.toolbar.border}`, background: 'transparent',
                          color: theme.toolbar.textMuted,
                        }}
                      >
                        <Send size={11} /> {t('plan.sendToAgent', '发送到 Agent')}
                      </button>

                      {shot.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() => void handleConfirm(shot)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                            borderRadius: 6, cursor: 'pointer', fontSize: 11,
                            border: `1px solid ${theme.toolbar.border}`, background: 'transparent',
                            color: theme.toolbar.textMuted,
                          }}
                        >
                          <Check size={11} /> {t('plan.confirmShot', '确认')}
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={!result.ready}
                        onClick={() => handleSendToCanvas(shot)}
                        title={result.ready ? undefined : t('plan.needAssets', '请先补齐该块引用的素材')}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                          borderRadius: 6, cursor: result.ready ? 'pointer' : 'not-allowed',
                          fontSize: 11, border: 'none',
                          background: result.ready ? theme.toolbar.accent : theme.toolbar.border,
                          color: result.ready ? '#fff' : theme.toolbar.textMuted,
                          opacity: result.ready ? 1 : 0.6,
                        }}
                      >
                        <Layers size={11} /> {t('plan.sendToCanvas', '发送到画布')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
