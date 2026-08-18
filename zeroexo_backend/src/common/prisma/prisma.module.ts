import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 全局 Prisma 模块 - 提供数据库访问能力,无需各业务模块重复 import。
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
