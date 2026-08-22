/**
 * agent-skill.admin.controller - Agent 技能升级管理接口
 *
 * Plan#33 D6 Agent 自我升级 - 管理员端:
 * - 技能文件浏览/读取/直接编辑
 * - 升级提案列表/批准(写盘)/拒绝
 *
 * 全部走 JwtAuthGuard + AdminGuard(admin / super_admin)。
 */

import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentSkillService } from './agent-skill.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@ApiTags('AdminAgentSkill')
@Controller('admin/agent-skills')
export class AgentSkillAdminController {
  constructor(private readonly skillService: AgentSkillService) {}

  /**
   * 技能目录树(目录 + 白名单文件)
   * GET /admin/agent-skills
   */
  @Get()
  @ApiOperation({ summary: '[Admin] 列出 Agent 技能目录树' })
  listSkills() {
    return { items: this.skillService.listSkills() };
  }

  /**
   * 升级提案列表(可按状态过滤)
   * GET /admin/agent-skills/proposals?status=pending
   */
  @Get('proposals')
  @ApiOperation({ summary: '[Admin] Agent 技能升级提案列表' })
  async listProposals(@Query('status') status?: string) {
    const items = await this.skillService.listProposals(status);
    return { items, total: items.length };
  }

  /**
   * 批准提案: 写盘生效 + 状态置 approved
   * POST /admin/agent-skills/proposals/:id/approve
   */
  @Post('proposals/:id/approve')
  @ApiOperation({ summary: '[Admin] 批准 Agent 技能升级提案(写盘生效)' })
  async approveProposal(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const proposal = await this.skillService.approveProposal(id, user.id);
    return { success: true, proposal };
  }

  /**
   * 拒绝提案: 仅状态更新,不写盘
   * POST /admin/agent-skills/proposals/:id/reject
   */
  @Post('proposals/:id/reject')
  @ApiOperation({ summary: '[Admin] 拒绝 Agent 技能升级提案' })
  async rejectProposal(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const proposal = await this.skillService.rejectProposal(id, user.id);
    return { success: true, proposal };
  }

  /**
   * 读取技能文件内容
   * GET /admin/agent-skills/:skillKey/:fileName
   */
  @Get(':skillKey/:fileName')
  @ApiOperation({ summary: '[Admin] 读取 Agent 技能文件' })
  readSkill(@Param('skillKey') skillKey: string, @Param('fileName') fileName: string) {
    return this.skillService.readSkill(skillKey, fileName);
  }

  /**
   * 直接编辑技能文件(管理员即时生效)
   * PUT /admin/agent-skills/:skillKey/:fileName
   */
  @Put(':skillKey/:fileName')
  @ApiOperation({ summary: '[Admin] 直接编辑 Agent 技能文件' })
  writeSkill(
    @Param('skillKey') skillKey: string,
    @Param('fileName') fileName: string,
    @Body() body: { content: string },
  ) {
    if (!body || typeof body.content !== 'string' || !body.content.trim()) {
      throw new BadRequestException('content 不能为空');
    }
    return this.skillService.writeSkill(skillKey, fileName, body.content);
  }
}
