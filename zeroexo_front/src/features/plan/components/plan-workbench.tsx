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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useAssets } from '@/features/asset-picker/index.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { AgentClient } from '@/features/agent-panel/AgentClient.js';
import {
  appendPlanHistory,
  createPlanHistoryEntry,
  normalizePlan,
  parsePlanDoc,
  parsePlanHistory,
  type PlanDoc,
  type PlanHistoryEntry,
} from '../types.js';
import { applyPlanOps, type PlanOp } from '../agent/plan-op-executor.js';
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
  const [gen, setGen] = useState<{ running: boolean; progress: number; message: string; opsLog: string[] } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLabelOpen, setHistoryLabelOpen] = useState(false);
  const [historyLabel, setHistoryLabel] = useState('');
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const agentClientRef = useRef<AgentClient | null>(null);
  const latestPlanRef = useRef<PlanDoc | null>(null);
  if (!agentClientRef.current) {
    agentClientRef.current = new AgentClient();
  }

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

  // 最新 Plan 跟踪：生成过程中的 op 累积应用基于此（不直接依赖渲染中的 plan，避免闭包过期）
  useEffect(() => {
    latestPlanRef.current = plan;
  }, [plan]);

  // 版本提示条 3 秒后自动消失
  useEffect(() => {
    if (!historyNotice) return;
    const timer = setTimeout(() => setHistoryNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [historyNotice]);

  /** 保存 Plan（整份 JSON 覆盖写回资产；保留已有版本历史，避免被整体替换丢失） */
  const savePlan = useCallback(async (next: PlanDoc, by: 'ai' | 'user' = 'user') => {
    setSaving(true);
    try {
      const doc = normalizePlan(next, by);
      const existingHistory = parsePlanHistory((planAsset?.data as { history?: unknown })?.history);
      await updateAsset(planAssetId, {
        data: { kind: 'plan', content: JSON.stringify(doc), history: existingHistory },
      });
    } finally {
      setSaving(false);
    }
  }, [planAssetId, updateAsset, planAsset]);

  /** 版本历史（来自资产 data.history） */
  const history: PlanHistoryEntry[] = useMemo(
    () => parsePlanHistory((planAsset?.data as { history?: unknown })?.history),
    [planAsset],
  );

  /** 手动保存一个版本快照（写入资产 data.history） */
  const handleSaveVersion = useCallback(async () => {
    if (!planAsset) return;
    const current = latestPlanRef.current ?? plan;
    const entry = createPlanHistoryEntry(current, 'user', historyLabel || undefined);
    const existing = parsePlanHistory((planAsset.data as { history?: unknown })?.history);
    const nextHistory = appendPlanHistory(existing, entry);
    setHistoryLabel('');
    setHistoryLabelOpen(false);
    setSaving(true);
    try {
      await updateAsset(planAssetId, {
        data: {
          ...((planAsset.data as Record<string, unknown>) ?? {}),
          kind: 'plan',
          content: JSON.stringify(normalizePlan(current, 'user')),
          history: nextHistory,
        },
      });
      setHistoryNotice(t('plan.histSaved', '版本已保存'));
    } finally {
      setSaving(false);
    }
  }, [planAsset, plan, planAssetId, updateAsset, historyLabel, t]);

  /** 恢复到指定版本（快照整体覆盖当前内容；不新增历史条目） */
  const handleRestoreVersion = useCallback(async (entry: PlanHistoryEntry) => {
    await savePlan(entry.snapshot, 'user');
    setHistoryOpen(false);
    setHistoryNotice(t('plan.histRestored', '已恢复到指定版本'));
  }, [savePlan, t]);

  /** 生成/重新生成计划：调后端 plan_agent（读剧本 → 产出 PlanOp 流），逐条落地并展示操作链路 */
  const handleGenerate = useCallback(async () => {
    const scriptAsset = assets.find(
      (a) => (a.kind === 'script' || a.kind === 'text') && a.id !== planAssetId,
    );
    if (!scriptAsset) {
      setGen({
        running: false, progress: 0,
        message: t('plan.genNoScript', '未找到剧本资产，请先在资产库导入剧本后再生成'),
        opsLog: [],
      });
      return;
    }
    // 后端 plan_read_script 按云端 ID 查资产：未同步的本地剧本后端读不到
    if (!scriptAsset.cloudId) {
      setGen({
        running: false, progress: 0,
        message: t('plan.genNotSynced', '剧本尚未同步到云端，请稍候片刻或检查网络后再试'),
        opsLog: [],
      });
      return;
    }
    setGen({
      running: true, progress: 0,
      message: t('plan.genStart', '正在分析剧本并生成制作计划…'),
      opsLog: [],
    });
    latestPlanRef.current = plan;
    const client = agentClientRef.current!;
    try {
      const { taskId } = await client.send('plan_agent', {
        mode: 'generate',
        planAssetId,
        title: plan.title,
        sourceScriptAssetId: scriptAsset.cloudId,
      });
      client.subscribe(taskId, {
        onThinking: (msg) => setGen((s) => (s ? { ...s, message: msg } : s)),
        onProgress: (p, msg) => setGen((s) => (s ? { ...s, progress: p, message: msg ?? s.message } : s)),
        onResult: (payload) => {
          const inner = (payload as { result?: { ok?: boolean; ops?: PlanOp[]; summary?: string } })?.result;
          if (inner && Array.isArray(inner.ops) && inner.ops.length > 0 && latestPlanRef.current) {
            const { plan: nextPlan, results } = applyPlanOps(latestPlanRef.current, inner.ops);
            latestPlanRef.current = nextPlan;
            setGen((s) => (s ? { ...s, opsLog: [...s.opsLog, ...results.map((r) => r.description)] } : s));
          }
        },
        onDone: async () => {
          const finalPlan = normalizePlan(latestPlanRef.current ?? plan, 'ai');
          // 保存内容 + 自动留档一个「AI 生成」版本，保证生成后可回溯
          const existingHistory = parsePlanHistory((planAsset?.data as { history?: unknown })?.history);
          const autoEntry = createPlanHistoryEntry(finalPlan, 'ai', t('plan.histAuto', 'AI 生成'));
          try {
            await updateAsset(planAssetId, {
              data: {
                ...((planAsset?.data as Record<string, unknown>) ?? {}),
                kind: 'plan',
                content: JSON.stringify(finalPlan),
                history: appendPlanHistory(existingHistory, autoEntry),
              },
            });
          } catch {
            // 留档失败不阻断，退回普通保存
            await savePlan(finalPlan, 'ai');
          }
          setGen((s) => (s ? { ...s, running: false, progress: 100, message: t('plan.genDone', '生成完成，操作已全部落地') } : s));
        },
        onError: (err) => setGen((s) => (s ? { ...s, running: false, message: `${t('plan.genFailed', '生成失败')}：${err}` } : s)),
        onClose: () => setGen((s) => (s ? { ...s, running: false } : s)),
      });
    } catch (err) {
      setGen({
        running: false, progress: 0,
        message: `${t('plan.genFailed', '生成失败')}：${(err as Error).message}`,
        opsLog: [],
      });
    }
  }, [assets, plan, planAssetId, planAsset, savePlan, t]);

  const containerStyle: CSSProperties = embedded
    ? { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.canvas.background, color: theme.toolbar.text }
    : { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', background: theme.canvas.background, color: theme.toolbar.text };

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
        {/* 保存提示紧跟标题 */}
        {saving && <span style={{ fontSize: 11, color: theme.toolbar.textMuted, flexShrink: 0 }}>{t('plan.saving', '保存中…')}</span>}

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

        {gen?.running ? (
          <span style={{ fontSize: 11, color: theme.toolbar.accent, flexShrink: 0 }}>
            {t('plan.genning', '生成中…')} {gen.progress}%
          </span>
        ) : (
          <button
            type="button"
            onClick={handleGenerate}
            style={{
              padding: '4px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, flexShrink: 0,
              background: `${theme.toolbar.accent}1f`, color: theme.toolbar.accent,
              transition: 'all 0.15s',
            }}
          >
            {t('plan.generate', '生成计划')}
          </button>
        )}

        {historyLabelOpen ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              autoFocus
              value={historyLabel}
              onChange={(e) => setHistoryLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveVersion(); }}
              placeholder={t('plan.histLabelPlaceholder', '版本名（可选）')}
              style={{ width: 110, fontSize: 11, padding: '3px 6px', borderRadius: 6, border: `1px solid ${theme.toolbar.border}`, background: theme.canvas.background, color: theme.toolbar.text }}
            />
            <button type="button" onClick={() => void handleSaveVersion()} style={{ padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, background: `${theme.toolbar.accent}1f`, color: theme.toolbar.accent }}>{t('common.confirm', '确定')}</button>
            <button type="button" onClick={() => { setHistoryLabelOpen(false); setHistoryLabel(''); }} style={{ padding: '3px 6px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, background: 'transparent', color: theme.toolbar.textMuted }}>{t('common.cancel', '取消')}</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setHistoryLabelOpen(true)}
            style={{ padding: '4px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, flexShrink: 0, background: `${theme.toolbar.accent}0d`, color: theme.toolbar.textMuted }}
          >
            {t('plan.saveVersion', '保存版本')}
          </button>
        )}

        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          style={{ padding: '4px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, flexShrink: 0, background: `${theme.toolbar.accent}0d`, color: theme.toolbar.textMuted }}
        >
          {t('plan.versionHistory', '版本历史')}
        </button>

        {!embedded && onClose && (
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: theme.toolbar.textMuted, fontSize: 12 }}>
            {t('common.close', '关闭')}
          </button>
        )}
      </div>

      {/* 版本操作提示条 */}
      {historyNotice && (
        <div style={{ padding: '4px 16px', fontSize: 11, color: theme.toolbar.accent, background: `${theme.toolbar.accent}0d`, borderBottom: `1px solid ${theme.toolbar.border}` }}>
          {historyNotice}
        </div>
      )}

      {/* 生成状态 + AI 操作链路 */}
      {gen && gen.opsLog.length > 0 && (
        <div style={{
          flexShrink: 0, padding: '8px 16px', borderBottom: `1px solid ${theme.toolbar.border}`,
          background: `${theme.toolbar.accent}0d`, maxHeight: 150, overflowY: 'auto',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.toolbar.text, marginBottom: 4 }}>
            {t('plan.genOps', 'AI 操作链路')}
          </div>
          {gen.opsLog.map((d, i) => (
            <div key={i} style={{ fontSize: 11, color: theme.toolbar.textMuted, lineHeight: 1.7, display: 'flex', gap: 6 }}>
              <span style={{ color: theme.toolbar.accent, flexShrink: 0 }}>✓</span>
              <span>{d}</span>
            </div>
          ))}
        </div>
      )}

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

      {/* 版本历史抽屉 */}
      {historyOpen && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setHistoryOpen(false)}
        >
          <div
            style={{
              width: 320, maxWidth: '85%', height: '100%',
              background: theme.toolbar.background ?? '#1e1e1e',
              color: theme.toolbar.text,
              borderLeft: `1px solid ${theme.toolbar.border}`,
              display: 'flex', flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${theme.toolbar.border}` }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t('plan.historyTitle', '版本历史')}</span>
              <button type="button" onClick={() => setHistoryOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: theme.toolbar.textMuted, fontSize: 12 }}>✕</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
              {history.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: theme.toolbar.textMuted, lineHeight: 1.7 }}>
                  {t('plan.historyEmpty', '暂无历史版本。点「保存版本」手动留档；AI 生成完成也会自动留档。')}
                </div>
              ) : (
                [...history].reverse().map((entry) => (
                  <div key={entry.id} style={{ padding: '8px 10px', borderRadius: 8, marginBottom: 6, background: `${theme.toolbar.accent}0d`, border: `1px solid ${theme.toolbar.border}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: theme.toolbar.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.label ?? formatTime(entry.timestamp)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleRestoreVersion(entry)}
                        style={{ padding: '2px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, background: `${theme.toolbar.accent}1f`, color: theme.toolbar.accent, flexShrink: 0 }}
                      >
                        {t('plan.histRestore', '恢复')}
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: theme.toolbar.textMuted, marginTop: 2 }}>
                      {formatTime(entry.timestamp)} · {entry.updatedBy === 'ai' ? t('plan.histByAi', 'AI') : t('plan.histByUser', '手动')}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 格式化 ISO 时间为本地展示文本 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 供外部按资产直接判定是否是 Plan（资产库入口用） */
export function isPlanAsset(asset: Asset | null | undefined): boolean {
  return asset?.data?.kind === 'plan';
}
