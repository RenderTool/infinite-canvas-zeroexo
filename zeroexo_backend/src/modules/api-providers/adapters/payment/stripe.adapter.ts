import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProvider } from '@prisma/client';
import { BaseApiAdapter, HealthResult } from '../base.adapter';
import { ApiProviderError } from '../api-provider.error';
import { decrypt } from '../../../../common/crypto/crypto-aes.util';

/**
 * Stripe 支付适配器 - Alpha
 *
 * 状态: 接口已定义,业务方法以 stub 形式存在
 * 后续实现:
 * - 引入 stripe npm 包,本适配器将调用其 SDK
 * - 业务方法: createCharge / refund / createSubscription / cancelSubscription
 * - Webhook: /api/payments/stripe/webhook
 *
 * 配置(config):
 * - mode:          'test' | 'live'
 * - webhookSecret:  Stripe Webhook 签名密钥
 * - successUrl:    支付成功回跳
 * - cancelUrl:     支付取消回跳
 *
 * 凭证(加密):
 * - apiKey: sk_test_*** / sk_live_***
 *
 * 能力声明: ['charge', 'refund', 'subscription']
 */
@Injectable()
export class StripeAdapter extends BaseApiAdapter {
  readonly type = 'payment' as const;
  readonly supportedProviders: string[] = ['stripe'];

  protected readonly logger = new Logger(StripeAdapter.name);
  public static readonly STRIPE_API = 'https://api.stripe.com/v1';

  constructor(private readonly config: ConfigService) {
    super();
  }

  private get encryptionKey(): string {
    const key = this.config.get<string>('ai.encryptionKey');
    if (!key) {
      throw new Error('Missing required config: ai.encryptionKey');
    }
    return key;
  }

  // ============================================================
  // 抽象方法
  // ============================================================

  async validateConfig(config: Record<string, any>): Promise<string | null> {
    if (!config || typeof config !== 'object') return '配置必须是对象';
    if (config.mode && !['test', 'live'].includes(config.mode)) {
      return `不支持的 mode: ${config.mode}`;
    }
    return null;
  }

  /**
   * 健康检查 - 通过 /v1/balance 探测 API Key 是否有效
   * 真实生产实现应使用 stripe SDK
   */
  async healthCheck(provider: ApiProvider): Promise<HealthResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    if (!provider.enabled) {
      return { ok: false, status: 'down', error: '渠道已禁用', checkedAt };
    }
    const creds = (provider.credentials as any) ?? {};
    if (!creds.apiKey) {
      return { ok: false, status: 'down', error: 'Stripe 缺少 apiKey', checkedAt };
    }
    try {
  
      const apiKey = decrypt(creds.apiKey, this.encryptionKey);
      const res = await fetch(`${StripeAdapter.STRIPE_API}/balance`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        return {
          ok: false,
          status: 'down',
          latencyMs: Date.now() - start,
          error: `HTTP ${res.status}`,
          checkedAt,
        };
      }
      return {
        ok: true,
        status: 'healthy',
        latencyMs: Date.now() - start,
        checkedAt,
        meta: { mode: (provider.config as any)?.mode ?? 'test' },
      };
    } catch (err) {
      return {
        ok: false,
        status: 'down',
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        checkedAt,
      };
    }
  }

  async invokeAction(
    provider: ApiProvider,
    action: string,
    params: Record<string, any>,
  ): Promise<any> {
    switch (action) {
      case 'createCharge':
        return this.createCharge(provider, {
          amount: Number(params.amount),
          currency: String(params.currency),
          source: String(params.source),
          description: params.description ? String(params.description) : undefined,
          metadata: params.metadata as Record<string, string> | undefined,
        });
      case 'refund':
        return this.refund(provider, {
          chargeId: String(params.chargeId),
          amount: params.amount !== undefined ? Number(params.amount) : undefined,
          reason: params.reason ? String(params.reason) : undefined,
        });
      case 'createSubscription':
        return this.createSubscription(provider, {
          customer: String(params.customer),
          priceId: String(params.priceId),
          trialDays: params.trialDays !== undefined ? Number(params.trialDays) : undefined,
        });
      case 'cancelSubscription':
        return this.cancelSubscription(provider, {
          subscriptionId: String(params.subscriptionId),
          atPeriodEnd: Boolean(params.atPeriodEnd),
        });
      default:
        throw new ApiProviderError(`Stripe 适配器不支持 action: ${action}`, {
          provider: provider.provider,
          action,
        });
    }
  }

  getUsageMetrics(): string[] {
    return ['request', 'order', 'charge', 'refund', 'subscription'];
  }

  // ============================================================
  // Alpha 业务方法(待 Stripe SDK 接入后完善)
  // ============================================================

  /**
   * 创建一次性扣款(对应 Stripe Charges API)
   * @param params.amount      金额(分)
   * @param params.currency    货币代码(usd / cny / eur)
   * @param params.source      支付来源(token / payment_method)
   * @param params.description 描述
   * @param params.metadata    自定义元数据
   */
  async createCharge(
    provider: ApiProvider,
    params: { amount: number; currency: string; source: string; description?: string; metadata?: Record<string, string> },
  ): Promise<{ id: string; amount: number; currency: string; status: string }> {
    if (!params?.amount || !params?.currency || !params?.source) {
      throw new ApiProviderError('amount / currency / source 必填', {
        provider: provider.provider,
        action: 'createCharge',
      });
    }
    const creds = (provider.credentials as any) ?? {};

    const apiKey = decrypt(creds.apiKey, this.encryptionKey);
    const form = new URLSearchParams();
    form.set('amount', String(params.amount));
    form.set('currency', params.currency);
    form.set('source', params.source);
    if (params.description) form.set('description', params.description);
    if (params.metadata) {
      for (const [k, v] of Object.entries(params.metadata)) {
        form.set(`metadata[${k}]`, String(v));
      }
    }
    try {
      const res = await fetch(`${StripeAdapter.STRIPE_API}/charges`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ApiProviderError(`Stripe 扣款失败: ${data?.error?.message ?? res.status}`, {
          provider: provider.provider,
          action: 'createCharge',
          upstream: data,
        });
      }
      return { id: data.id, amount: data.amount, currency: data.currency, status: data.status };
    } catch (err) {
      if (err instanceof ApiProviderError) throw err;
      throw new ApiProviderError(
        `Stripe createCharge 异常: ${err instanceof Error ? err.message : String(err)}`,
        { provider: provider.provider, action: 'createCharge', upstream: err },
      );
    }
  }

  /**
   * 退款(对应 Stripe Refunds API)
   * @param params.chargeId  原 charge id
   * @param params.amount    可选,部分退款金额(分)
   */
  async refund(
    provider: ApiProvider,
    params: { chargeId: string; amount?: number; reason?: string },
  ): Promise<{ id: string; chargeId: string; amount: number; status: string }> {
    if (!params?.chargeId) {
      throw new ApiProviderError('chargeId 必填', {
        provider: provider.provider,
        action: 'refund',
      });
    }
    const creds = (provider.credentials as any) ?? {};

    const apiKey = decrypt(creds.apiKey, this.encryptionKey);
    const form = new URLSearchParams();
    form.set('charge', params.chargeId);
    if (params.amount) form.set('amount', String(params.amount));
    if (params.reason) form.set('reason', params.reason);
    try {
      const res = await fetch(`${StripeAdapter.STRIPE_API}/refunds`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ApiProviderError(`Stripe 退款失败: ${data?.error?.message ?? res.status}`, {
          provider: provider.provider,
          action: 'refund',
          upstream: data,
        });
      }
      return { id: data.id, chargeId: data.charge, amount: data.amount, status: data.status };
    } catch (err) {
      if (err instanceof ApiProviderError) throw err;
      throw new ApiProviderError(
        `Stripe refund 异常: ${err instanceof Error ? err.message : String(err)}`,
        { provider: provider.provider, action: 'refund', upstream: err },
      );
    }
  }

  /**
   * 创建订阅(对应 Stripe Subscriptions API)
   * @param params.customer  客户 id
   * @param params.priceId   价格 id(price_***)
   * @param params.trialDays 可选试用天数
   */
  async createSubscription(
    provider: ApiProvider,
    params: { customer: string; priceId: string; trialDays?: number },
  ): Promise<{ id: string; customer: string; status: string; currentPeriodEnd?: number }> {
    if (!params?.customer || !params?.priceId) {
      throw new ApiProviderError('customer / priceId 必填', {
        provider: provider.provider,
        action: 'createSubscription',
      });
    }
    const creds = (provider.credentials as any) ?? {};

    const apiKey = decrypt(creds.apiKey, this.encryptionKey);
    const form = new URLSearchParams();
    form.set('customer', params.customer);
    form.append('items[0][price]', params.priceId);
    if (params.trialDays) form.set('trial_period_days', String(params.trialDays));
    try {
      const res = await fetch(`${StripeAdapter.STRIPE_API}/subscriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ApiProviderError(`Stripe 订阅失败: ${data?.error?.message ?? res.status}`, {
          provider: provider.provider,
          action: 'createSubscription',
          upstream: data,
        });
      }
      return {
        id: data.id,
        customer: data.customer,
        status: data.status,
        currentPeriodEnd: data.current_period_end,
      };
    } catch (err) {
      if (err instanceof ApiProviderError) throw err;
      throw new ApiProviderError(
        `Stripe createSubscription 异常: ${err instanceof Error ? err.message : String(err)}`,
        { provider: provider.provider, action: 'createSubscription', upstream: err },
      );
    }
  }

  /**
   * 取消订阅
   */
  async cancelSubscription(
    provider: ApiProvider,
    params: { subscriptionId: string; atPeriodEnd?: boolean },
  ): Promise<{ id: string; status: string; cancelAtPeriodEnd: boolean }> {
    if (!params?.subscriptionId) {
      throw new ApiProviderError('subscriptionId 必填', {
        provider: provider.provider,
        action: 'cancelSubscription',
      });
    }
    const creds = (provider.credentials as any) ?? {};

    const apiKey = decrypt(creds.apiKey, this.encryptionKey);
    // DELETE subscriptions/<id>?at_period_end=true|false
    const qs = new URLSearchParams();
    qs.set('at_period_end', params.atPeriodEnd ? 'true' : 'false');
    try {
      const res = await fetch(`${StripeAdapter.STRIPE_API}/subscriptions/${encodeURIComponent(params.subscriptionId)}?${qs.toString()}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ApiProviderError(`Stripe 取消订阅失败: ${data?.error?.message ?? res.status}`, {
          provider: provider.provider,
          action: 'cancelSubscription',
          upstream: data,
        });
      }
      return { id: data.id, status: data.status, cancelAtPeriodEnd: Boolean(data.cancel_at_period_end) };
    } catch (err) {
      if (err instanceof ApiProviderError) throw err;
      throw new ApiProviderError(
        `Stripe cancelSubscription 异常: ${err instanceof Error ? err.message : String(err)}`,
        { provider: provider.provider, action: 'cancelSubscription', upstream: err },
      );
    }
  }
}
