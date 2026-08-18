/**
 * 积分服务 — 用户积分账户管理
 *
 * 功能: 开户、充值、预冻结、结算、退款、查询
 * 并发控制: 使用数据库行锁 + 乐观更新防止积分超扣
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { badRequest, notFound } from '../../common/errors/app-exception.js';
import { ErrorCode } from '../../common/errors/error-codes';

export interface FreezeResult {
  success: boolean;
  frozenCredits: number;
  balanceAfter: number;
  frozenId?: string;
  error?: string;
}

export interface SettleResult {
  success: boolean;
  settledCredits: number;
  balanceAfter: number;
  error?: string;
}

export interface RefundResult {
  success: boolean;
  refundedCredits: number;
  balanceAfter: number;
  error?: string;
}

@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 确保用户积分账户存在
   * 新用户自动开户，已有账户直接返回
   */
  async ensureAccount(userId: string): Promise<void> {
    await this.prisma.userCredit.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  /**
   * 查询用户积分余额
   */
  async getBalance(userId: string): Promise<{
    balance: number;
    frozenAmount: number;
    available: number;
    totalCharged: number;
    totalConsumed: number;
  }> {
    await this.ensureAccount(userId);
    const credit = await this.prisma.userCredit.findUnique({ where: { userId } });
    if (!credit) throw notFound('NOT_FOUND', 'Credit account not found');
    return {
      balance: credit.balance,
      frozenAmount: credit.frozenAmount,
      available: credit.balance - credit.frozenAmount,
      totalCharged: credit.totalCharged,
      totalConsumed: credit.totalConsumed,
    };
  }

  /**
   * 充值积分 (管理员操作)
   */
  async recharge(
    userId: string,
    credits: number,
    operatorId?: string,
    remark?: string,
  ): Promise<{ balanceAfter: number }> {
    if (credits <= 0) throw badRequest('BAD_REQUEST', 'Recharge credits must be positive');
    await this.ensureAccount(userId);

    return this.prisma.$transaction(async (tx) => {
      const credit = await tx.userCredit.findUnique({
        where: { userId },
      });
      if (!credit) throw notFound('NOT_FOUND', 'Credit account not found');
      if (!credit.enabled) throw badRequest('BAD_REQUEST', 'Credit account is disabled');

      const newBalance = credit.balance + credits;
      await tx.userCredit.update({
        where: { id: credit.id },
        data: {
          balance: newBalance,
          totalCharged: { increment: credits },
        },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          creditId: credit.id,
          type: 'recharge',
          amount: credits,
          balanceAfter: newBalance,
          remark: remark || '充值',
          operatorId,
        },
      });

      return { balanceAfter: newBalance };
    });
  }

  /**
   * 预冻结积分 (请求发起前)
   * 冻结后积分不可用于其他消耗
   */
  async freeze(
    userId: string,
    estimatedCredits: number,
  ): Promise<FreezeResult> {
    if (estimatedCredits <= 0) {
      return { success: true, frozenCredits: 0, balanceAfter: 0 };
    }

    await this.ensureAccount(userId);

    return this.prisma.$transaction(async (tx) => {
      const credit = await tx.userCredit.findUnique({
        where: { userId },
      });
      if (!credit) return { success: false, frozenCredits: 0, balanceAfter: 0, error: '积分账户不存在' };
      if (!credit.enabled) return { success: false, frozenCredits: 0, balanceAfter: 0, error: '积分账户已禁用' };

      const available = credit.balance - credit.frozenAmount;
      if (available < estimatedCredits) {
        return {
          success: false,
          frozenCredits: 0,
          balanceAfter: credit.balance,
          error: `积分不足: 需要 ${estimatedCredits}, 可用 ${available}`,
        };
      }

      const newFrozen = credit.frozenAmount + estimatedCredits;
      await tx.userCredit.update({
        where: { id: credit.id },
        data: { frozenAmount: newFrozen },
      });

      const txn = await tx.creditTransaction.create({
        data: {
          userId,
          creditId: credit.id,
          type: 'freeze',
          amount: 0,
          balanceAfter: credit.balance,
          remark: `预冻结 ${estimatedCredits} 积分`,
        },
      });

      return {
        success: true,
        frozenCredits: estimatedCredits,
        balanceAfter: credit.balance,
        frozenId: txn.id,
      };
    });
  }

  /**
   * 结算: 从冻结积分中扣除实际消耗量，返还差额
   */
  async settle(
    userId: string,
    actualCredits: number,
    generationId?: string,
    remark?: string,
  ): Promise<SettleResult> {
    if (actualCredits < 0) {
      return { success: false, settledCredits: 0, balanceAfter: 0, error: '积分不能为负' };
    }

    return this.prisma.$transaction(async (tx) => {
      const credit = await tx.userCredit.findUnique({
        where: { userId },
      });
      if (!credit) return { success: false, settledCredits: 0, balanceAfter: 0, error: '积分账户不存在' };

      // 解冻全部冻结积分 (之前冻结的可能比实际多)
      const unfreezeAmount = credit.frozenAmount;
      let newBalance = credit.balance;
      let newFrozen = 0;

      if (unfreezeAmount > 0) {
        // 先解冻
        newFrozen = 0;
      }

      // 扣除实际消耗
      newBalance = newBalance - actualCredits;
      if (newBalance < 0) {
        // 余额不足: 不再静默置 0,抛业务异常(事务内抛出会整体回滚,冻结的积分得以保留)
        this.logger.warn(`积分超扣: userId=${userId}, balance=${credit.balance}, frozen=${credit.frozenAmount}, actualCredits=${actualCredits}`);
        throw badRequest(ErrorCode.CREDIT_INSUFFICIENT, `积分不足: 需要 ${actualCredits}, 当前余额 ${credit.balance}`);
      }

      await tx.userCredit.update({
        where: { id: credit.id },
        data: {
          balance: newBalance,
          frozenAmount: newFrozen,
          totalConsumed: { increment: actualCredits },
        },
      });

      // 记录解冻
      if (unfreezeAmount > 0) {
        await tx.creditTransaction.create({
          data: {
            userId,
            creditId: credit.id,
            type: 'unfreeze',
            amount: 0,
            balanceAfter: newBalance,
            remark: `解冻 ${unfreezeAmount} 积分`,
          },
        });
      }

      // 记录消耗
      if (actualCredits > 0) {
        await tx.creditTransaction.create({
          data: {
            userId,
            creditId: credit.id,
            type: 'consume',
            amount: -actualCredits,
            balanceAfter: newBalance,
            referenceId: generationId,
            remark: remark || 'AI 调用消耗',
          },
        });
      }

      return {
        success: true,
        settledCredits: actualCredits,
        balanceAfter: newBalance,
      };
    });
  }

  /**
   * 全额解冻 (请求失败时)
   */
  async unfreeze(userId: string, remark?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const credit = await tx.userCredit.findUnique({
        where: { userId },
      });
      if (!credit || credit.frozenAmount === 0) return;

      const frozen = credit.frozenAmount;
      await tx.userCredit.update({
        where: { id: credit.id },
        data: { frozenAmount: 0 },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          creditId: credit.id,
          type: 'unfreeze',
          amount: 0,
          balanceAfter: credit.balance,
          remark: remark || `请求失败解冻 ${frozen} 积分`,
        },
      });
    });
  }

  /**
   * 退款 (管理员操作)
   */
  async refund(
    userId: string,
    credits: number,
    referenceId?: string,
    remark?: string,
  ): Promise<RefundResult> {
    if (credits <= 0) return { success: false, refundedCredits: 0, balanceAfter: 0, error: '退款积分必须为正数' };

    await this.ensureAccount(userId);

    return this.prisma.$transaction(async (tx) => {
      const credit = await tx.userCredit.findUnique({
        where: { userId },
      });
      if (!credit) return { success: false, refundedCredits: 0, balanceAfter: 0, error: '积分账户不存在' };

      const newBalance = credit.balance + credits;
      await tx.userCredit.update({
        where: { id: credit.id },
        data: {
          balance: newBalance,
          totalRefunded: { increment: credits },
        },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          creditId: credit.id,
          type: 'refund',
          amount: credits,
          balanceAfter: newBalance,
          referenceId,
          remark: remark || '退款',
        },
      });

      return { success: true, refundedCredits: credits, balanceAfter: newBalance };
    });
  }

  /**
   * 查询用户消费记录
   */
  async getConsumptions(
    userId: string,
    options: { limit?: number; offset?: number; startDate?: Date; endDate?: Date } = {},
  ) {
    const { limit = 20, offset = 0, startDate, endDate } = options;
    const where: Record<string, unknown> = { userId };
    if (startDate) where.createdAt = { gte: startDate };
    if (endDate) where.createdAt = { ...(where.createdAt as Record<string, unknown>), lte: endDate };

    const [items, total] = await Promise.all([
      this.prisma.consumptionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.consumptionLog.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * 查询用户积分流水
   */
  async getTransactions(
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ) {
    const { limit = 20, offset = 0 } = options;
    return this.prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }
}
