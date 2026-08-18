/**
 * IStorageDriver - 存储后端抽象接口
 *
 * 设计原则:
 * 1. 纯接口契约,无 Nest 框架依赖 - 便于单元测试与 mock
 * 2. 所有 driver 必须实现的最小方法集 - 业务侧只需依赖接口,不关心具体实现
 * 3. URL 形态由 driver 决定 - 业务侧不直接拼 URL,统一通过 presignGet/Put 获取
 *
 * driver 实现方:
 * - LocalFileDriver    本地文件系统(默认/单机)
 * - S3CompatibleDriver MinIO / AWS S3(S3 协议)
 * - AliyunOssDriver    阿里云 OSS/OBS(支持 STS)
 * - TencentCosDriver   腾讯云 COS
 *
 * 切换策略:
 * - storage.primary:   当前的"读 + 写"目标
 * - storage.secondary: 迁移期"只写"目标(可选),用于双写过渡
 * - 切读时:把旧 primary 置为 secondary,观察无新写入后下线
 */

export type StorageDriverName = 'local' | 's3' | 'oss' | 'cos';

/** driver 配置(driver 名 + 具体参数) */
export interface DriverConfig {
  driver: StorageDriverName;
  options: Record<string, any>;
}

/** 全局存储配置(primary 必填,secondary 可选) */
export interface StorageConfig {
  primary: DriverConfig;
  secondary?: DriverConfig;
  /** 预签名 URL 默认有效期(秒) */
  presignExpiry?: number;
}

/** driver 健康检查结果 */
export interface DriverHealth {
  driver: string;
  ok: boolean;
  error?: string;
  latencyMs?: number;
  checkedAt?: string;
}

/** 存储对象元信息(listAllKeys 批量返回) */
export interface StorageObject {
  key: string;
  size: number | bigint;
  lastModified?: Date;
}

/** 上传结果 */
export interface PutBufferResult {
  storageKey: string;
  size: number;
  etag?: string;
}

/**
 * 存储后端抽象接口 - 所有 driver 的最小契约
 */
export interface IStorageDriver {
  /** driver 名称(local / s3 / oss / cos) */
  name: StorageDriverName;

  /** 初始化(校验配置、连接就绪) */
  init(): Promise<void>;

  /** 释放资源(关闭连接等),可省略 */
  dispose?(): Promise<void>;

  /** 配置校验,返回错误信息或 null(校验通过) */
  validateConfig(): Promise<string | null>;

  /** 健康检查 */
  healthCheck(): Promise<DriverHealth>;

  /** 生成上传预签名 URL(直接上传,绕过后端) */
  presignPut(key: string, contentType?: string, expirySeconds?: number): Promise<string>;

  /** 生成下载预签名 URL */
  presignGet(key: string, expirySeconds?: number): Promise<string>;

  /** 上传 Buffer */
  putBuffer(key: string, buffer: Buffer, contentType?: string): Promise<PutBufferResult>;

  /** 读取文件,不存在返回 null */
  readFile(key: string): Promise<Buffer | null>;

  /** 删除对象,不存在不报错 */
  removeObject(key: string): Promise<void>;

  /** 判断对象是否存在 */
  exists(key: string): Promise<boolean>;

  /** 列出所有 keys(分页式异步迭代,每次 yield 一个批量) */
  listAllKeys(prefix?: string): AsyncIterable<StorageObject[]>;

  /** 服务端复制(可选) */
  copyObject?(srcKey: string, destKey: string): Promise<void>;

  /** 获取当前根目录/容器名(供 settings 与迁移使用,可选) */
  getRoot?(): string;

  /** 运行时修改根目录(迁移完成后由 StorageService 调用,可选) */
  setRoot?(root: string): Promise<void>;
}
