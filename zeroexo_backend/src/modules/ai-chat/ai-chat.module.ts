import { Module } from '@nestjs/common';
import { AiChatAdminController } from './ai-chat.admin.controller';
import { AiChatSessionController } from './ai-chat-session.controller';
import { ApiProvidersModule } from '../api-providers/api-providers.module';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [ApiProvidersModule, PrismaModule],
  controllers: [AiChatAdminController, AiChatSessionController],
})
export class AiChatModule {}
