/**
 * PromptFormModal - 用户提示词创建/编辑弹窗
 *
 * 与公共提示词表单保持一致的 UI 框架：
 * - Modal + Form layout="vertical" + destroyOnHidden
 * - 字段子集：title, content, category, tags, images
 * - 支持多图上传，第一张为封面
 * - 管理员可为用户创建/编辑提示词
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, Form, Input, Select, Button, Upload, Image, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { apiPost, apiPatch, showApiError, apiFetch } from '@/services/api-client';
import { useAuthorizedImageUrl } from '@/pages/user-resources-utils';
import type { UploadFile } from 'antd/es/upload/interface';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

interface PromptImage {
  storageKey: string;
  width?: number;
  height?: number;
  alt?: string;
}

interface PromptFormModalProps {
  open: boolean;
  userId: string;
  editRecord: Record<string, unknown> | null;
  onClose: () => void;
  onSuccess: () => void;
}

/** 图片预览：私有资源通过 Authorization header 加载（blob URL），避免 JWT 进 URL query string */
function FormImagePreview({ storageKey }: { storageKey: string }) {
  const url = useAuthorizedImageUrl(storageKey, 'preview');
  return (
    <Image
      src={url}
      width={80}
      height={80}
      style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm, 4px)' }}
      fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAiIGhlaWdodD0iODAiIGZpbGw9IiNmMGYwZjAiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2JmYmZiZiIgZm9udC1zaXplPSIxMCI+SU1HPC90ZXh0Pjwvc3ZnPg=="
    />
  );
}

/** 上传图片到后端存储，返回 storageKey */
async function uploadImageFile(file: File): Promise<PromptImage> {
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

  return { storageKey: presign.storageKey, alt: file.name };
}

export default function PromptFormModal({
  open,
  userId,
  editRecord,
  onClose,
  onSuccess,
}: PromptFormModalProps) {
  const { t } = useTranslation();
  const CATEGORY_OPTIONS = [
    { label: t('publicPrompts.category.role'), value: 'role' },
    { label: t('publicPrompts.category.scene'), value: 'scene' },
    { label: t('publicPrompts.category.style'), value: 'style' },
    { label: t('publicPrompts.category.shot'), value: 'shot' },
    { label: t('publicPrompts.category.other'), value: 'other' },
  ];
  const [form] = Form.useForm();
  const isEdit = !!editRecord;

  // 图片上传状态
  const [imageList, setImageList] = useState<PromptImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadFileList = useRef<UploadFile[]>([]);

  useEffect(() => {
    if (open) {
      if (editRecord) {
        const imageKeys = (editRecord.imageKeys as string[]) || [];
        form.setFieldsValue({
          title: editRecord.title,
          content: editRecord.content,
          category: editRecord.category || 'other',
          tags: editRecord.tags || [],
        });
        if (imageKeys.length > 0) {
          setImageList(imageKeys.map((key) => ({ storageKey: key, alt: '' })));
          uploadFileList.current = imageKeys.map((_, i) => ({
            uid: `-${i}`,
            name: `image-${i}`,
            status: 'done' as const,
          }));
        } else {
          setImageList([]);
          uploadFileList.current = [];
        }
      } else {
        form.resetFields();
        form.setFieldsValue({ category: 'other' });
        setImageList([]);
        uploadFileList.current = [];
      }
    }
  }, [open, editRecord, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      // 将图片 storageKey 列表作为 imageKeys 传递
      const payload = { ...values, imageKeys: imageList.map((img) => img.storageKey) };
      if (isEdit) {
        await apiPatch(`/admin/prompts/${editRecord.id}`, payload);
        message.success(t('success.save'));
      } else {
        await apiPost(`/admin/prompts/user/${userId}`, payload);
        message.success(t('success.save'));
      }
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof Error && err.message?.includes('require')) return;
      showApiError(err, t('error.save'));
    }
  };

  // 图片上传
  const handleBeforeUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImageList((prev) => [...prev, { storageKey: dataUrl, alt: file.name }]);

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
          message.error(t('userResources.prompt.uploadFailed'));
        })
        .finally(() => {
          setUploading(false);
        });
    };
    reader.readAsDataURL(file);
    return false;
  };

  return (
    <Modal
      title={isEdit ? t('userResources.prompt.editTitle') : t('userResources.prompt.createTitle')}
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      destroyOnHidden
      width={680}
      okText={isEdit ? t('common.save') : t('userResources.prompt.create')}
      cancelText={t('common.cancel')}
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="title"
          label={t('userResources.prompt.title')}
          rules={[{ required: true, message: t('userResources.prompt.validation.titleRequired') }, { max: 100, message: t('userResources.prompt.validation.titleMax') }]}
        >
          <Input placeholder={t('userResources.prompt.titlePlaceholder')} maxLength={100} showCount />
        </Form.Item>
        <Form.Item
          name="content"
          label={t('userResources.prompt.content')}
          rules={[{ required: true, message: t('userResources.prompt.validation.contentRequired') }, { max: 7000, message: t('userResources.prompt.validation.contentMax') }]}
          >
          <Input.TextArea rows={6} placeholder={t('userResources.prompt.contentPlaceholder')} maxLength={7000} showCount />
        </Form.Item>

        {/* 图片上传区域 - 支持多图，第一张为封面 */}
        <Form.Item label={t('userResources.prompt.referenceImages')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {imageList.map((img, i) => (
              <div key={i} style={{ position: 'relative', width: 80, height: 80 }}>
                <FormImagePreview storageKey={img.storageKey} />
                {/* 封面标记 */}
                {i === 0 && (
                  <div style={{ position: 'absolute', top: 0, left: 0, background: '#f5222d', color: '#fff', fontSize: 10, padding: '1px 5px', borderRadius: '4px 0 4px 0', lineHeight: '16px' }}>
                    {t('userResources.prompt.cover')}
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
                      title={t('userResources.prompt.setCover')}
                    >
                      {t('userResources.prompt.cover')}
                    </Button>
                  )}
                  <Button
                    type="link"
                    size="small"
                    style={{ color: '#fff', fontSize: 10, padding: '0 3px', minWidth: 0, height: 18, lineHeight: '18px', marginLeft: 'auto' }}
                    onClick={() => {
                      setImageList((prev) => prev.filter((_, idx) => idx !== i));
                    }}
                    title={t('common.delete')}
                  >
                    {t('common.delete')}
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
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary, #595959)' }}>{t('userResources.prompt.uploadImage')}</span>
              </Button>
            </Upload>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #595959)' }}>{t('userResources.prompt.imageHint')}</div>
        </Form.Item>

        <Form.Item
          name="category"
          label={t('userResources.prompt.category')}
          rules={[{ required: true, message: t('userResources.prompt.validation.categoryRequired') }]}
        >
          <Select options={CATEGORY_OPTIONS} placeholder={t('userResources.prompt.categoryPlaceholder')} />
        </Form.Item>
        <Form.Item name="tags" label={t('userResources.prompt.tags')} extra={t('userResources.prompt.tagsExtra')}>
          <Select mode="tags" placeholder={t('userResources.prompt.tagsPlaceholder')} maxTagCount={8} maxTagTextLength={20} tokenSeparators={[',']} />
        </Form.Item>
      </Form>
    </Modal>
  );
}