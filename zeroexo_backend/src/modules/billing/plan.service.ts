/**
 * 订阅计划服务 — Plan(定价分组) CRUD + 用户订阅授予/到期回退
 *
 * 商业模型：
 * - Plan = 定价分组(免费/基础/标准/高级/超级/企业团队)，配置分组倍率、周期赠送积分、月/季/年价格、席位
 * - User.planCode + planExpiresAt = 用户当前生效计划（冗余快照，便于计费快速读取）
 * - Subscription = 订阅历史记录（每次授予一条，保留到期/取消痕迹）
 * - 到期回退：expiresAt 早于当前时间 → 回退为 free（清空 User.planCode/planExpiresAt）
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { notFound, badRequest } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';

/** 免费计划 code（内置，无 Plan 记录时也视为免费） */
export const FREE_PLAN_CODE = 'free';

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // Plan CRUD
  // ============================================================

  /** 列出全部计划(含禁用，按 sortOrder 升序) */
  async listPlans() {
    return this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** 列出启用的计划 */
  async listEnabledPlans() {
    return this.prisma.plan.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async getPlan(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw notFound(ErrorCode.NOT_FOUND, 'Plan not found');
    return plan;
  }

  async getPlanByCode(code: string) {
    return this.prisma.plan.findUnique({ where: { code } });
  }

  async createPlan(input: {
    code: string;
    name: string;
    description?: string;
    multiplier?: number;
    creditsPerCycle?: number;
    monthlyPrice?: number;
    quarterlyPrice?: number;
    yearlyPrice?: number;
    seats?: number;
    enabled?: boolean;
    sortOrder?: number;
  }) {
    const code = input.code.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(code)) {
      throw badRequest(ErrorCode.BAD_REQUEST, '计划 code 仅支持小写字母/数字/_-，且长度 2-32');
    }
    const existing = await this.prisma.plan.findUnique({ where: { code } });
    if (existing) throw badRequest(ErrorCode.BAD_REQUEST, `计划 code 已存在: ${code}`);
    if (code === FREE_PLAN_CODE) {
      throw badRequest(ErrorCode.BAD_REQUEST, 'free 为内置免费计划，不可创建');
    }

    return this.prisma.plan.create({
      data: {
        code,
        name: input.name,
        description: input.description,
        multiplier: input.multiplier ?? 1,
        creditsPerCycle: input.creditsPerCycle ?? 0,
        monthlyPrice: input.monthlyPrice ?? 0,
        quarterlyPrice: input.quarterlyPrice ?? 0,
        yearlyPrice: input.yearlyPrice ?? 0,
        seats: input.seats ?? 1,
        enabled: input.enabled ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async updatePlan(
    id: string,
    input: {
      name?: string;
      description?: string;
      multiplier?: number;
      creditsPerCycle?: number;
      monthlyPrice?: number;
      quarterlyPrice?: number;
      yearlyPrice?: number;
      seats?: number;
      enabled?: boolean;
      sortOrder?: number;
    },
  ) {
    await this.getPlan(id);
    return this.prisma.plan.update({ where: { id }, data: input });
  }

  async deletePlan(id: string) {
    const plan = await this.getPlan(id);
    if (plan.code === FREE_PLAN_CODE) {
      throw badRequest(ErrorCode.BAD_REQUEST, '内置免费计划不可删除');
    }
    // 若有订阅记录引用，禁止删除（建议改为禁用）
    const subCount = await this.prisma.subscription.count({ where: { planId: id } });
    if (subCount > 0) {
      throw badRequest(ErrorCode.BAD_REQUEST, `该计划已有 ${subCount} 条订阅记录，请改为禁用`);
    }
    return this.prisma.plan.delete({ where: { id } });
  }

  // ============================================================
  // 用户订阅
  // ============================================================

  /** 获取用户当前生效计划 code + 到期时间 */
  async getUserPlan(userId: string): Promise<{ planCode: string; planExpiresAt: Date | null; planName?: string; multiplier: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { planCode: true, planExpiresAt: true },
    });
    if (!user || !user.planCode || !user.planExpiresAt || user.planExpiresAt.getTime() <= Date.now()) {
      return { planCode: FREE_PLAN_CODE, planExpiresAt: null, multiplier: 1 };
    }
    const plan = await this.prisma.plan.findUnique({
      where: { code: user.planCode },
      select: { name: true, multiplier: true },
    });
    return {
      planCode: user.planCode,
      planExpiresAt: user.planExpiresAt,
      planName: plan?.name,
      multiplier: plan?.multiplier ?? 1,
    };
  }

  /**
   * 授予用户订阅（升级/续费）
   *
   * 幂等语义：若用户已有同一计划且未过期，顺延到期时间；否则从当前时间重新起算。
   * 覆盖/降级：传入不同计划时直接切换（旧订阅置为 cancelled）。
   */
  async grantSubscription(
    userId: string,
    planId: string,
    opts: {
      cycle?: 'month' | 'quarter' | 'year';
      seats?: number;
      renewMode?: 'manual' | 'auto';
      extend?: boolean;
      /** 指定到期时间（管理后台手动指定时使用，优先级高于 cycle 推算） */
      expiresAt?: Date;
    } = {},
  ) {
    const plan = await this.getPlan(planId);
    if (!plan.enabled) throw badRequest(ErrorCode.BAD_REQUEST, `计划「${plan.name}」已停用`);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound(ErrorCode.USER_NOT_FOUND, 'User not found');

    const cycle = opts.cycle ?? 'month';
    const seats = Math.max(1, opts.seats ?? plan.seats);
    const renewMode = opts.renewMode ?? 'manual';

    // 计算起止时间：同计划未过期且 extend=true → 顺延；否则从当前时间起算
    const now = Date.now();
    let startAt = new Date(now);
    let baseFrom = now;
    if (
      opts.extend &&
      user.planCode === plan.code &&
      user.planExpiresAt &&
      user.planExpiresAt.getTime() > now
    ) {
      baseFrom = user.planExpiresAt.getTime();
      startAt = new Date(now);
    }
    const expiresAt = opts.expiresAt ?? new Date(this.addCycle(baseFrom, cycle));

    // 取消旧的 active 订阅
    await this.prisma.subscription.updateMany({
      where: { userId, status: 'active', planId: { not: plan.id } },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });

    const sub = await this.prisma.subscription.create({
      data: {
        userId,
        planId: plan.id,
        planCode: plan.code,
        cycle,
        seats,
        status: 'active',
        renewMode,
        startAt,
        expiresAt,
      },
    });

    // 同步 User 冗余快照
    await this.prisma.user.update({
      where: { id: userId },
      data: { planCode: plan.code, planExpiresAt: expiresAt },
    });

    this.logger.log(`授予订阅: user=${userId} plan=${plan.code} cycle=${cycle} seats=${seats} expires=${expiresAt.toISOString()}`);
    return sub;
  }

  /**
   * 取消订阅（保留到期前权益，到期后回退 free）
   * 返回 true 表示已取消；false 表示无有效订阅
   */
  async cancelSubscription(userId: string, subscriptionId?: string) {
    const where = subscriptionId
      ? { id: subscriptionId, userId }
      : { userId, status: 'active' as const };
    const target = await this.prisma.subscription.findFirst({ where });
    if (!target) return false;

    await this.prisma.subscription.update({
      where: { id: target.id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    return true;
  }

  /** 立即回退为 free（管理员手动降级/退款后调用） */
  async resetToFree(userId: string) {
    await this.prisma.subscription.updateMany({
      where: { userId, status: 'active' },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { planCode: null, planExpiresAt: null },
    });
  }

  /** 查询用户订阅历史 */
  async listUserSubscriptions(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { plan: { select: { code: true, name: true } } },
    });
  }

  // ============================================================
  // 到期回退（惰性 + 定时）
  // ============================================================

  /** 每小时定时执行: 回退所有已到期订阅 */
  @Cron('0 5 * * * *')
  async scheduledExpireOverdue(): Promise<void> {
    try {
      await this.expireOverdueSubscriptions();
    } catch (err) {
      this.logger.error(`定时回退到期订阅失败: ${err}`);
    }
  }

  /**
   * 回退所有已到期订阅（惰性调用 + 定时任务）
   * 返回回退的用户数
   */
  async expireOverdueSubscriptions(): Promise<number> {
    const now = new Date();
    // 找出所有 planExpiresAt 已过期的用户
    const overdueUsers = await this.prisma.user.findMany({
      where: {
        planCode: { not: null },
        planExpiresAt: { lt: now },
      },
      select: { id: true },
    });
    if (overdueUsers.length === 0) return 0;

    const ids = overdueUsers.map((u) => u.id);
    // 对应 active 订阅置为 expired
    await this.prisma.subscription.updateMany({
      where: { userId: { in: ids }, status: 'active', expiresAt: { lt: now } },
      data: { status: 'expired' },
    });
    // 清空用户快照
    await this.prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { planCode: null, planExpiresAt: null },
    });
    this.logger.log(`到期回退: ${ids.length} 个用户已回退为 free`);
    return ids.length;
  }

  /** 按周期推进到期时间 */
  private addCycle(fromMs: number, cycle: 'month' | 'quarter' | 'year'): number {
    const d = new Date(fromMs);
    if (cycle === 'month') d.setMonth(d.getMonth() + 1);
    else if (cycle === 'quarter') d.setMonth(d.getMonth() + 3);
    else if (cycle === 'year') d.setFullYear(d.getFullYear() + 1);
    return d.getTime();
  }
}
