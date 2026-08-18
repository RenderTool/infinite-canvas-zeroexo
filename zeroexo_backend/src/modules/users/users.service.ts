import { Injectable } from '@nestjs/common';
import { unauthorized } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * 用户服务 - 提供当前用户详情查询。
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // 获取当前用户完整资料(含 bio / storageQuota / 时间戳)
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw unauthorized('USER_NOT_FOUND', 'User not found');
    }
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      role: user.role,
      storageQuota: user.storageQuota,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
