import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProvider } from '@prisma/client';
import { BaseApiAdapter, HealthResult } from '../base.adapter';
import { ApiProviderError } from '../api-provider.error';
import { decrypt } from '../../../../common/crypto/crypto-aes.util';

/**
 * 微信开放平台 OAuth 2.0 适配器
 *
 * 端点:
 * - 授权: https://open.weixin.qq.com/connect/qrconnect
 * - 令牌: https://api.weixin.qq.com/sns/oauth2/access_token
 * - 刷新: https://api.weixin.qq.com/sns/oauth2/refresh_token
 * - 用户信息: https://api.weixin.qq.com/sns/userinfo
 *
 * 配置(config):
 * - redirectUri: 回调地址
 * - scope:       snsapi_login(扫码登录) / snsapi_userinfo(用户信息)
 *
 * 凭证(加密):
 * - appId:  应用 ID
 * - appKey: 应用密钥(AppSecret)
 *
 * 能力声明: ['oauth', 'profile']
 */
@Injectable()
export class WechatAdapter extends BaseApiAdapter {
  readonly type = 'oauth' as const;
  readonly supportedProviders: string[] = ['wechat-oauth'];

  protected readonly logger = new Logger(WechatAdapter.name);
  private static readonly AUTHORIZE_URL = 'https://open.weixin.qq.com/connect/qrconnect';
  private static readonly TOKEN_URL = 'https://api.weixin.qq.com/sns/oauth2/access_token';
  private static readonly REFRESH_URL = 'https://api.weixin.qq.com/sns/oauth2/refresh_token';
  private static readonly USERINFO_URL = 'https://api.weixin.qq.com/sns/userinfo';

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
    if (!config.redirectUri) return '微信 OAuth 缺少 redirectUri';
    if (config.scope && !/^snsapi_(login|userinfo|base)$/.test(config.scope)) {
      return `不支持的 scope: ${config.scope}`;
    }
    return null;
  }

  async healthCheck(provider: ApiProvider): Promise<HealthResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};
    if (!cfg.redirectUri) {
      return { ok: false, status: 'down', error: '缺少 redirectUri', checkedAt };
    }
    if (!creds.appId || !creds.appKey) {
      return { ok: false, status: 'down', error: '微信 OAuth 缺少 appId/appKey', checkedAt };
    }
    return {
      ok: true,
      status: 'healthy',
      latencyMs: Date.now() - start,
      checkedAt,
      meta: { redirectUri: cfg.redirectUri, scope: cfg.scope ?? 'snsapi_login' },
    };
  }

  async invokeAction(
    provider: ApiProvider,
    action: string,
    params: Record<string, any>,
  ): Promise<any> {
    switch (action) {
      case 'authorize':
        return { url: this.getAuthorizeUrl(provider, params.state, params.redirectUri) };
      case 'exchange':
        return this.exchangeCode(provider, params.code, params.redirectUri);
      case 'refresh':
        return this.refreshToken(provider, params.refreshToken);
      case 'getUserInfo':
        return this.getUserInfo(provider, params.accessToken, params.openId);
      default:
        throw new ApiProviderError(`微信适配器不支持 action: ${action}`, {
          provider: provider.provider,
          action,
        });
    }
  }

  getUsageMetrics(): string[] {
    return ['oauth_authorize', 'oauth_token', 'oauth_profile'];
  }

  // ============================================================
  // 公开业务方法
  // ============================================================

  /**
   * 拼装微信扫码登录 URL
   * 注意: 微信开放平台 Web 应用走 /connect/qrconnect(扫码),与公众号的 /connect/oauth2 不同
   */
  getAuthorizeUrl(provider: ApiProvider, state: string, redirectUri?: string): string {
    if (!state) {
      throw new ApiProviderError('state 必填', { provider: provider.provider, action: 'authorize' });
    }
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};
    const appId = creds.appId;
    if (!appId) {
      throw new ApiProviderError('缺少 appId', { provider: provider.provider, action: 'authorize' });
    }
    const finalRedirect = redirectUri ?? cfg.redirectUri;
    if (!finalRedirect) {
      throw new ApiProviderError('缺少 redirectUri', { provider: provider.provider, action: 'authorize' });
    }
    const scope = cfg.scope ?? 'snsapi_login';
    const params = new URLSearchParams({
      appid: appId,
      redirect_uri: finalRedirect,
      response_type: 'code',
      scope,
      state,
    });
    // 微信需要在 fragment 追加 #wechat_redirect
    return `${WechatAdapter.AUTHORIZE_URL}?${params.toString()}#wechat_redirect`;
  }

  /**
   * code 换 access_token + openid + unionid
   * 微信一次性返回 unionid/openid(若已绑定开放平台)
   */
  async exchangeCode(
    provider: ApiProvider,
    code: string,
    redirectUri?: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    openId: string;
    unionId?: string;
    scope: string;
  }> {
    if (!code) {
      throw new ApiProviderError('code 必填', { provider: provider.provider, action: 'exchange' });
    }
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};

    const appKey = decrypt(creds.appKey, this.encryptionKey);
    const finalRedirect = redirectUri ?? cfg.redirectUri;
    if (!finalRedirect) {
      throw new ApiProviderError('缺少 redirectUri', { provider: provider.provider, action: 'exchange' });
    }
    const params = new URLSearchParams({
      appid: creds.appId,
      secret: appKey,
      code,
      grant_type: 'authorization_code',
    });
    const res = await fetch(`${WechatAdapter.TOKEN_URL}?${params.toString()}`);
    const data: any = await res.json().catch(() => ({}));
    if (data.errcode) {
      throw new ApiProviderError(`微信 token 错误: errcode=${data.errcode} errmsg=${data.errmsg}`, {
        provider: provider.provider,
        action: 'exchange',
        upstream: data,
      });
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: Number(data.expires_in) || 0,
      openId: data.openid,
      unionId: data.unionid,
      scope: data.scope,
    };
  }

  /**
   * 刷新 access_token
   */
  async refreshToken(
    provider: ApiProvider,
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number; openId: string; refreshToken: string; scope: string }> {
    if (!refreshToken) {
      throw new ApiProviderError('refreshToken 必填', { provider: provider.provider, action: 'refresh' });
    }
    const creds = (provider.credentials as any) ?? {};
    const params = new URLSearchParams({
      appid: creds.appId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const res = await fetch(`${WechatAdapter.REFRESH_URL}?${params.toString()}`);
    const data: any = await res.json().catch(() => ({}));
    if (data.errcode) {
      throw new ApiProviderError(`微信 refresh 错误: errcode=${data.errcode} errmsg=${data.errmsg}`, {
        provider: provider.provider,
        action: 'refresh',
        upstream: data,
      });
    }
    return {
      accessToken: data.access_token,
      expiresIn: Number(data.expires_in) || 0,
      openId: data.openid,
      refreshToken: data.refresh_token,
      scope: data.scope,
    };
  }

  /**
   * 拉取微信用户信息
   * 注意: scope 必须为 snsapi_userinfo 才能拿到昵称/头像
   */
  async getUserInfo(
    provider: ApiProvider,
    accessToken: string,
    openId: string,
  ): Promise<{ openId: string; nickname: string; avatar: string; gender: 'male' | 'female' | 'unknown'; unionId?: string }> {
    if (!accessToken || !openId) {
      throw new ApiProviderError('accessToken / openId 必填', {
        provider: provider.provider,
        action: 'getUserInfo',
      });
    }
    const params = new URLSearchParams({
      access_token: accessToken,
      openid: openId,
      lang: 'zh_CN',
    });
    const res = await fetch(`${WechatAdapter.USERINFO_URL}?${params.toString()}`);
    const data: any = await res.json().catch(() => ({}));
    if (data.errcode) {
      throw new ApiProviderError(`微信 userinfo 错误: errcode=${data.errcode} errmsg=${data.errmsg}`, {
        provider: provider.provider,
        action: 'getUserInfo',
        upstream: data,
      });
    }
    return {
      openId: data.openid,
      nickname: data.nickname ?? '',
      avatar: data.headimgurl ?? '',
      gender: data.sex === 1 ? 'male' : data.sex === 2 ? 'female' : 'unknown',
      unionId: data.unionid,
    };
  }
}
