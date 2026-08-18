/**
 * StorageDriverSwitcher 已拆分至 ./storage/ 目录:
 * - types.ts                  类型定义(DriverConfig / StorageConfig / DriverHealth / DriverName)
 * - driver-meta.tsx           DRIVER_META 元数据 + SecretInput 密码输入框
 * - DriverCard.tsx            单个 driver 卡片
 * - SwitchWizard.tsx          切换向导(配置 → 测试 → 确认)
 * - StorageDriverSwitcher.tsx 主组件
 *
 * 此文件保留为重新导出入口,以兼容现有 import 路径
 * (例如 @/components/storage-driver-switcher),无需修改其他引用方。
 */
export { default } from './storage/StorageDriverSwitcher';
