/**
 * Email Provider 预设配置
 *
 * 定义常见邮件服务商的预设配置,供前端卡片选择使用。
 */
export interface EmailProviderPreset {
  provider: string;
  label: string;
  type: 'email';
  defaultConfig?: Record<string, any>;
  color: string;
  description: string;
  defaultHost?: string;
  defaultPort?: number;
}

export const EMAIL_PROVIDER_PRESETS: EmailProviderPreset[] = [
  {
    provider: 'smtp',
    label: '通用 SMTP',
    type: 'email',
    color: '#52c41a',
    description: '标准 SMTP 协议,适用于任意支持 SMTP 的邮件服务商。',
    defaultHost: 'smtp.example.com',
    defaultPort: 587,
  },
  {
    provider: 'aliyun-dm',
    label: '阿里云邮件推送',
    type: 'email',
    color: '#fa8c16',
    description: '阿里云 DirectMail,国内送达率高,支持大规模发送。',
    defaultHost: 'smtpdm.aliyun.com',
    defaultPort: 465,
    defaultConfig: {
      fromAddress: 'noreply@example.com',
    },
  },
  {
    provider: 'tencent-ses',
    label: '腾讯云邮件',
    type: 'email',
    color: '#722ed1',
    description: '腾讯云 SES,基于腾讯海量发送能力,稳定可靠。',
    defaultHost: 'sg-smtp.qcloudmail.com',
    defaultPort: 465,
  },
  {
    provider: 'sendgrid',
    label: 'SendGrid',
    type: 'email',
    color: '#1890ff',
    description: 'Twilio SendGrid,全球领先的邮件发送服务,适合国际业务。',
    defaultHost: 'smtp.sendgrid.net',
    defaultPort: 587,
  },
  {
    provider: 'mailgun',
    label: 'Mailgun',
    type: 'email',
    color: '#f5222d',
    description: 'Mailgun,开发者友好的邮件 API 服务,适合事务邮件。',
    defaultHost: 'smtp.mailgun.org',
    defaultPort: 587,
  },
];
