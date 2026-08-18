import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserAiPreferenceService } from './user-ai-preference.service';
import { UpdateUserAiPreferenceDto } from './dto/update-preference.dto';

/**
 * 用户级 AI 配置 Controller
 * 当前用户(由 JWT 解析)对自己的配置进行读写
 */
@ApiTags('User AI Preference')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('user/ai-config')
export class UserAiPreferenceController {
  constructor(private readonly service: UserAiPreferenceService) {}

  @Get()
  @ApiOperation({ summary: '获取当前用户的 AI 配置' })
  get(@CurrentUser() user: AuthUser) {
    return this.service.get(user.id);
  }

  @Put()
  @ApiOperation({ summary: '更新当前用户的 AI 配置' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateUserAiPreferenceDto) {
    return this.service.update(user.id, dto);
  }

  @Delete()
  @ApiOperation({ summary: '重置当前用户的 AI 配置' })
  reset(@CurrentUser() user: AuthUser) {
    return this.service.reset(user.id);
  }
}
