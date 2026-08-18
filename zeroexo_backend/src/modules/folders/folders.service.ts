import { Injectable } from '@nestjs/common';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LogsService } from '../logs/logs.service';
import { CreateFolderDto, UpdateFolderDto } from './dto/folder.dto';

/** 系统预设根目录定义(不可删除/重命名) */
export const SYSTEM_FOLDERS: ReadonlyArray<{
  name: string;
  systemKey: 'scene' | 'character' | 'prop' | 'prompt' | 'other';
  sortOrder: number;
}> = [
  { name: '场景', systemKey: 'scene', sortOrder: 1 },
  { name: '角色', systemKey: 'character', sortOrder: 2 },
  { name: '道具', systemKey: 'prop', sortOrder: 3 },
  { name: '提示词', systemKey: 'prompt', sortOrder: 4 },
  { name: '其他', systemKey: 'other', sortOrder: 5 },
];

/**
 * 文件夹服务 - 树形文件夹 CRUD,系统根目录懒加载。
 * 1. 用户首次访问文件夹 API 时,自动确保 5 个系统根目录存在
 * 2. 系统目录 system=true,禁止 rename / delete / move
 * 3. 移动文件夹时检测循环引用(不能移到自身或子孙)
 * 4. 删除文件夹时,所属 asset/prompt/subject 的 folderId 自动置 null(SetNull)
 */
@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  /**
   * 懒加载:确保 5 个系统根目录存在
   */
  async findOrCreateRoot(ownerId: string) {
    const existing = await this.prisma.assetFolder.findMany({
      where: { ownerId, parentId: null },
      orderBy: { sortOrder: 'asc' },
    });
    const existingKeys = new Set(existing.map((f) => f.systemKey).filter(Boolean));
    const toCreate = SYSTEM_FOLDERS.filter((sf) => !existingKeys.has(sf.systemKey));
    if (toCreate.length > 0) {
      await this.prisma.assetFolder.createMany({
        data: toCreate.map((sf) => ({
          ownerId,
          name: sf.name,
          systemKey: sf.systemKey,
          system: true,
          sortOrder: sf.sortOrder,
          parentId: null,
        })),
      });
      this.logsService.log('system', `初始化系统文件夹`, {
        userId: ownerId,
        meta: { created: toCreate.map((s) => s.systemKey) },
      });
    }
    return this.prisma.assetFolder.findMany({
      where: { ownerId, parentId: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * 列出当前用户所有文件夹(平铺,前端构建树形)
   */
  async findAll(ownerId: string) {
    // 触发懒加载,确保系统目录存在
    await this.findOrCreateRoot(ownerId);
    return this.prisma.assetFolder.findMany({
      where: { ownerId },
      orderBy: [{ system: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * 获取单个文件夹
   */
  async findOne(ownerId: string, id: string) {
    const folder = await this.prisma.assetFolder.findUnique({ where: { id } });
    if (!folder || folder.ownerId !== ownerId) {
      throw notFound('FOLDER_NOT_FOUND', 'Folder not found or no access');
    }
    return folder;
  }

  /**
   * 新建文件夹
   */
  async create(ownerId: string, dto: CreateFolderDto) {
    const name = dto.name.trim();
    if (!name) {
      throw badRequest('BAD_REQUEST', 'Folder name must not be empty');
    }
    // 同父目录下名称不能重复
    const existing = await this.prisma.assetFolder.findFirst({
      where: { ownerId, parentId: dto.parentId ?? null, name },
    });
    if (existing) {
      throw conflict('CONFLICT', 'A folder with the same name already exists in this directory');
    }
    const folder = await this.prisma.assetFolder.create({
      data: {
        ownerId,
        name,
        parentId: dto.parentId ?? null,
        system: false,
      },
    });
    this.logsService.log('system', `新建文件夹: ${name}`, {
      userId: ownerId,
      meta: { id: folder.id, parentId: dto.parentId ?? null },
    });
    return folder;
  }

  /**
   * 更新文件夹(重命名 / 移动 / 排序)
   */
  async update(ownerId: string, id: string, dto: UpdateFolderDto) {
    const folder = await this.findOne(ownerId, id);
    if (folder.system) {
      throw forbidden('FORBIDDEN', 'System folders cannot be modified');
    }
    // 移动时检测循环引用
    if (dto.parentId !== undefined && dto.parentId !== folder.parentId) {
      if (dto.parentId === id) {
        throw badRequest('BAD_REQUEST', 'Cannot move a folder into itself');
      }
      if (dto.parentId) {
        await this.assertNotDescendant(id, dto.parentId);
      }
    }
    // 重命名时检查重复
    if (dto.name !== undefined) {
      const newName = dto.name.trim();
      if (!newName) throw badRequest('BAD_REQUEST', 'Folder name must not be empty');
      const dup = await this.prisma.assetFolder.findFirst({
        where: {
          ownerId,
          parentId: dto.parentId ?? folder.parentId,
          name: newName,
          NOT: { id },
        },
      });
      if (dup) throw conflict('CONFLICT', 'A folder with the same name already exists in this directory');
    }
    const updated = await this.prisma.assetFolder.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    this.logsService.log('system', `更新文件夹: ${updated.name}`, {
      userId: ownerId,
      meta: { id, changes: Object.keys(dto) },
    });
    return updated;
  }

  /**
   * 删除文件夹(系统目录禁止删除)
   * 注意: 关联的 asset/prompt/subject 的 folderId 由 Prisma SetNull 关联自动处理
   */
  async remove(ownerId: string, id: string) {
    const folder = await this.findOne(ownerId, id);
    if (folder.system) {
      throw forbidden('FORBIDDEN', 'System folders cannot be deleted');
    }
    // 先将所有子文件夹移到根目录(避免 SetNull 后孤儿)
    await this.prisma.assetFolder.updateMany({
      where: { ownerId, parentId: id },
      data: { parentId: null },
    });
    await this.prisma.assetFolder.delete({ where: { id } });
    this.logsService.log('system', `删除文件夹: ${folder.name}`, {
      userId: ownerId,
      meta: { id },
    });
    return { message: '文件夹已删除' };
  }

  /**
   * 断言: candidateId 不是 folderId 的子孙
   */
  private async assertNotDescendant(folderId: string, candidateId: string): Promise<void> {
    let cursor: string | null = candidateId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === folderId) {
        throw badRequest('BAD_REQUEST', 'Cannot move a folder into a descendant directory');
      }
      if (visited.has(cursor)) {
        throw badRequest('BAD_REQUEST', 'Circular reference detected');
      }
      visited.add(cursor);
      const next: { parentId: string | null } | null = await this.prisma.assetFolder.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = next?.parentId ?? null;
    }
  }
}
