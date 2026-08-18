import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface SmtpConfig {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  fromName?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transport: nodemailer.Transporter | null = null;

  configure(config: SmtpConfig): void {
    if (!config.host || !config.user || !config.pass) {
      this.logger.warn('SMTP 配置不完整,邮件将打印到控制台');
      this.transport = null;
      return;
    }
    const port = Number(config.port) || 587;
    this.transport = nodemailer.createTransport({
      host: config.host,
      port,
      secure: port === 465,
      auth: { user: config.user, pass: config.pass },
    });
    this.logger.log(`SMTP 已配置: ${config.host}:${config.port ?? 587}`);
  }

  async sendVerificationCode(
    to: string,
    code: string,
    type: 'register' | 'reset' = 'register',
    locale: string = 'zh',
  ): Promise<void> {
    if (!this.transport) {
      this.logger.warn(`SMTP 未配置,验证码 ${code} 将打印到控制台`);
      console.log(`\n[邮件验证码] 收件人: ${to}`);
      console.log(`[邮件验证码] 验证码: ${code}\n`);
      return;
    }
    try {
      const fromUser = (this.transport.options as any)?.auth?.user;
      if (!fromUser) {
        this.logger.warn('SMTP 配置缺少 user,验证码将打印到控制台');
        console.log(`\n[邮件验证码] 收件人: ${to}`);
        console.log(`[邮件验证码] 验证码: ${code}\n`);
        return;
      }
      const isRegister = type === 'register';
      const subject = isRegister
        ? this.buildSubject('register', locale)
        : this.buildSubject('reset', locale);
      const title = isRegister
        ? this.buildTitle('register', locale)
        : this.buildTitle('reset', locale);
      const bodyHint = isRegister
        ? this.buildBodyHint('register', locale)
        : this.buildBodyHint('reset', locale);
      const footerHint = isRegister
        ? this.buildFooterHint('register', locale)
        : this.buildFooterHint('reset', locale);
      await this.transport.sendMail({
        from: `"ZeroExo" <${fromUser}>`,
        to,
        subject,
        html: `
          <div style="max-width:480px;margin:0 auto;padding:32px;font-family:-apple-system,sans-serif;">
            <h2 style="color:#1c1917;margin:0 0 16px;">${title}</h2>
            <p style="color:#444;font-size:14px;line-height:1.6;">${bodyHint}</p>
            <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#e94560;text-align:center;padding:24px;background:#fafaf9;border-radius:12px;margin:16px 0;">
              ${code}
            </div>
            <p style="color:#888;font-size:12px;">${footerHint}</p>
          </div>
        `,
      });
      this.logger.log(`验证码已发送至 ${to} (${type})`);
    } catch (err) {
      this.logger.error(`发送验证码至 ${to} 失败: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  // ===== 多语言文案组装(zh/en/ja,未知语言回退 en) =====

  private buildSubject(kind: 'register' | 'reset', locale: string): string {
    const t: Record<string, Record<string, string>> = {
      register: {
        zh: 'ZeroExo - 注册验证码',
        en: 'ZeroExo - Registration Code',
        ja: 'ZeroExo - 登録コード',
      },
      reset: {
        zh: 'ZeroExo - 密码重置验证码',
        en: 'ZeroExo - Password Reset Code',
        ja: 'ZeroExo - パスワードリセットコード',
      },
    };
    return t[kind]?.[locale] ?? t[kind]!['en']!;
  }

  private buildTitle(kind: 'register' | 'reset', locale: string): string {
    const t: Record<string, Record<string, string>> = {
      register: {
        zh: '注册验证',
        en: 'Verify Your Email',
        ja: 'メールアドレス確認',
      },
      reset: {
        zh: '密码重置',
        en: 'Reset Your Password',
        ja: 'パスワードリセット',
      },
    };
    return t[kind]?.[locale] ?? t[kind]!['en']!;
  }

  private buildBodyHint(kind: 'register' | 'reset', locale: string): string {
    const t: Record<string, Record<string, string>> = {
      register: {
        zh: '您的验证码为:',
        en: 'Your verification code is:',
        ja: 'あなたの認証コードは:',
      },
      reset: {
        zh: '您的验证码为:',
        en: 'Your verification code is:',
        ja: 'あなたの認証コードは:',
      },
    };
    return t[kind]?.[locale] ?? t[kind]!['en']!;
  }

  private buildFooterHint(kind: 'register' | 'reset', locale: string): string {
    const t: Record<string, Record<string, string>> = {
      register: {
        zh: '验证码有效期为 10 分钟,请勿泄露给他人。如果您没有请求注册,请忽略此邮件。',
        en: 'The code is valid for 10 minutes. Do not share it with others. If you did not request registration, please ignore this email.',
        ja: '認証コードの有効期限は10分です。他人と共有しないでください。登録をリクエストしていない場合は、このメールを無視してください。',
      },
      reset: {
        zh: '验证码有效期为 10 分钟,请勿泄露给他人。如果您没有请求重置密码,请忽略此邮件。',
        en: 'The code is valid for 10 minutes. Do not share it with others. If you did not request a password reset, please ignore this email.',
        ja: '認証コードの有効期限は10分です。他人と共有しないでください。パスワードリセットをリクエストしていない場合は、このメールを無視してください。',
      },
    };
    return t[kind]?.[locale] ?? t[kind]!['en']!;
  }
}
