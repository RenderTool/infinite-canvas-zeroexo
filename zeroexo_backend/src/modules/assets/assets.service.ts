import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MinioService } from './minio.service';
import { ResourceService } from './resource.service';
import { LogsService } from '../logs/logs.service';
import { badRequest, notFound } from '../../common/errors/app-exception.js';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  CreateAssetDto,
  CreateAssetsBatchDto,
  CreateScriptAssetDto,
  CreateZeroexoAssetDto,
  CreateZeroexoStructuredDto,
  PresignAssetDto,
  PresignAssetsBatchDto,
  UpdateAssetDto,
  UpdateZeroexoAssetDto,
} from './dto/asset.dto';

/** 默认每页条数 */
const DEFAULT_LIMIT = 20;
/** 单页最大条数 */
const MAX_LIMIT = 100;

/** 允许客户端写入的 storageKey 前缀(与 presign 流程生成的路径保持一致) */
const ALLOWED_STORAGE_KEY_PREFIXES = ['resources/'];

/**
 * 校验客户端传入的 storageKey: 必须位于允许前缀下,且不允许路径穿越。
 * 防止客户端任意指定路径覆盖/污染存储目录。
 */
function assertSafeStorageKey(storageKey: string): void {
  if (
    !storageKey ||
    !ALLOWED_STORAGE_KEY_PREFIXES.some((prefix) => storageKey.startsWith(prefix))
  ) {
    throw badRequest(
      ErrorCode.BAD_REQUEST,
      `storageKey 必须以 ${ALLOWED_STORAGE_KEY_PREFIXES.join('或')} 开头`,
    );
  }
  if (storageKey.includes('..') || storageKey.includes('\\') || storageKey.startsWith('/')) {
    throw badRequest(ErrorCode.BAD_REQUEST, 'storageKey 不允许路径穿越(.. / \\ / 绝对路径)');
  }
}

/**
 * 从文件名提取扩展名(不含点),无扩展名时返回空字符串。
 */
function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

/**
 * 资产服务 - 当前用户的资产 CRUD 与 MinIO 预签名 URL 管理。
 * 列表接口采用游标分页(cursor + take + skip 1),与 projects 服务一致。
 *
 * 资源存储采用 CAS(内容寻址存储),通过 ResourceService 管理去重和引用计数。
 */
@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly resourceService: ResourceService,
    private readonly logsService: LogsService,
  ) {}

  /**
   * 预签名上传 - CAS 去重:如果提供了 contentHash,先检查是否已存在。
   * - 去重命中:返回已有 storageKey,uploadUrl=null(客户端跳过上传)
   * - 新资源:生成 CAS storageKey,返回预签名 URL
   * - 无 contentHash:回退到旧逻辑(随机 key,向后兼容)
   */
  async presign(
    userId: string,
    dto: PresignAssetDto,
  ): Promise<{ uploadUrl: string | null; storageKey: string }> {
    const ext = getExtension(dto.filename);

    // CAS 去重:客户端提供 contentHash 时走内容寻址路径
    if (dto.contentHash) {
      const { storageKey, needsUpload } = await this.resourceService.findOrCreate({
        hash: dto.contentHash,
        ownerId: userId,
        mimeType: dto.mimeType,
        size: dto.size,
        ext,
        scope: dto.scope,
      });

      if (!needsUpload) {
        // 去重命中:文件已存在,无需上传
        return { uploadUrl: null, storageKey };
      }

      const uploadUrl = await this.minio.presignPut(storageKey, dto.mimeType);
      return { uploadUrl, storageKey };
    }

    // 向后兼容:无 contentHash 时使用随机 key
    const suffix = ext ? `.${ext}` : '';
    const isPublic = dto.scope === 'public';
    const prefix = isPublic ? 'resources/public' : `resources/front/assets/${userId}`;
    const storageKey = `${prefix}/${nanoid()}${suffix}`;
    const uploadUrl = await this.minio.presignPut(storageKey, dto.mimeType);
    return { uploadUrl, storageKey };
  }

  /**
   * 批量预签名上传 - 逐条复用 presign 逻辑(CAS 去重同样生效)。
   * 单条失败不阻断整批:失败项返回 error 字段,客户端可降级单条重试。
   * 返回与 dto.items 等长、同序的结果数组。
   */
  async presignBatch(
    userId: string,
    dto: PresignAssetsBatchDto,
  ): Promise<{
    results: Array<
      | { uploadUrl: string | null; storageKey: string }
      | { error: string }
    >;
  }> {
    const results: Array<
      | { uploadUrl: string | null; storageKey: string }
      | { error: string }
    > = [];
    for (const item of dto.items) {
      try {
        results.push(await this.presign(userId, item));
      } catch (err) {
        this.logger.warn(
          `批量 presign 单条失败: ${item.filename} (${err instanceof Error ? err.message : String(err)})`,
        );
        results.push({ error: err instanceof Error ? err.message : 'presign failed' });
      }
    }
    return { results };
  }

  /**
   * 创建资产元数据 - 上传完成后调用。
   * 同时增加对应 Resource 的引用计数。
   */
  async create(userId: string, dto: CreateAssetDto) {
    // 服务端校验 storageKey 前缀与路径穿越,不信任客户端任意路径
    assertSafeStorageKey(dto.storageKey);
    const asset = await this.prisma.asset.create({
      data: {
        ownerId: userId,
        kind: dto.kind,
        filename: dto.filename,
        storageKey: dto.storageKey,
        mimeType: dto.mimeType,
        size: BigInt(dto.size),
        ...(dto.width !== undefined ? { width: dto.width } : {}),
        ...(dto.height !== undefined ? { height: dto.height } : {}),
        ...(dto.duration !== undefined ? { duration: dto.duration } : {}),
        ...(dto.thumbnailKey !== undefined
          ? { thumbnailKey: dto.thumbnailKey }
          : {}),
        ...(dto.text !== undefined ? { text: dto.text } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.folderId !== undefined ? { folderId: dto.folderId } : {}),
        lastSyncedAt: new Date(),
      },
    });

    // 增加资源引用计数
    await this.resourceService.incrementRef(dto.storageKey);

    this.logsService.log('asset', `上传素材: ${dto.filename}`, {
      userId,
      meta: {
        kind: dto.kind,
        filename: dto.filename,
        size: dto.size,
        mimeType: dto.mimeType,
        storageKey: dto.storageKey,
        folderId: dto.folderId,
      },
    });

    return asset;
  }

  /**
   * 批量创建资产元数据(Google Photos batchCreate 模式):
   * 逐条复用 create 逻辑(校验/引用计数/日志),单条失败不中断整批,
   * 返回每条的成功/失败明细,便于客户端对失败项单独重试。
   */
  async createBatch(userId: string, dto: CreateAssetsBatchDto) {
    const results: Array<{
      index: number;
      filename: string;
      ok: boolean;
      asset?: Awaited<ReturnType<AssetsService['create']>>;
      error?: string;
    }> = [];
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < dto.items.length; i += 1) {
      const item = dto.items[i]!;
      try {
        const asset = await this.create(userId, item);
        results.push({ index: i, filename: item.filename, ok: true, asset });
        ok += 1;
      } catch (err) {
        failed += 1;
        results.push({
          index: i,
          filename: item.filename,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.logsService.log(
      'asset',
      `批量导入素材: ${ok} 成功 / ${failed} 失败`,
      { userId, meta: { total: dto.items.length, ok, failed } },
    );
    return { total: dto.items.length, ok, failed, results };
  }

  /**
   * 创建剧本资产 - 剧本以 kind='script' 存储,text 字段保存剧集 JSON。
   * 无文件上传,不涉及 Resource 引用计数。
   */
  async createScriptAsset(userId: string, dto: CreateScriptAssetDto) {
    const asset = await this.prisma.asset.create({
      data: {
        ownerId: userId,
        kind: 'script',
        filename: dto.filename,
        storageKey: `script/${userId}/${nanoid()}`,
        mimeType: 'application/json',
        size: Buffer.byteLength(dto.text, 'utf-8'),
        text: dto.text,
        tags: dto.tags ?? [],
        category: 'user',
        lastSyncedAt: new Date(),
      },
    });

    this.logsService.log('asset', `创建剧本资产: ${dto.filename}`, {
      userId,
      meta: { id: asset.id, kind: 'script', filename: dto.filename },
    });

    return asset;
  }

  /**
   * 创建 .zeroexo 结构化资产 - 资产引擎产物。
   * kind 取值: zeroexo-text | zeroexo-entity | zeroexo-prompt
   * 同时增加对应 Resource 的引用计数。
   */
  async createZeroexoAsset(userId: string, dto: CreateZeroexoAssetDto) {
    // 服务端校验 storageKey 前缀与路径穿越,不信任客户端任意路径
    assertSafeStorageKey(dto.storageKey);
    const asset = await this.prisma.asset.create({
      data: {
        ownerId: userId,
        kind: dto.kind,
        filename: dto.filename,
        storageKey: dto.storageKey,
        mimeType: dto.mimeType,
        size: BigInt(dto.size),
        text: dto.text,
        tags: dto.tags ?? [],
        category: 'user',
        lastSyncedAt: new Date(),
      },
    });

    // 增加资源引用计数
    await this.resourceService.incrementRef(dto.storageKey);

    this.logsService.log('asset', `上传 .zeroexo 资产: ${dto.filename}`, {
      userId,
      meta: {
        id: asset.id,
        kind: dto.kind,
        filename: dto.filename,
        size: dto.size,
        projectId: dto.projectId,
      },
    });

    return asset;
  }

  /**
   * 创建零结构化资产(entity/prompt) - 自动生成 storageKey, 无需文件上传。
   * 类似 createScriptAsset, 结构化数据直接存入 text 字段。
   */
  async createZeroexoStructuredAsset(userId: string, dto: CreateZeroexoStructuredDto) {
    const asset = await this.prisma.asset.create({
      data: {
        ownerId: userId,
        kind: dto.kind,
        filename: dto.filename,
        storageKey: `zeroexo/${dto.kind}/${userId}/${nanoid()}`,
        mimeType: 'application/zeroexo+json',
        size: BigInt(0),
        text: dto.text,
        tags: dto.tags ?? [],
        category: 'user',
        lastSyncedAt: new Date(),
      },
    });

    this.logsService.log('asset', `创建零结构化资产: ${dto.filename}`, {
      userId,
      meta: { id: asset.id, kind: dto.kind, filename: dto.filename },
    });

    return asset;
  }

  /**
   * 获取 .zeroexo 资产的完整内容(含结构化 text 数据)。
   */
  async getZeroexoContent(ownerId: string, id: string) {
    const asset = await this.findOne(ownerId, id);
    if (!['zeroexo-text', 'zeroexo-entity', 'zeroexo-prompt'].includes(asset.kind)) {
      throw notFound('NOT_FOUND', 'Not a .zeroexo asset');
    }
    return {
      id: asset.id,
      kind: asset.kind,
      filename: asset.filename,
      text: asset.text,
      tags: asset.tags,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    };
  }

  /**
   * 分页查询当前用户的资产(游标分页),可按 kind/category/folderId 过滤。
   */
  async list(
    ownerId: string,
    cursor?: string,
    limit?: number,
    kind?: string,
    category?: string,
    folderId?: string,
  ) {
    const take = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const where: Prisma.AssetWhereInput = {
      ownerId,
      category: (category && category.trim()) ? category.trim() : 'user',
    };
    if (kind && kind.trim()) {
      where.kind = kind.trim();
    }
    if (folderId !== undefined) {
      where.folderId = folderId || null;
    }

    const items = await this.prisma.asset.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > take;
    const data = hasMore ? items.slice(0, take) : items;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? last.id : null;
    return { items: data, nextCursor };
  }

  /**
   * 获取单个资产(仅限所有者)。
   */
  async findOne(ownerId: string, id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.ownerId !== ownerId) {
      throw notFound(ErrorCode.ASSET_NOT_FOUND, 'Asset not found or no access');
    }
    return asset;
  }

  /**
   * 更新资产(每次更新自增 version,刷新 lastSyncedAt)。
   * 对于 zeroexo-entity/zeroexo-prompt 类型,拒绝直接更新,应使用专门的 zeroexo-content 端点。
   */
  async update(ownerId: string, id: string, dto: UpdateAssetDto) {
    const asset = await this.findOne(ownerId, id);
    if (asset.kind === 'zeroexo-entity' || asset.kind === 'zeroexo-prompt') {
      throw badRequest('BAD_REQUEST', 'zeroexo-entity/zeroexo-prompt assets must be updated via PATCH /resources/:id/zeroexo-content');
    }
    const updated = await this.prisma.asset.update({
      where: { id },
      data: {
        ...(dto.filename !== undefined ? { filename: dto.filename } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.visibility !== undefined
          ? { visibility: dto.visibility }
          : {}),
        ...(dto.thumbnailKey !== undefined
          ? { thumbnailKey: dto.thumbnailKey }
          : {}),
        ...(dto.folderId !== undefined ? { folderId: dto.folderId } : {}),
        ...(dto.text !== undefined
          ? {
              text: dto.text,
              size: Buffer.byteLength(dto.text, 'utf-8'),
            }
          : {}),
        version: { increment: 1 },
        lastSyncedAt: new Date(),
      },
    });

    return updated;
  }

  /**
   * 删除资产 - 仅删除 DB 记录,不删除底层资源文件。
   * 减少资源引用计数,refCount=0 时由 Resource 软删除 + 定时GC清理。
   *
   * 对 .zeroexo 类型资产,先检查 SourceMaterial 表是否有引用;
   * 如果有引用,返回 { hasReferences: true, referenceCount } 而非直接删除。
   */
  async remove(ownerId: string, id: string) {
    const asset = await this.findOne(ownerId, id);

    // 如果是 .zeroexo 资产,检查是否有 SourceMaterial 引用
    if (asset.kind.startsWith('zeroexo-')) {
      const referenceCount = await this.prisma.sourceMaterial.count({
        where: { processedAssetId: id },
      });
      if (referenceCount > 0) {
        return { hasReferences: true, referenceCount };
      }
    }

    // 减少资源引用计数(不删除物理文件)
    await this.resourceService.decrementRef(asset.storageKey);

    await this.prisma.asset.delete({ where: { id } });
    this.logsService.log('asset', `删除素材: ${asset.filename}`, {
      userId: ownerId,
      meta: { id, kind: asset.kind, filename: asset.filename },
    });

    return { message: '资产已删除' };
  }

  /**
   * 获取引用此资产的所有资产列表。
   * 查询所有 zeroexo-* 类型资产，检查它们的 text 字段是否包含对指定 id 的引用。
   */
  async getDependents(ownerId: string, id: string) {
    // 验证资产存在性
    await this.findOne(ownerId, id);

    const dependents = await this.prisma.asset.findMany({
      where: {
        ownerId,
        kind: { in: ['zeroexo-text', 'zeroexo-entity', 'zeroexo-prompt'] },
        id: { not: id },
        text: { contains: id },
      },
      select: { id: true, filename: true, kind: true },
    });

    return { dependents };
  }

  /**
   * 获取预签名下载 URL(仅限所有者)。
   */
  async getDownloadUrl(ownerId: string, id: string): Promise<{ url: string }> {
    const asset = await this.findOne(ownerId, id);
    const url = await this.minio.presignGet(asset.storageKey);
    return { url };
  }

  /**
   * 校验 zeroexo-entity 结构化数据。
   * 校验规则:
   * - category 必须是 character/scene/prop/location/custom 之一
   * - fields 数组非空
   * - fields 中每个 key 唯一
   * - fields 中每个 key 格式为英文数字下划线
   */
  async validateZeroexoEntityData(data: any): Promise<{ valid: boolean; errors: Array<{ field: string; message: string }> }> {
    const errors: Array<{ field: string; message: string }> = [];

    if (!data || typeof data !== 'object') {
      errors.push({ field: 'data', message: '结构化数据不能为空' });
      return { valid: false, errors };
    }

    // 校验 category 枚举
    const validCategories = ['character', 'scene', 'prop', 'location', 'custom'];
    if (!data.category || !validCategories.includes(data.category)) {
      errors.push({ field: 'category', message: `category 必须是 ${validCategories.join('/')} 之一` });
    }

    // 校验 fields 数组非空
    if (!Array.isArray(data.fields) || data.fields.length === 0) {
      errors.push({ field: 'fields', message: 'fields 数组不能为空' });
    } else {
      // 校验 fields 中每个 key 唯一性
      const keys = data.fields.map((f: any) => f.key);
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const key of keys) {
        if (seen.has(key)) {
          duplicates.add(key);
        }
        seen.add(key);
      }
      if (duplicates.size > 0) {
        errors.push({ field: 'fields', message: `存在重复的 key: ${Array.from(duplicates).join(', ')}` });
      }

      // 校验 fields 中每个 key 格式（英文数字下划线）
      const keyRegex = /^[a-zA-Z0-9_]+$/;
      for (const field of data.fields) {
        if (!keyRegex.test(field.key)) {
          errors.push({ field: `fields[${field.key}]`, message: `key "${field.key}" 格式不正确，仅允许英文、数字和下划线` });
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 校验 zeroexo-prompt 结构化数据。
   * 校验规则:
   * - template 非空
   * - params 结构（key/label/type/required 等字段）
   * - 变量名与 template 中 {{变量名}} 一致性
   */
  async validateZeroexoPromptData(data: any): Promise<{ valid: boolean; errors: Array<{ field: string; message: string }> }> {
    const errors: Array<{ field: string; message: string }> = [];

    if (!data || typeof data !== 'object') {
      errors.push({ field: 'data', message: '结构化数据不能为空' });
      return { valid: false, errors };
    }

    // 校验 template 非空
    if (!data.template || typeof data.template !== 'string' || data.template.trim().length === 0) {
      errors.push({ field: 'template', message: 'template 不能为空' });
    }

    // 校验 params 结构
    if (data.params !== undefined) {
      if (!Array.isArray(data.params)) {
        errors.push({ field: 'params', message: 'params 必须是数组' });
      } else {
        const validTypes = ['string', 'number', 'boolean', 'select'];
        for (let i = 0; i < data.params.length; i++) {
          const param = data.params[i];
          if (!param.key || typeof param.key !== 'string') {
            errors.push({ field: `params[${i}]`, message: `params[${i}] 缺少 key 字段` });
          }
          if (!param.label || typeof param.label !== 'string') {
            errors.push({ field: `params[${i}]`, message: `params[${i}] 缺少 label 字段` });
          }
          if (param.type && !validTypes.includes(param.type)) {
            errors.push({ field: `params[${i}].type`, message: `type 必须是 ${validTypes.join('/')} 之一` });
          }
        }

        // 校验变量名与 template 中 {{变量名}} 一致性
        if (data.template && typeof data.template === 'string') {
          const templateVars = data.template.match(/\{\{(\w+)\}\}/g) || [];
          const paramKeys = new Set(data.params.map((p: any) => p.key));
          for (const tVar of templateVars) {
            const varName = tVar.replace(/\{\{|\}\}/g, '');
            if (!paramKeys.has(varName)) {
              errors.push({ field: 'template', message: `template 中变量 {{${varName}}} 在 params 中未定义` });
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 更新 .zeroexo 资产的结构化数据内容。
   * 仅 zeroexo-entity 和 zeroexo-prompt 类型支持。
   * 如果 dto.text 有值,会反序列化并调用对应类型的校验器。
   */
  async updateZeroexoContent(ownerId: string, id: string, dto: UpdateZeroexoAssetDto) {
    const asset = await this.findOne(ownerId, id);

    // 验证是 zeroexo-entity 或 zeroexo-prompt 类型
    if (asset.kind !== 'zeroexo-entity' && asset.kind !== 'zeroexo-prompt') {
      throw badRequest('BAD_REQUEST', 'Only zeroexo-entity and zeroexo-prompt assets support structured content updates');
    }

    // 如果 dto.text 有值,反序列化进行校验
    if (dto.text !== undefined) {
      let parsedData: any;
      try {
        parsedData = JSON.parse(dto.text);
      } catch {
        throw badRequest('BAD_REQUEST', 'text field must be a valid JSON string');
      }

      let validationResult: { valid: boolean; errors: Array<{ field: string; message: string }> };
      if (asset.kind === 'zeroexo-entity') {
        validationResult = await this.validateZeroexoEntityData(parsedData);
      } else {
        validationResult = await this.validateZeroexoPromptData(parsedData);
      }

      if (!validationResult.valid) {
        throw badRequest('BAD_REQUEST', 'Invalid zeroexo structured data');
      }
    }

    // 更新资产
    const updated = await this.prisma.asset.update({
      where: { id },
      data: {
        ...(dto.filename !== undefined ? { filename: dto.filename } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
        ...(dto.text !== undefined ? { text: dto.text } : {}),
        version: { increment: 1 },
        lastSyncedAt: new Date(),
      },
    });

    return {
      id: updated.id,
      updatedAt: updated.updatedAt,
    };
  }
}
