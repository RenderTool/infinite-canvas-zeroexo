/**
 * Studio 控制器（工业化制片项目，Plan#46）
 *
 * 路由前缀 /studio，全部走 JwtAuthGuard + 所有权校验（service 层）。
 * 限流复用通用档位（经验#10：不新增业务档位，防限流叠加）。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StudioService } from './studio.service';
import {
  CreateStudioAssetDto,
  CreateStudioEpisodeDto,
  CreateStudioProjectDto,
  CreateStudioPromptEntryDto,
  RegisterStudioImageDto,
  UpdateStudioAssetDto,
  UpdateStudioEpisodeDto,
  UpdateStudioProjectDto,
  UpdateStudioPromptEntryDto,
} from './dto/studio.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MediumThrottle, ShortThrottle } from '../../common/throttler/decorators/throttle.decorator';

@ApiTags('Studio')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('studio')
export class StudioController {
  constructor(private readonly studioService: StudioService) {}

  // ============ 项目 ============

  @Get('projects')
  @ShortThrottle()
  @ApiOperation({ summary: '工业化项目列表（仅 type=studio）' })
  listProjects(@CurrentUser('id') userId: string, @Query('keyword') keyword?: string) {
    return this.studioService.listProjects(userId, keyword);
  }

  @Post('projects')
  @MediumThrottle()
  @ApiOperation({ summary: '创建工业化项目' })
  createProject(@CurrentUser('id') userId: string, @Body() dto: CreateStudioProjectDto) {
    return this.studioService.createProject(userId, dto);
  }

  @Get('projects/:id')
  @ShortThrottle()
  @ApiOperation({ summary: '项目工作台数据（资产 + 剧集）' })
  getProject(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.studioService.getProject(userId, id);
  }

  @Patch('projects/:id')
  @MediumThrottle()
  @ApiOperation({ summary: '更新项目（改名/描述）' })
  updateProject(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStudioProjectDto,
  ) {
    return this.studioService.updateProject(userId, id, dto);
  }

  @Delete('projects/:id')
  @MediumThrottle()
  @ApiOperation({ summary: '删除项目（级联删除资产/剧集）' })
  removeProject(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.studioService.removeProject(userId, id);
  }

  // ============ 资产卡（角色/场景/道具） ============

  @Get('projects/:id/assets')
  @ShortThrottle()
  @ApiOperation({ summary: '资产列表（可按 kind 过滤：character/scene/prop）' })
  listAssets(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query('kind') kind?: string,
  ) {
    return this.studioService.listAssets(userId, id, kind);
  }

  @Post('projects/:id/assets')
  @MediumThrottle()
  @ApiOperation({ summary: '创建资产卡' })
  createAsset(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateStudioAssetDto,
  ) {
    return this.studioService.createAsset(userId, id, dto);
  }

  @Patch('assets/:assetId')
  @MediumThrottle()
  @ApiOperation({ summary: '更新资产卡（改名/描述/状态/主图）' })
  updateAsset(
    @CurrentUser('id') userId: string,
    @Param('assetId') assetId: string,
    @Body() dto: UpdateStudioAssetDto,
  ) {
    return this.studioService.updateAsset(userId, assetId, dto);
  }

  @Delete('assets/:assetId')
  @MediumThrottle()
  @ApiOperation({ summary: '删除资产卡' })
  removeAsset(@CurrentUser('id') userId: string, @Param('assetId') assetId: string) {
    return this.studioService.removeAsset(userId, assetId);
  }

  // ============ 提示词条目（含参考素材） ============

  @Post('assets/:assetId/prompt-entries')
  @MediumThrottle()
  @ApiOperation({ summary: '新增提示词条目（含参考素材多图）' })
  createPromptEntry(
    @CurrentUser('id') userId: string,
    @Param('assetId') assetId: string,
    @Body() dto: CreateStudioPromptEntryDto,
  ) {
    return this.studioService.createPromptEntry(userId, assetId, dto);
  }

  @Patch('prompt-entries/:entryId')
  @MediumThrottle()
  @ApiOperation({ summary: '更新提示词条目' })
  updatePromptEntry(
    @CurrentUser('id') userId: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateStudioPromptEntryDto,
  ) {
    return this.studioService.updatePromptEntry(userId, entryId, dto);
  }

  @Delete('prompt-entries/:entryId')
  @MediumThrottle()
  @ApiOperation({ summary: '删除提示词条目' })
  removePromptEntry(@CurrentUser('id') userId: string, @Param('entryId') entryId: string) {
    return this.studioService.removePromptEntry(userId, entryId);
  }

  // ============ 生成图 ============

  @Post('assets/:assetId/images')
  @MediumThrottle()
  @ApiOperation({ summary: '登记生成图' })
  registerImage(
    @CurrentUser('id') userId: string,
    @Param('assetId') assetId: string,
    @Body() dto: RegisterStudioImageDto,
  ) {
    return this.studioService.registerImage(userId, assetId, dto);
  }

  @Post('assets/:assetId/images/:imageId/select')
  @MediumThrottle()
  @ApiOperation({ summary: '选中为主图（锁定一致性基准）' })
  selectImage(
    @CurrentUser('id') userId: string,
    @Param('assetId') assetId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.studioService.selectImage(userId, assetId, imageId);
  }

  @Delete('images/:imageId')
  @MediumThrottle()
  @ApiOperation({ summary: '删除生成图' })
  removeImage(@CurrentUser('id') userId: string, @Param('imageId') imageId: string) {
    return this.studioService.removeImage(userId, imageId);
  }

  // ============ 剧集（出片按集） ============

  @Get('projects/:id/episodes')
  @ShortThrottle()
  @ApiOperation({ summary: '剧集列表' })
  listEpisodes(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.studioService.listEpisodes(userId, id);
  }

  @Post('projects/:id/episodes')
  @MediumThrottle()
  @ApiOperation({ summary: '创建剧集（集数缺省自动递增）' })
  createEpisode(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateStudioEpisodeDto,
  ) {
    return this.studioService.createEpisode(userId, id, dto);
  }

  @Patch('episodes/:episodeId')
  @MediumThrottle()
  @ApiOperation({ summary: '更新剧集（拆分稿/过审状态）' })
  updateEpisode(
    @CurrentUser('id') userId: string,
    @Param('episodeId') episodeId: string,
    @Body() dto: UpdateStudioEpisodeDto,
  ) {
    return this.studioService.updateEpisode(userId, episodeId, dto);
  }

  @Delete('episodes/:episodeId')
  @MediumThrottle()
  @ApiOperation({ summary: '删除剧集' })
  removeEpisode(@CurrentUser('id') userId: string, @Param('episodeId') episodeId: string) {
    return this.studioService.removeEpisode(userId, episodeId);
  }
}
