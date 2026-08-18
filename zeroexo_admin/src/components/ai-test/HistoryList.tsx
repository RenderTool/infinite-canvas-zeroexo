/**
 * HistoryList - 右侧固定宽度列表视图
 *
 * 工作台右侧的历史记录列表，包含：
 *   1. 标题栏：图标 + 标题 + 记录数 Badge + 批量管理 + 全屏按钮
 *   2. 主体：错误重试 / 空状态 / 卡片列表（每张卡片由 HistoryCard 渲染）
 *   3. 底部：常显分页栏（总条数 + 上一页/下一页）
 *
 * 批量管理模式：
 *   - 点击「批量管理」进入模式，卡片出现勾选框
 *   - 支持全选/取消全选，选中后标题栏显示「批量删除」按钮
 *   - 批量删除带确认弹窗（与单个删除同款确认提示）
 *   - 批量模式下清空按钮隐藏
 */
import {
  Card,
  Button,
  Tooltip,
  Badge,
  Space,
  Empty,
  Modal,
  message,
  Input,
} from "antd";
import { SearchOutlined, HistoryOutlined, ReloadOutlined, FullscreenOutlined, DeleteOutlined, CheckSquareOutlined, CloseOutlined } from '@ant-design/icons';
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

export interface HistoryListProps {
  /** 历史记录列表 */
  history: GenerationRecord[];
  /** 当前选中的历史记录 id */
  activeHistoryId: string | null;
  /** 加载中（清空操作） */
  clearing: boolean;
  /** 是否正在生成（用于禁用重试按钮） */
  generating: boolean;
  /** 历史加载错误信息 */
  historyLoadError: string | null;
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
  /** 清空全部历史 */
  onClearHistory: () => void;
  /** 重新加载历史（错误状态下的「重试」按钮） */
  onRetryLoad: () => void;
  /** 进入全屏 */
  onEnterFullScreen: () => void;
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

/** 右侧固定宽度列表视图 */
export default function HistoryList({
  history,
  activeHistoryId,
  clearing,
  generating,
  historyLoadError,
  nextCursor,
  totalCount,
  currentPage,
  onPrevPage,
  onNextPage,
  onSelectRecord,
  onClearHistory,
  onRetryLoad,
  onEnterFullScreen,
  onDownload,
  onAddToReferences,
  onShowDetail,
  onRetryHistory,
  onDeleteHistory,
  onCancelHistory,
  historySearch,
  onSearchHistory,
}: HistoryListProps) {
  const { t } = useTranslation();
  // 批量模式状态
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  const isAllSelected = history.length > 0 && selectedIds.size === history.length;
  const hasPrev = currentPage > 1;
  const hasNext = !!nextCursor;

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

  /** 渲染批量模式工具栏（插入标题栏和记录列表之间） */
  const renderBatchToolbar = () => {
    if (!batchMode) return null;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "2px 6px",
          borderBottom: "1px solid #f0f0f0",
          background: "#fafafa",
          flexShrink: 0,
        }}
      >
        <Tooltip title={isAllSelected ? t('ai.deselectAll') : t('ai.selectAll')}>
          <Button
            size="small"
            type="text"
            icon={<CheckSquareOutlined style={{ fontSize: 13 }} />}
            onClick={handleSelectAll}
            disabled={batchDeleting}
            style={iconBtnStyle}
          />
        </Tooltip>
        <Tooltip title={selectedIds.size > 0 ? `${t('ai.batchDeleteHistory')} (${selectedIds.size})` : t('ai.noSelection')}>
          <Button
            size="small"
            type="primary"
            danger
            icon={<DeleteOutlined style={{ fontSize: 13 }} />}
            loading={batchDeleting}
            disabled={selectedIds.size === 0}
            onClick={handleBatchDelete}
            style={{ ...iconBtnStyle, ...(selectedIds.size > 0 ? { background: '#ff4d4f', borderColor: '#ff4d4f' } : {}) }}
          />
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Tooltip title={t('ai.exitBatchMode')}>
          <Button
            size="small"
            type="text"
            icon={<CloseOutlined style={{ fontSize: 13 }} />}
            onClick={exitBatchMode}
            disabled={batchDeleting}
            style={{ ...iconBtnStyle, color: "#8c8c8c" }}
          />
        </Tooltip>
      </div>
    );
  };

  return (
    <Card
      size="small"
      style={{
        borderRadius: 4,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      styles={{ body: { padding: 0, flex: 1, overflow: "auto", display: "flex", flexDirection: "column" } }}
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <Space size={6}>
              <HistoryOutlined style={{ fontSize: 14 }} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>历史记录</span>
              <Badge count={history.length} size="small" />
            </Space>
            <Space size={2}>
              {!batchMode && (
                <>
                  <Tooltip title={t('ai.batchMode')}>
                    <Button
                      size="small"
                      type="text"
                      icon={<CheckSquareOutlined style={{ fontSize: 14 }} />}
                      onClick={handleEnterBatchMode}
                      style={iconBtnStyle}
                    />
                  </Tooltip>
                  <Tooltip title="全屏查看">
                    <Button
                      size="small"
                      type="text"
                      icon={<FullscreenOutlined style={{ fontSize: 14 }} />}
                      onClick={onEnterFullScreen}
                      style={iconBtnStyle}
                    />
                  </Tooltip>
                  {history.length > 0 && (
                    <Tooltip title="清空全部">
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined style={{ fontSize: 14 }} />}
                        loading={clearing}
                        onClick={onClearHistory}
                        style={iconBtnStyle}
                      />
                    </Tooltip>
                  )}
                </>
              )}
            </Space>
          </div>
          <Input
            size="small"
            placeholder="搜索历史记录..."
            prefix={<SearchOutlined style={{ fontSize: 12, color: 'var(--color-text-tertiary, #bfbfbf)' }} />}
            value={historySearch}
            onChange={(e) => onSearchHistory?.(e.target.value)}
            allowClear
          />
        </div>
      }
    >
      {batchMode && renderBatchToolbar()}
      {historyLoadError && history.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            color: "#8c8c8c",
          }}
        >
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            {historyLoadError}
          </div>
          <Button
            size="small"
            icon={<ReloadOutlined style={{ fontSize: 12 }} />}
            onClick={onRetryLoad}
          >
            重试
          </Button>
        </div>
      ) : history.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "#bfbfbf",
            flex: 1,
          }}
        >
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无历史记录"
            style={{ margin: 0 }}
          />
        </div>
      ) : (
        <div
          style={{
            padding: 4,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flex: 1,
            overflow: "auto",
          }}
        >
          {history.map((item) => (
            <HistoryCard
              key={item.id}
              item={item}
              variant="list"
              active={activeHistoryId === item.id}
              generating={generating}
              selected={selectedIds.has(item.id)}
              onToggleSelect={batchMode ? handleToggleSelect : undefined}
              onSelect={(record) => {
                if (batchMode) {
                  handleToggleSelect(record.id);
                } else {
                  onSelectRecord(record);
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
      )}

      {/* 底部常显分页 */}
      <div
        style={{
          flexShrink: 0,
          padding: "6px 8px",
          borderTop: "1px solid #f0f0f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#fafafa",
        }}
      >
        <span style={{ fontSize: 11, color: "#8c8c8c" }}>
          {totalCount != null ? `共 ${totalCount} 条` : `共 ${history.length} 条`}
        </span>
        <Space size={2}>
          <Button
            size="small"
            type="text"
            disabled={!hasPrev}
            onClick={() => {
              exitBatchMode();
              onPrevPage();
            }}
            style={{ fontSize: 11, height: 22, color: hasPrev ? "#1677ff" : "#d9d9d9" }}
          >
            上一页
          </Button>
          <span style={{ fontSize: 11, color: "#8c8c8c", padding: "0 2px" }}>
            {currentPage}
          </span>
          <Button
            size="small"
            type="text"
            disabled={!hasNext}
            onClick={() => {
              exitBatchMode();
              onNextPage();
            }}
            style={{ fontSize: 11, height: 22, color: hasNext ? "#1677ff" : "#d9d9d9" }}
          >
            下一页
          </Button>
        </Space>
      </div>
    </Card>
  );
}
