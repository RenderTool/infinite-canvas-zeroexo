/**
 * PromptViewer - 统一提示词查看器
 *
 * 2026-08-29 架构统一：改为复用「资产浏览器（AssetDetailViewer）」这套查看器框架，
 * 只是展示区由图片/文档换成提示词链路画布 —— 与图片、文档同属一个 UI 框架的变体，
 * 用户不应看出这是两套 UI：
 * - 同一个 Modal 外壳、同一条底部出血悬浮操作栏、同一个尺寸（maxWidth 1300 + calc(100vh - 140px)）
 * - 提示词在下载按钮那一排额外多出「编辑」与「副本」两个图标按钮
 * - 删除统一由外层资产库负责，提示词页面内部不再自带删除按钮
 *
 * 提示词画布通过 renderPromptStage 注入（shared 不能反向 import features，会成环）。
 */
import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  PromptCreatePage,
  type PromptCreatePageHandle,
  type PublicPromptInitialData,
} from '@/features/asset-library/index.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AssetDetailViewer, type AssetDetailData } from '@/shared/components/asset-detail-viewer.js';

export interface PublicPromptViewItem {
  id: string;
  title: string;
  content: string;
  contentEn?: string;
  contentJa?: string;
  category: string;
  tags: string[];
  images: { storageKey: string; width?: number; height?: number; alt?: string }[];
  source: string;
  sourceId?: string;
  sourceName?: string;
  sourceUrl?: string;
  license?: string;
}

export interface PromptViewerProps {
  promptId?: string;
  publicItem?: PublicPromptViewItem;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  /** 标题变化回调（用于外部 Modal 同步标题） */
  onTitleChange?: (title: string) => void;
}

export function PromptViewer({
  promptId,
  publicItem,
  open,
  onClose,
  onSaved,
  onTitleChange: onTitleChangeProp,
}: PromptViewerProps): React.ReactElement {
  const { t } = useTranslation();
  const kindLabel = t('asset.kindPrompt', 'Prompt');

  // ===================== 状态 =====================
  const [editDirty, setEditDirty] = useState(false);
  /** 编辑态：受控于资产浏览器底部出血栏的「编辑 / 保存 / 取消」 */
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 标题与画布内标题输入双向同步（供资产浏览器标题栏展示） */
  const [title, setTitle] = useState(publicItem?.title ?? '');
  const pageRef = useRef<PromptCreatePageHandle | null>(null);

  const { modal } = App.useApp();

  // ===================== 关闭拦截（未保存提示） =====================
  const handleRequestClose = useCallback(() => {
    if (editDirty) {
      modal.confirm({
        title: t('promptViewer.discardUnsavedTitle'),
        content: t('promptViewer.discardUnsavedContent'),
        okText: t('promptViewer.discardAndExit'),
        cancelText: t('promptViewer.continueEditing'),
        okButtonProps: { danger: true },
        centered: true,
        onOk: onClose,
      });
      return;
    }
    onClose();
  }, [editDirty, onClose, t]);

  const handleTitleChange = useCallback((v: string) => {
    setTitle(v);
    onTitleChangeProp?.(v);
  }, [onTitleChangeProp]);

  /** 底部出血栏「保存」 */
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await pageRef.current?.save();
      setEditing(false);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [onSaved]);

  /** 底部出血栏「副本」：复制到个人提示词库 */
  const handleDuplicate = useCallback(async () => {
    await pageRef.current?.duplicate();
  }, []);

  // 编辑态变更：进入编辑交给页面内部记录快照（脏检查 / 取消回退依赖它）。
  // 用 ref 守卫，避免内部 setViewMode 回调 → 再次触发本函数的死循环。
  const editingRef = useRef(false);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  const handleEditingChange = useCallback((v: boolean) => {
    if (editingRef.current === v) return;
    editingRef.current = v;
    if (v) pageRef.current?.enterEdit();
    else pageRef.current?.cancelEdit();
    setEditing(v);
  }, []);

  // ===================== 边界情况 =====================
  if (!open) return <></>;
  if (!promptId && !publicItem) return <></>;

  // ===================== 公共提示词：初始数据 =====================
  const initialData: PublicPromptInitialData | undefined = publicItem
    ? {
        title: publicItem.title,
        content: publicItem.content,
        category: publicItem.category,
        tags: publicItem.tags ?? [],
        images: (publicItem.images ?? []).map((img) => ({ storageKey: img.storageKey })),
        contentEn: publicItem.contentEn,
        contentJa: publicItem.contentJa,
      }
    : undefined;

  // 提示词资产描述 —— 交给资产浏览器统一渲染外壳 / 标题栏 / 底部出血栏
  const asset: AssetDetailData = {
    id: promptId ?? publicItem!.id,
    title: title || publicItem?.title || kindLabel,
    kind: 'prompt',
    bytes: 0,
    tags: publicItem?.tags,
    data: {
      kind: 'prompt',
      content: publicItem?.content,
      prompt: publicItem?.content,
    },
  };

  // ===================== 渲染：复用资产浏览器框架，展示区注入提示词画布 =====================
  return (
    <AssetDetailViewer
      asset={asset}
      onClose={handleRequestClose}
      // 提示词画布作为「特殊类型的展示区」注入 —— 与图片/文档同框架，
      // 舞台尺寸、底部出血栏、按钮风格完全一致，用户看不出是两套 UI
      renderPromptStage={({ editing: stageEditing }) => (
        promptId ? (
          <PromptCreatePage
            ref={pageRef}
            embedded
            hideTitle
            promptId={promptId}
            viewMode={stageEditing ? 'edit' : 'view'}
            onSaved={onSaved ?? onClose}
            onDeleted={onClose}
            onTitleChange={handleTitleChange}
            onDirtyChange={setEditDirty}
            // 「生成副本 → 点击跳转」时先关掉本弹窗，否则跳转后仍遮挡资产库
            onRequestClose={handleRequestClose}
          />
        ) : (
          <PromptCreatePage
            ref={pageRef}
            embedded
            hideTitle
            readOnly
            initialData={initialData!}
            onSaved={onClose}
            // 公共提示词「副本」后点击跳转：同样先关弹窗再跳
            onRequestClose={handleRequestClose}
            publicMeta={publicItem ? {
              license: publicItem.license,
              source: publicItem.source,
              sourceName: publicItem.sourceName,
              sourceUrl: publicItem.sourceUrl,
            } : undefined}
          />
        )
      )}
      // 私有提示词可编辑；公共提示词只读（只提供「副本」）
      editable={!!promptId}
      editing={editing}
      onEditingChange={handleEditingChange}
      onSave={handleSave}
      saving={saving}
      // 副本：公共提示词收藏为副本；私有提示词也可复制一份
      onDuplicate={handleDuplicate}
    />
  );
}
