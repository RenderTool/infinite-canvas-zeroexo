import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AdminUsersController } from './users.admin.controller';
import { UserApplicationService } from './user-application.service';
import { UserApplicationController } from './user-application.controller';
import { UserCleanupService } from './user-cleanup.service';
import { LogsModule } from '../logs/logs.module';
import { AssetsModule } from '../assets/assets.module';
import { BillingModule } from '../billing/billing.module';
import { CollaborationModule } from '../collaboration/collaboration.module';

@Module({
  imports: [LogsModule, AssetsModule, BillingModule, CollaborationModule],
  providers: [UsersService, UserApplicationService, UserCleanupService],
  controllers: [UsersController, AdminUsersController, UserApplicationController],
  exports: [UsersService, UserCleanupService],
})
export class UsersModule {}
