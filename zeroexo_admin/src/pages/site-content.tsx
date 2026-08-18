/**
 * 站点运营 - 站点内容
 *
 * 品牌配置 + 政策公告 合并在一个页面，通过 Tab 切换（后续站点内容类型在此扩展）。
 */
import { useState } from 'react';
import { Tabs } from 'antd';
import { PictureOutlined, FileTextOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';
import BrandingSettings from './branding-settings';
import Policies from './policies';

export default function SiteContent() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'branding' | 'policies'>('branding');

  return (
    <BreadcrumbLayout items={[{ title: t('nav.siteOperations') }, { title: t('nav.siteContent') }]}>
      {/* 站点内容类型 Tab（品牌配置 | 政策公告） */}
      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as 'branding' | 'policies')}
        items={[
          {
            key: 'branding',
            label: (
              <span>
                <PictureOutlined style={{ marginRight: 4, verticalAlign: -2 }} />
                {t('siteContent.branding')}
              </span>
            ),
          },
          {
            key: 'policies',
            label: (
              <span>
                <FileTextOutlined style={{ marginRight: 4, verticalAlign: -2 }} />
                {t('siteContent.policies')}
              </span>
            ),
          },
        ]}
      />
      {tab === 'branding' ? <BrandingSettings /> : <Policies />}
    </BreadcrumbLayout>
  );
}
