import { create } from 'zustand';

/**
 * Plan#20 T9b: 主体按集过滤共享状态。
 * episodeId = null 表示「全部」;选中某集后画布上未关联该集的主体卡视觉降噪(半透明 + 禁交互)。
 * 纯 UI 过滤,不写节点数据、不进 CommandQueue,点「全部」即恢复。
 */
interface SubjectFilterState {
  episodeId: string | null;
  setEpisode: (episodeId: string | null) => void;
}

export const useSubjectFilterStore = create<SubjectFilterState>((set) => ({
  episodeId: null,
  setEpisode: (episodeId) => set({ episodeId }),
}));
