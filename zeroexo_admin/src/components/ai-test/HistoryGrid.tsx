/**
 * HistoryGrid - 全屏网格视图
 *
 * 全屏模式下的历史记录网格布局，包含：
 *   1. 顶部工具栏：标题 + 记录数 Badge + 批量管理按钮 + 退出全屏按钮
 *   2. 网格主体：自适应列数的卡片网格（每张卡片由 HistoryCard 渲染）
 *   3. 底部：常显分页栏（总条数 + 上一页/下一页）
 *
 * 批量管理模式：
 *   - 点击「批量管理」进入模式，卡片右上角出现勾选框
 *   - 支持全选/取消全选，选中后显示「批量删除」按钮
 *   - 批量删除带确认弹窗（与单个删除同款确认提示）
 */
import { Button, Space, Badge, Modal, message, Tooltip, Input } from "antd";
import { SearchOutlined, HistoryOutlined, MinusSquareOutlined, DeleteOutlined, CheckSquareOutlined, CloseOutlined } from '@ant-design/icons';
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { apiPost } from "@/services/api-client";
import type { GenerationRecord, ResultImage } from "./types";
import HistoryCard from "./HistoryCard";

/** 统一 icon-only 按钮样式：24x24 方块，居中 */
const iconBtnStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};

export interface HistoryGridProps {
  /** 历史记录列表 */
  history: GenerationRecord[];
  /** 是否正在生成（用于禁用重试按钮） */
  generating: boolean;
  /** 下一页游标 */
  nextCursor: string | null;
  /** 历史总条数 */
  totalCount?: number;
  /** 当前页码 */
  currentPage: number;
  /** 翻页回调 */
  onPrevPage: () => void;
  onNextPage: () => void;
  /** 选中某条历史记录（点击卡片） */
  onSelectRecord: (record: GenerationRecord) => void;
  /** 退出全屏 */
  onExitFullScreen: () => void;
  /** 下载结果图片 */
  onDownload: (result: ResultImage, index: number) => void;
  /** 添加结果到参考图 */
  onAddToReferences: (result: ResultImage, index: number) => void;
  /** 查看详情 */
  onShowDetail: (record: GenerationRecord) => void;
  /** 重试该条记录 */
  onRetryHistory: (record: GenerationRecord) => void;
  /** 删除该条记录 */
  onDeleteHistory: (id: string) => void;
  /** 取消该条记录（仅 pending 状态显示取消按钮） */
  onCancelHistory?: (id: string) => void;
  /** 搜索关键词 */
  historySearch?: string;
  /** 搜索回调 */
  onSearchHistory?: (value: string) => void;
}

/** 全屏网格视图 */
export default function HistoryGrid({
  history,
  generating,
  nextCursor,
  totalCount,
  currentPage,
  onPrevPage,
  onNextPage,
  onSelectRecord,
  onExitFullScreen,
  onDownload,
  onAddToReferences,
  onShowDetail,
  onRetryHistory,
  onDeleteHistory,
  onCancelHistory,
  historySearch,
  onSearchHistory,
}: HistoryGridProps) {
  const { t } = useTranslation();
  // 批量模式状态
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  const isAllSelected = history.length > 0 && selectedIds.size === history.length;

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(history.map((h) => h.id)));
    }
  }, [history, isAllSelected]);

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) {
      message.warning(t('ai.noSelection'));
      return;
    }
    Modal.confirm({
      title: t('ai.confirmDelete'),
      centered: true,
      content: t('ai.batchDeleteHistoryConfirm', { count: selectedIds.size }),
      okText: t('ai.confirmDelete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setBatchDeleting(true);
        try {
          const ids = Array.from(selectedIds);
          await apiPost('/ai/generations/batch-delete', { ids });
          setSelectedIds(new Set());
          setBatchMode(false);
          message.success(t('ai.batchDeleteHistorySuccess', { count: ids.length }));
          // 触发父组件刷新
          onPrevPage();
        } catch {
          message.error(t('ai.deleteFailed'));
        } finally {
          setBatchDeleting(false);
        }
      },
    });
  }, [selectedIds, t, onPrevPage]);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleEnterBatchMode = useCallback(() => {
    setBatchMode(true);
    setSelectedIds(new Set());
  }, []);

  const hasPrev = currentPage > 1;
  const hasNext = !!nextCursor;
  const startIndex = (currentPage - 1) * 20 + 1;
  const endIndex = Math.min(startIndex + history.length - 1, totalCount ?? history.length);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* 顶部工具栏：统一 icon-only 按钮，大小颜色一致 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid #f0f0f0",
          flexShrink: 0,
        }}
      >
        <Space size={8}>
          <HistoryOutlined style={{ fontSize: 16 }} />
          <span style={{ fontSize: 15, fontWeight: 500 }}>历史记录</span>
          <Badge count={history.length} size="small" />
        </Space>
        <Space size={2}>
          <Input
            placeholder="搜索历史记录..."
            prefix={<SearchOutlined />}
            value={historySearch}
            onChange={(e) => onSearchHistory?.(e.target.value)}
            style={{ width: 240 }}
            allowClear
          />
          {batchMode ? (
            <>
              <Tooltip title={isAllSelected ? t('ai.deselectAll') : t('ai.selectAll')}>
                <Button
                  size="small"
                  icon={<CheckSquareOutlined style={{ fontSize: 14 }} />}
                  onClick={handleSelectAll}
                  disabled={batchDeleting}
                  style={iconBtnStyle}
                />
              </Tooltip>
              <Tooltip title={selectedIds.size > 0 ? t('ai.batchDeleteHistory') : t('ai.noSelection')}>
                <Button
                  size="small"
                  type="primary"
                  danger
                  icon={<DeleteOutlined style={{ fontSize: 14 }} />}
                  loading={batchDeleting}
                  disabled={selectedIds.size === 0}
                  onClick={handleBatchDelete}
                  style={{ ...iconBtnStyle, ...(selectedIds.size > 0 ? { background: '#ff4d4f', borderColor: '#ff4d4f' } : {}) }}
                />
              </Tooltip>
              <Tooltip title={t('ai.exitBatchMode')}>
                <Button
                  size="small"
                  icon={<CloseOutlined style={{ fontSize: 14 }} />}
                  onClick={exitBatchMode}
                  disabled={batchDeleting}
                  style={iconBtnStyle}
                />
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip title={t('ai.batchMode')}>
                <Button
                  size="small"
                  icon={<CheckSquareOutlined style={{ fontSize: 14 }} />}
                  onClick={handleEnterBatchMode}
                  style={iconBtnStyle}
                />
              </Tooltip>
              <Tooltip title="退出全屏">
                <Button
                  size="small"
                  icon={<MinusSquareOutlined style={{ fontSize: 14 }} />}
                  onClick={onExitFullScreen}
                  style={iconBtnStyle}
                />
              </Tooltip>
            </>
          )}
        </Space>
      </div>

      {/* 网格主体 */}
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {history.map((item) => (
            <HistoryCard
              key={item.id}
              item={item}
              variant="grid"
              generating={generating}
              selected={selectedIds.has(item.id)}
              onToggleSelect={batchMode ? handleToggleSelect : undefined}
              onSelect={(record) => {
                if (batchMode) {
                  handleToggleSelect(record.id);
                } else {
                  onSelectRecord(record);
                  onExitFullScreen();
                }
              }}
              onDownload={onDownload}
              onAddToReferences={onAddToReferences}
              onShowDetail={onShowDetail}
              onRetryHistory={onRetryHistory}
              onDeleteHistory={onDeleteHistory}
              onCancelHistory={onCancelHistory}
            />
          ))}
        </div>
      </div>

      {/* 底部常显分页 */}
      <div
        style={{
          flexShrink: 0,
          padding: "8px 16px",
          borderTop: "1px solid #f0f0f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 12, color: "#8c8c8c" }}>
          {totalCount != null
            ? `${history.length > 0 ? `第 ${startIndex}-${endIndex} 条，` : ''}共 ${totalCount} 条`
            : `共 ${history.length} 条`}
        </span>
        <Space size={4}>
          <Button
            size="small"
            disabled={!hasPrev}
            onClick={() => {
              exitBatchMode();
              onPrevPage();
            }}
          >
            上一页
          </Button>
          <span style={{ fontSize: 12, color: "#8c8c8c", padding: "0 4px" }}>
            {currentPage}
          </span>
          <Button
            size="small"
            disabled={!hasNext}
            onClick={() => {
              exitBatchMode();
              onNextPage();
            }}
          >
            下一页
          </Button>
        </Space>
      </div>
    </div>
  );
}
