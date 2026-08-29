/**
 * plan/components/subject-manifest-tab — 主体清单 Tab（Plan#51 T6）
 *
 * 整部剧的主体列表（角色/场景/道具/色卡），由 Agent 生成并维护。
 * 左侧按 role 筛选的 Card 网格，选中后在右侧打开「主体画布」（复用提示词链路画布）。
 *
 * 交互原则：提示词与结构由 Agent 维护，用户这里只做两件直接操作——
 * ① 给占位变体上传/绑定素材；② 把主体发给 Agent 去改。
 */

import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import type { Asset } from '@/features/asset-picker/index.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import type { PlanDoc, Subject, SubjectRole, VariantStatus } from '../types.js';
import { SubjectCardCanvas } from './subject-card-canvas.js';

export interface SubjectManifestTabProps {
  plan: PlanDoc;
  assets: Asset[];
  isMobile: boolean;
  onSave: (next: PlanDoc, by?: 'ai' | 'user') => Promise<void>;
  onSendToAgent?: (payload: { scope: 'subject' | 'shot'; refId: string; text: string }) => void;
}

const ROLE_LABEL: Record<SubjectRole, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  style: '色卡',
};

const STATUS_COLOR: Record<VariantStatus, string> = {
  missing: '#8a8a8a',
  collected: '#e9a13b',
  generating: '#4a9eff',
  ready: '#3ecf8e',
};

export function SubjectManifestTab({
  plan,
  assets,
  isMobile,
  onSave,
  onSendToAgent,
}: SubjectManifestTabProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [roleFilter, setRoleFilter] = useState<'all' | SubjectRole>('all');
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null);

  const subjects = useMemo(() => {
    const list = roleFilter === 'all' ? plan.subjects : plan.subjects.filter((s) => s.role === roleFilter);
    // 角色 → 场景 → 道具 → 色卡 的固定顺序，保证清单稳定（不受 AI 生成顺序影响）
    const order: Record<SubjectRole, number> = { character: 0, scene: 1, prop: 2, style: 3 };
    return [...list].sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));
  }, [plan.subjects, roleFilter]);

  const selected = useMemo(
    () => plan.subjects.find((s) => s.refId === selectedRefId) ?? null,
    [plan.subjects, selectedRefId],
  );

  /** 主体缩略图：优先首个已绑定素材的变体 */
  const coverOf = useCallback((subject: Subject): string | null => {
    for (const v of subject.variants) {
      if (!v.assetId) continue;
      const asset = assets.find((a) => a.id === v.assetId);
      if (!asset) continue;
      if (asset.coverUrl) return asset.coverUrl;
      const d = asset.data as { kind: string; storageKey?: string; dataUrl?: string };
      if (d.kind === 'image') {
        return d.dataUrl || (d.storageKey ? getResourceUrl(d.storageKey, 'preview') : '') || null;
      }
    }
    return null;
  }, [assets]);

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: 12,
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* 左：清单网格 */}
      <div style={{
        flex: 1, minWidth: 0, overflow: 'auto',
        padding: isMobile ? 12 : 16,
      }}>
        {/* 筛选行 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          {(['all', 'character', 'scene', 'prop', 'style'] as const).map((r) => {
            const active = roleFilter === r;
            const label = r === 'all' ? t('plan.filterAll', '全部') : ROLE_LABEL[r];
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                style={{
                  padding: '3px 10px', borderRadius: 9999, cursor: 'pointer',
                  fontSize: 11, fontWeight: 500,
                  border: `1px solid ${active ? theme.toolbar.accent : theme.toolbar.border}`,
                  background: active ? `${theme.toolbar.accent}1a` : 'transparent',
                  color: active ? theme.toolbar.accent : theme.toolbar.textMuted,
                }}
              >
                {label}
              </button>
            );
          })}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: theme.toolbar.textMuted }}>
            {t('plan.subjectCount', '{{count}} 个主体', { count: subjects.length })}
          </span>
        </div>

        {subjects.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: theme.toolbar.textMuted, fontSize: 12 }}>
            {t('plan.emptySubjects', '暂无主体。让 Agent 读取剧本后自动生成主体清单。')}
          </div>
        ) : (
          <div style={gridStyle}>
            {subjects.map((subject) => {
              const cover = coverOf(subject);
              const readyCount = subject.variants.filter((v) => v.status === 'ready' || v.status === 'collected').length;
              const active = selectedRefId === subject.refId;
              return (
                <button
                  key={subject.refId}
                  type="button"
                  onClick={() => setSelectedRefId(subject.refId)}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 6, padding: 0,
                    borderRadius: 10, overflow: 'hidden', cursor: 'pointer', textAlign: 'left',
                    border: `1px solid ${active ? theme.toolbar.accent : theme.toolbar.border}`,
                    background: theme.mode === 'dark' ? '#161616' : '#ffffff',
                    transition: 'all 0.15s',
                  }}
                >
                  {/* 缩略图 */}
                  <div style={{
                    height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: theme.mode === 'dark' ? '#0d0d0d' : '#f5f5f4', position: 'relative',
                  }}>
                    {cover ? (
                      <img src={cover} alt={subject.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
                        {t('plan.noCover', '待收集')}
                      </span>
                    )}
                    <span style={{
                      position: 'absolute', top: 4, left: 4,
                      fontSize: 9, padding: '1px 5px', borderRadius: 9999,
                      background: 'rgba(0,0,0,0.55)', color: '#fff',
                    }}>
                      {ROLE_LABEL[subject.role]}
                    </span>
                  </div>
                  {/* 信息 */}
                  <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: theme.toolbar.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {subject.name}
                    </span>
                    <span style={{ fontSize: 10, color: theme.toolbar.textMuted }}>
                      {subject.refId} · {readyCount}/{subject.variants.length} {t('plan.variantUnit', '态')}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 右：主体画布（桌面端并排） */}
      {selected && !isMobile && (
        <div style={{
          width: 460, flexShrink: 0, borderLeft: `1px solid ${theme.toolbar.border}`,
          display: 'flex', flexDirection: 'column', minHeight: 0,
        }}>
          <SubjectCardCanvas
            plan={plan}
            subject={selected}
            assets={assets}
            onSave={onSave}
            onSendToAgent={onSendToAgent}
            onClose={() => setSelectedRefId(null)}
          />
        </div>
      )}

      {/* 移动端：全屏覆盖 */}
      {selected && isMobile && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: theme.canvas.background, display: 'flex', flexDirection: 'column' }}>
          <SubjectCardCanvas
            plan={plan}
            subject={selected}
            assets={assets}
            onSave={onSave}
            onSendToAgent={onSendToAgent}
            onClose={() => setSelectedRefId(null)}
          />
        </div>
      )}
    </div>
  );
}

export { ROLE_LABEL, STATUS_COLOR };
