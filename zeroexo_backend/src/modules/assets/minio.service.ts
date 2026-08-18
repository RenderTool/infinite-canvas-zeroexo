/**
 * MinioService - 兼容层(委托给 StorageService)
 *
 * 保留原因:
 * - assets.service / resource.service / storage.controller / ai-generate 等
 *   多个模块已经注入 MinioService,直接改类型会引发大面积注入错误
 * - 本类作为「瘦壳」,所有方法委托给新的 StorageService
 *
 * 未来清理:
 * - 下一阶段将逐步把注入点从 MinioService 替换为 StorageService
 * - 替换完成后再删除本类
 *
 * 接口保留:
 * - presignPut / presignGet / putBuffer / readFile / removeObject
 * - setStorageRoot / getStorageRoot(供旧 SettingsService 调用)
 */
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class MinioService implements OnApplicationBootstrap {
  constructor(private readonly storageService: StorageService) {}

  /**
   * 在 OnApplicationBootstrap 阶段检查 StorageService 已完成初始化。
   * 原因:StorageService.onModuleInit 是 async(含 await reload()),
   * NestJS 对同一批模块的 onModuleInit 是并行触发的,
   * 不能保证 StorageService 完成 reload 后才轮到本服务。
   * 而 OnApplicationBootstrap 在所有 onModuleInit 完成后才触发,
   * 时序上能确保 StorageService.primary 已就绪。
   */
  onApplicationBootstrap(): void {
    if (!this.storageService.getPrimary()) {
      throw new Error('StorageService 未初始化,无法使用 MinioService');
    }
  }

  /**
   * 获取当前存储根目录(向后兼容)
   * - 仅当 primary 是 local driver 时返回本地路径
   * - 对象存储 driver 返回 bucket 名称
   */
  getStorageRoot(): string {
    const primary = this.storageService.getPrimary();
    if (primary.name === 'local') {
      // 反射访问 root(避免循环依赖)
      return (primary as unknown as { getRoot?: () => string }).getRoot?.() ?? '';
    }
    return `[driver:${primary.name}]`;
  }

  /**
   * 设置新的本地存储根目录(向后兼容)
   * - 仅当 primary 是 local driver 时生效
   * - 对象存储 driver 抛错(切路径请通过 driver 切换接口)
   */
  async setStorageRoot(newRoot: string): Promise<void> {
    const primary = this.storageService.getPrimary();
    if (primary.name !== 'local') {
      throw new Error(
        '当前使用对象存储 driver,无法直接 setStorageRoot;请通过 driver 切换接口修改',
      );
    }
    await (primary as unknown as { setRoot: (r: string) => Promise<void> }).setRoot(newRoot);
  }

  // ──────── 委托方法(签名不变) ────────

  async presignPut(
    key: string,
    contentType: string,
    expirySeconds?: number,
  ): Promise<string> {
    return this.storageService.presignPut(key, contentType, expirySeconds);
  }

  async presignGet(
    key: string,
    expirySeconds?: number,
  ): Promise<string> {
    return this.storageService.presignGet(key, expirySeconds);
  }

  async removeObject(key: string): Promise<void> {
    return this.storageService.removeObject(key);
  }

  async putBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<{ storageKey: string; size: number }> {
    const result = await this.storageService.putBuffer(key, buffer, contentType);
    return { storageKey: result.storageKey, size: result.size };
  }

  async readFile(key: string): Promise<Buffer | null> {
    return this.storageService.readFile(key);
  }
}
