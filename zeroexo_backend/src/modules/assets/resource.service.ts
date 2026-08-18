import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MinioService } from './minio.service';

/**
 * 资源池服务 - 内容寻址存储(CAS) + 引用计数 + 软删除 + 定时GC。
 *
 * 设计:
 * - 上传时按 SHA-256 去重,相同内容全局只存一份
 * - Asset 创建/删除 → refCount ±1
 * - Project 创建/更新/删除 → 解析 scene 中的 storageKey,refCount ±1
 * - refCount = 0 时软删除(deletedAt),由 GC 任务定期清理物理文件
 *
 * CAS 存储路径:
 * - 私有: resources/front/assets/{ownerId}/{hash前2位}/{hash}.{ext}
 * - 公共: resources/public/{hash前2位}/{hash}.{ext}
 */
@Injectable()
export class ResourceService {
  private readonly logger = new Logger(ResourceService.name);

  /** 系统级公共用户 ID - 所有 scope=public 的资源归此用户所有 */
  static readonly SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

  /** 软删除宽限期(7天),期间可恢复 */
  private static readonly GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  /**
   * 按内容哈希查找或创建资源记录(CAS 去重核心)。
   * 如果哈希已存在,直接返回已有资源(去重命中,无需重复上传)。
   * 返回 { resource, needsUpload } — needsUpload=false 表示文件已存在可跳过上传。
   */
  async findOrCreate(opts: {
    hash: string;
    ownerId: string;
    mimeType: string;
    size: number;
    ext: string;
    scope?: 'private' | 'public';
  }): Promise<{ storageKey: string; needsUpload: boolean }> {
    const existing = await this.prisma.resource.findUnique({
      where: { hash: opts.hash },
    });

    if (existing) {
      // 去重命中:文件已存在,复用 storageKey
      // 如果之前被软删除(refCount=0),恢复它
      if (existing.deletedAt) {
        await this.prisma.resource.update({
          where: { id: existing.id },
          data: { deletedAt: null },
        });
      }

      // 验证文件实际存在磁盘上（防止 DB 记录残留但文件因上传失败等原因丢失）
      // 如果文件不存在,则重新创建 Resource 并强制重新上传
      try {
        const fileBuffer = await this.minio.readFile(existing.storageKey);
        if (fileBuffer) {
          return { storageKey: existing.storageKey, needsUpload: false };
        }
      } catch {
        // readFile 可能抛出非 ENOENT 异常,同样视为文件不存在
      }

      // 文件不存在,删除旧记录,重新生成 storageKey 并强制上传
      this.logger.warn(
        `CAS 去重命中但文件实际不存在,重新创建(旧 key: ${existing.storageKey})`,
      );
      await this.prisma.resource.delete({ where: { id: existing.id } });
      // 继续执行下方创建新资源的逻辑
    }

    // 新资源:生成 CAS 存储路径
    const hashPrefix = opts.hash.slice(0, 2);
    const extSuffix = opts.ext ? `.${opts.ext}` : '';
    const isPublic = opts.scope === 'public';
    const prefix = isPublic ? 'resources/public' : `resources/front/assets/${opts.ownerId}`;
    const storageKey = `${prefix}/${hashPrefix}/${opts.hash}${extSuffix}`;

    // 公共资源使用系统用户 ID，避免与管理员个人资源耦合
    const actualOwnerId = isPublic ? ResourceService.SYSTEM_USER_ID : opts.ownerId;

    await this.prisma.resource.create({
      data: {
        hash: opts.hash,
        storageKey,
        ownerId: actualOwnerId,
        size: BigInt(opts.size),
        mimeType: opts.mimeType,
        refCount: 0,
      },
    });

    return { storageKey, needsUpload: true };
  }

  /** 增加引用计数(Asset 创建 / Project 引用资源时调用) */
  async incrementRef(storageKey: string): Promise<void> {
    await this.prisma.resource.updateMany({
      where: { storageKey },
      data: { refCount: { increment: 1 }, deletedAt: null },
    });
  }

  /** 减少引用计数,refCount=0 时标记软删除 */
  async decrementRef(storageKey: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const resource = await tx.resource.findUnique({
        where: { storageKey },
      });
      if (!resource) return;

      const newCount = Math.max(0, resource.refCount - 1);
      await tx.resource.update({
        where: { id: resource.id },
        data: {
          refCount: newCount,
          deletedAt: newCount === 0 ? new Date() : null,
        },
      });
    });
  }

  /**
   * 批量调整引用计数(用于 Project 场景更新时的 diff)。
   * added 集合中的 key +1,removed 集合中的 key -1。
   */
  async adjustRefs(added: Set<string>, removed: Set<string>): Promise<void> {
    for (const key of added) {
      await this.incrementRef(key);
    }
    for (const key of removed) {
      await this.decrementRef(key);
    }
  }

  /**
   * 从 Project.scene JSON 中提取所有 storageKey。
   * scene 结构: [{ data: { storageKey: "xxx" } }, ...]
   */
  extractStorageKeysFromScene(scene: unknown): Set<string> {
    const keys = new Set<string>();
    if (!Array.isArray(scene)) return keys;
    for (const node of scene) {
      if (node && typeof node === 'object' && 'data' in node) {
        const data = (node as { data?: { storageKey?: string } }).data;
        if (data?.storageKey && typeof data.storageKey === 'string') {
          keys.add(data.storageKey);
        }
      }
    }
    return keys;
  }

  /**
   * 定时 GC:清理软删除超过宽限期的资源。
   * 跳过被版本快照保护的资源(snapshotProtected=true)。
   * 删除 MinIO 文件 + DB 记录。
   * @returns 清理的资源数量
   */
  async garbageCollect(): Promise<number> {
    const cutoff = new Date(Date.now() - ResourceService.GC_GRACE_MS);
    const orphans = await this.prisma.resource.findMany({
      where: {
        deletedAt: { not: null, lt: cutoff },
        refCount: 0,
        snapshotProtected: false,
      },
    });

    if (orphans.length === 0) return 0;

    let deleted = 0;
    for (const orphan of orphans) {
      try {
        await this.minio.removeObject(orphan.storageKey);
        await this.prisma.resource.delete({ where: { id: orphan.id } });
        deleted++;
      } catch (err) {
        this.logger.warn(
          `GC: 删除资源失败(storageKey=${orphan.storageKey}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    this.logger.log(`GC: 清理了 ${deleted}/${orphans.length} 个孤儿资源`);
    return deleted;
  }
}
