/**
 * HistoryPanel - 历史记录面板
 *
 * 面板编排层，根据 fullScreen 标志在两种视图间切换：
 *   1. 右侧固定宽度（280px）的列表卡片视图（HistoryList）
 *   2. 全屏网格视图（HistoryGrid，点击右上角全屏按钮触发）
 *
 * 每张历史卡片提供以下操作：
 *   - 下载结果图片
 *   - 添加到参考图
 *   - 查看详情
 *   - 复制提示词
 *   - 重试（仅失败状态）
 *   - 删除
 *
 * 状态变更与网络请求通过回调上抛给主组件处理。
 */
import type { GenerationRecord, ResultImage } from "./types";
import HistoryGrid from "./HistoryGrid";
import HistoryList from "./HistoryList";

export interface HistoryPanelProps {
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
  /** 是否处于全屏视图 */
  fullScreen: boolean;
  /** 选中某条历史记录（点击卡片） */
  onSelectRecord: (record: GenerationRecord) => void;
  /** 清空全部历史 */
  onClearHistory: () => void;
  /** 重新加载历史（错误状态下的「重试」按钮） */
  onRetryLoad: () => void;
  /** 进入全屏 */
  onEnterFullScreen: () => void;
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

/** 历史记录面板 - 视图编排层 */
export default function HistoryPanel({
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
  fullScreen,
  onSelectRecord,
  onClearHistory,
  onRetryLoad,
  onEnterFullScreen,
  onExitFullScreen,
  onDownload,
  onAddToReferences,
  onShowDetail,
  onRetryHistory,
  onDeleteHistory,
  onCancelHistory,
  historySearch,
  onSearchHistory,
}: HistoryPanelProps) {
  // ═══════ 全屏视图 ═══════
  if (fullScreen) {
    return (
      <HistoryGrid
        history={history}
        generating={generating}
        nextCursor={nextCursor}
        totalCount={totalCount}
        currentPage={currentPage}
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
        onSelectRecord={onSelectRecord}
        onExitFullScreen={onExitFullScreen}
        onDownload={onDownload}
        onAddToReferences={onAddToReferences}
        onShowDetail={onShowDetail}
        onRetryHistory={onRetryHistory}
        onDeleteHistory={onDeleteHistory}
        onCancelHistory={onCancelHistory}
        historySearch={historySearch}
        onSearchHistory={onSearchHistory}
      />
    );
  }

  // ═══════ 右侧固定宽度列表视图 ═══════
  return (
    <HistoryList
      history={history}
      activeHistoryId={activeHistoryId}
      clearing={clearing}
      generating={generating}
      historyLoadError={historyLoadError}
      nextCursor={nextCursor}
      totalCount={totalCount}
      currentPage={currentPage}
      onPrevPage={onPrevPage}
      onNextPage={onNextPage}
      onSelectRecord={onSelectRecord}
      onClearHistory={onClearHistory}
      onRetryLoad={onRetryLoad}
      onEnterFullScreen={onEnterFullScreen}
      onDownload={onDownload}
      onAddToReferences={onAddToReferences}
      onShowDetail={onShowDetail}
      onRetryHistory={onRetryHistory}
      onDeleteHistory={onDeleteHistory}
      onCancelHistory={onCancelHistory}
      historySearch={historySearch}
      onSearchHistory={onSearchHistory}
    />
  );
}
