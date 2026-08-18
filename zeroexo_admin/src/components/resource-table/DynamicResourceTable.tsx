/**
 * DynamicResourceTable — 配置驱动的通用资源表格组件
 *
 * 由后端 resource-classification.config.ts 驱动，所有渲染行为（列、筛选、空状态）
 * 均根据配置动态生成，消除前端硬编码。
 *
 * 使用方式：
 * ```tsx
 * <DynamicResourceTable
 *   categoryKey="material"
 *   userId="xxx"
 *   onDeleteRecord={(record) => handleDelete(record)}
 * />
 * ```
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Table, Image, Tag, Button, Modal, Space, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { DeleteOutlined, EyeOutlined, PlayCircleOutlined, EllipsisOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { apiGet, showApiError } from '@/services/api-client';
import {
  fetchClassificationConfig,
  ResourceCategory,
  ResourceColumn,
} from '@/services/resource-config';
import {
  KIND_LABELS,
  useAuthorizedImageUrl,
} from '@/pages/user-resources-utils';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';

interface DynamicResourceTableProps {
  /** 分类标识（material / ai-generation / project / prompt） */
  categoryKey: string;
  /** 用户 ID */
  userId: string;
  /** 删除单个记录的回调 */
  onDeleteRecord?: (record: Record<string, unknown>) => void;
  /** 查看元数据详情回调（AI 生成资源传入此回调时，操作栏会显示"元数据"按钮） */
  onViewMetadata?: (record: Record<string, unknown>) => void;
  /** 查看立项引导详情回调（创作项目传入此回调时，操作栏会显示"立项详情"按钮） */
  onViewSetupBrief?: (record: Record<string, unknown>) => void;
  /** 查看画布结构回调（画布项目传入此回调时，操作栏会显示"查看结构"按钮） */
  onViewGraph?: (record: Record<string, unknown>) => void;
  /** 查看详情回调（通用，显示"详情"按钮） */
  onViewDetail?: (record: Record<string, unknown>) => void;
  /** 额外的 filter 参数（如 type=canvas/creation） */
  extraFilter?: Record<string, string>;
  /** 总数变化回调 */
  onTotalChange?: (total: number) => void;
  /** 行选择模式 */
  rowSelection?: {
    selectedRowKeys: React.Key[];
    onChange: (keys: React.Key[]) => void;
  };
  /** 刷新触发器（值变化时重新加载数据） */
  refreshKey?: number;
}

/** 统一的 API 响应结构 */
interface ListResponse {
  items: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 图片单元格：私有资源通过 Authorization header 加载（blob URL），
 * 避免把 JWT 拼入 URL query string；公开资源直接使用原 URL。
 */
function AuthorizedImageCell({
  storageKey,
  width,
  height,
  style,
  fallback,
}: {
  storageKey: string;
  width: number;
  height: number;
  style?: React.CSSProperties;
  fallback: string;
}) {
  const thumbUrl = useAuthorizedImageUrl(storageKey, 'thumb');
  const fullUrl = useAuthorizedImageUrl(storageKey, 'full');
  return (
    <Image
      src={thumbUrl}
      width={width}
      height={height}
      style={style}
      preview={{ src: fullUrl }}
      fallback={fallback}
    />
  );
}

/** 视频单元格：缩略图走 Authorization header 加载，点击打开全量预览（blob URL） */
function AuthorizedVideoCell({
  storageKey,
  onPreview,
}: {
  storageKey: string;
  onPreview: (url: string) => void;
}) {
  const thumbUrl = useAuthorizedImageUrl(storageKey, 'thumb');
  const fullUrl = useAuthorizedImageUrl(storageKey, 'full');
  return (
    <video
      src={thumbUrl}
      width={60}
      height={60}
      style={{ objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }}
      preload="metadata"
      onClick={() => {
        if (fullUrl) onPreview(fullUrl);
      }}
    />
  );
}

export default function DynamicResourceTable({
  categoryKey,
  userId,
  onDeleteRecord,
  onViewMetadata,
  onViewSetupBrief,
  onViewGraph,
  onViewDetail,
  extraFilter,
  rowSelection,
  onTotalChange,
  refreshKey,
}: DynamicResourceTableProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<ResourceCategory | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  // 保留内部 filter 合并能力（筛选值统一由页面级工具栏通过 extraFilter 传入）
  const [filters] = useState<Record<string, string>>({});
  // 视频预览弹窗
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const initialLoadDone = useRef(false);
  // 请求序号：用于丢弃过期响应，避免快速切换筛选/翻页时旧数据覆盖新数据
  const loadSeqRef = useRef(0);

  // 加载配置
  useEffect(() => {
    fetchClassificationConfig().then((config) => {
      const cat = config.categories.find((c) => c.key === categoryKey);
      if (cat) setCategory(cat);
    });
  }, [categoryKey]);

  // 加载数据
  const loadData = useCallback(
    async (p: number, filterOverrides?: Record<string, string>) => {
      if (!userId) return;
      const seq = ++loadSeqRef.current;
      setLoading(true);
      try {
        const mergedFilters = { ...filters, ...filterOverrides, ...extraFilter };
        const params = new URLSearchParams({
          userId,
          category: categoryKey,
          page: String(p),
          pageSize: String(pageSize),
        });
        for (const [key, value] of Object.entries(mergedFilters)) {
          if (value) params.set(key, value);
        }

        const result = await apiGet<ListResponse>(
          `/admin/resources/list?${params.toString()}`,
        );
        // 过期响应（已有更新的请求发出）直接丢弃
        if (seq !== loadSeqRef.current) return;
        setData(result.items || []);
        const totalVal = result.total || 0;
        setTotal(totalVal);
        setPage(p);
        if (onTotalChange) onTotalChange(totalVal);
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        showApiError(err, t('error.load'));
      } finally {
        if (seq === loadSeqRef.current) setLoading(false);
      }
    },
    [userId, categoryKey, filters, extraFilter, onTotalChange],
  );

  // 首次加载
  useEffect(() => {
    if (userId && categoryKey && !initialLoadDone.current) {
      initialLoadDone.current = true;
      loadData(1);
    }
  }, [userId, categoryKey, loadData]);

  // 重新加载（当 filters/extraFilter 变化时）
  useEffect(() => {
    if (initialLoadDone.current) {
      loadData(1);
    }
  }, [filters, extraFilter]);

  // 重新加载（当 refreshKey 变化时）
  useEffect(() => {
    if (refreshKey !== undefined && initialLoadDone.current) {
      loadData(1);
    }
  }, [refreshKey]);

  // ==================== 列渲染 ====================

  const renderCell = useCallback(
    (col: ResourceColumn, record: Record<string, unknown>) => {
      const value = record[col.key];

      switch (col.render) {
        case 'image':
          // 处理 prompt 的 imageKeys 数组
          if (record.imageKeys && Array.isArray(record.imageKeys) && record.imageKeys.length > 0) {
            const keys = record.imageKeys as string[];
            return (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <AuthorizedImageCell
                  storageKey={keys[0]}
                  width={48}
                  height={48}
                  style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm, 4px)' }}
                  fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIGZpbGw9IiNmNWY1ZjUiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzhjOGM4YyIgZm9udC1zaXplPSI4Ij7lm77niYc8L3RleHQ+PC9zdmc+"
                />
                {keys.length > 1 && (
                  <div style={{ position: 'absolute', bottom: 0, right: 0, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 9, padding: '0 4px', borderRadius: '4px 0 4px 0', lineHeight: '14px' }}>
                    +{keys.length - 1}
                  </div>
                )}
              </div>
            );
          }
          // 处理普通素材的 storageKey
          if (record.kind === 'image' && record.storageKey) {
            return (
              <AuthorizedImageCell
                storageKey={record.storageKey as string}
                width={60}
                height={60}
                style={{ objectFit: 'cover', borderRadius: 4 }}
                fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIGZpbGw9IiNmNWY1ZjUiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzhjOGM4YyIgZm9udC1zaXplPSIxMCI+5Zu+54mHPC90ZXh0Pjwvc3ZnPg=="
              />
            );
          }
          if (record.kind === 'video')
            return (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <AuthorizedVideoCell
                  storageKey={record.storageKey as string}
                  onPreview={(url) => setVideoPreviewUrl(url)}
                />
                <PlayCircleOutlined
                  style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: 20, color: '#fff', opacity: 0.8, pointerEvents: 'none' }}
                />
              </div>
            );
          if (record.kind === 'audio')
            return <Tag color="green">{t('userResources.type.audio')}</Tag>;
          return <span style={{ color: '#8b949e' }}>-</span>;

        case 'tag':
          if (col.key === 'type') {
            // 项目类型
            return value === 'canvas' ? (
              <Tag color="blue">{t('userResources.projectType.canvas')}</Tag>
            ) : value === 'creation' ? (
              <Tag color="green">{t('userResources.projectType.creation')}</Tag>
            ) : (
              <Tag>{String(value || '-')}</Tag>
            );
          }
          if (col.key === 'status') {
            const statusMap: Record<string, { color: string; labelKey: string }> = {
              success: { color: 'success', labelKey: 'userResources.status.success' },
              failed: { color: 'error', labelKey: 'userResources.status.failed' },
              pending: { color: 'warning', labelKey: 'userResources.status.pending' },
              running: { color: 'processing', labelKey: 'userResources.status.running' },
              cancelled: { color: 'default', labelKey: 'userResources.status.cancelled' },
              draft: { color: 'default', labelKey: 'userResources.status.draft' },
              in_progress: { color: 'processing', labelKey: 'userResources.status.inProgress' },
              completed: { color: 'success', labelKey: 'userResources.status.completed' },
            };
            const s = statusMap[String(value)] || {
              color: 'default',
              labelKey: undefined,
            };
            return <Tag color={s.color}>{s.labelKey ? t(s.labelKey) : String(value || '-')}</Tag>;
          }
          // kind 类型
          return (
            <Tag>
              {t(
                KIND_LABELS[String(value)] ||
                  (value as string) ||
                  '-',
              )}
            </Tag>
          );

        case 'source-tag':
          if (value === '后台管理测试')
            return <Tag color="purple">{t('userResources.source.adminTest')}</Tag>;
          if (value === 'AI 生成')
            return <Tag color="blue">{t('userResources.source.aiGenerated')}</Tag>;
          return <Tag>{String(value || '-')}</Tag>;

        case 'date':
          return value
            ? new Date(value as string).toLocaleString()
            : <span style={{ color: '#8b949e' }}>-</span>;

        case 'actions': {
          const menuItems: MenuProps['items'] = [];
          if (onViewDetail) {
            menuItems.push({ key: 'detail', icon: <EyeOutlined />, label: t('userResources.action.detail') });
          }
          if (onViewGraph && record.type === 'canvas') {
            menuItems.push({ key: 'graph', icon: <EyeOutlined />, label: t('userResources.action.viewStructure') });
          }
          if (onViewMetadata) {
            menuItems.push({ key: 'metadata', icon: <EyeOutlined />, label: t('userResources.action.metadata') });
          }
          if (onViewSetupBrief && record.type === 'creation') {
            menuItems.push({ key: 'brief', icon: <EyeOutlined />, label: t('userResources.action.projectDetail') });
          }
          if (onDeleteRecord) {
            if (menuItems.length > 0) {
              menuItems.push({ type: 'divider' });
            }
            menuItems.push({ key: 'delete', icon: <DeleteOutlined />, label: t('userResources.action.delete'), danger: true });
          }
          return (
            <div className="row-actions">
              <Dropdown
                trigger={['click']}
                menu={{
                  items: menuItems,
                  onClick: ({ key }) => {
                    switch (key) {
                      case 'detail': onViewDetail?.(record); break;
                      case 'graph': onViewGraph?.(record); break;
                      case 'metadata': onViewMetadata?.(record); break;
                      case 'brief': onViewSetupBrief?.(record); break;
                      case 'delete': onDeleteRecord?.(record); break;
                    }
                  },
                }}
              >
                <Button
                  type="primary"
                  icon={<EllipsisOutlined />}
                  disabled={menuItems.length === 0}
                  style={{ width: 32, height: 32, padding: 0 }}
                />
              </Dropdown>
            </div>
          );
        }

        case 'tags': {
          // 统一处理：无论是数组还是逗号分隔的字符串，都转为数组
          let tags: string[] = [];
          if (Array.isArray(value)) {
            tags = value as string[];
          } else if (typeof value === 'string' && value) {
            tags = value.split(',').map((s) => s.trim()).filter(Boolean);
          } else if (value) {
            tags = [String(value)];
          }
          
          if (tags.length === 0) {
            return '-';
          }
          
          const tagStyle: React.CSSProperties = { margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' };
          
          return (
            <Space size={[4, 4]} wrap>
              {tags.slice(0, 4).map((t) => (
                <Tag key={t} style={tagStyle}>{t}</Tag>
              ))}
              {tags.length > 4 && (
                <Tag color="default" style={tagStyle}>+{tags.length - 4}</Tag>
              )}
            </Space>
          );
        }

        case 'text':
        default:
          return String(value ?? '-');
      }
    },
    [t, onDeleteRecord, onViewMetadata, onViewSetupBrief, onViewGraph, onViewDetail],
  );

  // ==================== 构建 Ant Design columns ====================

  const antColumns: ColumnsType<Record<string, unknown>> = (
    category?.columns || []
  )
    .filter((col) => !col.hidden)
    .map((col) => {
      const isActions = col.render === 'actions';
      return {
        title: col.title,
        dataIndex: col.key,
        key: col.key,
        width: col.width,
        ellipsis: true,
        ...(isActions ? { fixed: 'right' as const } : {
          sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => {
            const va = a[col.key];
            const vb = b[col.key];
            if (typeof va === 'number' && typeof vb === 'number') return va - vb;
            if (va instanceof Date && vb instanceof Date) return va.getTime() - vb.getTime();
            return String(va ?? '').localeCompare(String(vb ?? ''), 'zh-Hans-CN');
          },
        }),
        render: (_: unknown, record: Record<string, unknown>) =>
          renderCell(col, record),
      };
    });

  // ==================== 渲染 ====================

  const pagination: TablePaginationConfig = {
    current: page,
    total,
    pageSize,
    showSizeChanger: true,
    onChange: (p) => loadData(p),
    showTotal: (totalItems, range) =>
      `${range[0]}-${range[1]} / ${t('common.total')} ${totalItems} ${t('common.items')}`,
    placement: ['bottomEnd'],
  };

  return (
    <>
      <Table<Record<string, unknown>>
        className="resource-table"
        rowKey="id"
        columns={antColumns}
        dataSource={data}
        loading={loading}
        size="small"
        bordered
        sticky
        scroll={{ x: 'max-content' }}
        rowSelection={
          rowSelection
            ? {
                selectedRowKeys: rowSelection.selectedRowKeys,
                onChange: rowSelection.onChange,
              }
            : undefined
        }
        pagination={pagination}
        locale={{ emptyText: category?.display.emptyText || t('userResources.empty.text') }}
      />
      {/* 视频预览弹窗 */}
      <Modal
        title={t('userResources.videoPreview')}
        open={!!videoPreviewUrl}
        onCancel={() => setVideoPreviewUrl(null)}
        footer={null}
        width={800}
        centered
        destroyOnHidden
      >
        {videoPreviewUrl && (
          <video controls autoPlay style={{ width: '100%', maxHeight: '70vh' }}>
            <source src={videoPreviewUrl} />
          </video>
        )}
      </Modal>
    </>
  );
}
