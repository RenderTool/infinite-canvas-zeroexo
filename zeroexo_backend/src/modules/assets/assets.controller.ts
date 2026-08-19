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
import { AssetsService } from './assets.service';
import {
  CreateAssetDto,
  CreateScriptAssetDto,
  CreateZeroexoAssetDto,
  CreateZeroexoStructuredDto,
  PresignAssetDto,
  UpdateAssetDto,
  UpdateZeroexoAssetDto,
} from './dto/asset.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  MediumThrottle,
  UploadThrottle,
} from '../../common/throttler/decorators/throttle.decorator';
import { forbidden } from '../../common/errors/app-exception.js';

/**
 * 资源控制器 - 资产(素材)上传与元数据管理
 *
 * 安全加固(Stage H.1 - API 速率限制):
 * - 上传相关端点(presign / create)使用 @UploadThrottle(1000 次/分),
 *   覆盖项目资源批量同步上传,同时保留粗粒度防刷。
 * - 删除端点使用 @MediumThrottle(5 分钟 500 次),防止批量刷删。
 */
@ApiTags('Resources')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('resources')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post('presign')
  @ApiOperation({ summary: '获取预签名上传 URL(scope=public 需管理员权限)' })
  @UploadThrottle()
  presign(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() dto: PresignAssetDto,
  ) {
    if (dto.scope === 'public' && role !== 'admin' && role !== 'super_admin') {
      throw forbidden('FORBIDDEN', 'Only admins can upload public resources');
    }
    return this.assetsService.presign(userId, dto);
  }

  @Post()
  @ApiOperation({ summary: '创建资产元数据(上传完成后调用)' })
  @UploadThrottle()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateAssetDto) {
    return this.assetsService.create(userId, dto);
  }

  @Post('scripts')
  @ApiOperation({ summary: '创建剧本资产(kind=script,text 存剧集 JSON)' })
  @UploadThrottle()
  createScript(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateScriptAssetDto,
  ) {
    return this.assetsService.createScriptAsset(userId, dto);
  }

  @Post('zeroexo')
  @ApiOperation({ summary: '上传 .zeroexo 结构化资产(资产引擎产物)' })
  @UploadThrottle()
  createZeroexo(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateZeroexoAssetDto,
  ) {
    return this.assetsService.createZeroexoAsset(userId, dto);
  }

  @Post('zeroexo-structured')
  @ApiOperation({ summary: '创建零结构化资产(entity/prompt), 自动生成 storageKey, 无需文件上传' })
  @UploadThrottle()
  createZeroexoStructured(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateZeroexoStructuredDto,
  ) {
    return this.assetsService.createZeroexoStructuredAsset(userId, dto);
  }

  @Get(':id/content')
  @ApiOperation({ summary: '获取 .zeroexo 资产的完整内容' })
  getZeroexoContent(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.assetsService.getZeroexoContent(userId, id);
  }

  @Get()
  @ApiOperation({ summary: '分页查询资产列表(游标分页,可按 kind/category/folderId 过滤)' })
  list(
    @CurrentUser('id') userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('kind') kind?: string,
    @Query('category') category?: string,
    @Query('folderId') folderId?: string,
  ) {
    return this.assetsService.list(
      userId,
      cursor,
      limit ? Number(limit) : undefined,
      kind,
      category,
      folderId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '获取资产详情' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.assetsService.findOne(userId, id);
  }

  @Get(':id/dependents')
  @ApiOperation({ summary: '获取引用此资产的所有资产列表' })
  getDependents(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.assetsService.getDependents(userId, id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: '获取预签名下载 URL' })
  getDownloadUrl(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.assetsService.getDownloadUrl(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新资产' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.assetsService.update(userId, id, dto);
  }

  @Patch(':id/zeroexo-content')
  @ApiOperation({ summary: '更新 .zeroexo 资产的结构化数据内容' })
  updateZeroexoContent(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateZeroexoAssetDto,
  ) {
    return this.assetsService.updateZeroexoContent(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除资产(仅删除记录,资源由引用计数+GC管理)' })
  @MediumThrottle()
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.assetsService.remove(userId, id);
  }
}
