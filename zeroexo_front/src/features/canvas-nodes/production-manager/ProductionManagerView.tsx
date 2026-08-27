/**
 * ProductionManagerView - 统筹节点视图（卡片编辑器版）
 *
 * 卡片即编辑器，所有操作常驻：
 * - 左侧侧边栏：实体缩略图导航 + hover 删除（在圆卡片上）+ 底部加号添加新实体
 * - 右侧封面舞台：变体预览 + 左右箭头切换 + 删除变体
 * - 右侧信息条：名称（可编辑）+ 类型（下拉切换）+ 状态标签（自由文本）+ 上传新状态
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Modal, Select, Tooltip, App as AntdApp } from 'antd';
import { ChevronLeft, ChevronRight, Plus, Trash2, Upload as UploadIcon, Rabbit } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NodeRendererProps } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView, ThumbNav, usePreviewImage } from '@zeroexo/plugin-nodes';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { useAuth } from '@/features/auth/auth-store.js';
import type { ProductionItemKind, ProductionManagerData, ProductionItemImage } from './production-manager-types';
import { createProductionItem } from './production-manager-types';
import { ItemThumb } from './production-manager-panels';

export interface ProductionManagerViewProps extends NodeRendererProps {
  connectionController: any;
  store?: any;
}

const PM_COLOR = '#64748b';

function parseData(data: Record<string, unknown> | undefined): ProductionManagerData {
  if (!data) return { title: '', items: [] };
  return {
    title: (data.title as string) ?? '',
    scriptId: data.scriptId as string | undefined,
    items: Array.isArray(data.items) ? (data.items as ProductionManagerData['items']) : [],
  };
}

/** 封面舞台：当前变体剧照（contain） */
function ItemCover({ storageKey, dark }: { storageKey?: string; dark: boolean }): React.ReactElement {
  const fallback = storageKey ? (getResourceUrl(storageKey, 'preview') ?? '') : '';
  // 节点内展示层三档契约(征集 #77):自适应档不拉原图,原图只在图片浏览器
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

export const ProductionManagerView = memo(function ProductionManagerView({
  node,
  pins,
  isSelected,
  isHovered,
  forceShowPins,
  updateNode,
  invK,
  externalRenaming,
  onRenameFinish,
  connectionController,
  store,
}: ProductionManagerViewProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message: antdMessage } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();
  const isDark = theme.mode === 'dark';
  const data = useMemo(() => parseData(node.data as Record<string, unknown> | undefined), [node.data]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // 当前活跃条目索引
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (activeIndex >= data.items.length) setActiveIndex(0);
  }, [data.items.length, activeIndex]);
  const activeItem = data.items[Math.min(activeIndex, data.items.length - 1)] ?? null;

  // 当前变体索引（切换条目时重置）
  const [variantIndex, setVariantIndex] = useState(0);
  useEffect(() => {
    setVariantIndex(0);
  }, [activeItem?.id]);
  const activeVariants = activeItem?.images ?? [];
  const activeVariant = activeVariants[Math.min(variantIndex, activeVariants.length - 1)] ?? null;

  // ===== 数据更新辅助 =====
  const updateItems = useCallback((nextItems: ProductionManagerData['items']) => {
    updateNode({ data: { ...(node.data as Record<string, unknown>), ...data, items: nextItems } });
  }, [updateNode, node.data, data]);

  // ===== 实体管理 =====
  const handleAddEntity = useCallback(() => {
    const item = createProductionItem('character');
    const sameKindCount = data.items.filter((i) => i.kind === 'character').length;
    item.name = `${t('entity.character')} ${sameKindCount + 1}`;
    updateItems([...data.items, item]);
    setActiveIndex(data.items.length);
  }, [data.items, updateItems, t]);

  const handleDeleteEntity = useCallback((itemId: string) => {
    const target = data.items.find((i) => i.id === itemId);
    if (!target) return;
    Modal.confirm({
      centered: true,
      okType: 'danger',
      title: t('common.delete'),
      content: `${t('common.confirmDelete')}「${target.name || t('productionManager.unnamed')}」？`,
      onOk: () => {
        const nextItems = data.items.filter((i) => i.id !== itemId);
        updateItems(nextItems);
      },
    });
  }, [data.items, updateItems, t]);

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeItem) return;
    const nextItems = data.items.map((i) => (i.id === activeItem.id ? { ...i, name: e.target.value } : i));
    updateItems(nextItems);
  }, [activeItem, data.items, updateItems]);

  const handleKindChange = useCallback((kind: ProductionItemKind) => {
    if (!activeItem) return;
    const nextItems = data.items.map((i) => (i.id === activeItem.id ? { ...i, kind } : i));
    updateItems(nextItems);
  }, [activeItem, data.items, updateItems]);

  // ===== 变体管理 =====
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
        const nextItems = data.items.map((i) =>
          i.id === activeItem.id ? { ...i, images: nextImages, coverKey: i.coverKey || storageKey } : i,
        );
        updateItems(nextItems);
        setVariantIndex(nextImages.length - 1);
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
    } finally {
      setUploading(false);
    }
  }, [isAuthenticated, antdMessage, t, activeItem, activeVariants, data.items, updateItems]);

  const handleRemoveVariant = useCallback((storageKey: string) => {
    if (!activeItem) return;
    const nextImages = activeVariants.filter((v) => v.storageKey !== storageKey);
    const nextItems = data.items.map((i) =>
      i.id === activeItem.id
        ? { ...i, images: nextImages, coverKey: nextImages.length > 0 ? (i.coverKey === storageKey ? nextImages[0]!.storageKey : i.coverKey) : null }
        : i,
    );
    updateItems(nextItems);
    if (variantIndex >= nextImages.length) setVariantIndex(Math.max(0, nextImages.length - 1));
  }, [activeItem, activeVariants, data.items, updateItems, variantIndex]);

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
    const nextImages = activeVariants.map((v) =>
      v.storageKey === activeVariant.storageKey ? { ...v, stateTag: e.target.value } : v,
    );
    const nextItems = data.items.map((i) => (i.id === activeItem.id ? { ...i, images: nextImages } : i));
    updateItems(nextItems);
  }, [activeVariant, activeItem, activeVariants, data.items, updateItems]);

  // ===== 条目切换 =====
  const handleItemChange = useCallback((index: number) => {
    if (index < 0 || index >= data.items.length) return;
    setActiveIndex(index);
  }, [data.items.length]);

  const handlePrev = useCallback(() => {
    if (data.items.length <= 1) return;
    handleItemChange(Math.max(0, activeIndex - 1));
  }, [data.items.length, activeIndex, handleItemChange]);

  const handleNext = useCallback(() => {
    if (data.items.length <= 1) return;
    handleItemChange(Math.min(data.items.length - 1, activeIndex + 1));
  }, [data.items.length, activeIndex, handleItemChange]);

  const handleJump = useCallback((index: number) => {
    handleItemChange(index);
  }, [handleItemChange]);

  // 导航条目（侧边栏圆形缩略图，删除气泡由 ThumbNav 渲染在圆外）
  const navItems = useMemo(() => data.items.map((it) => ({
    id: it.id,
    title: undefined,
    thumb: <ItemThumb kind={it.kind} storageKey={it.images[0]?.storageKey} dark={isDark} />,
    onDelete: () => handleDeleteEntity(it.id),
  })), [data.items, isDark, handleDeleteEntity]);

  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const infoBg = theme.node.fill;
  const contentSurface = isDark ? '#161616' : '#ffffff';

  const title = node.title ?? (data.title || t('canvasNodes.stage.productionManager'));
  const hasVariants = activeVariants.length > 0;

  return (
    <>
      <style>{`
        .pm-hover-btn { opacity: 0; transition: opacity 0.15s; }
        *:hover > .pm-hover-btn { opacity: 1; }
        .pm-icon-btn:hover { background: rgba(128,128,128,0.12); }
      `}</style>
      <BaseNodeView
        node={node}
        pins={pins}
        isSelected={isSelected}
        isHovered={isHovered}
        title={title}
        color={PM_COLOR}
        connectionController={connectionController}
        forceShowPins={forceShowPins}
        invK={invK}
        titleIcon={<Rabbit size={Math.max(10, 13 * (invK ?? 1))} />}
        updateNode={updateNode}
        externalRenaming={externalRenaming}
        onRenameFinish={onRenameFinish}
        contentPadding="0"
        store={store}
      >
        <div style={{ display: 'flex', width: '100%', height: '100%', minHeight: 0 }}>
          {/* 左侧侧边栏：缩略图导航 + 底部添加按钮 */}
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flexShrink: 0 }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ThumbNav
                orientation="vertical"
                items={navItems}
                activeIndex={activeIndex}
                total={data.items.length}
                onPrev={handlePrev}
                onNext={handleNext}
                onJump={handleJump}
              />
            </div>
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
              <button
                type="button"
                className="pm-icon-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleAddEntity}
                style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: textMuted }}
                title={t('productionManager.add_character')}
              >
                <Plus size={14} />
              </button>
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
                    {/* 变体状态标签 */}
                    {activeVariant?.stateTag && (
                      <span style={{
                        position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
                        background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, padding: '2px 10px',
                        borderRadius: 999, whiteSpace: 'nowrap',
                      }}>
                        {activeVariant.stateTag}
                      </span>
                    )}
                    {/* 左右箭头切换变体 */}
                    {activeVariants.length > 1 && (
                      <>
                        <button
                          type="button"
                          className="pm-hover-btn"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={handlePrevVariant}
                          style={{
                            position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
                            width: 24, height: 24, borderRadius: '50%', border: 'none',
                            background: 'rgba(0,0,0,0.45)', color: '#fff', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12,
                          }}
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          className="pm-hover-btn"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={handleNextVariant}
                          style={{
                            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                            width: 24, height: 24, borderRadius: '50%', border: 'none',
                            background: 'rgba(0,0,0,0.45)', color: '#fff', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12,
                          }}
                        >
                          <ChevronRight size={14} />
                        </button>
                        {/* 变体页码 */}
                        <span style={{
                          position: 'absolute', top: 6, right: 6,
                          background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 10,
                          padding: '1px 7px', borderRadius: 999,
                        }}>
                          {variantIndex + 1}/{activeVariants.length}
                        </span>
                      </>
                    )}
                    {/* 删除变体 */}
                    <button
                      type="button"
                      className="pm-hover-btn"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => activeVariant && handleRemoveVariant(activeVariant.storageKey)}
                      style={{
                        position: 'absolute', top: 6, left: 6,
                        width: 20, height: 20, borderRadius: '50%', border: 'none',
                        background: 'rgba(220,38,38,0.8)', color: '#fff', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10,
                      }}
                      title={t('common.delete')}
                    >
                      <Trash2 size={10} />
                    </button>
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

            {/* 信息条：名称 + 类型 + 状态标签 + 上传新状态 */}
            <div style={infoBarStyle(infoBg)}>
              {activeItem ? (
                <>
                  {/* 第一行：名称 + 类型（角色操作） */}
                  <div style={infoRowStyle}>
                    <input
                      value={activeItem.name}
                      onChange={handleNameChange}
                      onPointerDown={(e) => e.stopPropagation()}
                      placeholder={t('productionManager.unnamed')}
                      style={nameInputStyle(textPrimary)}
                    />
                    <Select
                      value={activeItem.kind}
                      onChange={handleKindChange}
                      size="small"
                      style={{ width: 88, flexShrink: 0 }}
                      dropdownStyle={{ minWidth: 100 }}
                      onMouseDown={(e) => e.stopPropagation()}
                      options={[
                        { value: 'character', label: t('entity.character') },
                        { value: 'scene', label: t('entity.scene') },
                        { value: 'prop', label: t('entity.prop') },
                      ]}
                    />
                  </div>
                  {/* 分割线 */}
                  <div style={{ height: 1, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', margin: '1px 0' }} />
                  {/* 第二行：状态标签 + 上传新状态（变体操作） */}
                  <div style={infoRowStyle}>
                    <span style={{ fontSize: 9, color: textMuted, flexShrink: 0, whiteSpace: 'nowrap' }}>{t('subject.stateTag')}</span>
                    <input
                      value={activeVariant?.stateTag ?? ''}
                      onChange={handleStateTagChange}
                      onPointerDown={(e) => e.stopPropagation()}
                      placeholder="受伤态、成年、幼年..."
                      style={stateTagInputStyle(textMuted)}
                    />
                    <Tooltip title={t('subject.addState')}>
                      <button
                        type="button"
                        className="pm-icon-btn"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: textMuted, flexShrink: 0 }}
                      >
                        {uploading ? <span style={{ fontSize: 10 }}>...</span> : <UploadIcon size={12} />}
                      </button>
                    </Tooltip>
                    <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleAddVariant(f); e.target.value = ''; }} />
                  </div>
                </>
              ) : (
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: textMuted }}>
                  {t('productionManager.viewEmpty')}
                </div>
              )}
            </div>
          </div>
        </div>
      </BaseNodeView>
    </>
  );
});

// ===== 样式 =====

function infoBarStyle(bg: string): CSSProperties {
  return {
    flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3,
    padding: '6px 10px', background: bg,
  };
}

const infoRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, width: '100%',
};

function nameInputStyle(textPrimary: string): CSSProperties {
  return {
    flex: 1, minWidth: 0, border: 'none', background: 'transparent',
    fontSize: 13, fontWeight: 700, color: textPrimary, outline: 'none',
    padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  };
}

function stateTagInputStyle(textMuted: string): CSSProperties {
  return {
    flex: 1, minWidth: 0, border: 'none', background: 'transparent',
    fontSize: 10, color: textMuted, outline: 'none', padding: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  };
}