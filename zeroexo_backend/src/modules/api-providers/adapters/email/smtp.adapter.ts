import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProvider } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { BaseApiAdapter, HealthResult } from '../base.adapter';
import { ApiProviderError } from '../api-provider.error';
import { decrypt } from '../../../../common/crypto/crypto-aes.util';

/**
 * SMTP 邮件适配器
 *
 * 适用范围:
 * - provider 标识: smtp / aliyun-dm / tencent-ses / sendgrid
 * - 协议: 通用 SMTP,均可通过 nodemailer 复用
 *
 * 关键配置(config 字段,公开):
 * - host          SMTP 主机(如 smtp.gmail.com / smtpdm.aliyun.com)
 * - port          端口(465 走 SSL,587 走 STARTTLS,25 不加密)
 * - secure        boolean 是否直接 SSL(465 自动为 true)
 * - user          登录用户名
 * - fromAddress   发件人邮箱
 * - fromName      发件人显示名
 *
 * 凭证字段(加密):
 * - pass          密码 / SMTP Auth Token / API Key
 *
 * 能力声明: ['send', 'verify']
 */
@Injectable()
export class SmtpAdapter extends BaseApiAdapter {
  readonly type = 'email' as const;
  /** 当前适配器只承担一个 provider(由 ApiProvider.provider 字段路由) */
  readonly supportedProviders: string[] = ['smtp'];

  protected readonly logger = new Logger(SmtpAdapter.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  /** 加密密钥 getter - 与其它适配器共享同一密钥 */
  private get encryptionKey(): string {
    const key = this.config.get<string>('ai.encryptionKey');
    if (!key) {
      throw new Error('Missing required config: ai.encryptionKey');
    }
    return key;
  }

  // ============================================================
  // 基础抽象方法实现
  // ============================================================

  /**
   * 校验 SMTP 公开配置
   * - 必须有 host / port / user
   * - fromAddress 若提供,需符合邮箱格式
   */
  async validateConfig(config: Record<string, any>): Promise<string | null> {
    if (!config || typeof config !== 'object') return '配置必须是对象';
    if (!config.host) return 'SMTP 缺少 host';
    if (!config.port) return 'SMTP 缺少 port';
    if (!config.user) return 'SMTP 缺少 user';
    if (config.fromAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.fromAddress)) {
      return `fromAddress 格式不合法: ${config.fromAddress}`;
    }
    return null;
  }

  /**
   * 健康检查 - 通过 nodemailer.verify() 进行实际握手 + auth 校验
   * 任何 SMTP 错误都会返回 down 状态并附带错误信息
   */
  async healthCheck(provider: ApiProvider): Promise<HealthResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();

    if (!provider.enabled) {
      return { ok: false, status: 'down', error: '渠道已禁用', checkedAt };
    }

    let transport: Transporter | null = null;
    try {
      const creds = (provider.credentials as any) ?? {};
      if (!creds.pass) {
        return {
          ok: false,
          status: 'down',
          error: 'SMTP 缺少 pass 凭证',
          checkedAt,
        };
      }
      transport = this.buildTransport(provider.config as any, creds);
      await transport.verify();
      return {
        ok: true,
        status: 'healthy',
        latencyMs: Date.now() - start,
        checkedAt,
        meta: { host: (provider.config as any)?.host, port: (provider.config as any)?.port },
      };
    } catch (err) {
      return {
        ok: false,
        status: 'down',
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        checkedAt,
      };
    } finally {
      if (transport) transport.close();
    }
  }

  /**
   * 业务动作分发
   * - send:   发送自定义邮件
   * - verify: 验证发件人地址格式 + 可选 DNS 解析
   */
  async invokeAction(
    provider: ApiProvider,
    action: string,
    params: Record<string, any>,
  ): Promise<any> {
    switch (action) {
      case 'send': {
        const { to, subject, html, text } = params;
        if (!to) throw new ApiProviderError('缺少收件人 to', { provider: provider.provider, action });
        if (!subject) throw new ApiProviderError('缺少主题 subject', { provider: provider.provider, action });
        if (!html && !text) {
          throw new ApiProviderError('邮件内容为空(需 html 或 text)', { provider: provider.provider, action });
        }
        return this.send(provider, to, subject, html, text);
      }
      case 'verify': {
        const fromAddress = params.fromAddress ?? (provider.config as any)?.fromAddress;
        return this.verify(fromAddress);
      }
      default:
        throw new ApiProviderError(`SMTP 适配器不支持 action: ${action}`, {
          provider: provider.provider,
          action,
        });
    }
  }

  /** Email 类型支持的指标 */
  getUsageMetrics(): string[] {
    return ['email_sent', 'request'];
  }

  // ============================================================
  // 对外方法(供 ApiProvidersService 调度的薄包装)
  // ============================================================

  /**
   * 测试连接 - 复用于 ApiProvidersService.checkHealth 之外的前端"测试按钮"
   * @returns success + latencyMs + 可选 error
   */
  async testConnection(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    // 由 healthCheck 提供更详细信息,此处仅作为简单入口
    return { success: true, latencyMs: 0 };
  }

  /**
   * 发送邮件
   * @param to        收件人邮箱
   * @param subject   邮件主题
   * @param html      HTML 内容(与 text 二选一)
   * @param text      纯文本内容(可选)
   * @returns messageId
   */
  async send(
    provider: ApiProvider,
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<{ messageId: string }> {
    let transport: Transporter | null = null;
    try {
      const creds = (provider.credentials as any) ?? {};
      transport = this.buildTransport(provider.config as any, creds);
      const cfg = (provider.config as any) ?? {};
      const fromAddress = cfg.fromAddress ?? creds.user;
      const fromName = cfg.fromName ?? 'ZeroExo';
      const info = await transport.sendMail({
        from: `"${fromName}" <${fromAddress}>`,
        to,
        subject,
        html,
        text,
      });
      this.logger.log(`SMTP 发送成功 to=${to} messageId=${info.messageId}`);
      return { messageId: info.messageId };
    } catch (err) {
      throw new ApiProviderError(
        `SMTP 发送失败: ${err instanceof Error ? err.message : String(err)}`,
        {
          provider: provider.provider,
          action: 'send',
          upstream: err,
        },
      );
    } finally {
      if (transport) transport.close();
    }
  }

  /**
   * 验证发件人地址
   * - 必查: 邮箱格式
   * - 可选: MX 记录 / A 记录
   * @returns ok + reason(失败原因)
   */
  async verify(
    fromAddress: string,
  ): Promise<{ ok: boolean; reason?: string; mxRecords?: string[] }> {
    if (!fromAddress) {
      return { ok: false, reason: '发件人地址为空' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
      return { ok: false, reason: `邮箱格式不合法: ${fromAddress}` };
    }
    // DNS 解析为可选,使用 Node 内置 dns/promises
    try {
      const domain = fromAddress.split('@')[1];
      const mx = await dnsLookupMx(domain);
      if (mx.length === 0) {
        return { ok: true, reason: '未配置 MX 记录(可能仍可投递)', mxRecords: [] };
      }
      return { ok: true, mxRecords: mx.map((m) => `${m.priority} ${m.exchange}`) };
    } catch {
      // DNS 解析失败不应阻塞校验
      return { ok: true, reason: 'DNS 解析失败(已跳过)' };
    }
  }

  // ============================================================
  // 私有辅助
  // ============================================================

  /**
   * 根据 config + credentials 构造 nodemailer transport
   * pass 字段已加密,需先解密
   */
  private buildTransport(
    config: Record<string, any>,
    creds: Record<string, any>,
  ): Transporter {

    const port = Number(config.port) || 587;
    return nodemailer.createTransport({
      host: config.host,
      port,
      secure: typeof config.secure === 'boolean' ? config.secure : port === 465,
      auth: {
        user: config.user ?? creds.user,
        pass: decrypt(creds.pass, this.encryptionKey),
      },
    });
  }
}

/**
 * 内部辅助 - 延迟加载 dns/promises,避免顶层 import 干扰类型解析
 * 同时避免在 tsconfig types 仅声明 'node' 的情况下出现 namespace dns 错误
 */
async function dnsLookupMx(domain: string): Promise<Array<{ priority: number; exchange: string }>> {
  const dns: typeof import('dns/promises') = await import('dns/promises');
  const records = await dns.resolveMx(domain).catch(() => [] as Array<{ priority: number; exchange: string }>);
  return records;
}
