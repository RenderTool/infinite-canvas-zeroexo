/**
 * UserInfoHeader - 用户资源页面的用户信息头部（标题样式）
 *
 * 包含两部分：
 *   1. 用户已加载时：返回按钮 + 当前操作账户信息（昵称/邮箱/角色），并在 assets
 *      Tab 下提供对应的上传按钮（Upload 组件，beforeUpload 拦截后交由父组件处理）。
 *   2. 用户未加载且非加载中时：展示加载失败告警。
 *
 * 该组件为纯展示 + 回调型组件，数据与回调由父组件通过 props 传入。
 */
import { Alert, Button, Space, Tag, Upload } from 'antd';
import { UploadOutlined, UserOutlined } from '@ant-design/icons';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UserInfo } from '@/pages/user-resources-types';

export interface UserInfoHeaderProps {
  /** 当前用户信息（null 表示尚未加载或加载失败） */
  userInfo: UserInfo | null;
  /** 是否正在加载用户信息 */
  loading: boolean;
  /** 当前激活的 Tab（assets / projects / prompts / generations） */
  activeTab: string;
  /** 上传文件回调（由 Upload.beforeUpload 拦截后调用） */
  onUploadFile: (file: File) => void;
  /** 返回上一级（用户列表）回调 */
  onBack: () => void;
}

export default function UserInfoHeader({
  userInfo,
  loading,
  activeTab,
  onUploadFile,
  onBack,
}: UserInfoHeaderProps) {
  const { t } = useTranslation();

  return (
    <>
      {userInfo && (
        <div
          style={{
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Button
            type="link"
            size="small"
            icon={<ArrowLeft size={14} />}
            onClick={onBack}
            style={{ padding: 0, fontSize: 13, color: 'var(--color-text-secondary, #8c8c8c)' }}
          >
            {t('common.back')}
          </Button>
          <UserOutlined style={{ fontSize: 16, color: 'var(--color-primary)' }} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            {t('userResources.currentAccount')}：
            <span style={{ fontWeight: 400 }}>{userInfo.nickname || userInfo.username}</span>
            <span style={{ color: 'var(--color-text-secondary, #595959)', fontWeight: 400, fontSize: 13 }}>
              （{userInfo.email}）
            </span>
            <Tag color={userInfo.role === 'admin' ? 'red' : 'blue'} style={{ marginLeft: 8 }}>
              {userInfo.role === 'admin' ? t('common.admin') : t('common.normalUser')}
            </Tag>
          </span>
          <div style={{ flex: 1 }} />
          {activeTab === 'assets' && (
            <Space size={8}>
              <Upload
                accept="image/*,video/*,audio/*"
                showUploadList={false}
                beforeUpload={(file) => { onUploadFile(file as File); return false; }}
              >
                <Button size="small" type="primary" icon={<UploadOutlined />}>{t('userResources.uploadAsset')}</Button>
              </Upload>
            </Space>
          )}
        </div>
      )}
      {!userInfo && !loading && (
        <Alert title={t('userResources.loadUserFail')} type="warning" showIcon style={{ marginBottom: 16 }} />
      )}
    </>
  );
}
