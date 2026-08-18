import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Space,
  message,
  Upload,
  Image,
  Dropdown,
  Tabs,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined,
  ReloadOutlined, EyeOutlined, UploadOutlined, EllipsisOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import { apiGet, apiPost, apiPatch, apiDelete, apiFetch, showApiError } from '@/services/api-client';
import { useTranslation } from 'react-i18next';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';
import BatchDeleteToolbar from '@/components/user-resources/BatchDeleteToolbar';
import { useAuthorizedImageUrl } from '@/pages/user-resources-utils';
import type { ColumnsType } from 'antd/es/table';
import type { ItemType } from 'antd/es/menu/interface';
import type { UploadFile } from 'antd/es/upload/interface';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

interface PromptImage {
  storageKey: string;
  width?: number;
  height?: number;
  alt?: string;
}

interface PublicPrompt {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  source: string;
  sourceId?: string;
  clusterName?: string;
  images?: PromptImage[];
  demoTitles?: Record<string, string>;
  sourceName?: string;
  sourceUrl?: string;
  license?: string;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  items: PublicPrompt[];
  total: number;
  page: number;
  limit: number;
}

const LICENSE_OPTIONS = [
  { label: 'CC0', value: 'CC0' },
  { label: 'CC BY 4.0', value: 'CC BY 4.0' },
  { label: 'MIT', value: 'MIT' },
];

/**
 * 公共提示词图片：私有资源通过 Authorization header 加载（blob URL），
 * 避免把 JWT 拼入 URL query string；公开资源直接使用原 URL。
 */
function PromptImage({
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
  const displayUrl = useAuthorizedImageUrl(storageKey, 'preview');
  const fullUrl = useAuthorizedImageUrl(storageKey, 'full');
  return (
    <Image
      src={displayUrl}
      width={width}
      height={height}
      style={style}
      preview={{ src: fullUrl }}
      fallback={fallback}
    />
  );
}

/** 上传图片到后端存储，返回 storageKey */
async function uploadImageFile(file: File): Promise<PromptImage> {
  // 1. 获取预签名 URL
  const presign = await apiFetch<{ uploadUrl: string | null; storageKey: string }>(
    `/admin/resources/user/${SYSTEM_USER_ID}/presign`,
    {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || 'image/png',
        size: file.size,
        scope: 'public',
      }),
    },
  );

  // 2. 上传文件内容
  if (presign.uploadUrl) {
    const uploadRes = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'image/png' },
      body: file,
    });
    if (!uploadRes.ok) {
      throw new Error('文件上传失败');
    }
  }

  // 3. 读取图片尺寸
  const meta = await readImageMeta(file);

  return {
    storageKey: presign.storageKey,
    width: meta.width,
    height: meta.height,
    alt: file.name,
  };
}

/** 从 File 读取图片宽高 */
function readImageMeta(file: File): Promise<{ width: number; height: number }> {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = document.createElement('img');
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('读取图片信息失败'));
    };
    img.src = url;
  });
}

export default function PublicPrompts() {
  const { t } = useTranslation();
  const CATEGORY_OPTIONS = [
    { label: t('publicPrompts.category.role'), value: 'role' },
    { label: t('publicPrompts.category.scene'), value: 'scene' },
    { label: t('publicPrompts.category.style'), value: 'style' },
    { label: t('publicPrompts.category.shot'), value: 'shot' },
    { label: t('publicPrompts.category.other'), value: 'other' },
  ];
  const SOURCE_OPTIONS = [
    { label: t('publicPrompts.source.manual'), value: 'manual' },
    { label: t('publicPrompts.source.imagePromptLibrary'), value: 'image-prompt-library' },
  ];
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PublicPrompt[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<string | undefined>();

  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal] = useState<PublicPrompt | null>(null);
  const [detailModal, setDetailModal] = useState<PublicPrompt | null>(null);
  const [form] = Form.useForm();
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 图片上传状态（创建/编辑共用）
  const [imageList, setImageList] = useState<PromptImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadFileList = useRef<UploadFile[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      if (keyword) params.set('keyword', keyword);
      if (category) params.set('category', category);
      const result = await apiGet<ListResponse>(`/admin/public-prompts?${params.toString()}`);
      setData(result.items);
      setTotal(result.total);
    } catch (err) {
      message.error(t('publicPrompts.load.failed'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, category]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const payload = { ...values, images: imageList };
      await apiPost('/admin/public-prompts', payload);
      message.success(t('publicPrompts.create.success'));
      setCreateModal(false);
      form.resetFields();
      setImageList([]);
      uploadFileList.current = [];
      fetchData();
    } catch (err) {
      message.error(t('publicPrompts.create.failed'));
    }
  };

  const handleUpdate = async () => {
    if (!editModal) return;
    try {
      const values = await form.validateFields();
      const payload = { ...values, images: imageList };
      await apiPatch(`/admin/public-prompts/${editModal.id}`, payload);
      message.success(t('publicPrompts.update.success'));
      setEditModal(null);
      form.resetFields();
      setImageList([]);
      uploadFileList.current = [];
      fetchData();
    } catch (err) {
      message.error(t('publicPrompts.update.failed'));
    }
  };

  const handleDelete = async (id: string) => {
    Modal.confirm({
      title: t('publicPrompts.delete.confirm'),
      content: t('publicPrompts.delete.content'),
      centered: true,
      okType: 'danger',
      okText: t('publicPrompts.delete.confirmText'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await apiDelete(`/admin/public-prompts/${id}`);
          message.success(t('publicPrompts.delete.success'));
          fetchData();
        } catch (err) {
          message.error(t('publicPrompts.delete.failed'));
        }
      },
    });
  };

  // ==================== 批量操作（同用户资源页编辑模式） ====================

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) { message.warning(t('publicPrompts.batch.deleteWarning')); return; }
    Modal.confirm({
      title: t('publicPrompts.batch.deleteConfirm'),
      centered: true,
      okType: 'danger',
      okText: t('publicPrompts.delete.confirmText'),
      cancelText: t('common.cancel'),
      content: t('publicPrompts.batch.deleteContent', { count: selectedRowKeys.length }),
      onOk: async () => {
        try {
          const res = await apiPost<{ deletedCount: number }>('/admin/public-prompts/batch-delete', { ids: selectedRowKeys });
          message.success(t('publicPrompts.batch.deleteSuccess', { count: res.deletedCount || selectedRowKeys.length }));
          setSelectedRowKeys([]);
          fetchData();
        } catch (err) {
          showApiError(err, t('publicPrompts.batch.deleteFailed'));
        }
      },
    });
  };

  const handleDeleteCurrentPage = () => {
    Modal.confirm({
      title: t('publicPrompts.batch.deleteCurrentPage'),
      centered: true,
      okType: 'danger',
      okText: t('publicPrompts.delete.confirmText'),
      cancelText: t('common.cancel'),
      content: t('publicPrompts.batch.deleteCurrentPageContent'),
      onOk: async () => {
        try {
          const ids = data.map((d) => d.id);
          const res = await apiPost<{ deletedCount: number }>('/admin/public-prompts/batch-delete', { ids });
          message.success(t('publicPrompts.batch.deleteSuccess', { count: res.deletedCount || ids.length }));
          setSelectedRowKeys([]);
          fetchData();
        } catch (err) {
          showApiError(err, t('publicPrompts.delete.failed'));
        }
      },
    });
  };

  const handleDeleteAll = () => {
    Modal.confirm({
      title: t('publicPrompts.batch.deleteAll'),
      centered: true,
      okType: 'danger',
      okText: t('publicPrompts.delete.confirmText'),
      cancelText: t('common.cancel'),
      content: (
        <div>
          <p style={{ color: 'var(--color-error, #ff4d4f)' }}><strong>{t('publicPrompts.batch.deleteAllDanger')}</strong>{t('publicPrompts.batch.deleteAllDangerDesc', { total })}</p>
          <p>{t('publicPrompts.batch.deleteAllContent')}</p>
        </div>
      ),
      onOk: async () => {
        try {
          const res = await apiPost<{ deletedCount: number }>('/admin/public-prompts/clear', {});
          message.success(t('publicPrompts.batch.clearSuccess', { count: res.deletedCount || 0 }));
          setSelectedRowKeys([]);
          setPage(1);
          fetchData();
        } catch (err) {
          showApiError(err, t('publicPrompts.batch.clearFailed'));
        }
      },
    });
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

  // 创建弹窗打开时初始化表单默认值
  useEffect(() => {
    if (createModal) {
      form.resetFields();
      form.setFieldsValue({ category: 'style', source: 'manual' });
    }
  }, [createModal]);

  // 编辑弹窗打开时设置表单值
  useEffect(() => {
    if (editModal) {
      form.setFieldsValue({
        title: editModal.title,
        content: editModal.content,
        category: editModal.category,
        tags: editModal.tags,
        source: editModal.source,
        sourceId: editModal.sourceId,
        clusterName: editModal.clusterName,
        sourceName: editModal.sourceName,
        sourceUrl: editModal.sourceUrl,
        license: editModal.license,
      });
    }
  }, [editModal]);

  const openCreate = () => {
    setImageList([]);
    uploadFileList.current = [];
    setCreateModal(true);
  };

  const openEdit = (record: PublicPrompt) => {
    setImageList(record.images || []);
    uploadFileList.current = (record.images || []).map((img, i) => ({
      uid: `-${i}`,
      name: img.alt || `image-${i}`,
      status: 'done' as const,
    }));
    setEditModal(record);
  };

  const openDetail = async (record: PublicPrompt) => {
    try {
      const detail = await apiGet<PublicPrompt>(`/admin/public-prompts/${record.id}`);
      setDetailModal(detail);
    } catch (err) {
      message.error(t('publicPrompts.detail.loadFailed'));
    }
  };

  // 图片上传 — 使用 FileReader 读为 data URL 即时预览，后台异步上传到云存储
  const handleBeforeUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImageList((prev) => [...prev, { storageKey: dataUrl, alt: file.name }]);

      // 后台异步上传到云存储
      setUploading(true);
      uploadImageFile(file)
        .then((result) => {
          setImageList((prev) =>
            prev.map((item) =>
              item.storageKey === dataUrl ? { ...result, alt: result.alt || file.name } : item
            )
          );
        })
        .catch(() => {
          // 上传失败时保留本地预览
          message.error(t('publicPrompts.upload.failed'));
        })
        .finally(() => {
          setUploading(false);
        });
    };
    reader.readAsDataURL(file);
    return false; // 阻止 Upload 默认上传行为
  };

  // 移除图片（使用 Upload 组件的 onRemove 回调，无需额外处理）

  const columns: ColumnsType<PublicPrompt> = [
    {
      title: t('publicPrompts.column.image'),
      dataIndex: 'images',
      key: 'images',
      width: 80,
      render: (images: PromptImage[]) => {
        if (!images || images.length === 0) return '-';
        return (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <PromptImage
              storageKey={images[0].storageKey}
              width={48}
              height={48}
              style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm, 4px)' }}
              fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIGZpbGw9IiNmMGYwZjAiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2JmYmZiZiIgZm9udC1zaXplPSI4Ij5JTUc8L3RleHQ+PC9zdmc+"
            />
            {images.length > 1 && (
              <div style={{ position: 'absolute', bottom: 0, right: 0, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 9, padding: '0 4px', borderRadius: '4px 0 4px 0', lineHeight: '14px' }}>
                +{images.length - 1}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: t('publicPrompts.column.title'),
      dataIndex: 'title',
      key: 'title',
      width: 160,
      ellipsis: true,
      sorter: (a, b) => a.title.localeCompare(b.title),
      render: (v, r) => (
        <a onClick={() => openDetail(r)}>{v}</a>
      ),
    },
    {
      title: t('publicPrompts.column.content'),
      dataIndex: 'content',
      key: 'content',
      width: 200,
      ellipsis: true,
      sorter: (a, b) => (a.content || '').localeCompare(b.content || ''),
      render: (v: string) => <span style={{ color: 'var(--color-text-secondary, #666)' }}>{v}</span>,
    },
    {
      title: t('publicPrompts.column.category'),
      dataIndex: 'category',
      key: 'category',
      width: 80,
      sorter: (a, b) => (a.category || '').localeCompare(b.category || ''),
      render: (v: string) => {
        const opt = CATEGORY_OPTIONS.find((o) => o.value === v);
        return <Tag color="blue" style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{opt?.label || v}</Tag>;
      },
    },
    {
      title: t('publicPrompts.column.tags'),
      dataIndex: 'tags',
      key: 'tags',
      width: 120,
      ellipsis: true,
      render: (tags: string[]) => {
        const tagStyle: React.CSSProperties = { margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' };
        return (
          <Space size={[4, 4]} wrap>
            {(tags || []).slice(0, 4).map((t) => (
              <Tag key={t} style={tagStyle}>{t}</Tag>
            ))}
            {(tags?.length || 0) > 4 && (
              <Tag color="default" style={tagStyle}>+{tags.length - 4}</Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: t('publicPrompts.column.actions'),
      key: 'actions',
      width: 48,
      fixed: 'right',
      render: (_, r) => {
        const items: ItemType[] = [
          {
            key: 'detail',
            label: t('publicPrompts.action.detail'),
            icon: <EyeOutlined />,
          },
          {
            key: 'edit',
            label: t('publicPrompts.action.edit'),
            icon: <EditOutlined />,
          },
          { type: 'divider' },
          {
            key: 'delete',
            label: t('publicPrompts.action.delete'),
            icon: <DeleteOutlined />,
            danger: true,
          },
        ];
        return (
          <div className="row-actions">
            <Dropdown
              menu={{
                items,
                onClick: ({ key }) => {
                  if (key === 'detail') openDetail(r);
                  if (key === 'edit') openEdit(r);
                  if (key === 'delete') handleDelete(r.id);
                },
              }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Button
                type="primary"
                icon={<EllipsisOutlined />}
                style={{ width: 32, height: 32, padding: 0 }}
              />
            </Dropdown>
          </div>
        );
      },
    },
  ];

  const renderFormFields = () => (
    <>
      <Form.Item name="title" label={t('publicPrompts.form.title')} rules={[{ required: true, message: t('publicPrompts.form.titleRequired') }, { max: 100, message: t('publicPrompts.form.titleMax') }]}>
        <Input placeholder={t('publicPrompts.form.placeholder.title')} maxLength={100} showCount />
      </Form.Item>
      <Form.Item name="content" label={t('publicPrompts.form.content')} rules={[{ required: true, message: t('publicPrompts.form.contentRequired') }, { max: 7000, message: t('publicPrompts.form.contentMax') }]}>
        <Input.TextArea rows={6} placeholder={t('publicPrompts.form.placeholder.content')} maxLength={7000} showCount />
      </Form.Item>

      {/* 图片上传区域 - 支持多图，第一张为封面 */}
      <Form.Item label={t('publicPrompts.form.referenceImages')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {imageList.map((img, i) => (
            <div key={i} style={{ position: 'relative', width: 80, height: 80 }}>
              <PromptImage
                storageKey={img.storageKey}
                width={80}
                height={80}
                style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm, 4px)' }}
                fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAiIGhlaWdodD0iODAiIGZpbGw9IiNmMGYwZjAiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2JmYmZiZiIgZm9udC1zaXplPSIxMCI+SU1HPC90ZXh0Pjwvc3ZnPg=="
              />
              {/* 封面标记 */}
              {i === 0 && (
                <div style={{ position: 'absolute', top: 0, left: 0, background: '#f5222d', color: '#fff', fontSize: 10, padding: '1px 5px', borderRadius: '4px 0 4px 0', lineHeight: '16px' }}>
                  {t('publicPrompts.cover')}
                </div>
              )}
              {/* 操作按钮组 */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', gap: 2, padding: 2, background: 'rgba(0,0,0,0.45)', borderRadius: '0 0 4px 4px', opacity: 0, transition: 'opacity 0.2s' }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0' }}
              >
                {i !== 0 && (
                  <Button
                    type="link"
                    size="small"
                    style={{ color: '#fff', fontSize: 10, padding: '0 3px', minWidth: 0, height: 18, lineHeight: '18px' }}
                    onClick={() => {
                      setImageList((prev) => {
                        const next = [...prev];
                        const [item] = next.splice(i, 1);
                        next.unshift(item);
                        return next;
                      });
                    }}
                    title={t('publicPrompts.setCover')}
                  >
                    {t('publicPrompts.cover')}
                  </Button>
                )}
                <Button
                  type="link"
                  size="small"
                  style={{ color: '#fff', fontSize: 10, padding: '0 3px', minWidth: 0, height: 18, lineHeight: '18px', marginLeft: 'auto' }}
                  onClick={() => {
                    setImageList((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                  title={t('publicPrompts.action.delete')}
                >
                  {t('publicPrompts.action.delete')}
                </Button>
              </div>
            </div>
          ))}
          <Upload
            beforeUpload={handleBeforeUpload}
            showUploadList={false}
            accept="image/*"
            disabled={uploading}
          >
            <Button
              icon={<UploadOutlined />}
              loading={uploading}
              style={{ width: 80, height: 80, border: '1px dashed var(--color-border-secondary, #e8e8e8)', borderRadius: 'var(--radius-sm, 4px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'var(--color-bg-elevated, #fafafa)', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary, #595959)' }}>{t('publicPrompts.form.uploadImage')}</span>
            </Button>
          </Upload>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #595959)' }}>{t('publicPrompts.form.uploadHint')}</div>
      </Form.Item>

      <Form.Item name="category" label={t('publicPrompts.form.category')} rules={[{ required: true, message: t('publicPrompts.form.categoryRequired') }]}>
        <Select options={CATEGORY_OPTIONS} placeholder={t('publicPrompts.form.categoryPlaceholder')} />
      </Form.Item>
      <Form.Item name="tags" label={t('publicPrompts.form.tags')} extra={t('publicPrompts.form.tagsExtra')}>
        <Select mode="tags" placeholder={t('publicPrompts.form.tagsPlaceholder')} maxTagCount={8} maxTagTextLength={20} tokenSeparators={[',']} />
      </Form.Item>
      <Form.Item name="source" label={t('publicPrompts.form.source')}>
        <Select options={SOURCE_OPTIONS} placeholder={t('publicPrompts.form.sourcePlaceholder')} />
      </Form.Item>
      <Form.Item name="sourceName" label={t('publicPrompts.form.sourceName')} rules={[{ max: 100, message: t('publicPrompts.form.sourceNameMax') }]}>
        <Input placeholder={t('publicPrompts.form.sourceNamePlaceholder')} maxLength={100} showCount />
      </Form.Item>
      <Form.Item name="sourceUrl" label={t('publicPrompts.form.sourceUrl')} rules={[{ max: 500, message: t('publicPrompts.form.sourceUrlMax') }]}>
        <Input placeholder={t('publicPrompts.placeholder.sourceUrl')} maxLength={500} />
      </Form.Item>
      <Form.Item name="license" label={t('publicPrompts.form.license')}>
        <Select options={LICENSE_OPTIONS} placeholder={t('publicPrompts.form.licensePlaceholder')} allowClear />
      </Form.Item>
    </>
  );

  return (
    <BreadcrumbLayout
      items={[{ title: t('nav.siteOperations') }, { title: t('nav.publicAssets') }]}
      toolbar={
        <>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary, #595959)', marginRight: 12 }}>
            {t('common.total')} {total} {t('common.items')}
          </span>
          <Button icon={<ReloadOutlined />} onClick={fetchData}>
            {t('common.refresh')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t('publicPrompts.create.title')}
          </Button>
        </>
      }
    >
      {/* 素材类型 Tab（当前仅「提示词」，后续素材类型在此扩展） */}
      <Tabs
        style={{ marginBottom: 0 }}
        items={[
          {
            key: 'prompt',
            label: (
              <span>
                <BulbOutlined style={{ marginRight: 4, verticalAlign: -2 }} />
                {t('publicPrompts.tab.prompt')}
              </span>
            ),
          },
        ]}
      />

      <div style={{ marginTop: 12, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Input
          placeholder={t('publicPrompts.search.placeholder')}
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 240 }}
          allowClear
        />
        <Select
          placeholder={t('publicPrompts.filter.category')}
          allowClear
          style={{ width: 140 }}
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(v) => { setCategory(v); setPage(1); }}
        />
        <Button onClick={() => { setKeyword(''); setCategory(undefined); setPage(1); }}>
          {t('common.clear')}
        </Button>
      </div>

      {/* 批量操作（同用户资源页编辑模式） */}
      <BatchDeleteToolbar
        selectedCount={selectedRowKeys.length}
        totalCount={total}
        currentPageCount={data.length}
        onBatchDelete={handleBatchDelete}
        onDeleteCurrentPage={handleDeleteCurrentPage}
        onDeleteAll={handleDeleteAll}
      />

      <Table<PublicPrompt>
        className="media-table resource-table"
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        size="small"
        bordered
        sticky
        rowSelection={rowSelection}
        scroll={{ x: 1200 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (total) => `${t('common.total')} ${total} ${t('common.items')}`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />

      {/* 创建弹窗 */}
      <Modal
        title={t('publicPrompts.create.title')}
        open={createModal}
        onCancel={() => { setCreateModal(false); form.resetFields(); setImageList([]); uploadFileList.current = []; }}
        onOk={handleCreate}
        destroyOnHidden
        width={680}
        centered
      >
        <Form form={form} layout="vertical" preserve={false}>
          {renderFormFields()}
        </Form>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal
        title={t('publicPrompts.edit.title')}
        open={!!editModal}
        onCancel={() => { setEditModal(null); form.resetFields(); setImageList([]); uploadFileList.current = []; }}
        onOk={handleUpdate}
        destroyOnHidden
        width={680}
        centered
      >
        <Form form={form} layout="vertical" preserve={false}>
          {renderFormFields()}
        </Form>
      </Modal>

      {/* 详情弹窗 */}
      <Modal
        title={t('publicPrompts.detail.title')}
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={null}
        width={720}
        centered
      >
        {detailModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 图片展示 - 封面大图，其余缩略 */}
            {detailModal.images && detailModal.images.length > 0 && (
              <div>
                <div style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 12, marginBottom: 8 }}>{t('publicPrompts.detail.referenceImages')}</div>
                <Image.PreviewGroup>
                  {/* 封面图 - 大图展示 */}
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <PromptImage
                        storageKey={detailModal.images[0].storageKey}
                        width={320}
                        height={200}
                        style={{ objectFit: 'cover', borderRadius: 'var(--radius-md, 6px)', border: '1px solid var(--color-border, #f0f0f0)' }}
                        fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDMyMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNmMGYwZjAiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2JmYmZiZiIgZm9udC1zaXplPSIxNCI+SU1HPC90ZXh0Pjwvc3ZnPg=="
                      />
                      <div style={{ position: 'absolute', top: 6, left: 6, background: '#f5222d', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 4, lineHeight: '18px' }}>{t('publicPrompts.cover')}</div>
                    </div>
                  </div>
                  {/* 其余参考图 - 缩略排列 */}
                  {detailModal.images.length > 1 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {detailModal.images.slice(1).map((img, i) => (
                        <PromptImage
                          key={i}
                          storageKey={img.storageKey}
                          width={100}
                          height={100}
                          style={{ objectFit: 'cover', borderRadius: 'var(--radius-md, 6px)', border: '1px solid var(--color-border, #f0f0f0)' }}
                          fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNmMGYwZjAiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2JmYmZiZiIgZm9udC1zaXplPSIxMCI+SU1HPC90ZXh0Pjwvc3ZnPg=="
                        />
                      ))}
                    </div>
                  )}
                </Image.PreviewGroup>
              </div>
            )}
            <div>
              <div style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 12, marginBottom: 4 }}>{t('publicPrompts.detail.titleLabel')}</div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{detailModal.title}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color="blue" style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{CATEGORY_OPTIONS.find((o) => o.value === detailModal.category)?.label || detailModal.category}</Tag>
              {detailModal.tags?.map((t) => <Tag key={t} style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{t}</Tag>)}
              {detailModal.license && <Tag color="green" style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{detailModal.license}</Tag>}
            </div>
            <div>
              <div style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 12, marginBottom: 4 }}>{t('publicPrompts.detail.contentLabel')}</div>
              <pre style={{
                background: 'var(--color-bg-code, #f6f8fa)', borderRadius: 'var(--radius-md, 6px)', padding: 12,
                fontSize: 13, lineHeight: 1.5, maxHeight: 300, overflow: 'auto',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {detailModal.content}
              </pre>
            </div>
            {detailModal.sourceUrl && (
              <div>
                <div style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 12, marginBottom: 4 }}>{t('publicPrompts.detail.sourceUrlLabel')}</div>
                <a href={detailModal.sourceUrl} target="_blank" rel="noreferrer">{detailModal.sourceUrl}</a>
              </div>
            )}
            <div style={{ display: 'flex', gap: 24, fontSize: 12, color: 'var(--color-text-secondary, #595959)' }}>
              <span>{t('publicPrompts.detail.createdAt')}: {new Date(detailModal.createdAt).toLocaleString()}</span>
              <span>{t('publicPrompts.detail.updatedAt')}: {new Date(detailModal.updatedAt).toLocaleString()}</span>
            </div>
          </div>
        )}
      </Modal>
    </BreadcrumbLayout>
  );
}