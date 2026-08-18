/**
 * Email 适配器统一出口
 *
 * 当前已实现:
 * - SmtpAdapter: 通用 SMTP(可复用至 aliyun-dm / tencent-ses / sendgrid)
 *
 * 后续计划(预留):
 * - AliyunDmAdapter: 阿里云邮件推送 DirectMail(走 OpenAPI 签名)
 * - TencentSesAdapter: 腾讯云邮件 SES(走 TC3-HMAC-SHA256 签名)
 * - SendGridAdapter: SendGrid(走 HTTP v3/mail/send)
 */
export { SmtpAdapter } from './smtp.adapter';
