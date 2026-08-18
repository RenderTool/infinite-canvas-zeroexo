import { Body, Controller, Get, Headers, NotImplementedException, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import {
  EmailThrottle,
  LoginThrottle,
  RegisterThrottle,
  ShortThrottle,
} from '../../common/throttler/decorators/throttle.decorator';

/**
 * 认证控制器 - 注册 / 登录 / 刷新令牌 / 找回密码 等
 *
 * 安全加固(Stage H.1 - API 速率限制):
 * - 关键端点使用业务级限流装饰器:
 *   - @LoginThrottle()    登录/注册码/重置码(防爆破)
 *   - @RegisterThrottle() 注册(防批量注册)
 *   - @EmailThrottle()    找回/重置密码邮件(防垃圾)
 *   - @ShortThrottle()    OAuth 回调(短时保护)
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('send-register-code')
  @ApiOperation({ summary: '发送注册验证码' })
  @EmailThrottle()
  sendRegisterCode(
    @Body() dto: ForgotPasswordDto,
    @Headers('x-locale') xLocale?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const locale = this.resolveLocale(dto as { locale?: string }, xLocale, acceptLanguage);
    return this.authService.sendRegisterCode(dto.email, locale);
  }

  @Post('register')
  @ApiOperation({ summary: '注册' })
  @RegisterThrottle()
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: '登录(支持邮箱或用户名)' })
  @LoginThrottle()
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @UseGuards(AuthGuard('jwt-refresh'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '刷新令牌' })
  refresh(@CurrentUser() user: AuthUser) {
    return this.authService.refresh(user.id);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '登出' })
  logout() {
    return this.authService.logout();
  }

  @Post('forgot-password')
  @ApiOperation({ summary: '忘记密码(发送重置邮件)' })
  @EmailThrottle()
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Headers('x-locale') xLocale?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const locale = this.resolveLocale(dto as { locale?: string }, xLocale, acceptLanguage);
    return this.authService.forgotPassword(dto.email, locale);
  }

  @Post('verify-reset-code')
  @ApiOperation({ summary: '验证重置码' })
  @LoginThrottle()
  verifyResetCode(@Body() dto: VerifyResetCodeDto) {
    return this.authService.verifyResetCode(dto.email, dto.code);
  }

  @Post('reset-password')
  @ApiOperation({ summary: '使用令牌重置密码' })
  @EmailThrottle()
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Get('email-domains')
  @ApiOperation({ summary: '获取支持的邮箱域名列表' })
  getEmailDomains() {
    return this.authService.getEmailDomains();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户' })
  me(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  /** OAuth QQ 回调(短时保护) */
  @Post('oauth/qq/callback')
  @ApiOperation({ summary: 'QQ OAuth 回调' })
  @ShortThrottle()
  qqCallback(@Body() _body: { code: string; state?: string }) {
    // 实现待接入 OAuthAdapter;此处先返回 501 保持限流生效
    throw new NotImplementedException('QQ OAuth 登录尚未启用');
  }

  /** OAuth 微信回调(短时保护) */
  @Post('oauth/wechat/callback')
  @ApiOperation({ summary: '微信 OAuth 回调' })
  @ShortThrottle()
  wechatCallback(@Body() _body: { code: string; state?: string }) {
    throw new NotImplementedException('微信 OAuth 登录尚未启用');
  }

  /**
   * 解析请求 locale(邮件语言):
   * 优先级 body.locale > x-locale header > Accept-Language header > 'zh'。
   * 仅接受 zh/en/ja,其它值回退 'en'(与邮件词条一致)。
   */
  private resolveLocale(
    body: { locale?: string },
    xLocale?: string,
    acceptLanguage?: string,
  ): string {
    const SUPPORTED = ['zh', 'en', 'ja'];
    const candidates = [body?.locale, xLocale, acceptLanguage];
    for (const c of candidates) {
      if (!c) continue;
      const norm = c.split(',')[0]!.split('-')[0]!.trim().toLowerCase();
      if (SUPPORTED.includes(norm)) return norm;
      if (c === acceptLanguage && /en/i.test(c)) return 'en';
    }
    return 'zh';
  }
}
