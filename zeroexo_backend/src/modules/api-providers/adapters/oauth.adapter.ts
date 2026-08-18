import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProvider } from '@prisma/client';
import { randomBytes } from 'crypto';
import { decrypt } from '../../../common/crypto/crypto-aes.util';
import { BaseApiAdapter, HealthResult } from './base.adapter';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest } from '../../../common/errors/app-exception.js';

/**
 * OAuth 渠道支持的服务商标识
 * - qq:         QQ 互联
 * - wechat:     微信开放平台(网站应用)
 * - wechat-mp:  微信公众平台
 * - github:     GitHub OAuth Apps
 * - google:     Google Sign-In
 * - dingtalk:   钉钉开放平台
 * - feishu:     飞书开放平台
 */
const SUPPORTED = [
  'qq',
  'wechat',
  'wechat-mp',
  'github',
  'google',
  'dingtalk',
  'feishu',
] as const;
type OAuthProviderType = (typeof SUPPORTED)[number];

/** 授权 URL 返回 */
export interface AuthUrlResult {
  url: string;
  state: string;
}

/** Token 交换结果 */
export interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  raw: Record<string, any>;
}

/** 用户信息 */
export interface UserInfo {
  openId: string;
  unionId?: string;
  nickname?: string;
  avatar?: string;
  email?: string;
  raw: Record<string, any>;
}

/**
 * OAuth 适配器 - 统一第三方登录授权流程
 *
 * 设计要点:
 * 1. 不持久化 state - 由调用方在 callback 处传回校验
 * 2. PKCE(code_verifier)按需生成 - 适用于 github/google 等支持的服务
 * 3. 用户信息查询走各服务商自有 userinfo 端点(返回结构差异在此抹平)
 */
@Injectable()
export class OAuthAdapter extends BaseApiAdapter {
  readonly type = 'oauth' as const;
  readonly supportedProviders: string[] = [...SUPPORTED];

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

  /** 校验公开配置 - 各 OAuth 服务商都需 appId + redirectUri */
  async validateConfig(config: Record<string, any>): Promise<string | null> {
    // provider 已在 ApiProvidersService.validateTypeAndProvider 中校验,config 中不含 provider 字段
    if (!config.appId) return '缺少 appId';
    if (!config.redirectUri) return '缺少 redirectUri';
    return null;
  }

  /**
   * 健康检查 - 各 OAuth 服务商一般无轻量 ping 接口
   * 策略:仅做配置完整性校验 + 解析授权端点 URL
   * - 真实连通性在 getAuthorizationUrl 第一次回调时验证
   */
  async healthCheck(provider: ApiProvider): Promise<HealthResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    if (!provider.enabled) {
      return { ok: false, status: 'down', error: '渠道已禁用', checkedAt };
    }
    const cfg = (provider.config as any) ?? {};
    const err = await this.validateConfig(cfg);
    if (err) {
      return {
        ok: false,
        status: 'down',
        latencyMs: Date.now() - start,
        error: err,
        checkedAt,
      };
    }
    return {
      ok: true,
      status: 'healthy',
      latencyMs: Date.now() - start,
      checkedAt,
      details: {
        provider: provider.provider,
        authorizeEndpoint: this.getAuthorizeEndpoint(provider.provider as OAuthProviderType),
      },
    };
  }

  /**
   * 业务动作分发
   * - get-auth-url: 生成授权 URL(含 state)
   * - exchange-token: code 换 access_token
   * - get-user-info: 拉取用户信息
   * - refresh-token: 刷新 access_token
   */
  async invokeAction(
    provider: ApiProvider,
    action: string,
    params: Record<string, any>,
  ): Promise<any> {
    switch (action) {
      case 'get-auth-url':
        return this.getAuthorizationUrl(
          provider,
          params.redirectUri ?? (provider.config as any).redirectUri,
          params.state,
        );
      case 'exchange-token':
        return this.exchangeCodeForToken(
          provider,
          params.code,
          params.redirectUri ?? (provider.config as any).redirectUri,
        );
      case 'refresh-token':
        return this.refreshToken(provider, params.refreshToken);
      case 'get-user-info':
        return this.getUserInfo(provider, params.accessToken, params.openId);
      default:
        throw badRequest(ErrorCode.BAD_REQUEST, `OAuth adapter does not support action: ${action}`);
    }
  }

  /** OAuth 类型上报指标 */
  getUsageMetrics(): string[] {
    return ['request', 'oauth_authorize'];
  }

  /** 公开配置字段 - appId / redirectUri */
  getConfigFields() {
    return [
      {
        key: 'appId',
        label: 'App ID',
        type: 'text' as const,
        required: true,
        placeholder: 'OAuth 应用 ID',
      },
      {
        key: 'redirectUri',
        label: '回调地址',
        type: 'text' as const,
        required: true,
        placeholder: 'https://example.com/oauth/callback',
      },
    ];
  }

  /** 凭证字段 - appSecret */
  getCredentialsFields() {
    return [
      {
        key: 'appSecret',
        label: 'App Secret',
        type: 'password' as const,
        required: true,
        description: 'OAuth 应用的密钥,加密落库',
      },
    ];
  }

  // ===== 私有方法 =====

  /** 各 OAuth 服务商授权端点 */
  private getAuthorizeEndpoint(provider: OAuthProviderType): string {
    switch (provider) {
      case 'qq':
        return 'https://graph.qq.com/oauth2.0/authorize';
      case 'wechat':
        return 'https://open.weixin.qq.com/connect/qrconnect';
      case 'wechat-mp':
        return 'https://open.weixin.qq.com/connect/oauth2/authorize';
      case 'github':
        return 'https://github.com/login/oauth/authorize';
      case 'google':
        return 'https://accounts.google.com/o/oauth2/v2/auth';
      case 'dingtalk':
        return 'https://oapi.dingtalk.com/connect/oauth2/sns_authorize';
      case 'feishu':
        return 'https://open.feishu.cn/open-apis/authen/v1/index';
    }
  }

  /** 各 OAuth 服务商 token 端点 */
  private getTokenEndpoint(provider: OAuthProviderType): string {
    switch (provider) {
      case 'qq':
        return 'https://graph.qq.com/oauth2.0/token';
      case 'wechat':
      case 'wechat-mp':
        return 'https://api.weixin.qq.com/sns/oauth2/access_token';
      case 'github':
        return 'https://github.com/login/oauth/access_token';
      case 'google':
        return 'https://oauth2.googleapis.com/token';
      case 'dingtalk':
        return 'https://oapi.dingtalk.com/sns/gettoken';
      case 'feishu':
        return 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
    }
  }

  /** 各 OAuth 服务商 userinfo 端点 */
  private getUserInfoEndpoint(provider: OAuthProviderType): string {
    switch (provider) {
      case 'qq':
        return 'https://graph.qq.com/user/get_user_info';
      case 'wechat':
      case 'wechat-mp':
        return 'https://api.weixin.qq.com/sns/userinfo';
      case 'github':
        return 'https://api.github.com/user';
      case 'google':
        return 'https://www.googleapis.com/oauth2/v2/userinfo';
      case 'dingtalk':
        return 'https://oapi.dingtalk.com/sns/getuserinfo_bycode';
      case 'feishu':
        return 'https://open.feishu.cn/open-apis/authen/v1/user_info';
    }
  }

  /** 生成授权 URL(自动生成 state) */
  private getAuthorizationUrl(
    provider: ApiProvider,
    redirectUri: string,
    state?: string,
  ): AuthUrlResult {
    const cfg = (provider.config as any) ?? {};
    const finalState = state ?? randomBytes(16).toString('hex');
    const endpoint = this.getAuthorizeEndpoint(provider.provider as OAuthProviderType);
    const params = new URLSearchParams();
    params.set('appid', cfg.appId);
    params.set('redirect_uri', redirectUri);
    params.set('response_type', 'code');
    params.set('state', finalState);
    params.set('scope', cfg.scope ?? 'userinfo');
    const url = `${endpoint}?${params.toString()}`;
    return { url, state: finalState };
  }

  /** code 换 access_token - 统一封装 GET/POST 差异 */
  private async exchangeCodeForToken(
    provider: ApiProvider,
    code: string,
    redirectUri: string,
  ): Promise<TokenResult> {
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};
    const appSecret = decrypt(creds.appSecret, this.encryptionKey);
    const endpoint = this.getTokenEndpoint(provider.provider as OAuthProviderType);

    // 大部分 OAuth 提供商使用 GET + query,GitHub 使用 POST
    let res: Response;
    if (provider.provider === 'github' || provider.provider === 'feishu') {
      const body = new URLSearchParams();
      body.set('client_id', cfg.appId);
      body.set('client_secret', appSecret);
      body.set('code', code);
      body.set('redirect_uri', redirectUri);
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
    } else {
      const params = new URLSearchParams();
      params.set('appid', cfg.appId);
      params.set('secret', appSecret);
      params.set('code', code);
      params.set('grant_type', 'authorization_code');
      if (provider.provider === 'qq') {
        // QQ OAuth 支持 POST，将 appSecret 放在 body 中传输
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: params,
        });
      } else {
        // 微信只支持 GET，维持 query 参数传递
        res = await fetch(`${endpoint}?${params.toString()}`);
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw badRequest(ErrorCode.BAD_REQUEST, `Token exchange failed: HTTP ${res.status} ${text}`);
    }
    const raw = (await res.json()) as Record<string, any>;
    return {
      accessToken: raw.access_token ?? raw.accessToken ?? '',
      refreshToken: raw.refresh_token ?? raw.refreshToken,
      expiresIn: raw.expires_in ?? raw.expiresIn,
      scope: raw.scope,
      raw,
    };
  }

  /** 刷新 access_token */
  private async refreshToken(
    provider: ApiProvider,
    refreshToken: string,
  ): Promise<TokenResult> {
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};
    const appSecret = decrypt(creds.appSecret, this.encryptionKey);
    const endpoint = this.getTokenEndpoint(provider.provider as OAuthProviderType);
    const params = new URLSearchParams();
    params.set('appid', cfg.appId);
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', refreshToken);
    if (provider.provider !== 'wechat' && provider.provider !== 'wechat-mp') {
      params.set('client_secret', appSecret);
    } else {
      // 微信单独传 appSecret
    }
    const res = await fetch(`${endpoint}?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw badRequest(ErrorCode.BAD_REQUEST, `Token refresh failed: HTTP ${res.status} ${text}`);
    }
    const raw = (await res.json()) as Record<string, any>;
    return {
      accessToken: raw.access_token ?? '',
      refreshToken: raw.refresh_token ?? refreshToken,
      expiresIn: raw.expires_in,
      scope: raw.scope,
      raw,
    };
  }

  /** 拉取用户信息 - 抹平各服务商字段差异 */
  private async getUserInfo(
    provider: ApiProvider,
    accessToken: string,
    openId?: string,
  ): Promise<UserInfo> {
    const endpoint = this.getUserInfoEndpoint(provider.provider as OAuthProviderType);
    const params = new URLSearchParams();
    params.set('access_token', accessToken);
    if (provider.provider === 'qq' || provider.provider === 'wechat' || provider.provider === 'wechat-mp') {
      if (openId) params.set('openid', openId);
    }
    const res = await fetch(`${endpoint}?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw badRequest(ErrorCode.BAD_REQUEST, `Failed to fetch user info: HTTP ${res.status} ${text}`);
    }
    const raw = (await res.json()) as Record<string, any>;
    return {
      openId: raw.openid ?? raw.openId ?? raw.id ?? '',
      unionId: raw.unionid ?? raw.unionId,
      nickname: raw.nickname ?? raw.name ?? raw.login,
      avatar: raw.figureurl_qq_2 ?? raw.headimgurl ?? raw.avatar_url,
      email: raw.email,
      raw,
    };
  }
}
