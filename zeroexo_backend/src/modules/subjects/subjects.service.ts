import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LogsService } from '../logs/logs.service';
import { notFound } from '../../common/errors/app-exception.js';
import { ErrorCode } from '../../common/errors/error-codes';
import { CreateSubjectDto, UpdateSubjectDto, QuerySubjectDto } from './dto/subject.dto';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * 主体服务 - 角色 / 场景 / 道具 的 CRUD
 * 列表采用游标分页(与 prompts/assets 风格一致)
 */
@Injectable()
export class SubjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  async list(ownerId: string, query: QuerySubjectDto) {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const where: Prisma.SubjectWhereInput = { ownerId };
    if (query.type && query.type.trim()) {
      where.type = query.type.trim();
    }
    if (query.folderId !== undefined) {
      where.folderId = query.folderId || null;
    }
    if (query.keyword && query.keyword.trim()) {
      where.name = { contains: query.keyword.trim(), mode: 'insensitive' };
    }
    const items = await this.prisma.subject.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > take;
    const data = hasMore ? items.slice(0, take) : items;
    const last = data[data.length - 1];
    return { items: data, nextCursor: hasMore && last ? last.id : null };
  }

  async create(ownerId: string, dto: CreateSubjectDto) {
    const subject = await this.prisma.subject.create({
      data: {
        ownerId,
        type: dto.type,
        name: dto.name,
        aliases: dto.aliases ?? '',
        description: dto.description ?? '',
        avatarKey: dto.avatarKey,
        avatarEmoji: dto.avatarEmoji,
        status: dto.status ?? 'ok',
        consistency: dto.consistency ?? '',
        fields: (dto.fields ?? {}) as Prisma.InputJsonValue,
        tags: dto.tags ?? [],
        imageKeys: dto.imageKeys ?? [],
        folderId: dto.folderId,
        lastSyncedAt: new Date(),
      },
    });
    this.logsService.log('system', `创建主体: ${dto.name}`, {
      userId: ownerId,
      meta: { id: subject.id, type: dto.type },
    });
    return subject;
  }

  async findOne(ownerId: string, id: string) {
    const subject = await this.prisma.subject.findUnique({ where: { id } });
    if (!subject || subject.ownerId !== ownerId) {
      throw notFound(ErrorCode.SUBJECT_NOT_FOUND, 'Subject not found or no access');
    }
    return subject;
  }

  async update(ownerId: string, id: string, dto: UpdateSubjectDto) {
    await this.findOne(ownerId, id);
    const updated = await this.prisma.subject.update({
      where: { id },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.aliases !== undefined ? { aliases: dto.aliases } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.avatarKey !== undefined ? { avatarKey: dto.avatarKey } : {}),
        ...(dto.avatarEmoji !== undefined ? { avatarEmoji: dto.avatarEmoji } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.consistency !== undefined ? { consistency: dto.consistency } : {}),
        ...(dto.fields !== undefined ? { fields: dto.fields as Prisma.InputJsonValue } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.imageKeys !== undefined ? { imageKeys: dto.imageKeys } : {}),
        ...(dto.folderId !== undefined ? { folderId: dto.folderId } : {}),
        lastSyncedAt: new Date(),
      },
    });
    this.logsService.log('sync', `主体更新: ${updated.name}`, {
      userId: ownerId,
      meta: { id, type: updated.type },
    });
    return updated;
  }

  async remove(ownerId: string, id: string) {
    const subject = await this.findOne(ownerId, id);
    await this.prisma.subject.delete({ where: { id } });
    this.logsService.log('system', `删除主体: ${subject.name}`, {
      userId: ownerId,
      meta: { id, type: subject.type },
    });
    return { message: '主体已删除' };
  }
}
