import { Controller, Post, Get, Patch, Delete, Param, Body, UseGuards, Request, Query } from '@nestjs/common';
import { UserApplicationService } from './user-application.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@Controller()
export class UserApplicationController {
  constructor(private readonly service: UserApplicationService) {}

  /**
   * 已登录用户申请角色升级（admin / operator）
   */
  @UseGuards(JwtAuthGuard)
  @Post('auth/apply')
  async apply(@Request() req: any, @Body() dto: {
    type: string;
    reason?: string;
  }) {
    return this.service.createApplication(req.user.id, dto);
  }

  /**
   * 查询当前用户的申请状态
   */
  @UseGuards(JwtAuthGuard)
  @Get('auth/apply/status')
  async getStatus(@Request() req: any) {
    return this.service.getApplicationStatus(req.user.email);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/applications')
  async listApplications(
    @Query('username') username?: string,
    @Query('email') email?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listApplications({ username, email, status });
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('admin/applications/:id/approve')
  async approve(
    @Param('id') id: string,
    @Body() body: { targetRole?: string },
    @Request() req: any,
  ) {
    // JWT payload 无 sub 字段,操作人取 req.user.id,角色取 req.user.role
    return this.service.approveApplication(id, req.user.id, req.user.role, body.targetRole);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('admin/applications/:id/reject')
  async reject(@Param('id') id: string, @Request() req: any) {
    return this.service.rejectApplication(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('admin/applications/:id')
  async delete(@Param('id') id: string) {
    return this.service.deleteApplication(id);
  }
}