import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import dayjs from 'dayjs';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('users')
  @HttpCode(HttpStatus.OK)
  async getUsersAnalytics() {
    const total = await this.prisma.user.count();
    const newUsers = await this.prisma.user.count({
      where: { createdAt: { gte: dayjs().subtract(7, 'day').toISOString() } },
    });
    const active = await this.prisma.user.count({
      where: { updatedAt: { gte: dayjs().subtract(7, 'day').toISOString() } },
    });
    return { total, new: newUsers, active };
  }

  @Get('projects')
  @HttpCode(HttpStatus.OK)
  async getProjectsAnalytics() {
    const total = await this.prisma.project.count();
    const newProjects = await this.prisma.project.count({
      where: { createdAt: { gte: dayjs().subtract(7, 'day').toISOString() } },
    });
    return { total, new: newProjects };
  }

  @Get('ai-calls')
  @HttpCode(HttpStatus.OK)
  async getAiCallsAnalytics() {
    const total = await this.prisma.aiGeneration.count();
    const successful = await this.prisma.aiGeneration.count({
      where: { status: 'success' },
    });
    const failed = await this.prisma.aiGeneration.count({
      where: { status: 'failed' },
    });
    // 按生成类型统计
    const byKind = await this.prisma.aiGeneration.groupBy({
      by: ['kind', 'status'],
      _count: true,
    });
    // 按日统计最近 7 天调用量
    const dailyCalls: { date: string; total: number; successful: number; failed: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      const start = dayjs().subtract(i, 'day').startOf('day').toISOString();
      const end = dayjs().subtract(i, 'day').endOf('day').toISOString();
      const dayTotal = await this.prisma.aiGeneration.count({
        where: { createdAt: { gte: start, lte: end } },
      });
      const daySuccess = await this.prisma.aiGeneration.count({
        where: { createdAt: { gte: start, lte: end }, status: 'success' },
      });
      const dayFailed = await this.prisma.aiGeneration.count({
        where: { createdAt: { gte: start, lte: end }, status: 'failed' },
      });
      dailyCalls.push({ date, total: dayTotal, successful: daySuccess, failed: dayFailed });
    }
    return { total, successful, failed, byKind, dailyCalls };
  }

  @Get('recent-activity')
  @HttpCode(HttpStatus.OK)
  async getRecentActivity() {
    const items: { date: string; users: number; projects: number; aiCalls: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      const start = dayjs().subtract(i, 'day').startOf('day').toISOString();
      const end = dayjs().subtract(i, 'day').endOf('day').toISOString();
      const users = await this.prisma.user.count({
        where: { createdAt: { gte: start, lte: end } },
      });
      const projects = await this.prisma.project.count({
        where: { createdAt: { gte: start, lte: end } },
      });
      const aiCalls = await this.prisma.aiGeneration.count({
        where: { createdAt: { gte: start, lte: end } },
      });
      items.push({ date, users, projects, aiCalls });
    }
    return { items };
  }

  @Get('top-users')
  @HttpCode(HttpStatus.OK)
  async getTopUsers() {
    // 查询每个用户的 AI 调用次数，取 Top 10
    const raw = await this.prisma.aiGeneration.groupBy({
      by: ['ownerId'],
      _count: true,
      orderBy: { _count: { ownerId: 'desc' } },
      take: 10,
    });
    const userIds = raw.map((r) => r.ownerId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.username]));
    const items = raw.map((r) => ({
      username: userMap.get(r.ownerId) || r.ownerId.slice(0, 8),
      projects: 0,
      aiCalls: r._count,
    }));
    return { items };
  }

  @Get('active-users')
  @HttpCode(HttpStatus.OK)
  async getActiveUsers() {
    const sevenDaysAgo = dayjs().subtract(7, 'day').toISOString();
    const users = await this.prisma.user.findMany({
      where: { updatedAt: { gte: sevenDaysAgo } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        username: true,
        email: true,
        updatedAt: true,
      },
    });
    // 批量查询真实数据:项目数/提示词数/AI调用数
    const userIds = users.map((u) => u.id);
    const [projectCounts, promptCounts, aiCallCounts] = await Promise.all([
      // 各用户项目数
      this.prisma.project.groupBy({
        by: ['ownerId'],
        where: { ownerId: { in: userIds } },
        _count: { id: true },
      }),
      // 各用户提示词数
      this.prisma.prompt.groupBy({
        by: ['ownerId'],
        where: { ownerId: { in: userIds } },
        _count: { id: true },
      }),
      // 各用户 AI 调用数
      this.prisma.aiGeneration.groupBy({
        by: ['ownerId'],
        where: { ownerId: { in: userIds } },
        _count: { id: true },
      }),
    ]);
    const projectMap = new Map(projectCounts.map((r) => [r.ownerId, r._count.id]));
    const promptMap = new Map(promptCounts.map((r) => [r.ownerId, r._count.id]));
    const aiCallMap = new Map(aiCallCounts.map((r) => [r.ownerId, r._count.id]));
    const items = users.map((u) => ({
      username: u.username,
      email: u.email || '-',
      lastActive: u.updatedAt,
      projectCount: projectMap.get(u.id) ?? 0,
      promptCount: promptMap.get(u.id) ?? 0,
      aiCallCount: aiCallMap.get(u.id) ?? 0,
    }));
    return { items };
  }

  @Get('user-growth')
  @HttpCode(HttpStatus.OK)
  async getUserGrowth() {
    const items: { date: string; newUsers: number; cumulative: number }[] = [];
    let cumulative = 0;
    // 先查累计到 30 天前的总数
    const before30 = dayjs().subtract(30, 'day').startOf('day').toISOString();
    cumulative = await this.prisma.user.count({
      where: { createdAt: { lt: before30 } },
    });
    for (let i = 29; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      const start = dayjs().subtract(i, 'day').startOf('day').toISOString();
      const end = dayjs().subtract(i, 'day').endOf('day').toISOString();
      const newUsers = await this.prisma.user.count({
        where: { createdAt: { gte: start, lte: end } },
      });
      cumulative += newUsers;
      items.push({ date, newUsers, cumulative });
    }
    return { items };
  }

  @Get('ai-calls-trend')
  @HttpCode(HttpStatus.OK)
  async getAiCallsTrend() {
    const kinds = ['text', 'image', 'video', 'audio'];
    const items: { date: string; text: number; image: number; video: number; audio: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      const start = dayjs().subtract(i, 'day').startOf('day').toISOString();
      const end = dayjs().subtract(i, 'day').endOf('day').toISOString();
      const row: any = { date, text: 0, image: 0, video: 0, audio: 0 };
      for (const kind of kinds) {
        const count = await this.prisma.aiGeneration.count({
          where: { createdAt: { gte: start, lte: end }, kind },
        });
        row[kind] = count;
      }
      items.push(row);
    }
    return { items };
  }

  @Get('model-distribution')
  @HttpCode(HttpStatus.OK)
  async getModelDistribution() {
    const raw = await this.prisma.aiGeneration.groupBy({
      by: ['model'],
      _count: true,
      where: { status: 'success' },
      orderBy: { _count: { model: 'desc' } },
    });
    const items = raw.map((r) => ({
      name: r.model,
      value: r._count,
    }));
    return { items };
  }

  @Get('resource-distribution')
  @HttpCode(HttpStatus.OK)
  async getResourceDistribution() {
    const raw = await this.prisma.asset.groupBy({
      by: ['kind'],
      _count: true,
      orderBy: { _count: { kind: 'desc' } },
    });
    const total = raw.reduce((sum, r) => sum + r._count, 0);
    const items = raw.map((r) => ({
      name: r.kind,
      value: r._count,
      percentage: total > 0 ? Math.round((r._count / total) * 10000) / 100 : 0,
    }));
    return { items };
  }

  @Get('token-trend')
  @HttpCode(HttpStatus.OK)
  async getTokenTrend(@Query('model') model?: string) {
    const items: { date: string; tokens: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      const start = dayjs().subtract(i, 'day').startOf('day').toISOString();
      const end = dayjs().subtract(i, 'day').endOf('day').toISOString();
      const result = await this.prisma.aiGeneration.aggregate({
        _sum: { costTokens: true },
        where: {
          createdAt: { gte: start, lte: end },
          ...(model ? { model } : {}),
        },
      });
      items.push({ date, tokens: result._sum.costTokens ?? 0 });
    }
    return { items };
  }

  @Get('resource-growth')
  @HttpCode(HttpStatus.OK)
  async getResourceGrowth() {
    const items: { date: string; images: number; videos: number; audios: number; others: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      const start = dayjs().subtract(i, 'day').startOf('day').toISOString();
      const end = dayjs().subtract(i, 'day').endOf('day').toISOString();
      const images = await this.prisma.asset.count({
        where: { createdAt: { gte: start, lte: end }, kind: 'image' },
      });
      const videos = await this.prisma.asset.count({
        where: { createdAt: { gte: start, lte: end }, kind: 'video' },
      });
      const audios = await this.prisma.asset.count({
        where: { createdAt: { gte: start, lte: end }, kind: 'audio' },
      });
      const total = await this.prisma.asset.count({
        where: { createdAt: { gte: start, lte: end } },
      });
      items.push({ date, images, videos, audios, others: total - images - videos - audios });
    }
    return { items };
  }

  @Get('storage-usage')
  @HttpCode(HttpStatus.OK)
  async getStorageUsage() {
    const result = await this.prisma.asset.aggregate({
      _sum: { size: true },
    });
    const totalBytes = result._sum.size ?? BigInt(0);
    const totalGB = Number(totalBytes) / (1024 * 1024 * 1024);
    const quotaBytes = await this.prisma.user.aggregate({
      _sum: { storageQuota: true },
    });
    const totalQuota = Number(quotaBytes._sum.storageQuota ?? BigInt(0)) / (1024 * 1024 * 1024);
    return { usedGB: Math.round(totalGB * 100) / 100, quotaGB: Math.round(totalQuota * 100) / 100, usedBytes: Number(totalBytes) };
  }
}
