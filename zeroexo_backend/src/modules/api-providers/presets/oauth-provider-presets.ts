/**
 * OAuth Provider 预设配置
 *
 * 定义常见第三方登录服务商的预设配置,供前端卡片选择使用。
 */
export interface OAuthProviderPreset {
  provider: string;
  label: string;
  type: 'oauth';
  color: string;
  description: string;
  defaultConfig?: Record<string, any>;
}

export const OAUTH_PROVIDER_PRESETS: OAuthProviderPreset[] = [
  {
    provider: 'qq',
    label: 'QQ 互联',
    type: 'oauth',
    color: '#1890ff',
    description: 'QQ 互联开放平台,支持 QQ 账号登录。',
    defaultConfig: {
      scope: 'get_user_info',
      authUrl: 'https://graph.qq.com/oauth2.0/authorize',
      tokenUrl: 'https://graph.qq.com/oauth2.0/token',
      userInfoUrl: 'https://graph.qq.com/user/get_user_info',
    },
  },
  {
    provider: 'wechat',
    label: '微信开放平台',
    type: 'oauth',
    color: '#52c41a',
    description: '微信开放平台,支持微信扫码登录。',
    defaultConfig: {
      scope: 'snsapi_login',
      authUrl: 'https://open.weixin.qq.com/connect/qrconnect',
      tokenUrl: 'https://api.weixin.qq.com/sns/oauth2/access_token',
      userInfoUrl: 'https://api.weixin.qq.com/sns/userinfo',
    },
  },
  {
    provider: 'wechat-mp',
    label: '微信公众号',
    type: 'oauth',
    color: '#52c41a',
    description: '微信公众号内网页授权登录。',
    defaultConfig: {
      scope: 'snsapi_userinfo',
      authUrl: 'https://open.weixin.qq.com/connect/oauth2/authorize',
      tokenUrl: 'https://api.weixin.qq.com/sns/oauth2/access_token',
      userInfoUrl: 'https://api.weixin.qq.com/sns/userinfo',
    },
  },
  {
    provider: 'github',
    label: 'GitHub',
    type: 'oauth',
    color: '#262626',
    description: 'GitHub OAuth,支持 GitHub 账号登录。',
    defaultConfig: {
      scope: 'read:user',
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userInfoUrl: 'https://api.github.com/user',
    },
  },
  {
    provider: 'google',
    label: 'Google',
    type: 'oauth',
    color: '#fa8c16',
    description: 'Google OAuth 2.0,支持 Google 账号登录。',
    defaultConfig: {
      scope: 'openid profile email',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    },
  },
  {
    provider: 'dingtalk',
    label: '钉钉',
    type: 'oauth',
    color: '#1890ff',
    description: '钉钉开放平台,支持钉钉扫码登录。',
    defaultConfig: {
      scope: 'openid',
      authUrl: 'https://oapi.dingtalk.com/connect/oauth2/sns_authorize',
      tokenUrl: 'https://oapi.dingtalk.com/sns/gettoken',
      userInfoUrl: 'https://oapi.dingtalk.com/sns/getuserinfo',
    },
  },
  {
    provider: 'feishu',
    label: '飞书',
    type: 'oauth',
    color: '#722ed1',
    description: '飞书开放平台,支持飞书账号登录。',
    defaultConfig: {
      scope: 'user:email',
      authUrl: 'https://open.feishu.cn/open-apis/authen/v1/index',
      tokenUrl: 'https://open.feishu.cn/open-apis/authen/v1/access_token',
      userInfoUrl: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
    },
  },
];
