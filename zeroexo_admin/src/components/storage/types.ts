/**
 * 存储 driver 相关类型定义
 *
 * 该文件汇总 StorageDriverSwitcher 模块用到的核心类型,
 * 供主组件及子组件(DriverCard / SwitchWizard)共享引用。
 *
 * 注意:DriverName 此处以字面量联合形式定义,
 * 与 driver-meta.tsx 中 DRIVER_META 的 4 个 key 保持一致,
 * 即等价于 keyof typeof DRIVER_META。
 */

// driver 名称联合类型,对应 DRIVER_META 的 4 个 key
export type DriverName = 'local' | 's3' | 'oss' | 'cos';

// 单个 driver 的配置
export interface DriverConfig {
  driver: 'local' | 's3' | 'oss' | 'cos';
  options: Record<string, any>;
}

// 存储总配置(primary 为主 driver,secondary 为备用 driver)
export interface StorageConfig {
  primary: DriverConfig;
  secondary?: DriverConfig;
  presignExpiry?: number;
}

// driver 健康状态(由后端 /admin/storage/health 接口返回)
export interface DriverHealth {
  driver: string;
  ok: boolean;
  error?: string;
  latencyMs?: number;
  checkedAt: string;
}
