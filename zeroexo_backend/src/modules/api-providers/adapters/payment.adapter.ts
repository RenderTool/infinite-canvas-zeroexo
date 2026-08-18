import { Injectable } from '@nestjs/common';
import { ApiProvider } from '@prisma/client';
import { BaseApiAdapter, HealthResult } from './base.adapter';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest } from '../../../common/errors/app-exception.js';

/**
 * 支付渠道支持的服务商标识(占位,Stage F 完整实现)
 * - stripe:      Stripe(国际)
 * - alipay:      支付宝
 * - wechat-pay:  微信支付
 */
const SUPPORTED = ['stripe', 'alipay', 'wechat-pay'] as const;
// PaymentProviderType 留作后续阶段(Stage F 商业化)使用,先用 export 抑制未使用告警
export type PaymentProviderType = (typeof SUPPORTED)[number];

/**
 * Payment 适配器 - 占位实现
 *
 * 当前状态:Stage B + C 阶段仅提供基础骨架
 * - healthCheck: 全部返回 unknown(由调用方决定是否启用)
 * - invokeAction: 一律抛 BadRequest,提示未实现
 *
 * 后续阶段(Stage F 商业化)将完整实现:
 * - Stripe: REST API + Webhook
 * - 支付宝: RSA2 签名 + 异步通知
 * - 微信支付: V3 API + 回调验签
 */
@Injectable()
export class PaymentAdapter extends BaseApiAdapter {
  readonly type = 'payment' as const;
  readonly supportedProviders: string[] = [...SUPPORTED];

  /**
   * 校验公开配置
   * - 当前只校验 provider 字段是否合法
   * - 各服务商具体字段在 Stage F 补全(appId/merchantId/...)
   */
  async validateConfig(_config: Record<string, any>): Promise<string | null> {
    // provider 已在 ApiProvidersService.validateTypeAndProvider 中校验,config 中不含 provider 字段
    return null;
  }

  /**
   * 健康检查 - 占位:返回 unknown
   * - 实际支付服务无 ping 接口,真实健康度由上次支付回调成功率反推
   * - Stage F 将基于 ApiHealthLog 计算健康分
   */
  async healthCheck(provider: ApiProvider): Promise<HealthResult> {
    const checkedAt = new Date().toISOString();
    return {
      ok: false,
      status: 'unknown',
      error: '支付服务尚未实现',
      checkedAt,
      details: { placeholder: true, provider: provider.provider },
    };
  }

  /**
   * 业务动作 - 全部抛 BadRequest
   * - Stage F 将实现:create-order / query-order / refund / payout
   */
  async invokeAction(
    _provider: ApiProvider,
    action: string,
    _params: Record<string, any>,
  ): Promise<any> {
    throw badRequest(
      ErrorCode.BAD_REQUEST,
      `Payment adapter is not implemented yet, unable to execute action: ${action}`,
    );
  }

  /** 支付类型上报指标 */
  getUsageMetrics(): string[] {
    return ['request', 'payment_amount'];
  }

  /** 公开配置字段 - 占位 */
  getConfigFields() {
    return [
      {
        key: 'merchantId',
        label: '商户号',
        type: 'text' as const,
        placeholder: '支付宝 / 微信 商户号',
        description: 'Stage F 完整实现',
      },
      {
        key: 'notifyUrl',
        label: '回调地址',
        type: 'text' as const,
        placeholder: 'https://example.com/payment/callback',
      },
    ];
  }

  /** 凭证字段 - 占位 */
  getCredentialsFields() {
    return [
      {
        key: 'appId',
        label: 'App ID',
        type: 'text' as const,
        description: '支付应用 ID',
      },
      {
        key: 'privateKey',
        label: '私钥',
        type: 'textarea' as const,
        description: 'RSA2 私钥,加密落库',
      },
    ];
  }
}
