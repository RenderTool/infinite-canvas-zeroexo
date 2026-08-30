/**
 * StoryboardSubjectManager - 节点内「主体库」视图（2026-08-30 征集 #110）
 *
 * 剧管（production-manager）UI 与功能合并进分镜节点后的内嵌形态：
 * - 左侧 ThumbNav 垂直导航（每个主体一个缩略项）+ 底部 + 号新建主体
 * - 右侧封面舞台（当前主体剧照，多图可左右切换/删除）+ 信息条（名称/类型/状态标签/上传）
 * - 「生成真实图片」：**直接复用 NodeGenerateDock 组件**（图片节点同款悬浮胶囊）——
 *   选中主体时 portal 渲染到画布容器（canvasHost），吸附在分镜节点正下方，
 *   AI 自动映射当前主体的一致/锚点句到 dock 提示词。
 *
 * 数据源：node.data.productionItems[]（ProductionItem，与剧管同契约），
 * 本组件为受控组件（items + onChange），读写均由父级 storyboard-sheet 接线。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal, Tooltip, App as AntdApp } from 'antd';
import { ChevronLeft, ChevronRight, Trash2, Upload as UploadIcon, Rabbit } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { ThumbNav, usePreviewImage } from '@zeroexo/plugin-nodes';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { useViewport, useSelection } from '@zeroexo/plugin-render-react';
import { NodeGenerateDock } from '@/features/tools-dock/node-generate-dock.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { ItemThumb } from '../production-manager/production-manager-panels';
import type { ProductionItem, ProductionItemKind, ProductionItemImage } from '../production-manager/production-manager-types';
import { createProductionItem } from '../production-manager/production-manager-types';

export interface StoryboardSubjectManagerProps {
  items: ProductionItem[];
  onChange: (items: ProductionItem[]) => void;
  /** 画布 graph store（NodeGenerateDock 依赖：订阅视口/图变化做吸附定位） */
  store: any;
  /** 分镜节点 id（NodeGenerateDock 锚点 = 分镜节点在画布世界坐标的位置） */
  nodeId: string;
  /** 生成真实图片回调（Phase 2 接入真实生成链路；当前占位由父级决定） */
  onGenerateImage?: (item: ProductionItem, prompt: string) => void;
}

/** 封面舞台：当前变体剧照（contain） */
function ItemCover({ storageKey, dark }: { storageKey?: string; dark: boolean }): React.ReactElement {
  const fallback = storageKey ? (getResourceUrl(storageKey, 'preview') ?? '') : '';
  const hydrated = usePreviewImage(storageKey ?? '', fallback);
  if (!hydrated) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.3)' }}>
        <Rabbit size={40} />
      </div>
    );
  }
  return <img src={hydrated} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />;
}

export const StoryboardSubjectManager = memo(function StoryboardSubjectManager({
  items,
  onChange,
  store,
  nodeId,
  onGenerateImage,
}: StoryboardSubjectManagerProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message: antdMessage } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();
  const isDark = theme.mode === 'dark';
  const canvasHost = useCanvasTabStore((s) => s.canvasHost);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 节点 DOM 容器 ref：getAnchorBounds 用真实 DOM 位置算世界坐标（绕开 store 找不到节点的隐患）
  const containerRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);

  // dock 生成配置（模型/参数）本地态，按主体 id 隔离，切换主体各自独立
  const [dockConfigs, setDockConfigs] = useState<Record<string, { model?: string; paramValues?: Record<string, any> }>>({});

  // 当前活跃主体索引
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (activeIndex >= items.length) setActiveIndex(items.length > 0 ? 0 : 0);
  }, [items.length, activeIndex]);
  const activeItem = items[Math.min(activeIndex, items.length - 1)] ?? null;

  // 当前变体索引（切换主体时重置）
  const [variantIndex, setVariantIndex] = useState(0);
  useEffect(() => { setVariantIndex(0); }, [activeItem?.id]);
  const activeVariants = activeItem?.images ?? [];
  const activeVariant = activeVariants[Math.min(variantIndex, activeVariants.length - 1)] ?? null;

  // ===== 主体管理 =====
  const handleAddEntity = useCallback(() => {
    const item = createProductionItem('character');
    const sameKindCount = items.filter((i) => i.kind === 'character').length;
    item.name = `${t('entity.character')} ${sameKindCount + 1}`;
    onChange([...items, item]);
    setActiveIndex(items.length);
  }, [items, onChange, t]);

  const handleDeleteEntity = useCallback((itemId: string) => {
    const target = items.find((i) => i.id === itemId);
    if (!target) return;
    Modal.confirm({
      centered: true,
      okType: 'danger',
      title: t('common.delete'),
      content: t('storyboard.confirmDeleteProductionItem', { name: target.name || t('productionManager.unnamed') }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      onOk: () => onChange(items.filter((i) => i.id !== itemId)),
    });
  }, [items, onChange, t]);

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeItem) return;
    onChange(items.map((i) => (i.id === activeItem.id ? { ...i, name: e.target.value } : i)));
  }, [activeItem, items, onChange]);

  const handleKindChange = useCallback((kind: ProductionItemKind) => {
    if (!activeItem) return;
    onChange(items.map((i) => (i.id === activeItem.id ? { ...i, kind } : i)));
  }, [activeItem, items, onChange]);

  // ===== 变体管理（上传剧照） =====
  const handleAddVariant = useCallback(async (file: File) => {
    if (!isAuthenticated) { antdMessage.warning(t('subjectCreate.loginRequired')); return; }
    if (!activeItem) return;
    setUploading(true);
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data as { kind?: string; storageKey?: string; dataUrl?: string };
      const storageKey = d.storageKey ?? '';
      if (storageKey) {
        const newVariant: ProductionItemImage = { storageKey, tags: [] };
        const nextImages = [...activeVariants, newVariant];
        onChange(items.map((i) =>
          i.id === activeItem.id ? { ...i, images: nextImages, coverKey: i.coverKey || storageKey } : i,
        ));
        setVariantIndex(nextImages.length - 1);
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
    } finally {
      setUploading(false);
    }
  }, [isAuthenticated, antdMessage, t, activeItem, activeVariants, items, onChange]);

  const handleRemoveVariant = useCallback((storageKey: string) => {
    if (!activeItem) return;
    const nextImages = activeVariants.filter((v) => v.storageKey !== storageKey);
    onChange(items.map((i) =>
      i.id === activeItem.id
        ? { ...i, images: nextImages, coverKey: nextImages.length > 0 ? (i.coverKey === storageKey ? nextImages[0]!.storageKey : i.coverKey) : null }
        : i,
    ));
    if (variantIndex >= nextImages.length) setVariantIndex(Math.max(0, nextImages.length - 1));
  }, [activeItem, activeVariants, items, onChange, variantIndex]);

  const handlePrevVariant = useCallback(() => {
    if (activeVariants.length <= 1) return;
    setVariantIndex((prev) => (prev <= 0 ? activeVariants.length - 1 : prev - 1));
  }, [activeVariants.length]);

  const handleNextVariant = useCallback(() => {
    if (activeVariants.length <= 1) return;
    setVariantIndex((prev) => (prev >= activeVariants.length - 1 ? 0 : prev + 1));
  }, [activeVariants.length]);

  const handleStateTagChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeVariant || !activeItem) return;
    onChange(items.map((i) => (
      i.id === activeItem.id
        ? { ...i, images: activeVariants.map((v) => (v.storageKey === activeVariant.storageKey ? { ...v, stateTag: e.target.value } : v)) }
        : i
    )));
  }, [activeVariant, activeItem, activeVariants, items, onChange]);

  // ===== 条目切换 =====
  const handleJump = useCallback((index: number) => {
    if (index < 0 || index >= items.length) return;
    setActiveIndex(index);
  }, [items.length]);
  const handlePrev = useCallback(() => handleJump(Math.max(0, activeIndex - 1)), [activeIndex, handleJump]);
  const handleNext = useCallback(() => handleJump(Math.min(items.length - 1, activeIndex + 1)), [items.length, activeIndex, handleJump]);

  // 导航条目
  const navItems = useMemo(() => items.map((it) => ({
    id: it.id,
    title: undefined,
    thumb: <ItemThumb kind={it.kind} storageKey={it.images[0]?.storageKey} dark={isDark} />,
    onDelete: () => handleDeleteEntity(it.id),
  })), [items, isDark, handleDeleteEntity]);

  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const infoBg = theme.node.fill;
  const contentSurface = isDark ? '#161616' : '#ffffff';
  const hasVariants = activeVariants.length > 0;

  // ===== 生成真实图片：直接复用 NodeGenerateDock（图片节点同款悬浮胶囊）=====
  // AI 自动映射当前主体的一致性/锚点句到 dock 提示词；有主体即自动折叠显示在分镜节点下方，
  // 点击折叠细条展开完整面板（NodeGenerateDock 默认 collapsed 行为），无需二次点击入口。
  const dockPrompt = useMemo(() => (activeItem?.consistency ?? ''), [activeItem]);

  // dock 当前主体的模型/参数配置（未配置时为空，dock 内部会自动选首个可用模型并回调）
  const activeItemId = activeItem?.id ?? '';
  const activeDockConfig = dockConfigs[activeItemId] ?? {};
  const handleDockConfigChange = useCallback((_nodeId: string, patch: Record<string, unknown>) => {
    if (!activeItemId) return;
    setDockConfigs((prev) => ({ ...prev, [activeItemId]: { ...(prev[activeItemId] ?? {}), ...patch } }));
  }, [activeItemId]);

  // 节点选中订阅（2026-08-31 征集 #114）：dock 仅在分镜节点被选中时显示，
  // 失焦（点击空白/其他节点）即隐藏 —— 与普通图片节点 dock「选中显示、失焦隐藏」统一。
  const { selectedNodeIds } = useSelection(store);

  // NodeGenerateDock 锚点 — 直接读节点 DOM 的真实屏幕位置，换算成世界坐标后交给 dock 的世界→屏幕换算。
  // 完全绕开 store.getGraph() 找节点那条链路（之前在那条路上失败导致 dock 落到画布原点 (0,0)）。
  // 注意：viewport 与 containerRef 必须订阅，否则画布平移/缩放时 dock 不跟随。
  const viewport = useViewport(store);
  const getAnchorBounds = useCallback(() => {
    const el = containerRef.current;
    const host = canvasHost;
    if (!el || !host) return null;
    const nodeRect = el.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    // 节点相对 canvasHost 的屏幕偏移
    const xRel = nodeRect.left - hostRect.left;
    const yRel = nodeRect.top - hostRect.top;
    const wRel = nodeRect.width;
    const hRel = nodeRect.height;
    const k = viewport.k || 1;
    // 反推世界坐标：screenRel = world * k + viewport  →  world = (screenRel - viewport) / k
    const worldX = (xRel - viewport.x) / k;
    const worldY = (yRel - viewport.y) / k;
    const worldW = wRel / k;
    const worldH = hRel / k;
    return { x: worldX, y: worldY, width: worldW, height: worldH };
  }, [canvasHost, viewport]);

  // 节点记录保留为 dock 的最后回退（getAnchorBounds 失败时兜底，分镜默认 720×520）
  const nodeRecord = useMemo(() => {
    const graph = store?.getGraph?.();
    return (graph?.nodes?.find((n: any) => n.id === nodeId) ?? null) as any;
  }, [store, nodeId]);

  return (
    <>
      <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0, position: 'relative' }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* 左侧侧边栏：缩略图导航（内部集成 + 创建项） */}
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flexShrink: 0 }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ThumbNav
                orientation="vertical"
                items={navItems}
                activeIndex={activeIndex}
                total={items.length}
                onPrev={handlePrev}
                onNext={handleNext}
                onJump={handleJump}
                createItem={{
                  title: t('storyboard.addSubject', '添加主体'),
                  thumb: (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: textMuted, flexShrink: 0 }}>
                      <path
                        fill="currentColor"
                        fillRule="evenodd"
                        d="M6.417 2.917a.583.583 0 0 1 1.166 0v3.5h3.5a.583.583 0 0 1 0 1.166h-3.5v3.5a.583.583 0 1 1-1.166 0v-3.5h-3.5a.583.583 0 1 1 0-1.166h3.5z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ),
                  onClick: handleAddEntity,
                }}
              />
            </div>
          </div>

          {/* 右侧列：封面舞台 + 信息条 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* 封面舞台 */}
            <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', background: contentSurface }}>
              {activeItem ? (
                hasVariants ? (
                  <>
                    <ItemCover storageKey={activeVariant?.storageKey} dark={isDark} />
                    {activeVariant?.stateTag && (
                      <span style={{
                        position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
                        background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, padding: '2px 10px',
                        borderRadius: 999, whiteSpace: 'nowrap',
                      }}>
                        {activeVariant.stateTag}
                      </span>
                    )}
                    {activeVariants.length > 1 && (
                      <>
                        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={handlePrevVariant} style={{
                          position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.45)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                        }}>
                          <ChevronLeft size={14} />
                        </button>
                        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={handleNextVariant} style={{
                          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.45)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                        }}>
                          <ChevronRight size={14} />
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.3)' }}>
                    <Rabbit size={32} />
                    <span style={{ fontSize: 11, opacity: 0.75 }}>{t('productionManager.viewEmpty')}</span>
                  </div>
                )
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.3)' }}>
                  <Rabbit size={40} />
                  <span style={{ fontSize: 11, opacity: 0.75 }}>{t('productionManager.viewEmpty')}</span>
                </div>
              )}
            </div>

            {/* 信息条：单行紧凑布局 */}
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: infoBg, borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
              {activeItem ? (
                <>
                  <input value={activeItem.name} onChange={handleNameChange} onPointerDown={(e) => e.stopPropagation()} placeholder={t('productionManager.unnamed')} style={{
                    flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 13, fontWeight: 700, color: textPrimary, outline: 'none', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} />
                  {/* 类型：分段按钮 */}
                  <div style={{ display: 'inline-flex', height: 22, borderRadius: 5, border: `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'}`, overflow: 'hidden', flexShrink: 0 }}>
                    {(['character', 'scene', 'prop'] as const).map((k, idx, arr) => {
                      const selected = activeItem.kind === k;
                      const label = k === 'character' ? t('entity.character') : k === 'scene' ? t('entity.scene') : t('entity.prop');
                      const radiusL = idx === 0 ? 4 : 0;
                      const radiusR = idx === arr.length - 1 ? 4 : 0;
                      const borderL = idx !== 0 ? `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'}` : 'none';
                      return (
                        <button key={k} type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => handleKindChange(k)} style={{
                          height: '100%', padding: '0 7px', border: 'none', borderLeft: borderL,
                          borderRadius: `${radiusL}px ${radiusR}px ${radiusR}px ${radiusL}px`, cursor: 'pointer',
                          background: selected ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)') : 'transparent',
                          color: selected ? textPrimary : textMuted, fontSize: 11, fontWeight: selected ? 600 : 400,
                        }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {/* 状态标记（单行 inline） */}
                  <input value={activeVariant?.stateTag ?? ''} onChange={handleStateTagChange} onPointerDown={(e) => e.stopPropagation()} placeholder={t('subject.stateTag')} title={t('subject.stateTag')} style={{
                    width: 110, flexShrink: 0, border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', fontSize: 11, color: textPrimary, outline: 'none', padding: '2px 6px', borderRadius: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} />
                  <span style={{ fontSize: 10, color: textMuted, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {activeVariants.length > 0 ? `${variantIndex + 1}/${activeVariants.length}` : '-/-'}
                  </span>
                  <Tooltip title={t('subject.addState')}>
                    <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 8px', border: `1px solid ${isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)'}`, borderRadius: 5,
                      background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', color: textPrimary, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {uploading ? '...' : <><UploadIcon size={11} />{t('subject.addState')}</>}
                    </button>
                  </Tooltip>
                  {activeVariant && (
                    <Tooltip title={t('common.delete')}>
                      <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => handleRemoveVariant(activeVariant.storageKey)} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3, height: 22, padding: '0 8px', border: `1px solid ${isDark ? 'rgba(239,68,68,0.4)' : 'rgba(220,38,38,0.35)'}`, borderRadius: 5,
                        background: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(220,38,38,0.08)', color: theme.toolbar.danger, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0,
                      }}>
                        <Trash2 size={10} />{t('common.delete')}
                      </button>
                    </Tooltip>
                  )}
                </>
              ) : (
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: textMuted }}>
                  {t('productionManager.viewEmpty')}
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleAddVariant(f); e.target.value = ''; }} />
            </div>
          </div>
        </div>
      </div>

      {/* ===== 真正的 NodeGenerateDock（图片节点同款悬浮胶囊）：分镜节点选中 + 有主体时显示 ===== */}
      {activeItem && canvasHost && store && selectedNodeIds.has(nodeId) && createPortal(
        <NodeGenerateDock
          key={`subject-dock-${activeItem.id}`}
          nodeId={`subject-${activeItem.id}`}
          nodeType="image"
          store={store}
          getAnchorBounds={getAnchorBounds}
          node={nodeRecord}
          isRunning={false}
          initialPrompt={dockPrompt}
          model={activeDockConfig.model ?? ''}
          onPromptChange={() => {}}
          onGenerate={(_nodeId, _mode, prompt) => {
            onGenerateImage?.(activeItem, prompt);
          }}
          onStop={() => {}}
          onConfigChange={handleDockConfigChange}
          paramValues={activeDockConfig.paramValues ?? {}}
        />,
        canvasHost,
      )}
    </>
  );
});
