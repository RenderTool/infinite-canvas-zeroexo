import { Module } from '@nestjs/common';
import { PoliciesService } from './policies.service';
import { PoliciesController } from './policies.controller';
import { PoliciesAdminController } from './policies.admin.controller';

@Module({
  controllers: [PoliciesController, PoliciesAdminController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}