import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';

/** 排除易混淆字符（O/0, I/1, l 等）- 已在 CHARSET 中排除 */
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** 过期房间软清理后的保留期(天):期间参与者主页仍能看到"已失效"协作,到期物理删除 */
const EXPIRED_RETENTION_DAYS = 30;

/**
 * 邀请码服务 - 生成与验证 6 位邀请码，处理过期逻辑。
 */
@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 生成 6 位随机邀请码，排除易混淆字符
   */
  generateCode(length: number = 6): string {
    let code = '';
    const chars = CHARSET.split('');
    const bytes = new Uint32Array(length);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < length; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  /**
   * 生成唯一邀请码（数据库去重）
   */
  async generateUniqueCode(): Promise<string> {
    let code: string;
    let attempts = 0;
    do {
      code = this.generateCode();
      attempts++;
      if (attempts > 5) {
        this.logger.warn('邀请码生成超过5次去重');
      }
      const existing = await this.prisma.collaborationRoom.findUnique({
        where: { inviteCode: code },
        select: { id: true },
      });
      if (!existing) break;
    } while (true);
    return code;
  }

  /**
   * 生成邀请链接
   */
  generateLink(inviteCode: string, baseUrl?: string): string {
    const origin = baseUrl || process.env.FRONTEND_URL || 'https://zeroexo.app';
    return `${origin}/c/${inviteCode}`;
  }

  /**
   * 计算过期时间
   * 语义（Plan#38 Phase 6.2）：undefined 或 <=0 表示「永不过期」返回 null，
   * 不再静默回落 24h（修复 UI「永不过期」与实际 24h 过期的矛盾）。
   */
  calculateExpiresAt(expireHours?: number): Date | null {
    if (expireHours === undefined || expireHours <= 0) return null;
    return new Date(Date.now() + expireHours * 60 * 60 * 1000);
  }

  /**
   * 验证邀请码是否有效
   * @returns 房间信息或 null（无效/过期/关闭）
   */
  async verifyCode(inviteCode: string): Promise<{
    id: string;
    canvasId: string;
    mode: string;
    status: string;
    ownerId: string;
  } | null> {
    const room = await this.prisma.collaborationRoom.findUnique({
      where: { inviteCode },
      select: { id: true, canvasId: true, mode: true, status: true, ownerId: true, expiresAt: true },
    });
    if (!room) return null;
    if (room.status !== 'active') return null;
    if (room.expiresAt && room.expiresAt < new Date()) return null;
    return { id: room.id, canvasId: room.canvasId, mode: room.mode, status: room.status, ownerId: room.ownerId };
  }

  /**
   * 标记邀请码已使用（可选，当前方案邀请码可重复使用直到过期）
   */

  /**
   * 清理过期的协作房间
   */
  async cleanupExpiredRooms(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.collaborationRoom.updateMany({
      where: { status: 'active', expiresAt: { lt: now } },
      data: { status: 'expired' },
    });
    if (result.count > 0) {
      this.logger.log(`清理过期协作房间 ${result.count} 个`);
    }
    return result.count;
  }

  /**
   * 定时清理(每小时第 5 分钟):过期 active 房间软置 expired + 超保留期 expired 房间物理删除。
   * 历史缺口:此前 cleanupExpiredRooms 只在邀请码验证时惰性生效,过期房间永不自动失效,
   * expired 记录也永不删除 → 幽灵房间堆积;ScheduleModule 已在 app.module 注册。
   */
  @Cron('0 5 * * * *')
  async timerCleanupExpiredRooms(): Promise<void> {
    try {
      await this.cleanupExpiredRooms();
      await this.purgeExpiredRooms();
    } catch (err) {
      this.logger.error(`定时清理协作房间失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 物理删除超过保留期的 expired 房间(成员/消息 onDelete: Cascade 级联清理)
   */
  async purgeExpiredRooms(): Promise<number> {
    const deadline = new Date(Date.now() - EXPIRED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.prisma.collaborationRoom.deleteMany({
      where: { status: 'expired', updatedAt: { lt: deadline } },
    });
    if (result.count > 0) {
      this.logger.log(`物理清理超期协作房间 ${result.count} 个`);
    }
    return result.count;
  }
}
