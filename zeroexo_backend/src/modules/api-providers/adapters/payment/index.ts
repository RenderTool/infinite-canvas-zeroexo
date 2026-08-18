/**
 * Payment 适配器统一出口
 *
 * 当前已实现:
 * - StripeAdapter: Stripe(Alpha,基础 charge / refund / subscription)
 *
 * 后续计划(预留):
 * - AlipayAdapter:  支付宝当面付 / 手机网站支付
 * - WechatPayAdapter: 微信支付 V3
 * - PaypalAdapter:  PayPal REST
 */
export { StripeAdapter } from './stripe.adapter';
