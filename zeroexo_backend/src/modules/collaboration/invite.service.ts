import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** 排除易混淆字符（O/0, I/1, l 等）- 已在 CHARSET 中排除 */
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** 邀请码默认有效期（小时） */
const DEFAULT_EXPIRE_HOURS = 24;

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
   */
  calculateExpiresAt(expireHours?: number): Date {
    const hours = expireHours ?? DEFAULT_EXPIRE_HOURS;
    return new Date(Date.now() + hours * 60 * 60 * 1000);
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
      data: { status: 'closed' },
    });
    if (result.count > 0) {
      this.logger.log(`清理过期协作房间 ${result.count} 个`);
    }
    return result.count;
  }
}
