import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { freemem, totalmem, uptime } from 'node:os';

const execAsync = promisify(exec);

interface DiskInfo {
  used: number;
  total: number;
}

const getDiskUsage = (path: string): DiskInfo => {
  try {
    const { diskUsage } = require('node:os');
    return diskUsage(path);
  } catch {
    return { used: 0, total: 1 };
  }
};

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/monitoring')
export class MonitoringController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getMonitoringData() {
    const memUsage = Math.round(((totalmem() - freemem()) / totalmem()) * 100);
    const disk = getDiskUsage('/');

    let cpuUsage = 0;
    try {
      const result = await execAsync('wmic cpu get loadpercentage');
      const match = result.stdout.match(/(\d+)/);
      if (match) cpuUsage = parseInt(match[1]);
    } catch {
      cpuUsage = 0;
    }

    return {
      cpu: cpuUsage,
      memory: memUsage,
      storageUsed: disk.used,
      storageTotal: disk.total,
      uptime: String(Math.floor(uptime())),
      activeConnections: 0,
      requestsPerSecond: 0,
      errorRate: 0,
    };
  }

  /**
   * 基础设施健康检测（数据库 + Redis）
   * 前端仪表盘专用，降低轮询频率到 30s
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  async getInfraHealth() {
    // --- 数据库检测 ---
    let dbOk = false;
    let dbLatencyMs = 0;
    let dbError: string | null = null;
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - start;
      dbOk = true;
    } catch (err: unknown) {
      dbError = err instanceof Error ? err.message : String(err);
    }

    // --- Redis 检测 ---
    let redisOk = false;
    let redisLatencyMs = 0;
    let redisError: string | null = null;
    const redisConfigured = this.redis.enabled;
    if (redisConfigured) {
      try {
        const start = Date.now();
        redisOk = await this.redis.ping();
        redisLatencyMs = Date.now() - start;
      } catch (err: unknown) {
        redisError = err instanceof Error ? err.message : String(err);
      }
    } else {
      redisError = '未配置 REDIS_URL';
    }

    return {
      database: {
        ok: dbOk,
        latencyMs: dbLatencyMs,
        error: dbError,
      },
      redis: {
        ok: redisOk,
        configured: redisConfigured,
        latencyMs: redisLatencyMs,
        error: redisError,
      },
    };
  }
}
