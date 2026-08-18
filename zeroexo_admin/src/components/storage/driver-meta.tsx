/**
 * driver 元数据与密码型输入框
 *
 * DRIVER_META 集中维护 4 个 driver(local / MinIO-S3 / 阿里云 OSS / 腾讯云 COS)的
 * 标签、描述、图标、默认配置项与表单字段定义。
 *
 * SecretInput 为带显示/隐藏切换的密码输入框,供 SwitchWizard 表单使用。
 *
 * 说明:因 SecretInput 内含 JSX,本文件使用 .tsx 扩展名。
 */
import { useState } from 'react';
import { Input } from 'antd';
import { HardDrive, Server, Cloud, Database, Eye, EyeOff } from 'lucide-react';

// driver 元数据(标签 / 描述 / 图标 / 颜色 / 默认配置 / 表单字段)
export const DRIVER_META = {
  local: {
    label: 'storage.local',
    description: 'storage.localDesc',
    icon: HardDrive,
    color: '#52c41a',
    defaultOptions: { root: 'storage' },
    fields: [
      { key: 'root', label: 'storage.storagePath', placeholder: 'storage', required: true },
    ],
  },
  s3: {
    label: 'storage.s3',
    description: 'storage.s3Desc',
    icon: Server,
    color: '#1890ff',
    defaultOptions: {
      endpoint: '',
      region: 'us-east-1',
      bucket: '',
      accessKey: '',
      secretKey: '',
      forcePathStyle: true,
      publicBaseUrl: '',
    },
    fields: [
      { key: 'endpoint', label: 'storage.endpoint', placeholder: 'http://localhost:9000(MinIO);AWS S3 leave blank' },
      { key: 'region', label: 'storage.region', placeholder: 'us-east-1', required: true },
      { key: 'bucket', label: 'storage.bucket', placeholder: 'zeroexo-assets', required: true },
      { key: 'accessKey', label: 'storage.accessKey', placeholder: 'AKIA...', required: true, secret: true },
      { key: 'secretKey', label: 'storage.secretKey', placeholder: '****', required: true, secret: true },
      { key: 'publicBaseUrl', label: 'storage.cdnDomain', placeholder: 'https://cdn.example.com' },
    ],
  },
  oss: {
    label: 'storage.oss',
    description: 'storage.ossDesc',
    icon: Cloud,
    color: '#fa8c16',
    defaultOptions: {
      region: 'oss-cn-hangzhou',
      bucket: '',
      accessKeyId: '',
      accessKeySecret: '',
      endpoint: '',
      internal: false,
      cdnDomain: '',
      secure: true,
    },
    fields: [
      { key: 'region', label: 'storage.region', placeholder: 'oss-cn-hangzhou', required: true },
      { key: 'bucket', label: 'storage.bucket', placeholder: 'zeroexo-assets', required: true },
      { key: 'accessKeyId', label: 'storage.accessKey', placeholder: 'LTAI...', required: true, secret: true },
      { key: 'accessKeySecret', label: 'storage.secretKey', placeholder: '****', required: true, secret: true },
      { key: 'endpoint', label: 'storage.endpoint', placeholder: 'Leave blank for default' },
      { key: 'cdnDomain', label: 'storage.cdnDomain', placeholder: 'https://cdn.example.com' },
    ],
  },
  cos: {
    label: 'storage.cos',
    description: 'storage.cosDesc',
    icon: Database,
    color: '#722ed1',
    defaultOptions: {
      region: 'ap-guangzhou',
      bucket: '',
      secretId: '',
      secretKey: '',
      cdnDomain: '',
      protocol: 'https:',
    },
    fields: [
      { key: 'region', label: 'storage.region', placeholder: 'ap-guangzhou', required: true },
      { key: 'bucket', label: 'storage.bucket', placeholder: 'zeroexo-1250000000', required: true },
      { key: 'secretId', label: 'storage.accessKey', placeholder: 'AKID...', required: true, secret: true },
      { key: 'secretKey', label: 'storage.secretKey', placeholder: '****', required: true, secret: true },
      { key: 'cdnDomain', label: 'storage.cdnDomain', placeholder: 'https://cdn.example.com' },
    ],
  },
} as const;

// 密码型输入框(支持显示/隐藏切换)
export function SecretInput({ secret, placeholder }: { secret?: boolean; placeholder?: string }) {
  const [visible, setVisible] = useState(false);
  if (!secret) {
    return <Input placeholder={placeholder} />;
  }
  return (
    <Input
      type={visible ? 'text' : 'password'}
      placeholder={placeholder}
      suffix={
        <span
          onClick={() => setVisible(!visible)}
          style={{ cursor: 'pointer', color: '#8c8c8c' }}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </span>
      }
    />
  );
}
