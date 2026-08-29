/**
 * plan/components/subject-card-canvas — 主体 Card 打开的链路画布（Plan#51 T7）
 *
 * 复用提示词模块的 PromptChainCanvas（参考图 → 提示词 → 生成图），语义重映射为：
 * - 参考图列 = 该主体各变体已绑定的素材
 * - 提示词节点 = 当前选中变体（或主体基础）提示词
 *
 * 编辑边界（Plan#51 决策）：提示词与结构由 Agent 维护，用户这里只做
 * ① 给占位变体上传/绑定素材；② 发给 Agent 去改结构或新增状态。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { Plus, Send, Upload } from 'lucide-react';
import type { Asset } from '@/features/asset-picker/index.js';
import { useAssets } from '@/features/asset-picker/index.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { PromptChainCanvas } from '@/features/asset-library/components/prompt-chain-canvas.js';
import type { PlanDoc, Subject, Variant, VariantStatus } from '../types.js';
import { ROLE_LABEL } from './subject-manifest-tab.js';

export interface SubjectCardCanvasProps {
  plan: PlanDoc;
  subject: Subject;
  assets: Asset[];
  onSave: (next: PlanDoc, by?: 'ai' | 'user') => Promise<void>;
  onSendToAgent?: (payload: { scope: 'subject' | 'shot'; refId: string; text: string }) => void;
  onClose: () => void;
}

export function SubjectCardCanvas({
  plan,
  subject,
  assets,
  onSave,
  onSendToAgent,
  onClose,
}: SubjectCardCanvasProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { addAsset } = useAssets();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingVariant, setPendingVariant] = useState<Variant | null>(null);
  const [uploading, setUploading] = useState(false);

  const [activeVariantRef, setActiveVariantRef] = useState<string | null>(
    subject.variants[0]?.refId ?? null,
  );

  const activeVariant = useMemo(
    () => subject.variants.find((v) => v.refId === activeVariantRef) ?? subject.variants[0] ?? null,
    [subject.variants, activeVariantRef],
  );

  /** 画布展示的提示词：选中变体优先，退化到主体基础提示词 */
  const canvasContent = activeVariant?.prompt?.trim()
    || subject.basePrompt?.trim()
    || '';

  /** 画布参考图列：该主体全部已绑定变体素材 */
  const canvasImages = useMemo(() => {
    const list: Array<{ storageKey: string; role: string; isCover?: boolean; title?: string }> = [];
    subject.variants.forEach((v) => {
      if (!v.assetId) return;
      const asset = assets.find((a) => a.id === v.assetId);
      const d = asset?.data as { kind: string; storageKey?: string } | undefined;
      if (!d || d.kind !== 'image' || !d.storageKey) return;
      list.push({
        storageKey: d.storageKey,
        role: 'reference',
        isCover: v.refId === activeVariant?.refId,
        title: v.name,
      });
    });
    return list;
  }, [subject.variants, assets, activeVariant]);

  /** 变体缩略图 */
  const thumbOf = useCallback((variant: Variant): string | null => {
    if (!variant.assetId) return null;
    const asset = assets.find((a) => a.id === variant.assetId);
    if (!asset) return null;
    if (asset.coverUrl) return asset.coverUrl;
    const d = asset.data as { kind: string; storageKey?: string; dataUrl?: string };
    if (d.kind !== 'image') return null;
    return d.dataUrl || (d.storageKey ? getResourceUrl(d.storageKey, 'preview') : '') || null;
  }, [assets]);

  // ===== 上传绑定占位素材 =====
  const handlePickFile = useCallback((variant: Variant) => {
    setPendingVariant(variant);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const variant = pendingVariant;
    if (!file || !variant) return;
    setUploading(true);
    try {
      const uploaded = await uploadAsset(file);
      // 主体素材需要进资产库（可视化管理），与提示词附图「禁止入库」的契约不同
      const created = await addAsset({
        title: `${subject.name}·${variant.name}`,
        kind: 'image',
        bytes: file.size,
        mimeType: file.type,
        data: uploaded.data,
        tags: ['plan', subject.refId, variant.refId],
      });
      if (created) {
        const next: PlanDoc = {
          ...plan,
          subjects: plan.subjects.map((s) => s.refId !== subject.refId ? s : {
            ...s,
            variants: s.variants.map((v) => v.refId !== variant.refId ? v : {
              ...v, assetId: created.id, status: 'collected' as VariantStatus,
            }),
          }),
        };
        await onSave(next);
        setActiveVariantRef(variant.refId);
      }
    } finally {
      setUploading(false);
      setPendingVariant(null);
    }
  }, [pendingVariant, subject, plan, addAsset, onSave]);

  // ===== 交给 Agent =====
  const handleSendSubject = useCallback(() => {
    onSendToAgent?.({
      scope: 'subject',
      refId: subject.refId,
      text: `请修改主体「${subject.name}」（${subject.refId}，${ROLE_LABEL[subject.role]}）`,
    });
  }, [onSendToAgent, subject]);

  const handleAskNewVariant = useCallback(() => {
    onSendToAgent?.({
      scope: 'subject',
      refId: subject.refId,
      text: `请为主体「${subject.name}」（${subject.refId}）新增一个状态占位（例如新的情绪/造型参考图），并生成对应提示词`,
    });
  }, [onSendToAgent, subject]);

  const statusColor = (s: VariantStatus) => (
    s === 'ready' || s === 'collected' ? '#3ecf8e' : s === 'generating' ? '#4a9eff' : '#8a8a8a'
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 头部 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        borderBottom: `1px solid ${theme.toolbar.border}`, flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.toolbar.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subject.name}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 400, color: theme.toolbar.textMuted }}>
              {subject.refId} · {ROLE_LABEL[subject.role]}
            </span>
          </div>
        </div>
        <button type="button" onClick={handleSendSubject} title={t('plan.sendToAgent', '发送到 Agent')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: theme.toolbar.accent, display: 'inline-flex', padding: 4 }}>
          <Send size={14} />
        </button>
        <button type="button" onClick={onClose} title={t('common.close', '关闭')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: theme.toolbar.textMuted, fontSize: 12 }}>
          ✕
        </button>
      </div>

      {/* 画布（复用提示词链路画布） */}
      <div style={{ flex: 1, minHeight: 180, padding: 12 }}>
        <div style={{ width: '100%', height: '100%', borderRadius: 10, overflow: 'hidden' }}>
          <PromptChainCanvas
            content={canvasContent}
            mode="img2img"
            images={canvasImages}
            tags={[subject.refId, ROLE_LABEL[subject.role]]}
          />
        </div>
      </div>

      {/* 变体列表 */}
      <div style={{ flexShrink: 0, padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
            {t('plan.variants', '状态 / 变体')}
          </span>
          <button type="button" onClick={handleAskNewVariant}
            style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
              border: `1px solid ${theme.toolbar.border}`, background: 'transparent',
              color: theme.toolbar.textMuted,
            }}>
            <Plus size={11} /> {t('plan.askVariant', '让 Agent 加状态')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {subject.variants.map((v) => {
            const thumb = thumbOf(v);
            const active = activeVariant?.refId === v.refId;
            return (
              <div key={v.refId} style={{ flexShrink: 0, width: 76 }}>
                <button
                  type="button"
                  onClick={() => v.assetId ? setActiveVariantRef(v.refId) : handlePickFile(v)}
                  title={v.assetId ? t('plan.viewVariant', '查看该状态') : t('plan.uploadVariant', '上传/绑定素材')}
                  style={{
                    width: '100%', height: 56, borderRadius: 8, padding: 0, cursor: 'pointer',
                    border: `1.5px ${v.assetId ? 'solid' : 'dashed'} ${active ? theme.toolbar.accent : theme.toolbar.border}`,
                    background: thumb ? 'transparent' : (theme.mode === 'dark' ? '#161616' : '#f5f5f4'),
                    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                  }}
                >
                  {thumb ? (
                    <img src={thumb} alt={v.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Upload size={14} color={theme.toolbar.textMuted} />
                  )}
                </button>
                <div style={{
                  marginTop: 3, fontSize: 10, textAlign: 'center',
                  color: theme.toolbar.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {v.name}
                </div>
                <div style={{ height: 3, borderRadius: 2, background: statusColor(v.status), marginTop: 2 }} />
              </div>
            );
          })}
        </div>

        {uploading && (
          <div style={{ fontSize: 11, color: theme.toolbar.accent }}>{t('plan.uploading', '上传中…')}</div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => { void handleFileChange(e); }}
      />
    </div>
  );
}
