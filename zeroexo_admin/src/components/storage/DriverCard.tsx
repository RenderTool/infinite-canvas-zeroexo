/**
 * DriverCard - 单个 driver 的卡片展示
 *
 * 展示 driver 的图标、标签、描述,并提供"查看/切换"按钮。
 * 当前激活的 driver 显示加粗左边框与"当前"标签;
 * 被选中的 driver 显示细边框以高亮。
 *
 * 点击卡片整体触发 onSelect,点击按钮触发 onConfigure(并阻止冒泡)。
 */
import { Card, Row, Col, Tag, Button } from 'antd';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DRIVER_META } from './driver-meta';
import type { DriverName } from './types';

export default function DriverCard({
  name: _name,
  meta,
  isCurrent,
  isSelected,
  onSelect,
  onConfigure,
}: {
  name: DriverName;
  meta: typeof DRIVER_META[DriverName];
  isCurrent: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onConfigure: () => void;
}) {
  const { t } = useTranslation();
  const Icon = meta.icon;
  return (
    <Card
      hoverable
      onClick={onSelect}
      style={{
        borderRadius: 4,
        borderLeft: isCurrent ? `3px solid ${meta.color}` : isSelected ? `2px solid ${meta.color}` : '2px solid transparent',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
      styles={{ body: { padding: 16 } }}
    >
      <Row align="top" gutter={12}>
        <Col flex="none">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 4,
              background: `${meta.color}15`,
              color: meta.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon size={20} />
          </div>
        </Col>
        <Col flex="auto">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 500, fontSize: 14 }}>{t(meta.label)}</span>
            {isCurrent && (
              <Tag color="green" style={{ marginLeft: 0 }}>
                <Check size={10} style={{ marginRight: 2, verticalAlign: -1 }} /> {t('storage.current')}
              </Tag>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#8c8c8c', lineHeight: 1.5 }}>
            {t(meta.description)}
          </div>
        </Col>
        <Col flex="none">
          <Button
            type="primary"
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onConfigure();
            }}
          >
            {isCurrent ? t('storage.view') : t('storage.switchTo')}
          </Button>
        </Col>
      </Row>
    </Card>
  );
}
