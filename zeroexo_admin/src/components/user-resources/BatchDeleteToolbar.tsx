/**
 * BatchDeleteToolbar - 通用批量删除工具栏
 *
 * 统一替代 AssetToolbar / PromptToolbar / ProjectToolbar。
 * 展示当前选中数量，并提供三种删除入口：
 *   1. 批量删除选中
 *   2. 删除当前页全部
 *   3. 清空全部（危险操作）
 *
 * 纯展示 + 回调型组件，所有状态与数据由父组件通过 props 传入。
 */
import { Button } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

export interface BatchDeleteToolbarProps {
  /** 已选中行数 */
  selectedCount: number;
  /** 资源总数（用于"清空全部"按钮标签与禁用判断） */
  totalCount: number;
  /** 当前页条目数（用于"删除当前页"按钮禁用判断） */
  currentPageCount: number;
  /** 批量删除选中项回调 */
  onBatchDelete: () => void;
  /** 删除当前页全部回调 */
  onDeleteCurrentPage: () => void;
  /** 清空全部回调 */
  onDeleteAll: () => void;
  /** 资源类型名称（用于显示在按钮文案中，如"素材""项目""提示词"） */
  resourceType?: string;
}

export default function BatchDeleteToolbar({
  selectedCount,
  totalCount,
  currentPageCount,
  onBatchDelete,
  onDeleteCurrentPage,
  onDeleteAll,
}: BatchDeleteToolbarProps) {
  const { t } = useTranslation();

  return (
    <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ color: 'var(--color-text-secondary, #8c8c8c)', fontSize: 13 }}>
        {t('userResources.selected')} {selectedCount} {t('common.items')}
      </span>
      <Button
        size="small"
        danger
        icon={<DeleteOutlined />}
        onClick={onBatchDelete}
        disabled={selectedCount === 0}
      >
        {t('userResources.batchDelete')}
      </Button>
      <Button
        size="small"
        danger
        icon={<DeleteOutlined />}
        onClick={onDeleteCurrentPage}
        disabled={currentPageCount === 0}
      >
        {t('userResources.deleteCurrentPage')}
      </Button>
      <Button
        size="small"
        danger
        type="dashed"
        icon={<DeleteOutlined />}
        onClick={onDeleteAll}
        disabled={totalCount === 0}
      >
        {t('userResources.deleteAll')}（{totalCount}）
      </Button>
    </div>
  );
}