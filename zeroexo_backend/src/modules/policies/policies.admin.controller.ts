import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PoliciesService } from './policies.service';
import { CreatePolicyVersionDto, UpdatePolicyVersionDto } from './dto/policy.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin Policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/policies')
export class PoliciesAdminController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Get()
  @ApiOperation({ summary: '管理员获取所有政策文档列表（含版本信息）' })
  list() {
    return this.policiesService.list(true);
  }

  @Get(':key/versions')
  @ApiOperation({ summary: '获取指定政策的版本列表' })
  listVersions(@Param('key') key: string) {
    return this.policiesService.listVersions(key);
  }

  @Get(':key/versions/:version')
  @ApiOperation({ summary: '获取指定版本的完整内容' })
  getVersion(
    @Param('key') key: string,
    @Param('version') version: string,
  ) {
    return this.policiesService.getVersionDetail(key, parseInt(version, 10));
  }

  @Post(':key/versions')
  @ApiOperation({ summary: '创建新版本' })
  createVersion(
    @Param('key') key: string,
    @Body() dto: CreatePolicyVersionDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.policiesService.createVersion(key, dto, userId);
  }

  @Put(':key/versions/:version')
  @ApiOperation({ summary: '更新指定版本（仅未发布版本可编辑）' })
  updateVersion(
    @Param('key') key: string,
    @Param('version') version: string,
    @Body() dto: UpdatePolicyVersionDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.policiesService.updateVersion(key, parseInt(version, 10), dto, userId);
  }

  @Post(':key/versions/:version/publish')
  @ApiOperation({ summary: '发布指定版本（自动取消其他版本发布）' })
  publishVersion(
    @Param('key') key: string,
    @Param('version') version: string,
  ) {
    return this.policiesService.publishVersion(key, parseInt(version, 10));
  }

  @Delete(':key/versions/:version')
  @ApiOperation({ summary: '删除未发布版本' })
  deleteVersion(
    @Param('key') key: string,
    @Param('version') version: string,
  ) {
    return this.policiesService.deleteVersion(key, parseInt(version, 10));
  }

  @Delete(':key')
  @ApiOperation({ summary: '删除整个政策（含所有版本）' })
  remove(@Param('key') key: string) {
    return this.policiesService.remove(key);
  }
}