/**
 * StoryboardSubjectTab - 分镜「主体」页签（2026-08-30 用户拍板新增）
 *
 * 展示 AI 生成的主体占位提示词卡片（角色/场景/道具），样式与主页提示词库完全一致：
 * - 卡片复用 shared/components/prompt-card.tsx 的 PromptCard（16:9 缩略图 + 标题 + 分类徽章 + 标签行）
 * - 类型筛选按钮与主页提示词子分类胶囊按钮同款（全部/角色/场景/道具）
 * - 点击卡片 → 打开「提示词链路画布」（PromptChainCanvas），与主页提示词打开体验一致：
 *   参考图列（referenceImages）→ 提示词节点（anchorSentence/description）→ 输出列占位
 * - 只读占位文档：主体由 AI 生成、用户敲定；修改走 Agent，不直接编辑
 */
import { memo, useCallback, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { App as AntdApp } from 'antd';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import type { ThemeConfig } from '@zeroexo/shared';
import { PromptCard } from '@/shared/components/prompt-card.js';
import { AssetDetailViewer, type AssetDetailData } from '@/shared/components/asset-detail-viewer.js';
import { PromptChainCanvas, type PromptChainImage } from '@/features/asset-library/components/prompt-chain-canvas.js';
import { ENTITY_KIND_META } from './storyboard-utils';
import type { ProductionItem, ProductionItemKind } from '../production-manager/production-manager-types';

export interface StoryboardSubjectTabProps {
  /** 主体库条目（与节点主体库/StoryboardSubjectManager 同一数据源，2026-08-30 统一） */
  productionItems: ProductionItem[];
  theme: ThemeConfig;
  /** 2026-08-30 征集 #110: 全屏=查看为主+可编辑新建主体。以下回调由父级接线写 node.data */
  onAddItem?: (kind: ProductionItemKind) => void;
  onUpdateItem?: (itemId: string, patch: Partial<ProductionItem>) => void;
  onDeleteItem?: (itemId: string) => void;
}

const KIND_FILTERS: Array<{ key: 'all' | ProductionItemKind; labelKey: string }> = [
  { key: 'all', labelKey: 'storyboard.subjectAll' },
  { key: 'character', labelKey: 'entity.character' },
  { key: 'scene', labelKey: 'entity.scene' },
  { key: 'prop', labelKey: 'entity.prop' },
];

/** 主体卡片数据（2026-08-30：来自主体库 productionItems） */
interface SubjectCardData {
  id: string;
  name: string;
  kind: ProductionItemKind;
  /** 提示词正文：优先锚点句，兜底描述 */
  prompt: string;
  /** 参考图 storageKey 列表 */
  imageKeys: string[];
  /** 提示词原文（画布展示用） */
  content: string;
  referenceImages?: Array<{ storageKey: string; prompt?: string; isPrimary?: boolean }>;
}

export const StoryboardSubjectTab = memo(function StoryboardSubjectTab({
  productionItems,
  theme,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
}: StoryboardSubjectTabProps): React.ReactElement {
  const { t } = useTranslation();
  const { modal: antdModal } = AntdApp.useApp();
  const [activeKind, setActiveKind] = useState<'all' | ProductionItemKind>('all');
  const [openCard, setOpenCard] = useState<SubjectCardData | null>(null);

  // ===== 数据源：主体库 productionItems（与节点主体库同一数据源，2026-08-30 统一）=====
  const cards = useMemo<SubjectCardData[]>(() => {
    return (productionItems ?? [])
      .filter((it) => it && it.name && it.name.trim())
      .map((it) => ({
        id: it.id,
        name: it.name,
        kind: it.kind,
        prompt: it.consistency || '',
        imageKeys: (it.images ?? []).map((r) => r.storageKey),
        content: it.consistency || '',
        referenceImages: (it.images ?? []).map((r) => ({
          storageKey: r.storageKey,
          prompt: r.prompt,
          isPrimary: r.storageKey === it.coverKey,
        })),
      }));
  }, [productionItems]);

  const counts = useMemo(() => {
    const c: Record<ProductionItemKind, number> = { character: 0, scene: 0, prop: 0 };
    for (const card of cards) {
      c[card.kind] = (c[card.kind] ?? 0) + 1;
    }
    return c;
  }, [cards]);

  const filtered = useMemo(
    () => (activeKind === 'all' ? cards : cards.filter((c) => c.kind === activeKind)),
    [cards, activeKind],
  );

  // ===== 类型筛选按钮（主页提示词子分类胶囊同款） =====
  const filterRow = (
    <div
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        gap: 4,
        padding: '8px 20px 12px',
        flexShrink: 0,
        overflowX: 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      {KIND_FILTERS.map((f) => {
        const selected = activeKind === f.key;
        const count = f.key === 'all' ? cards.length : counts[f.key];
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => setActiveKind(f.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 24,
              padding: '0 8px',
              fontSize: 11,
              fontWeight: selected ? 600 : 400,
              borderRadius: 6,
              cursor: 'pointer',
              flexShrink: 0,
              border: selected ? `1px solid ${theme.toolbar.accent}` : '1px solid transparent',
              background: selected ? theme.toolbar.accent : 'transparent',
              color: selected ? '#fff' : theme.toolbar.textMuted,
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {t(f.labelKey)}
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
          </button>
        );
      })}
    </div>
  );

  // ===== 卡片网格（主页提示词网格同款） =====
  const grid: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 20,
    alignContent: 'start',
  };

  // 2026-08-30 征集 #110: 新建主体卡片的目标分类（全部 → 默认角色；具体分类 → 该分类）
  const createKind: ProductionItemKind = activeKind === 'all' ? 'character' : activeKind;
  const canCreate = !!onAddItem;
  const canDelete = !!onDeleteItem;

  // 2026-08-30 征集 #112: 卡片网格 hover 直接删除（复用 PromptCard 内置 onDelete，无需点进详情画布）
  const handleDeleteCard = useCallback((card: SubjectCardData) => {
    antdModal.confirm({
      centered: true,
      okType: 'danger',
      title: t('common.delete'),
      content: t('storyboard.confirmDeleteSubject', { name: card.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      onOk: () => {
        onDeleteItem?.(card.id);
        setOpenCard((cur) => (cur?.id === card.id ? null : cur));
      },
    });
  }, [antdModal, t, onDeleteItem]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {filterRow}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 20px 24px' }}>
        <div style={grid}>
          {canCreate && (
            /* 常驻新建主体卡（主页 ProjectCard variant="create" 1:1：仅外框虚线 + 中央加号，无内部虚线框） */
            <button
              type="button"
              onClick={() => onAddItem?.(createKind)}
              style={{
                aspectRatio: '239.2 / 135.4',
                borderRadius: 12,
                border: `1.5px dashed ${theme.mode === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)'}`,
                background: theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                cursor: 'pointer', color: theme.toolbar.textMuted, fontFamily: 'inherit',
                transition: 'all 0.15s', outline: 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'; }}
            >
              <Plus size={24} />
              <span style={{ fontSize: 12, fontWeight: 500 }}>
                {activeKind === 'all' ? t('storyboard.addSubject', '新建主体') : t(`entity.${createKind}`)}
              </span>
            </button>
          )}
          {filtered.map((card) => {
            const meta = ENTITY_KIND_META[card.kind];
            return (
              <PromptCard
                key={card.id}
                title={card.name}
                category={card.kind}
                categoryLabel={t(meta.labelKey)}
                tags={card.prompt ? [card.prompt] : []}
                imageKeys={card.imageKeys}
                mode="asset"
                borderRadius={12}
                thumbnailAspectRatio="239.2/135.4"
                disableHoverScale
                onClick={() => setOpenCard(card)}
                onDelete={canDelete ? () => handleDeleteCard(card) : undefined}
                theme={theme}
              />
            );
          })}
        </div>
      </div>

      {/* ===== 点击卡片 → 提示词链路画布（主页提示词同款查看器；可编辑新建/删除主体） ===== */}
      {openCard && (
        <SubjectPromptViewer
          card={openCard}
          onClose={() => setOpenCard(null)}
          editable={canCreate}
          onUpdateItem={onUpdateItem}
          onDeleteItem={onDeleteItem}
        />
      )}
    </div>
  );
});

/** 主体 → 提示词链路画布查看器（AssetDetailViewer 外壳 + PromptChainCanvas 舞台，与主页提示词打开一致） */
function SubjectPromptViewer({
  card,
  onClose,
  editable,
  onUpdateItem,
  onDeleteItem,
}: {
  card: SubjectCardData;
  onClose: () => void;
  /** 2026-08-30 征集 #110: 可编辑（名称/提示词/图集/删除） */
  editable?: boolean;
  onUpdateItem?: (itemId: string, patch: Partial<ProductionItem>) => void;
  onDeleteItem?: (itemId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { modal: antdModal } = AntdApp.useApp();
  // 编辑态（点击编辑切换）：开启后 PromptChainCanvas 进入可编辑 + 底部浮层显示名称编辑
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(card.name);

  const patch = (p: Partial<ProductionItem>) => onUpdateItem?.(card.id, p);

  const asset: AssetDetailData = {
    id: card.id,
    title: editing ? nameDraft : card.name,
    kind: 'prompt',
    bytes: 0,
    tags: card.prompt ? [card.prompt] : undefined,
    data: {
      kind: 'prompt',
      content: card.content,
      prompt: card.content,
    },
  };

  // 2026-08-30 征集 #110: 主体剧照是生成产物 → 输出列(output/生成图)，不是输入参考图
  const images: PromptChainImage[] = useMemo(() => {
    const refs = card.referenceImages ?? [];
    return refs.map((r, i) => ({
      storageKey: r.storageKey,
      role: 'output' as const,
      isCover: i === 0,
      title: card.name,
    }));
  }, [card]);

  const meta = ENTITY_KIND_META[card.kind];

  const handleDelete = () => {
    antdModal.confirm({
      centered: true,
      okType: 'danger',
      title: t('common.delete'),
      content: t('storyboard.confirmDeleteSubject', { name: card.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      onOk: () => { onDeleteItem?.(card.id); onClose(); },
    });
  };

  return (
    <AssetDetailViewer
      asset={asset}
      onClose={onClose}
      renderPromptStage={() => (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
          <PromptChainCanvas
            content={card.content || t('storyboard.subjectPromptEmpty', '（该主体暂无提示词，可让 Agent 补全）')}
            mode="txt2img"
            images={images}
            tags={[t(meta.labelKey)]}
            editable={editable && editing}
            onContentChange={editable && editing ? (v) => patch({ consistency: v }) : undefined}
            style={{ width: '100%', height: '100%' }}
            editOverlay={editable && editing ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: theme?.toolbar?.background ?? '#161616', border: '1px solid rgba(128,128,128,0.2)', borderRadius: 8, padding: '6px 10px' }}>
                <span style={{ fontSize: 11, color: '#a8a8a8', flexShrink: 0 }}>{t('storyboard.subjectName', '主体名称')}</span>
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => { if (nameDraft.trim() && nameDraft !== card.name) patch({ name: nameDraft.trim() }); }}
                  placeholder={card.name}
                  style={{
                    flex: 1, minWidth: 0, border: '1px solid rgba(128,128,128,0.25)', background: 'transparent',
                    borderRadius: 6, padding: '3px 8px', fontSize: 12, color: '#fff', outline: 'none',
                  }}
                />
                <span style={{ fontSize: 10, color: '#8a8a8a', flexShrink: 0 }}>{t(meta.labelKey)}</span>
              </div>
            ) : undefined}
          />
        </div>
      )}
      editable={editable}
      editing={editable ? editing : undefined}
      onEditingChange={editable ? (v) => setEditing(v) : undefined}
      onDelete={editable ? handleDelete : undefined}
    />
  );
}
