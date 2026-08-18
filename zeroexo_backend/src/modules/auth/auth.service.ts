import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { badRequest, conflict, unauthorized } from '../../common/errors/app-exception.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LogsService } from '../logs/logs.service';
import { EmailService } from '../email/email.service';
import { ApiProvidersService } from '../api-providers/api-providers.service';
import { decrypt } from '../../common/crypto/crypto-aes.util';
import type { User } from '@prisma/client';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

/**
 * 返回给前端的用户信息(去除 passwordHash 等敏感字段)。
 */
export type SafeUser = {
  id: string;
  email: string;
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  role: string;
  emailVerified: boolean;
  permissions: { code: string; module: string }[];
};

/**
 * 认证响应 - 注册/登录成功后返回。
 */
export type AuthResult = {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
};

/** bcrypt 哈希轮数 */
const BCRYPT_ROUNDS = 10;

/**
 * 认证服务 - 注册 / 登录 / 刷新令牌 / 登出 / 获取当前用户。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly logsService: LogsService,
    private readonly emailService: EmailService,
    private readonly apiProvidersService: ApiProvidersService,
  ) {}

  /**
   * 解析 SMTP 配置: 仅从 api-providers 数据库表读取（加密存储）。
   * 优先取默认 email provider, 若未标记为默认则回退到任意 enabled 的 smtp provider。
   * 提取后解密 credentials.pass 并配置 EmailService。
   */
  private async configureEmailService(): Promise<void> {
    try {
      let emailProvider = await this.apiProvidersService.getDefaultRaw('email');
      if (!emailProvider || !emailProvider.enabled || emailProvider.provider !== 'smtp') {
        const all = await this.apiProvidersService.findAllRaw('email');
        emailProvider = all.find((p) => p.enabled && p.provider === 'smtp') ?? null;
      }

      if (!emailProvider) {
        this.logger.warn('未找到启用的 SMTP 提供商,验证码将打印到控制台');
        return;
      }

      const cfg = (emailProvider.config as Record<string, any>) ?? {};
      const creds = (emailProvider.credentials as Record<string, any>) ?? {};

      const host = cfg.host as string;
      const user = cfg.user as string;
      const port = cfg.port ? Number(cfg.port) : 587;
      const pass = creds.pass
        ? decrypt(creds.pass as string, this.configService.get<string>('ai.encryptionKey') ?? '')
        : '';

      if (host && user && pass) {
        this.emailService.configure({ host, port, user, pass });
        this.logger.log(`SMTP 已配置: ${host}:${port}`);
      } else {
        this.logger.warn(`SMTP 配置不完整(host=${!!host}, user=${!!user}, pass=${!!pass}),验证码将打印到控制台`);
      }
    } catch (err) {
      this.logger.error(`配置 SMTP 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 注册新用户
  async register(dto: RegisterDto): Promise<AuthResult> {
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { username: dto.username }] },
      select: { id: true },
    });
    if (exists) {
      throw conflict('USER_EMAIL_TAKEN', 'Email or username is already taken');
    }
    // 校验邮箱验证码
    if (!dto.code) {
      throw badRequest('AUTH_CODE_REQUIRED', 'Please get the email verification code first');
    }
    const vcode = await this.prisma.verificationCode.findFirst({
      where: {
        email: dto.email,
        code: dto.code,
        type: 'register',
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
    });
    if (!vcode) {
      throw badRequest('AUTH_INVALID_CODE', 'Invalid or expired verification code, please re-acquire');
    }
    // 标记验证码已使用
    await this.prisma.verificationCode.update({
      where: { id: vcode.id },
      data: { usedAt: new Date() },
    });
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        passwordHash,
        emailVerified: true,
      },
    });
    this.logsService.log('auth', `新用户注册: ${user.username}`, {
      userId: user.id,
      username: user.username,
      meta: { email: user.email },
    });
    return this.buildAuthResult(user);
  }

  // 登录(仅支持邮箱)
  async login(dto: LoginDto): Promise<AuthResult> {
    if (!dto.email) {
      throw badRequest('AUTH_EMAIL_REQUIRED', 'Email is required');
    }
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email },
    });
    if (!user) {
      this.logsService.log('auth', `登录失败(用户不存在): ${dto.email}`, {
        level: 'warn',
        meta: { input: dto.email },
      });
      throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Incorrect email or password');
    }
    if (user.disabled || user.deletedAt) {
      this.logsService.log('auth', `登录失败(账号已禁用或已删除): ${dto.email}`, {
        level: 'warn',
        meta: { input: dto.email },
      });
      throw unauthorized('AUTH_ACCOUNT_DISABLED', 'Account has been disabled or deleted, please contact admin');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      this.logsService.log('auth', `登录失败(密码错误): ${user.username}`, {
        level: 'warn',
        userId: user.id,
        username: user.username,
      });
      throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Incorrect email or password');
    }
    this.logsService.log('auth', `用户登录: ${user.username}`, {
      userId: user.id,
      username: user.username,
    });
    return this.buildAuthResult(user);
  }

  // 刷新令牌(基于 refresh token 中解出的 userId 换发新令牌对)
  async refresh(
    userId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw unauthorized('AUTH_USER_NOT_FOUND', 'User not found or has been deleted');
    }
    const result = await this.buildAuthResult(user);
    return { accessToken: result.accessToken, refreshToken: result.refreshToken };
  }

  // 登出(无状态 JWT,服务端不存储 token,客户端自行删除即可)
  async logout(): Promise<{ message: string }> {
    return { message: '已登出' };
  }

  /** 获取支持的邮箱域名列表
   * 仅从 api-providers 数据库表读取（加密存储，受管理员权限保护）
   * smtpConfigured: 是否存在启用的 SMTP 提供商
   * domains: 配置的允许域名列表（空数组表示无限制）
   */
  async getEmailDomains(): Promise<{ domains: string[]; smtpConfigured: boolean }> {
    try {
      const allProviders = await this.apiProvidersService.findAllRaw('email');
      const enabledSmtp = allProviders.filter(
        (p) => p.enabled && p.provider === 'smtp',
      );
      const smtpConfigured = enabledSmtp.length > 0;

      if (!smtpConfigured) {
        this.logger.warn(
          `[getEmailDomains] 未找到启用的 SMTP 提供商,共查询 ${allProviders.length} 个 email provider`,
        );
        if (allProviders.length > 0) {
          for (const p of allProviders) {
            this.logger.warn(
              `[getEmailDomains]   provider: id=${p.id}, provider=${p.provider}, enabled=${p.enabled}`,
            );
          }
        }
      }

      const domainSet = new Set<string>();
      for (const provider of enabledSmtp) {
        const cfg = (provider.config as Record<string, any>) ?? {};
        const allowedDomains = cfg.allowedDomains;
        if (Array.isArray(allowedDomains)) {
          for (const d of allowedDomains) {
            if (typeof d === 'string') domainSet.add(d.toLowerCase());
          }
        }
      }

      return { domains: [...domainSet], smtpConfigured };
    } catch (err) {
      this.logger.error(`getEmailDomains 异常: ${err instanceof Error ? err.message : String(err)}`);
      return { domains: [], smtpConfigured: false };
    }
  }

  // 发送注册验证码
  async sendRegisterCode(email: string, locale: string = 'zh'): Promise<{ message: string }> {
    // 检查邮箱是否已被注册
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) {
      throw conflict('AUTH_EMAIL_TAKEN', 'This email is already registered');
    }
    // 生成6位数字验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10分钟有效
    // 删除该邮箱旧的注册验证码
    await this.prisma.verificationCode.deleteMany({
      where: { email, type: 'register' },
    });
    // 保存新验证码
    await this.prisma.verificationCode.create({
      data: { email, code, type: 'register', expiresAt },
    });
    // 发送邮件
    await this.configureEmailService();
    await this.emailService.sendVerificationCode(email, code, 'register', locale);
    this.logsService.log('auth', `注册验证码已发送: ${email}`, {});
    return { message: '验证码已发送至您的邮箱,请查收' };
  }

  // 忘记密码(发送验证码)
  async forgotPassword(email: string, locale: string = 'zh'): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { message: '如果该邮箱已注册,您将收到验证码邮件' };
    }
    // 生成6位数字验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10分钟有效
    // 删除该邮箱旧的重置验证码
    await this.prisma.verificationCode.deleteMany({
      where: { email, type: 'reset' },
    });
    // 保存新验证码到 VerificationCode 表
    await this.prisma.verificationCode.create({
      data: { email, code, type: 'reset', expiresAt, userId: user.id },
    });
    // 发送邮件
    await this.configureEmailService();
    await this.emailService.sendVerificationCode(user.email, code, 'reset', locale);
    this.logsService.log('auth', `验证码已发送: ${user.email}`, {
      userId: user.id, username: user.username,
    });
    return { message: '验证码已发送至您的邮箱,请查收' };
  }

  // 验证重置码
  async verifyResetCode(email: string, code: string): Promise<{ token: string }> {
    const vcode = await this.prisma.verificationCode.findFirst({
      where: {
        email,
        code,
        type: 'reset',
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
    });
    if (!vcode) {
      throw badRequest('AUTH_INVALID_CODE', 'Invalid or expired verification code, please re-acquire');
    }
    // 标记验证码已使用
    await this.prisma.verificationCode.update({
      where: { id: vcode.id },
      data: { usedAt: new Date() },
    });
    // 返回验证码 ID 作为临时令牌(因为已标记 usedAt,无法重复使用)
    return { token: vcode.id };
  }

  // 使用令牌重置密码
  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const vcode = await this.prisma.verificationCode.findFirst({
      where: {
        id: token,
        type: 'reset',
        usedAt: { not: null },
        // 校验令牌未过期,过期则拒绝重置
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
    if (!vcode || !vcode.user) {
      throw badRequest('AUTH_RESET_LINK_INVALID', 'Reset link has expired or is invalid, please re-apply');
    }
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: vcode.user.id },
      data: { passwordHash },
    });
    this.logsService.log('auth', `密码已重置: ${vcode.user.email}`, {
      userId: vcode.user.id,
      username: vcode.user.username,
    });
    return { message: '密码已重置成功,请使用新密码登录' };
  }

  // 获取当前用户基本信息
  async getMe(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw unauthorized('AUTH_USER_NOT_FOUND', 'User not found');
    }
    return await this.toSafeUser(user);
  }

  // 签发 access + refresh 令牌对,并附带安全用户信息
  private async buildAuthResult(user: User): Promise<AuthResult> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn:
        this.configService.get<string>('jwt.accessExpiresIn') ?? '15m',
    });
    const refreshToken = await this.jwtService.signAsync(payload, {
      expiresIn:
        this.configService.get<string>('jwt.refreshExpiresIn') ?? '7d',
    });
    return { user: await this.toSafeUser(user), accessToken, refreshToken };
  }

  private async toSafeUser(user: User): Promise<SafeUser> {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      role: user.role,
      emailVerified: user.emailVerified,
      permissions: [],
    };
  }
}
