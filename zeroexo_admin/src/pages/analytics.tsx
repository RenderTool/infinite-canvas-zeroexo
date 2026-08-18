/**
 * 数据分析 - 纯路由分发页面
 *
 * 运营分析 / 计费分析(开发中) 由左侧 sidebar 子项导航，本页面仅根据当前路由路径
 * 渲染对应子页面。
 */
import AnalyticsOperations from './analytics-operations';

export default function Analytics() {
  // 计费分析页开发中,直接渲染运营分析
  return <AnalyticsOperations />;
}