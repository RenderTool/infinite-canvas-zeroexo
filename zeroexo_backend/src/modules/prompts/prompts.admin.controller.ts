import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Logger, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PromptsService } from './prompts.service';
import { CreatePromptDto, UpdatePromptDto } from './dto/prompt.dto';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/prompts')
export class AdminPromptsController {
  private readonly logger = new Logger(AdminPromptsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly promptsService: PromptsService,
  ) {}

  /** 为指定用户创建提示词(管理员) */
  @Post('user/:userId')
  @HttpCode(HttpStatus.CREATED)
  async createUserPrompt(
    @Param('userId') userId: string,
    @Body() dto: CreatePromptDto,
  ) {
    return this.promptsService.create(userId, dto);
  }

  /** 更新提示词(管理员) */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async updatePrompt(
    @Param('id') id: string,
    @Body() dto: UpdatePromptDto,
  ) {
    // 管理员更新时，先查找提示词获取 ownerId
    const prompt = await this.prisma.prompt.findUnique({
      where: { id },
      select: { id: true, ownerId: true },
    });
    if (!prompt) {
      throw new Error('提示词不存在');
    }
    return this.promptsService.update(prompt.ownerId, id, dto);
  }

  /** 查看指定用户的提示词列表（分页） */
  @Get('user/:userId')
  @HttpCode(HttpStatus.OK)
  async listUserPrompts(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const take = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.prompt.findMany({
        where: { ownerId: userId },
        orderBy: { updatedAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          title: true,
          category: true,
          tags: true,
          favorite: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.prompt.count({ where: { ownerId: userId } }),
    ]);
    return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
  }

  /** 删除单个提示词(管理员) */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deletePrompt(@Param('id') id: string) {
    const prompt = await this.prisma.prompt.findUnique({
      where: { id },
      select: { id: true, title: true, ownerId: true },
    });
    if (!prompt) {
      throw new Error('提示词不存在');
    }

    await this.prisma.prompt.delete({ where: { id } });

    this.logger.log(`[Admin] 删除用户${prompt.ownerId}的提示词: ${prompt.title}`);
    return { message: '提示词已删除' };
  }

  /** 批量删除提示词 */
  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  async deletePrompts(@Body() body: { ids: string[] }) {
    if (!body.ids || body.ids.length === 0) {
      throw new Error('ids 不能为空');
    }

    const prompts = await this.prisma.prompt.findMany({
      where: { id: { in: body.ids } },
      select: { id: true, title: true, ownerId: true },
    });

    let deletedCount = 0;
    for (const prompt of prompts) {
      try {
        await this.prisma.prompt.delete({ where: { id: prompt.id } });
        deletedCount++;
      } catch (err) {
        this.logger.warn(`[Admin] 批量删除提示词失败(id=${prompt.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`[Admin] 批量删除提示词完成: ${deletedCount}/${prompts.length} 个`);
    return { message: `已删除 ${deletedCount} 个提示词`, deletedCount };
  }

  /** 清空指定用户的所有提示词 */
  @Post('user/:userId/clear')
  @HttpCode(HttpStatus.OK)
  async clearUserPrompts(@Param('userId') userId: string) {
    const prompts = await this.prisma.prompt.findMany({
      where: { ownerId: userId },
      select: { id: true, title: true },
    });

    let deletedCount = 0;
    for (const prompt of prompts) {
      try {
        await this.prisma.prompt.delete({ where: { id: prompt.id } });
        deletedCount++;
      } catch (err) {
        this.logger.warn(`[Admin] 清空提示词失败(id=${prompt.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`[Admin] 清空用户${userId}提示词完成: ${deletedCount}/${prompts.length} 个`);
    return { message: `已清空 ${deletedCount} 个提示词`, deletedCount };
  }
}
