import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProvider } from '@prisma/client';
import { BaseApiAdapter, HealthResult } from '../base.adapter';
import { ApiProviderError } from '../api-provider.error';
import { decrypt } from '../../../../common/crypto/crypto-aes.util';

/**
 * 授权 URL 返回结构
 */
export interface AuthorizeUrlResult {
  url: string;
  state: string;
}

/**
 * 令牌交换返回结构
 */
export interface TokenExchangeResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  openId: string;
  scope?: string;
}

/**
 * QQ 用户信息
 */
export interface QqUserInfo {
  openId: string;
  nickname: string;
  avatar: string;
  gender: 'male' | 'female' | 'unknown';
}

/**
 * QQ 互联 OAuth 2.0 适配器
 *
 * 端点说明:
 * - 授权: https://graph.qq.com/oauth2.0/authorize
 * - 令牌: https://graph.qq.com/oauth2.0/token
 * - OpenID: https://graph.qq.com/oauth2.0/me
 * - 用户信息: https://graph.qq.com/user/get_user_info
 *
 * 配置(config,公开):
 * - redirectUri: 回调地址
 * - scope: get_user_info(默认) / add_topic / add_one_blog / add_album / list_album / ...
 *
 * 凭证(加密):
 * - appId:  应用 ID
 * - appKey: 应用密钥
 *
 * 能力声明: ['oauth', 'profile']
 */
@Injectable()
export class QqAdapter extends BaseApiAdapter {
  readonly type = 'oauth' as const;
  readonly supportedProviders: string[] = ['qq-oauth'];

  protected readonly logger = new Logger(QqAdapter.name);
  private static readonly AUTHORIZE_URL = 'https://graph.qq.com/oauth2.0/authorize';
  private static readonly TOKEN_URL = 'https://graph.qq.com/oauth2.0/token';
  private static readonly OPENID_URL = 'https://graph.qq.com/oauth2.0/me';
  private static readonly USERINFO_URL = 'https://graph.qq.com/user/get_user_info';

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
  // 基础抽象方法实现
  // ============================================================

  /**
   * 校验配置
   * - 必须有 redirectUri
   * - scope 可选,缺省 'get_user_info'
   */
  async validateConfig(config: Record<string, any>): Promise<string | null> {
    if (!config || typeof config !== 'object') return '配置必须是对象';
    if (!config.redirectUri) return 'QQ OAuth 缺少 redirectUri';
    return null;
  }

  /**
   * 健康检查 - QQ 没有轻量探测端点,只能做"配置完整性 + 凭证格式"检查
   * 真正连通性以 getAuthorizeUrl 后的回调为准
   */
  async healthCheck(provider: ApiProvider): Promise<HealthResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};
    if (!cfg.redirectUri) {
      return { ok: false, status: 'down', error: '缺少 redirectUri', checkedAt };
    }
    if (!creds.appId || !creds.appKey) {
      return { ok: false, status: 'down', error: 'QQ OAuth 缺少 appId/appKey', checkedAt };
    }
    return {
      ok: true,
      status: 'healthy',
      latencyMs: Date.now() - start,
      checkedAt,
      meta: { redirectUri: cfg.redirectUri, scope: cfg.scope ?? 'get_user_info' },
    };
  }

  /**
   * 业务动作分发
   * - authorize:    拼装授权 URL
   * - exchange:     code 换 access_token
   * - getUserInfo:  拉取 QQ 用户信息
   */
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
      case 'getUserInfo':
        return this.getUserInfo(provider, params.accessToken, params.openId);
      default:
        throw new ApiProviderError(`QQ 适配器不支持 action: ${action}`, {
          provider: provider.provider,
          action,
        });
    }
  }

  /** OAuth 指标 */
  getUsageMetrics(): string[] {
    return ['oauth_authorize', 'oauth_token', 'oauth_profile'];
  }

  // ============================================================
  // 公开业务方法
  // ============================================================

  /**
   * 拼装 QQ 授权 URL
   * @param state        防 CSRF 随机串
   * @param redirectUri  可选,默认使用 config.redirectUri
   */
  getAuthorizeUrl(provider: ApiProvider, state: string, redirectUri?: string): string {
    if (!state) throw new ApiProviderError('state 必填', { provider: provider.provider, action: 'authorize' });
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
    const scope = cfg.scope ?? 'get_user_info';
    const display = cfg.display ?? 'pc';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: appId,
      redirect_uri: finalRedirect,
      state,
      scope,
      display,
    });
    return `${QqAdapter.AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * code 换 access_token + 拉取 openid
   * QQ 流程: 先换 token,再调 /me 拿 openid
   */
  async exchangeCode(
    provider: ApiProvider,
    code: string,
    redirectUri?: string,
  ): Promise<TokenExchangeResult> {
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

    // 1. 换 token
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: creds.appId,
      client_secret: appKey,
      code,
      redirect_uri: finalRedirect,
      fmt: 'json',
    });
    const tokenRes = await fetch(`${QqAdapter.TOKEN_URL}?${tokenParams.toString()}`, {
      method: 'GET',
    });
    const tokenText = await tokenRes.text();
    let tokenJson: any;
    try {
      tokenJson = JSON.parse(tokenText);
    } catch {
      throw new ApiProviderError(`QQ token 响应非 JSON: ${tokenText.slice(0, 200)}`, {
        provider: provider.provider,
        action: 'exchange',
      });
    }
    if (tokenJson.error) {
      throw new ApiProviderError(`QQ token 错误: ${tokenJson.error} ${tokenJson.error_description ?? ''}`, {
        provider: provider.provider,
        action: 'exchange',
      });
    }
    const accessToken: string = tokenJson.access_token;
    if (!accessToken) {
      throw new ApiProviderError('QQ token 响应缺少 access_token', {
        provider: provider.provider,
        action: 'exchange',
      });
    }

    // 2. 拿 openid
    const meParams = new URLSearchParams({
      access_token: accessToken,
      fmt: 'json',
    });
    const meRes = await fetch(`${QqAdapter.OPENID_URL}?${meParams.toString()}`);
    const meJson: any = await meRes.json().catch(() => ({}));
    const openId: string = meJson.openid;
    if (!openId) {
      throw new ApiProviderError('QQ /me 响应缺少 openid', {
        provider: provider.provider,
        action: 'exchange',
        upstream: meJson,
      });
    }

    return {
      accessToken,
      refreshToken: tokenJson.refresh_token ?? '',
      expiresIn: Number(tokenJson.expires_in) || 0,
      openId,
      scope: tokenJson.scope,
    };
  }

  /**
   * 拉取 QQ 用户基本信息
   * 文档: https://wiki.open.qq.com/index.php?title=API%E6%96%87%E6%A1%A3
   */
  async getUserInfo(
    provider: ApiProvider,
    accessToken: string,
    openId: string,
  ): Promise<QqUserInfo> {
    if (!accessToken || !openId) {
      throw new ApiProviderError('accessToken / openId 必填', {
        provider: provider.provider,
        action: 'getUserInfo',
      });
    }
    const creds = (provider.credentials as any) ?? {};
    const params = new URLSearchParams({
      access_token: accessToken,
      oauth_consumer_key: creds.appId,
      openid: openId,
      format: 'json',
    });
    const res = await fetch(`${QqAdapter.USERINFO_URL}?${params.toString()}`);
    const data: any = await res.json().catch(() => ({}));
    if (data.ret !== 0) {
      throw new ApiProviderError(`QQ userinfo 失败: ret=${data.ret} msg=${data.msg}`, {
        provider: provider.provider,
        action: 'getUserInfo',
        upstream: data,
      });
    }
    return {
      openId,
      nickname: data.nickname ?? '',
      avatar: data.figureurl_qq_2 ?? data.figureurl_qq_1 ?? data.figureurl ?? '',
      gender: data.gender === '男' ? 'male' : data.gender === '女' ? 'female' : 'unknown',
    };
  }
}
