/**
 * plan/components/plan-workbench — 制作计划工作台（Plan#51 T5）
 *
 * 以页签形式打开（幂等 key `plan:<assetId>`），内嵌于页签内容层（embedded 模式：
 * absolute 填充父容器、不自带关闭按钮，由页签 X 关闭），也可全屏 Modal 打开（主页资产库）。
 *
 * 双 Tab：
 * - Tab1 主体清单：AI 生成的整部剧主体列表（角色/场景/道具/色卡），Card 打开为链路画布
 * - Tab2 视频提示词：分镜块列表，含槽位映射与正文，可发送到 Agent / 发送到画布
 *
 * 存储：Plan 以资产形式持久化（AssetKind='plan'，data.content = PlanDoc JSON），
 * 复用既有资产同步链路（cloudId/version/lastSyncedAt），不新建存储。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useAssets } from '@/features/asset-picker/index.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import {
  normalizePlan,
  parsePlanDoc,
  type PlanDoc,
} from '../types.js';
import { SubjectManifestTab } from './subject-manifest-tab.js';
import { ShotPromptsTab } from './shot-prompts-tab.js';

export interface PlanWorkbenchProps {
  /** Plan 资产 id */
  planAssetId: string;
  title?: string;
  /** 页签内嵌模式（absolute 填充父容器、隐藏自带关闭钮） */
  embedded?: boolean;
  onClose?: () => void;
  /** 发送到 Agent：把当前上下文注入 Agent 会话 */
  onSendToAgent?: (payload: { scope: 'subject' | 'shot'; refId: string; text: string }) => void;
  /** 发送到画布：素材副本列 + 视频产物节点 */
  onSendToCanvas?: (payload: { shotId: string; images: string[]; prompt: string; title: string }) => void;
}

type TabKey = 'subjects' | 'shots';

export function PlanWorkbench({
  planAssetId,
  title,
  embedded = false,
  onClose,
  onSendToAgent,
  onSendToCanvas,
}: PlanWorkbenchProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const { assets, updateAsset, refresh } = useAssets();

  const [tab, setTab] = useState<TabKey>('subjects');
  const [saving, setSaving] = useState(false);

  // 首次进入确保资产已加载（资产库 hook 自身会加载，这里兜底刷新一次）
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const planAsset = useMemo(
    () => assets.find((a) => a.id === planAssetId),
    [assets, planAssetId],
  );

  const plan: PlanDoc = useMemo(() => {
    const raw = planAsset?.data?.kind === 'plan' ? planAsset.data.content : null;
    return parsePlanDoc(raw, title ?? planAsset?.title ?? '制作计划');
  }, [planAsset, title]);

  /** 保存 Plan（整份 JSON 覆盖写回资产） */
  const savePlan = useCallback(async (next: PlanDoc, by: 'ai' | 'user' = 'user') => {
    setSaving(true);
    try {
      const doc = normalizePlan(next, by);
      await updateAsset(planAssetId, {
        data: { kind: 'plan', content: JSON.stringify(doc) },
      });
    } finally {
      setSaving(false);
    }
  }, [planAssetId, updateAsset]);

  const containerStyle: CSSProperties = embedded
    ? { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.canvas.background, color: theme.toolbar.text }
    : { display: 'flex', flexDirection: 'column', height: '100%', background: theme.canvas.background, color: theme.toolbar.text };

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'subjects', label: t('plan.tabSubjects', '主体清单') },
    { key: 'shots', label: t('plan.tabShots', '视频提示词') },
  ];

  return (
    <div style={containerStyle}>
      {/* 头部：标题 + Tab 切换 + 关闭 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: isMobile ? '8px 12px' : '10px 16px',
        borderBottom: `1px solid ${theme.toolbar.border}`,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {plan.title}
        </span>

        <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0 }}>
          {tabs.map((tb) => {
            const active = tab === tb.key;
            return (
              <button
                key={tb.key}
                type="button"
                onClick={() => setTab(tb.key)}
                style={{
                  padding: '4px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 500,
                  background: active ? `${theme.toolbar.accent}1f` : 'transparent',
                  color: active ? theme.toolbar.accent : theme.toolbar.textMuted,
                  transition: 'all 0.15s',
                }}
              >
                {tb.label}
              </button>
            );
          })}
        </div>

        {saving && <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>{t('plan.saving', '保存中…')}</span>}

        {!embedded && onClose && (
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: theme.toolbar.textMuted, fontSize: 12 }}>
            {t('common.close', '关闭')}
          </button>
        )}
      </div>

      {/* Tab 内容 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {tab === 'subjects' ? (
          <SubjectManifestTab
            plan={plan}
            assets={assets}
            isMobile={isMobile}
            onSave={savePlan}
            onSendToAgent={onSendToAgent}
          />
        ) : (
          <ShotPromptsTab
            plan={plan}
            assets={assets}
            isMobile={isMobile}
            onSave={savePlan}
            onSendToAgent={onSendToAgent}
            onSendToCanvas={onSendToCanvas}
          />
        )}
      </div>
    </div>
  );
}

/** 供外部按资产直接判定是否是 Plan（资产库入口用） */
export function isPlanAsset(asset: Asset | null | undefined): boolean {
  return asset?.data?.kind === 'plan';
}
