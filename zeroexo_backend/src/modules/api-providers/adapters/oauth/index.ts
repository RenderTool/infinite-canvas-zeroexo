/**
 * OAuth 适配器统一出口
 *
 * 当前已实现:
 * - QqAdapter:     QQ 互联(基于 graph.qq.com)
 * - WechatAdapter: 微信开放平台(基于 open.weixin.qq.com 扫码登录)
 *
 * 后续计划(预留):
 * - GithubAdapter: GitHub OAuth Apps
 * - GoogleAdapter: Google Sign-In
 * - FeishuAdapter: 飞书开放平台
 */
export { QqAdapter } from './qq.adapter';
export { WechatAdapter } from './wechat.adapter';
export type { AuthorizeUrlResult, TokenExchangeResult, QqUserInfo } from './qq.adapter';
