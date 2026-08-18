/**
 * DetailBreadcrumb - 详情页返回操作栏
 *
 * 页面级面包屑已展示「模块 / 子模块」层级，本组件仅提供返回操作 + 详情标题，
 * 不与页面面包屑重复，避免出现二次面包屑。
 */
import { Button } from 'antd';
import { ArrowLeft } from 'lucide-react';

interface DetailBreadcrumbProps {
  /** 返回上一级回调 */
  onBack: () => void;
  /** 当前详情页名称（如 "GPT-4o"、"通用 SMTP"） */
  detailName: string;
}

export default function DetailBreadcrumb({
  onBack,
  detailName,
}: DetailBreadcrumbProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
        fontSize: 13,
        color: '#8c8c8c',
      }}
    >
      <Button
        type="link"
        size="small"
        icon={<ArrowLeft size={14} />}
        onClick={onBack}
        style={{ padding: 0, fontSize: 13 }}
      >
        返回
      </Button>
      <span style={{ color: '#262626', fontWeight: 600, fontSize: 15 }}>
        {detailName}
      </span>
    </div>
  );
}
