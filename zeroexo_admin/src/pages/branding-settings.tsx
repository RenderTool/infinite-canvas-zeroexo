import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { color as themeColor } from '@/design-tokens';
import {
  Card,
  Button,
  message,
  Input,
  Switch,
  Progress,
  Upload,
  Modal,
  Typography,
  Space,
  Row,
  Col,
  Image,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  DragOutlined,
  LinkOutlined,
  ReloadOutlined,
  UploadOutlined,
  VideoCameraOutlined,
  PictureOutlined,
  CloseCircleOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import type { BrandingConfig, HeroVideoItem } from './branding-types';
import { DEFAULT_BRANDING_CONFIG } from './branding-types';
import {
  fetchBrandingConfig,
  saveBrandingConfig,
  uploadBrandingFile,
  deleteBrandingFile,
  handleBrandingError,
  formatFileSize,
} from './branding-service';

interface UploadingItem {
  uid: string;
  name: string;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  error?: string;
  file: File;
}

type UploadTarget = 'hero' | 'fallback';

const VIDEO_EXTS = ['.mp4', '.webm', '.ogg', '.mkv', '.mov'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.bmp'];

function getUrlExt(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url, window.location.origin);
    const key = u.searchParams.get('key') || '';
    if (key) {
      const parts = key.split('.');
      return parts.length > 1 ? '.' + parts.pop()!.toLowerCase() : '';
    }
    const pathParts = u.pathname.split('.');
    return pathParts.length > 1 ? '.' + pathParts.pop()!.toLowerCase() : '';
  } catch {
    const cleanUrl = url.split('?')[0];
    const parts = cleanUrl.split('.');
    return parts.length > 1 ? '.' + parts.pop()!.toLowerCase() : '';
  }
}

function isVideoUrl(url: string): boolean {
  return VIDEO_EXTS.includes(getUrlExt(url));
}

/** 将文件名自动格式化为可读标题（Unicode 安全） */
function formatVideoTitle(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')           // 移除扩展名
    .replace(/[-_]/g, ' ')             // 下划线/连字符→空格
    .replace(/\s+/g, ' ')              // 合并多余空格
    .replace(/(^|\s)([a-zA-Z])/g, (_, space, letter) => space + letter.toUpperCase()); // 仅英文字母首字母大写
}

function isImageUrl(url: string): boolean {
  return IMAGE_EXTS.includes(getUrlExt(url));
}

/** 将后端 API URL 转为同源代理路径，避免跨域 ORB 拦截 */
function normalizeProxyUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    if (u.hostname !== window.location.hostname && u.pathname.startsWith('/api/')) {
      return u.pathname + u.search;
    }
  } catch { /* noop */ }
  return url;
}

export default function BrandingSettings() {
  const { t } = useTranslation();
  const [, setLoading] = useState(false);
  const [config, setConfig] = useState<BrandingConfig>({ ...DEFAULT_BRANDING_CONFIG });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadingItems, setUploadingItems] = useState<UploadingItem[]>([]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchBrandingConfig();
      setConfig(data);
    } catch (err) {
      handleBrandingError(err, t('error.load'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  /** 立即持久化配置到后端，修改即生效 */
  const persistConfig = useCallback(async (cfg: BrandingConfig, removedFiles?: string[]) => {
    try {
      await saveBrandingConfig(cfg);
      if (removedFiles && removedFiles.length > 0) {
        await Promise.allSettled(
          removedFiles.map((key) => deleteBrandingFile(key).catch(() => {})),
        );
      }
    } catch (err) {
      handleBrandingError(err, t('error.save'));
    }
  }, []);

  const addVideo = () => {
    const newConfig = {
      ...config,
      heroVideos: [...config.heroVideos, { url: '', image: null, label: '', enabled: true }],
    };
    setConfig(newConfig);
    persistConfig(newConfig);
  };

  const extractStorageKey = (url: string): string | null => {
    try {
      const u = new URL(url, window.location.origin);
      const key = u.searchParams.get('key');
      if (key && key.startsWith('resources/public/branding/')) return key;
    } catch {
      const match = url.match(/key=([^&]+)/);
      if (match && match[1].startsWith('resources/public/branding/')) return match[1];
    }
    return null;
  };

  const removeVideo = (index: number) => {
    const video = config.heroVideos[index];
    const storageKey = video?.url ? extractStorageKey(video.url) : null;

    Modal.confirm({
      title: t('branding.confirmDelete'),
      content: t('branding.confirmDeleteContent'),
      centered: true,
      okText: t('branding.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: () => {
        const newConfig = {
          ...config,
          heroVideos: config.heroVideos.filter((_, i) => i !== index),
        };
        setConfig(newConfig);
        persistConfig(newConfig, storageKey ? [storageKey] : []);
        message.success(t('branding.deleted'));
      },
    });
  };

  const updateVideo = (index: number, patch: Partial<HeroVideoItem>) => {
    const newConfig = {
      ...config,
      heroVideos: config.heroVideos.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    };
    setConfig(newConfig);
    persistConfig(newConfig);
  };

  const moveVideo = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= config.heroVideos.length) return;
    const videos = [...config.heroVideos];
    [videos[index], videos[newIndex]] = [videos[newIndex], videos[index]];
    const newConfig = { ...config, heroVideos: videos };
    setConfig(newConfig);
    persistConfig(newConfig);
  };

  const handleAssetUpload = async (file: File, index: number, target: UploadTarget) => {
    const uid = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const item: UploadingItem = { uid, name: file.name, progress: 0, status: 'uploading', file };
    setUploadingItems((prev) => [...prev, item]);

    try {
      const result = await uploadBrandingFile(file, target, (percent) => {
        setUploadingItems((prev) => prev.map((it) => (it.uid === uid ? { ...it, progress: percent } : it)));
      });

      setUploadingItems((prev) => prev.map((it) => (it.uid === uid ? { ...it, status: 'success', progress: 100 } : it)));

      if (target === 'hero') {
        updateVideo(index, { url: result.url, label: formatVideoTitle(result.originalName) });
      } else {
        updateVideo(index, { image: result.url });
      }

      message.success(t('branding.uploadSuccess', { name: file.name }));
    } catch (err) {
      setUploadingItems((prev) => prev.map((it) => (it.uid === uid ? { ...it, status: 'error', error: (err as Error).message } : it)));
      message.error(t('branding.uploadFailed', { name: file.name, error: (err as Error).message }));
    }
  };

  const makeUploadProps = (target: UploadTarget): UploadProps => ({
    multiple: false,
    accept: target === 'hero'
      ? 'video/mp4,video/webm,.mp4,.webm,.ogg,.mkv,.mov'
      : 'image/*,.jpg,.jpeg,.png,.webp,.gif,.svg',
    showUploadList: false,
    beforeUpload: () => false,
    onDrop(e) { e.preventDefault(); },
  });

  const clearCompletedUploads = () => {
    setUploadingItems((prev) => prev.filter((it) => it.status === 'uploading'));
  };

  const PreviewButton = ({ url, type }: { url: string; type: 'video' | 'image' }) => {
    const canPreview = type === 'video' ? isVideoUrl(url) : isImageUrl(url);
    if (!url || !canPreview) return null;
    
    if (type === 'image') {
      return (
        <Image
          src={normalizeProxyUrl(url)}
          width={32}
          height={32}
          style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm, 4px)', cursor: 'pointer' }}
          alt={t('branding.preview')}
        />
      );
    }
    
    return (
      <Button
        size="small"
        icon={<EyeOutlined />}
        onClick={() => setPreviewUrl(url)}
        title={t('branding.preview')}
      />
    );
  };

  return (
    <>
      <Card
        title={
          <Space>
            <VideoCameraOutlined />
            <span>{t('branding.videoList')}</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #525252)', fontWeight: 400 }}>
              {t('branding.videoCount', { count: config.heroVideos.length })}
            </span>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadConfig}>
              {t('branding.reload')}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} size="small" onClick={addVideo} disabled={config.heroVideos.length >= 20}>
              {t('branding.addVideo')}
            </Button>
          </Space>
        }
      >
        {/* 上传队列 */}
        {uploadingItems.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 500 }}>{t('branding.uploadQueue')}</span>
              <Button size="small" onClick={clearCompletedUploads}>{t('branding.clearCompleted')}</Button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {uploadingItems.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '4px 0' }}>
                  {item.status === 'error'
                    ? <CloseCircleOutlined style={{ fontSize: 16, color: themeColor.error }} />
                    : <VideoCameraOutlined style={{ fontSize: 16, color: themeColor.primary }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <Typography.Text strong style={{ fontSize: 12 }}>{item.name}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {formatFileSize(item.file.size)}
                        {item.status === 'success' && <Typography.Text type="success" style={{ marginLeft: 4, fontSize: 10 }}>{t('branding.completed')}</Typography.Text>}
                        {item.status === 'error' && <Typography.Text type="danger" style={{ marginLeft: 4, fontSize: 10 }}>{t('branding.failed')}</Typography.Text>}
                      </Typography.Text>
                    </div>
                    {item.status === 'uploading' && <Progress percent={item.progress} size="small" status="active" />}
                    {item.status === 'error' && <Typography.Text type="danger" style={{ fontSize: 11 }}>{item.error}</Typography.Text>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {config.heroVideos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-secondary, #595959)' }}>
            <VideoCameraOutlined style={{ fontSize: 48, color: 'var(--color-border-secondary, #e8e8e8)', marginBottom: 12 }} />
            <div style={{ marginBottom: 8 }}>{t('branding.noVideos')}</div>
            <Button type="dashed" icon={<PlusOutlined />} onClick={addVideo}>{t('branding.addFirstVideo')}</Button>
          </div>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            {config.heroVideos.map((video, index) => (
              <Card
                key={index}
                size="small"
                style={{ background: 'var(--color-bg-elevated, #f5f5f5)' }}
                styles={{ body: { padding: 12 } }}
              >
                {/* 第一行: 元信息和操作 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--color-border-light, #f5f5f5)' }}>
                  <span style={{ color: 'var(--color-text-secondary, #525252)', fontWeight: 600, fontSize: 12 }}>#{index + 1}</span>
                  <Input
                    placeholder={t('branding.placeholder.label')}
                    value={video.label || ''}
                    onChange={(e) => updateVideo(index, { label: e.target.value })}
                    style={{ flex: 1, maxWidth: 200 }}
                    size="small"
                  />
                  <Switch
                    checked={video.enabled !== false}
                    onChange={(checked) => updateVideo(index, { enabled: checked })}
                    size="small"
                  />
                  <div style={{ flex: 1 }} />
                  <Button
                    size="small"
                    icon={<DragOutlined />}
                    onClick={() => moveVideo(index, -1)}
                    disabled={index === 0}
                    title={t('branding.moveUp')}
                  />
                  <Button
                    size="small"
                    icon={<DragOutlined style={{ transform: 'rotate(180deg)' }} />}
                    onClick={() => moveVideo(index, 1)}
                    disabled={index === config.heroVideos.length - 1}
                    title={t('branding.moveDown')}
                  />
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeVideo(index)}
                    title={t('branding.delete')}
                  />
                </div>

                {/* 第二行: 视频和回退图配置 */}
                <Row gutter={12}>
                  {/* 视频配置 */}
                  <Col xs={24} sm={12}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--color-text-secondary, #595959)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <VideoCameraOutlined /> {t('branding.video')}
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Input
                          placeholder={t('branding.placeholder.videoUrl')}
                          value={video.url}
                          onChange={(e) => updateVideo(index, { url: e.target.value })}
                          prefix={<LinkOutlined style={{ color: 'var(--color-text-tertiary, #bfbfbf)' }} />}
                          size="small"
                          style={{ flex: 1 }}
                        />
                        <Upload
                          {...makeUploadProps('hero')}
                          beforeUpload={(file) => { handleAssetUpload(file, index, 'hero'); return false; }}
                        >
                          <Button size="small" icon={<UploadOutlined />} title={t('branding.uploadVideo')} />
                        </Upload>
                        <PreviewButton url={video.url} type="video" />
                      </div>
                    </div>
                  </Col>

                  {/* 回退图配置 */}
                  <Col xs={24} sm={12}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--color-text-secondary, #595959)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <PictureOutlined /> {t('branding.fallbackImage')}
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Input
                          placeholder={t('branding.placeholder.imageUrl')}
                          value={video.image || ''}
                          onChange={(e) => updateVideo(index, { image: e.target.value || null })}
                          prefix={<PictureOutlined style={{ color: 'var(--color-text-tertiary, #bfbfbf)' }} />}
                          size="small"
                          style={{ flex: 1 }}
                        />
                        <Upload
                          {...makeUploadProps('fallback')}
                          beforeUpload={(file) => { handleAssetUpload(file, index, 'fallback'); return false; }}
                        >
                          <Button size="small" icon={<UploadOutlined />} title={t('branding.uploadImage')} />
                        </Upload>
                        <PreviewButton url={video.image || ''} type="image" />
                      </div>
                    </div>
                  </Col>
                </Row>
              </Card>
            ))}
          </Space>
        )}
      </Card>

      {/* 预览 Modal - 大尺寸，媒体占比95%+ */}
      <Modal
        title={null}
        open={!!previewUrl}
        onCancel={() => setPreviewUrl(null)}
        footer={null}
        width={1200}
        centered
        destroyOnHidden
        closable
        styles={{
          body: {
            padding: 0,
            margin: 0,
            background: '#000',
          },
        }}
        style={{
          maxWidth: '95vw',
        }}
      >
        {previewUrl && isVideoUrl(previewUrl) ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '85vh', background: '#000' }}>
            <video
              src={normalizeProxyUrl(previewUrl)}
              controls
              autoPlay
              muted
              loop
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
            />
          </div>
        ) : previewUrl && isImageUrl(previewUrl) ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '85vh', background: '#000' }}>
            <img
              src={normalizeProxyUrl(previewUrl)}
              alt={t('branding.preview')}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '85vh', color: '#999' }}>
            {t('branding.unknownType')}
          </div>
        )}
      </Modal>
    </>
  );
}