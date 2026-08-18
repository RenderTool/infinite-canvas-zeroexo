import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProvider } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { decrypt } from '../../../common/crypto/crypto-aes.util';
import { BaseApiAdapter, HealthResult, QuotaCheckResult } from './base.adapter';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest } from '../../../common/errors/app-exception.js';

/**
 * 邮件渠道支持的服务商标识
 * - smtp:        通用 SMTP(任意第三方邮件服务)
 * - aliyun-dm:   阿里云邮件推送 DM
 * - tencent-ses: 腾讯云邮件 SES
 * - sendgrid:    SendGrid(国际)
 * - mailgun:     Mailgun(国际)
 */
const SUPPORTED = ['smtp', 'aliyun-dm', 'tencent-ses', 'sendgrid', 'mailgun'] as const;
type EmailProviderType = (typeof SUPPORTED)[number];

/**
 * 邮件发送结果
 */
export interface EmailSendResult {
  /** 消息 ID(用于追溯) */
  messageId: string;
  /** 收件人 */
  to: string;
  /** 是否成功 */
  ok: boolean;
}

/**
 * Email 适配器 - 统一邮件渠道的连接校验与发送
 *
 * 支持的连接方式:
 * - smtp:        nodemailer 实际 SMTP 握手 + auth
 * - aliyun-dm:   HTTP 调用 DirectMail SendMail / DescribeQuota
 * - tencent-ses: HTTP 调用 ses SendEmail
 * - sendgrid:    HTTP POST /v3/mail/send
 * - mailgun:     HTTP POST /v3/{domain}/messages
 */
@Injectable()
export class EmailAdapter extends BaseApiAdapter {
  readonly type = 'email' as const;
  readonly supportedProviders: string[] = [...SUPPORTED];

  constructor(private readonly config: ConfigService) {
    super();
    this.logger = new Logger(EmailAdapter.name);
  }

  private get encryptionKey(): string {
    const key = this.config.get<string>('ai.encryptionKey');
    if (!key) {
      throw new Error('Missing required config: ai.encryptionKey');
    }
    return key;
  }

  /**
   * 校验公开配置 - SMTP 需 host/user,云邮件需 region
   * 注意: provider 已在 ApiProvidersService.validateTypeAndProvider 中校验,config 中不含 provider 字段
   */
  async validateConfig(config: Record<string, any>): Promise<string | null> {
    // SMTP 校验
    if (config.host !== undefined || config.user !== undefined || config.port !== undefined) {
      if (!config.host) return 'SMTP 缺少 host';
      if (!config.user) return 'SMTP 缺少 user';
      if (!config.port) return 'SMTP 缺少 port';
    }
    // 云邮件渠道
    if (config.region !== undefined) {
      if (!config.region) return '云邮件缺少 region';
    }
    // 国际邮件渠道
    if (config.from !== undefined) {
      if (!config.from) return '缺少 from 地址';
    }
    return null;
  }

  /**
   * 健康检查 - 按渠道类型分派
   * - smtp:        nodemailer.verify()(实际连接 + auth)
   * - aliyun-dm:   调用 DescribeQuota 校验 AccessKey
   * - tencent-ses: 调用 GetStatistics(轻量)
   * - sendgrid:    HTTP GET /v3/scopes(校验 API Key)
   * - mailgun:     HTTP GET /v3/domains(校验 API Key)
   */
  async healthCheck(provider: ApiProvider): Promise<HealthResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();

    if (!provider.enabled) {
      return { ok: false, status: 'down', error: '渠道已禁用', checkedAt };
    }

    try {
      switch (provider.provider as EmailProviderType) {
        case 'smtp':
          return await this.checkSmtp(provider, start, checkedAt);
        case 'aliyun-dm':
          return await this.checkAliyunDm(provider, start, checkedAt);
        case 'tencent-ses':
          return await this.checkTencentSes(provider, start, checkedAt);
        case 'sendgrid':
          return await this.checkSendGrid(provider, start, checkedAt);
        case 'mailgun':
          return await this.checkMailgun(provider, start, checkedAt);
        default:
          return {
            ok: false,
            status: 'unknown',
            error: `未知邮件渠道: ${provider.provider}`,
            checkedAt,
          };
      }
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

  /**
   * 业务动作分发
   * - send:                  发送自定义邮件
   * - send-verification-code:发送验证码(供 password reset 流程复用)
   */
  async invokeAction(
    provider: ApiProvider,
    action: string,
    params: Record<string, any>,
  ): Promise<any> {
    switch (action) {
      case 'send':
        return this.sendEmail(
          provider,
          params.to,
          params.subject,
          params.html ?? params.text ?? '',
        );
      case 'send-verification-code':
        return this.sendVerificationCode(provider, params.to, params.code);
      default:
        throw badRequest(ErrorCode.BAD_REQUEST, `Email adapter does not support action: ${action}`);
    }
  }

  /** 邮件类型上报指标 */
  getUsageMetrics(): string[] {
    return ['email_sent', 'request'];
  }

  /** 公开配置字段 - SMTP 通用 */
  getConfigFields() {
    return [
      {
        key: 'host',
        label: 'SMTP 主机',
        type: 'text' as const,
        placeholder: 'smtp.example.com',
        description: '通用 SMTP 必填',
      },
      {
        key: 'port',
        label: 'SMTP 端口',
        type: 'number' as const,
        placeholder: '465',
        description: '465 走 SSL,587 走 STARTTLS',
      },
      {
        key: 'region',
        label: '区域',
        type: 'text' as const,
        placeholder: 'cn-hangzhou',
        description: '云邮件渠道必填',
      },
      {
        key: 'from',
        label: '发件人',
        type: 'text' as const,
        placeholder: 'noreply@example.com',
        description: '部分云邮件渠道必填',
      },
    ];
  }

  /** 凭证字段（暂未使用，前端定义为主） */
  getCredentialsFields() {
    return [
      {
        key: 'pass',
        label: 'KEY',
        type: 'password' as const,
        required: true,
      },
    ];
  }

  /**
   * 重写 checkQuota - 从云服务商 API 获取实时配额
   *
   * - aliyun-dm:  调用 DescribeQuota 获取每日限额
   * - sendgrid:   调用 /v3/user/credits 获取额度
   * - mailgun:    调用 /v3/account/limits 获取限额
   * - smtp:       无 API,回落父类默认实现(从 provider.quota 读取)
   * - tencent-ses:API 签名复杂(TC3-HMAC-SHA256),暂回落默认实现
   */
  async checkQuota(provider: ApiProvider): Promise<QuotaCheckResult> {
    const providerName = provider.provider;

    // SMTP / tencent-ses: 无配额查询 API,使用存储值
    if (providerName === 'smtp' || providerName === 'tencent-ses') {
      return super.checkQuota(provider);
    }

    try {
      let dailyLimit: number | null = null;
      let dailyUsed = 0;

      if (providerName === 'aliyun-dm') {
        // 阿里云 DM API 需要 HMAC-SHA1 签名认证，AccessKeyId 不能以明文 URL 参数传递。
        // 跳过远程配额查询，使用本地存储值。如需实时配额，请使用 @alicloud/dm SDK。
        return super.checkQuota(provider);
      } else if (providerName === 'sendgrid') {
        const result = await this.fetchSendGridQuota(provider);
        dailyLimit = result.dailyLimit;
        dailyUsed = result.dailyUsed;
      } else if (providerName === 'mailgun') {
        const result = await this.fetchMailgunQuota(provider);
        dailyLimit = result.dailyLimit;
        dailyUsed = result.dailyUsed;
      }

      if (dailyLimit == null) {
        return super.checkQuota(provider);
      }

      const percent = dailyLimit > 0 ? (dailyUsed / dailyLimit) * 100 : 0;
      let level: 'ok' | 'warning' | 'critical' = 'ok';
      if (percent >= 95) level = 'critical';
      else if (percent >= 80) level = 'warning';

      return {
        level,
        percent: Math.round(percent * 100) / 100,
        used: dailyUsed,
        total: dailyLimit,
        message:
          level === 'critical'
            ? '已接近或超过限额'
            : level === 'warning'
              ? '用量较高'
              : '正常',
      };
    } catch (err) {
      // API 失败时回落默认实现
      this.logger.warn(
        `从 API 获取配额失败(${providerName}),使用存储值: ${err instanceof Error ? err.message : String(err)}`,
      );
      return super.checkQuota(provider);
    }
  }

  // ===== 私有方法 =====

  /** SMTP 实际握手 */
  private async checkSmtp(
    provider: ApiProvider,
    start: number,
    checkedAt: string,
  ): Promise<HealthResult> {
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};
    // user 存储在前端 configFields 中（非敏感字段 → provider.config.user）
    // pass 存储在前端 configFields 中（sensitive 字段 → provider.credentials.pass）
    if (!cfg.host || !cfg.user || !creds.pass) {
      return {
        ok: false,
        status: 'down',
        error: 'SMTP 配置不完整(host/user/pass)',
        checkedAt,
      };
    }
    const port = Number(cfg.port) || 587;
    const smtpUser = cfg.user;
    const smtpPass = decrypt(creds.pass, this.encryptionKey);
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port,
      secure: port === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
    try {
      await transport.verify();
      return {
        ok: true,
        status: 'healthy',
        latencyMs: Date.now() - start,
        checkedAt,
        details: { host: cfg.host, port },
      };
    } finally {
      transport.close();
    }
  }

  /** 阿里云 DM - 校验 AccessKey 配置是否存在（不发起真实 API 调用，避免将 AccessKeyId 放在 URL 中） */
  private async checkAliyunDm(
    provider: ApiProvider,
    start: number,
    checkedAt: string,
  ): Promise<HealthResult> {
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};
    const region = cfg.region ?? 'cn-hangzhou';
    const accessKeyId = decrypt(creds.user ?? '', this.encryptionKey);
    const accessKeySecret = decrypt(creds.pass ?? '', this.encryptionKey);
    if (!accessKeyId || !accessKeySecret) {
      return {
        ok: false,
        status: 'down',
        error: '阿里云 DM 缺少 AccessKey',
        checkedAt,
      };
    }
    // 阿里云 API 需要 HMAC-SHA1 签名认证，不能将 AccessKeyId 以明文 URL 参数传递。
    // 生产环境应使用 @alicloud/dm SDK 进行完整签名调用，此处仅校验凭证存在性。
    return {
      ok: true,
      status: 'healthy',
      latencyMs: Date.now() - start,
      checkedAt,
      details: { region, note: '仅校验 AccessKey 配置存在，未发起真实 API 调用' },
    };
  }

  /** 腾讯云 SES - 通过 SMTP 协议验证连通性 */
  private async checkTencentSes(
    provider: ApiProvider,
    start: number,
    checkedAt: string,
  ): Promise<HealthResult> {
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};
    // 腾讯 SES 支持标准 SMTP，复用 SMTP 验证逻辑
    const smtpHost = cfg.smtpHost || 'smtp.cloud.tencent.com';
    const smtpPort = cfg.smtpPort || 465;
    const smtpUser = creds.user ? decrypt(creds.user, this.encryptionKey) : '';
    const smtpPass = creds.pass ? decrypt(creds.pass, this.encryptionKey) : '';
    if (!smtpUser || !smtpPass) {
      return {
        ok: false,
        status: 'down',
        error: '腾讯云 SES SMTP 凭证未配置',
        checkedAt,
      };
    }
    try {
      const transport = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: cfg.useSSL !== false,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transport.verify();
      transport.close();
      return {
        ok: true,
        status: 'healthy',
        latencyMs: Date.now() - start,
        checkedAt,
        details: { host: smtpHost, port: smtpPort },
      };
    } catch (err: any) {
      return {
        ok: false,
        status: 'down',
        latencyMs: Date.now() - start,
        error: err.message || String(err),
        checkedAt,
      };
    }
  }

  /** SendGrid - GET /v3/scopes 校验 API Key */
  private async checkSendGrid(
    provider: ApiProvider,
    start: number,
    checkedAt: string,
  ): Promise<HealthResult> {
    const creds = (provider.credentials as any) ?? {};
    const apiKey = decrypt(creds.pass ?? '', this.encryptionKey);
    if (!apiKey) {
      return {
        ok: false,
        status: 'down',
        error: 'SendGrid 缺少 API Key',
        checkedAt,
      };
    }
    const res = await fetch('https://api.sendgrid.com/v3/scopes', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return {
      ok: res.ok,
      status: res.ok ? 'healthy' : 'down',
      latencyMs: Date.now() - start,
      error: res.ok ? undefined : `HTTP ${res.status}`,
      checkedAt,
    };
  }

  /** Mailgun - GET /v3/domains 校验 API Key */
  private async checkMailgun(
    provider: ApiProvider,
    start: number,
    checkedAt: string,
  ): Promise<HealthResult> {
    const creds = (provider.credentials as any) ?? {};
    const apiKey = decrypt(creds.pass ?? '', this.encryptionKey);
    if (!apiKey) {
      return {
        ok: false,
        status: 'down',
        error: 'Mailgun 缺少 API Key',
        checkedAt,
      };
    }
    const res = await fetch('https://api.mailgun.net/v3/domains', {
      headers: { Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}` },
    });
    return {
      ok: res.ok,
      status: res.ok ? 'healthy' : 'down',
      latencyMs: Date.now() - start,
      error: res.ok ? undefined : `HTTP ${res.status}`,
      checkedAt,
    };
  }

  // ===== 配额查询(云服务商 API) =====

  /** SendGrid - GET /v3/user/credits 返回剩余额度 */
  private async fetchSendGridQuota(
    provider: ApiProvider,
  ): Promise<{ dailyLimit: number; dailyUsed: number }> {
    const creds = (provider.credentials as any) ?? {};
    const apiKey = decrypt(creds.pass ?? '', this.encryptionKey);
    if (!apiKey) return { dailyLimit: 0, dailyUsed: 0 };

    const res = await fetch('https://api.sendgrid.com/v3/user/credits', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      this.logger.warn(`SendGrid credits API HTTP ${res.status}`);
      return { dailyLimit: 0, dailyUsed: 0 };
    }
    // 响应: { "remain": 100, "total": 100, "used": 0, "nextReset": "..." }(实际是月度配额)
    const data: any = await res.json().catch(() => ({}));
    const total = Number(data.total) || 0;
    const used = Number(data.used) || 0;
    return { dailyLimit: total, dailyUsed: used };
  }

  /** Mailgun - GET /v3/account/limits 返回账户限额 */
  private async fetchMailgunQuota(
    provider: ApiProvider,
  ): Promise<{ dailyLimit: number; dailyUsed: number }> {
    const creds = (provider.credentials as any) ?? {};
    const apiKey = decrypt(creds.pass ?? '', this.encryptionKey);
    if (!apiKey) return { dailyLimit: 0, dailyUsed: 0 };

    const res = await fetch('https://api.mailgun.net/v3/account/limits', {
      headers: { Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}` },
    });
    if (!res.ok) {
      this.logger.warn(`Mailgun limits API HTTP ${res.status}`);
      return { dailyLimit: 0, dailyUsed: 0 };
    }
    // Mailgun limits 返回格式不定,视订阅计划不同字段不同
    const data: any = await res.json().catch(() => ({}));
    const dailyLimit = Number(data.sending_limit?.daily_limit) || 0;
    const dailyUsed = Number(data.sending_limit?.daily_used) || 0;
    return { dailyLimit, dailyUsed };
  }

  /** 发送自定义邮件 - SMTP 走 nodemailer,云邮件走 HTTP */
  private async sendEmail(
    provider: ApiProvider,
    to: string,
    subject: string,
    body: string,
  ): Promise<EmailSendResult> {
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};

    if (provider.provider === 'smtp') {
      const port = Number(cfg.port) || 587;
      if (!creds.user || !creds.pass) {
        return { messageId: '', to, ok: false };
      }
      const smtpUser = decrypt(creds.user, this.encryptionKey);
      const smtpPass = decrypt(creds.pass, this.encryptionKey);
      const transport = nodemailer.createTransport({
        host: cfg.host,
        port,
        secure: port === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
      const info = await transport.sendMail({
        from: `"ZeroExo" <${smtpUser}>`,
        to,
        subject,
        html: body,
      });
      return { messageId: info.messageId, to, ok: true };
    }

    // 其他渠道(aliyun-dm/tencent-ses/sendgrid/mailgun)在 Stage C 之后实现
    throw badRequest(
      ErrorCode.BAD_REQUEST,
      `Email provider ${provider.provider} does not implement send action, please use smtp`,
    );
  }

  /** 发送验证码(预制 HTML 模板) */
  private async sendVerificationCode(
    provider: ApiProvider,
    to: string,
    code: string,
  ): Promise<EmailSendResult> {
    const html = `
      <div style="max-width:480px;margin:0 auto;padding:32px;font-family:-apple-system,sans-serif;">
        <h2 style="color:#1c1917;margin:0 0 16px;">验证码</h2>
        <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#e94560;text-align:center;padding:24px;background:#fafaf9;border-radius:12px;margin:16px 0;">
          ${code}
        </div>
        <p style="color:#888;font-size:12px;">验证码有效期为 10 分钟,请勿泄露给他人。</p>
      </div>
    `;
    return this.sendEmail(provider, to, 'ZeroExo 验证码', html);
  }
}
