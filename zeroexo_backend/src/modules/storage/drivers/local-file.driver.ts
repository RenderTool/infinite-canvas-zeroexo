/**
 * LocalFileDriver - 本地文件系统存储
 *
 * 用途:
 * - 单机部署 / 开发环境
 * - 中小规模(< 1TB,单机磁盘可容纳)
 * - 兼容旧版 MinioService 行为(伪预签名 URL 走后端 PUT/GET 路由)
 *
 * 配置:
 * {
 *   driver: 'local',
 *   options: { root: 'storage' }   // 相对路径基于 process.cwd
 * }
 *
 * 路径安全:
 * - resolveFilePath 严格校验防止 path traversal(.., .)
 * - 所有 storageKey 必须以 resources/ 或 canvases/ 或 logs/ 等业务前缀开头
 */

import { Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import type {
  DriverHealth,
  IStorageDriver,
  PutBufferResult,
  StorageObject,
} from '../storage-driver.interface';

export class LocalFileDriver implements IStorageDriver {
  readonly name = 'local' as const;
  private readonly logger = new Logger(LocalFileDriver.name);
  private root!: string;
  private readonly options: Record<string, any>;

  constructor(options: Record<string, any>) {
    this.options = options;
  }

  async init(): Promise<void> {
    const envRoot = process.env.STORAGE_ROOT;
    this.root = path.resolve(process.cwd(), this.options.root || envRoot || 'storage');
    await fs.mkdir(this.root, { recursive: true });
    this.logger.log(`本地存储已就绪,根目录: ${this.root}`);
  }

  async validateConfig(): Promise<string | null> {
    if (!this.options.root) {
      return '缺少 root 配置';
    }
    try {
      const resolved = path.resolve(process.cwd(), this.options.root);
      await fs.access(path.dirname(resolved));
      return null;
    } catch (err) {
      return `无法访问根目录: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * 解析 key 为绝对路径,严格防 path traversal
   */
  resolveFilePath(key: string): string {
    if (!key || typeof key !== 'string') {
      throw new Error(`非法 storageKey: ${String(key)}`);
    }
    const normalized = path
      .normalize(key)
      .replace(/^[/\\]+/, '')
      .replace(/\.\.+/g, '.');
    const full = path.join(this.root, normalized);
    if (!full.startsWith(this.root)) {
      throw new Error(`非法 storageKey(越界): ${key}`);
    }
    return full;
  }

  getPublicHost(): string {
    if (this.options.publicHost) return this.options.publicHost;
    const port = Number(process.env.PORT ?? '3000');
    return `http://localhost:${port}`;
  }

  async presignPut(key: string, _contentType?: string, _expirySeconds?: number): Promise<string> {
    return `${this.getPublicHost()}/api/storage/put?key=${encodeURIComponent(key)}`;
  }

  async presignGet(key: string, _expirySeconds?: number): Promise<string> {
    return `${this.getPublicHost()}/api/storage/get?key=${encodeURIComponent(key)}`;
  }

  async putBuffer(key: string, buffer: Buffer, _contentType?: string): Promise<PutBufferResult> {
    const file = this.resolveFilePath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
    return { storageKey: key, size: buffer.length };
  }

  async readFile(key: string): Promise<Buffer | null> {
    const file = this.resolveFilePath(key);
    try {
      return await fs.readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async removeObject(key: string): Promise<void> {
    const file = this.resolveFilePath(key);
    try {
      await fs.unlink(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const file = this.resolveFilePath(key);
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 列出所有 keys(分页式异步迭代)
   * 每次 yield 一个目录层级的批量结果,避免大目录 OOM
   */
  async *listAllKeys(prefix = ''): AsyncIterable<StorageObject[]> {
    const basePath = prefix ? this.resolveFilePath(prefix) : this.root;
    if (!basePath.startsWith(this.root)) {
      throw new Error(`非法 prefix(越界): ${prefix}`);
    }
    yield* this.walkDir(basePath, prefix);
  }

  private async *walkDir(
    dir: string,
    relPrefix: string,
  ): AsyncIterable<StorageObject[]> {
    let entries: fssync.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    // 每 100 个文件为一个 batch
    const BATCH = 100;
    let batch: StorageObject[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        yield* this.walkDir(full, rel);
      } else {
        const stat = await fs.stat(full);
        batch.push({
          key: rel.replace(/\\/g, '/'),
          size: stat.size,
          lastModified: stat.mtime,
        });
        if (batch.length >= BATCH) {
          yield batch;
          batch = [];
        }
      }
    }
    if (batch.length > 0) yield batch;
  }

  async copyObject(srcKey: string, destKey: string): Promise<void> {
    const src = this.resolveFilePath(srcKey);
    const dest = this.resolveFilePath(destKey);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }

  async healthCheck(): Promise<DriverHealth> {
    const start = Date.now();
    try {
      // 尝试创建并删除一个测试文件
      const testKey = `.healthcheck-${Date.now()}`;
      await this.putBuffer(testKey, Buffer.from('ok'), 'text/plain');
      await this.removeObject(testKey);
      return {
        driver: this.name,
        ok: true,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        driver: this.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /** 获取当前根目录(供 settings 模块与迁移使用) */
  getRoot(): string {
    return this.root;
  }

  /** 运行时修改根目录(迁移完成后由 StorageService 调用) */
  async setRoot(newRoot: string): Promise<void> {
    const resolved = path.resolve(newRoot);
    await fs.mkdir(resolved, { recursive: true });
    this.root = resolved;
    this.logger.log(`本地存储根目录已切换至: ${this.root}`);
  }

  /** 同步检查根目录是否存在(初始化时使用) */
  static existsSync(root: string): boolean {
    try {
      fssync.accessSync(root);
      return true;
    } catch {
      return false;
    }
  }
}
