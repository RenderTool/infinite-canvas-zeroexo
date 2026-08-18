import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Tabs, Button, message, Modal, Card, Alert, Select, Upload, Image, Tag,
} from 'antd';
import {
  PictureOutlined, ProjectOutlined, FileTextOutlined,
  ReloadOutlined, PlusOutlined, UploadOutlined,
} from '@ant-design/icons';

import { useTranslation } from 'react-i18next';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';
import { apiGet, apiPost, apiDelete, showApiError } from '@/services/api-client';
import {
  useAuthorizedImageUrl,
} from '@/pages/user-resources-utils';
import type {
  UserInfo,
} from './user-resources-types';
import DynamicResourceTable from '@/components/resource-table/DynamicResourceTable';
import MetadataDetailModal from '@/components/resource-table/MetadataDetailModal';
import SetupBriefDetailDrawer from '@/components/resource-table/SetupBriefDetailDrawer';
import BatchDeleteToolbar from '@/components/user-resources/BatchDeleteToolbar';
import PromptFormModal from '@/components/user-resources/PromptFormModal';
import UserInfoHeader from '@/components/user-resources/UserInfoHeader';
import CanvasHierarchyViewer from '@/components/CanvasHierarchyViewer';

/** 提示词详情图片组：私有图片通过 Authorization header 加载（blob URL），避免 JWT 进 URL query string */
function PromptDetailImageGroup({ keys }: { keys: string[] }) {
  const { t } = useTranslation();
  const coverUrl = useAuthorizedImageUrl(keys[0], 'full');
  return (
    <div>
      <div style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 12, marginBottom: 8 }}>{t('userResources.promptDetail.image')}</div>
      <Image.PreviewGroup>
        <div style={{ marginBottom: 8 }}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <Image
              src={coverUrl}
              width={320}
              height={200}
              style={{ objectFit: 'cover', borderRadius: 'var(--radius-md, 6px)', border: '1px solid var(--color-border, #f0f0f0)' }}
              fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDMyMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNmMGYwZjAiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2JmYmZiZiIgZm9udC1zaXplPSIxNCI+SU1HPC90ZXh0Pjwvc3ZnPg=="
            />
          </div>
        </div>
        {keys.length > 1 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {keys.slice(1).map((key, i) => (
              <PromptDetailThumbImage key={i} storageKey={key} />
            ))}
          </div>
        )}
      </Image.PreviewGroup>
    </div>
  );
}

/** 提示词详情缩略图 */
function PromptDetailThumbImage({ storageKey }: { storageKey: string }) {
  const url = useAuthorizedImageUrl(storageKey, 'full');
  return (
    <Image
      src={url}
      width={100}
      height={100}
      style={{ objectFit: 'cover', borderRadius: 'var(--radius-md, 6px)', border: '1px solid var(--color-border, #f0f0f0)' }}
      fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNmMGYwZjAiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2JmYmZiZiIgZm9udC1zaXplPSIxMCI+SU1HPC90ZXh0Pjwvc3ZnPg=="
    />
  );
}

export default function UserResources() {
  const { userId } = useParams<{ userId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const CATEGORY_OPTIONS = [
    { label: t('userResources.category.role'), value: 'role' },
    { label: t('userResources.category.scene'), value: 'scene' },
    { label: t('userResources.category.style'), value: 'style' },
    { label: t('userResources.category.shot'), value: 'shot' },
    { label: t('userResources.category.other'), value: 'other' },
  ];

  // 各 Tab 的类型筛选配置（统一由页面级工具栏提供，避免与表格内部重复）
  const TAB_FILTERS: Record<string, { key: string; placeholder: string; options: { label: string; value: string }[] }> = {
    material: {
      key: 'kind',
      placeholder: t('userResources.filter.materialType'),
      options: [
        { label: t('userResources.type.image'), value: 'image' },
        { label: t('userResources.type.video'), value: 'video' },
        { label: t('userResources.type.audio'), value: 'audio' },
        { label: t('userResources.type.text'), value: 'text' },
      ],
    },
    test: {
      key: 'kind',
      placeholder: t('userResources.filter.materialType'),
      options: [
        { label: t('userResources.type.image'), value: 'image' },
        { label: t('userResources.type.video'), value: 'video' },
        { label: t('userResources.type.audio'), value: 'audio' },
        { label: t('userResources.type.text'), value: 'text' },
      ],
    },
    projects: {
      key: 'type',
      placeholder: t('userResources.filter.projectType'),
      options: [
        { label: t('userResources.type.canvas'), value: 'canvas' },
        { label: t('userResources.type.creation'), value: 'creation' },
      ],
    },
    prompts: {
      key: 'category',
      placeholder: t('userResources.filter.category'),
      options: CATEGORY_OPTIONS,
    },
  };

  // 当前操作用户信息
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [userInfoLoading, setUserInfoLoading] = useState(true);

  // 共享行选择状态
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [activeTab, setActiveTab] = useState('material');

  // 刷新触发器（删除成功后递增，触发 DynamicResourceTable 重新加载）
  const [refreshKey, setRefreshKey] = useState(0);

  // 各 Tab 的总数（由 DynamicResourceTable 通过 onTotalChange 更新）
  const [assetTotal, setAssetTotal] = useState(0);
  const [projectTotal, setProjectTotal] = useState(0);
  const [testTotal, setTestTotal] = useState(0);
  const [promptTotal, setPromptTotal] = useState(0);

  // 分类筛选状态（各 Tab 的类型筛选，统一由页面级工具栏维护）
  const [tabFilter, setTabFilter] = useState<string | undefined>();

  // AI 生成元数据详情弹窗
  const [metadataRecord, setMetadataRecord] = useState<Record<string, unknown> | null>(null);

  // 创作项目立项引导详情抽屉
  const [setupBriefProjectId, setSetupBriefProjectId] = useState<string | null>(null);

  // 画布结构查看抽屉
  const [graphViewerProjectId, setGraphViewerProjectId] = useState<string | null>(null);

  // 提示词创建/编辑弹窗
  const [promptFormOpen, setPromptFormOpen] = useState(false);
  const [promptEditRecord, setPromptEditRecord] = useState<Record<string, unknown> | null>(null);
  // 提示词详情弹窗
  const [promptDetail, setPromptDetail] = useState<Record<string, unknown> | null>(null);

  /** 查看 AI 生成资源的元数据 */
  const handleViewMetadata = useCallback(async (record: Record<string, unknown>) => {
    if (!record.id) return;
    try {
      const data = await apiGet<Record<string, unknown>>(`/admin/ai/generations/by-asset/${record.id}`);
      setMetadataRecord(data);
    } catch (err) {
      showApiError(err, t('error.load'));
    }
  }, []);

  /** 查看创作项目的立项引导详情（Phase 参数 + 对话记录） */
  const handleViewSetupBrief = useCallback((record: Record<string, unknown>) => {
    if (!record.id) return;
    setSetupBriefProjectId(String(record.id));
  }, []);

  /** 查看画布项目的节点结构 */
  const handleViewGraph = useCallback((record: Record<string, unknown>) => {
    if (!record.id) return;
    setGraphViewerProjectId(String(record.id));
  }, []);

  // 获取当前用户信息
  const fetchUserInfo = useCallback(async (uid: string) => {
    setUserInfoLoading(true);
    try {
      const data = await apiGet<UserInfo>(`/admin/users/${uid}`);
      setUserInfo(data);
    } catch {
      setUserInfo(null);
    } finally {
      setUserInfoLoading(false);
    }
  }, []);

  // 初次加载用户信息
  useEffect(() => {
    if (userId) fetchUserInfo(userId);
  }, [userId, fetchUserInfo]);

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    setSelectedRowKeys([]);
    setTabFilter(undefined);
  };

  // ==================== 素材删除操作 ====================

  const handleDeleteAsset = (record: Record<string, unknown>) => {
    Modal.confirm({
      title: t('userResources.deleteConfirm.title'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.okText'), cancelText: t('common.cancel'),
      content: t('userResources.deleteConfirm.content', { name: record.filename }),
      onOk: async () => {
        try {
          await apiDelete(`/admin/resources/${record.id}`);
          message.success(t('userResources.message.deletedWithName', { name: record.filename }));
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.deleteFailed')); }
      },
    });
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) { message.warning(t('userResources.message.selectToDelete', { type: '' })); return; }
    Modal.confirm({
      title: t('userResources.deleteConfirm.batchTitle'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.okText'), cancelText: t('common.cancel'),
      content: t('userResources.deleteConfirm.batchContent', { count: selectedRowKeys.length }),
      onOk: async () => {
        try {
          const res = await apiPost<{ deletedCount: number }>('/admin/resources/batch-delete', { ids: selectedRowKeys });
          message.success(t('userResources.message.batchDeleted', { count: res.deletedCount || selectedRowKeys.length, type: '' }));
          setSelectedRowKeys([]);
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.batchDeleteFailed')); }
      },
    });
  };

  const handleDeleteCurrentPage = () => {
    Modal.confirm({
      title: t('userResources.deleteConfirm.title'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.okText'), cancelText: t('common.cancel'),
      content: t('userResources.deleteConfirm.currentPage'),
      onOk: async () => {
        try {
          const res = await apiPost<{ deletedCount: number }>('/admin/resources/batch-delete', { ids: selectedRowKeys });
          message.success(t('userResources.message.batchDeleted', { count: res.deletedCount || selectedRowKeys.length, type: '' }));
          setSelectedRowKeys([]);
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.deleteFailed')); }
      },
    });
  };

  const handleDeleteAll = () => {
    if (!userId) return;
    Modal.confirm({
      title: t('userResources.deleteConfirm.deleteAllTitle'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.deleteAllOk'), cancelText: t('common.cancel'),
      content: (
        <div>
          <p style={{ color: 'var(--color-error, #ff4d4f)' }}><strong>{t('userResources.deleteConfirm.danger')}</strong>{t('userResources.deleteConfirm.deleteAllContent', { username: userInfo?.username || userId, type: '', count: assetTotal })}</p>
        </div>
      ),
      onOk: async () => {
        try {
          const res = await apiPost<{ deletedCount: number }>(`/admin/resources/user/${userId}/clear`, {});
          message.success(t('userResources.message.cleared', { count: res.deletedCount || 0, type: '' }));
          setSelectedRowKeys([]);
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.clearFailed')); }
      },
    });
  };

  // 上传素材
  const handleUploadFile = async (file: File) => {
    if (!userId) return false;
    // 校验文件格式：仅允许图片、视频、音频
    const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
    const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
      '.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv',
      '.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    const isAllowedMime = ALLOWED_MIME_PREFIXES.some((p) => file.type.startsWith(p));
    const isAllowedExt = ALLOWED_EXTENSIONS.some((e) => ext === e);
    // 如果 MIME 类型为空（如 .exe 等不可识别文件）或类型不匹配，通过扩展名二次校验
    if (!isAllowedMime && !isAllowedExt) {
      message.error(t('userResources.message.formatNotSupported', { ext: ext || file.type }));
      return false;
    }
    try {
      const presignRes = await apiPost<{ uploadUrl: string | null; storageKey: string }>(
        `/admin/resources/user/${userId}/presign`, { filename: file.name, mimeType: file.type, size: file.size });
      if (presignRes.uploadUrl) {
        const uploadRes = await fetch(presignRes.uploadUrl, {
          method: 'PUT', body: file, headers: { 'Content-Type': file.type },
        });
        if (!uploadRes.ok) { message.error(t('userResources.message.uploadFailed')); return false; }
      }
      const kind = file.type.startsWith('image/') ? 'image'
        : file.type.startsWith('video/') ? 'video'
        : file.type.startsWith('audio/') ? 'audio' : 'text';
      await apiPost(`/admin/resources/user/${userId}/asset`, {
        kind, filename: file.name, storageKey: presignRes.storageKey, mimeType: file.type, size: file.size,
      });
      message.success(t('userResources.message.uploadSuccess'));
      setSelectedRowKeys([]);
      setRefreshKey((k) => k + 1);
      return true;
    } catch (err) { showApiError(err, t('userResources.message.uploadError')); return false; }
  };

  // ==================== 项目删除操作 ====================

  const handleDeleteProject = (record: Record<string, unknown>) => {
    Modal.confirm({
      title: t('userResources.deleteConfirm.title'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.okText'), cancelText: t('common.cancel'),
      content: t('userResources.deleteConfirm.content', { name: record.title }),
      onOk: async () => {
        try {
          if (record.type === 'canvas') {
            await apiDelete(`/admin/projects/${record.id}`);
          } else {
            await apiDelete(`/admin/creation/${record.id}`);
          }
          message.success(t('userResources.message.deletedWithName', { name: record.title }));
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.deleteFailed')); }
      },
    });
  };

  const handleBatchDeleteProjects = () => {
    if (selectedRowKeys.length === 0) { message.warning(t('userResources.message.selectToDelete', { type: '' })); return; }
    Modal.confirm({
      title: t('userResources.deleteConfirm.batchTitle'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.okText'), cancelText: t('common.cancel'),
      content: t('userResources.deleteConfirm.batchContent', { count: selectedRowKeys.length }),
      onOk: async () => {
        try {
          const res = await apiPost<{ deletedCount: number }>('/admin/projects/batch-delete', { ids: selectedRowKeys });
          message.success(t('userResources.message.batchDeleted', { count: res.deletedCount || selectedRowKeys.length, type: '' }));
          setSelectedRowKeys([]);
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.batchDeleteFailed')); }
      },
    });
  };

  const handleDeleteCurrentPageProjects = () => {
    Modal.confirm({
      title: t('userResources.deleteConfirm.title'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.okText'), cancelText: t('common.cancel'),
      content: t('userResources.deleteConfirm.currentPage'),
      onOk: async () => {
        try {
          const res = await apiPost<{ deletedCount: number }>('/admin/projects/batch-delete', { ids: selectedRowKeys });
          message.success(t('userResources.message.batchDeleted', { count: res.deletedCount || selectedRowKeys.length, type: '' }));
          setSelectedRowKeys([]);
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.deleteFailed')); }
      },
    });
  };

  const handleDeleteAllProjects = () => {
    if (!userId) return;
    Modal.confirm({
      title: t('userResources.deleteConfirm.deleteAllTitle'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.deleteAllOk'), cancelText: t('common.cancel'),
      content: (
        <div>
          <p style={{ color: 'var(--color-error, #ff4d4f)' }}><strong>{t('userResources.deleteConfirm.danger')}</strong>{t('userResources.deleteConfirm.deleteAllContent', { username: userInfo?.username || userId, type: '', count: projectTotal })}</p>
        </div>
      ),
      onOk: async () => {
        try {
          // 仅清空项目(画布)，绝不能调用素材清空接口
          const res = await apiPost<{ deletedCount: number }>(`/admin/projects/user/${userId}/clear`, {});
          message.success(t('userResources.message.cleared', { count: res.deletedCount || 0, type: '' }));
          setSelectedRowKeys([]);
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.clearFailed')); }
      },
    });
  };

  // ==================== 提示词删除操作 ====================

  const handleOpenCreatePrompt = () => {
    setPromptEditRecord(null);
    setPromptFormOpen(true);
  };

  const handlePromptFormSuccess = () => {
    setRefreshKey((k) => k + 1);
  };

  const handleViewPrompt = useCallback((record: Record<string, unknown>) => {
    setPromptDetail(record);
  }, []);

  const handleDeletePrompt = (record: Record<string, unknown>) => {
    Modal.confirm({
      title: t('userResources.deleteConfirm.title'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.okText'), cancelText: t('common.cancel'),
      content: t('userResources.deleteConfirm.content', { name: record.title }),
      onOk: async () => {
        try {
          await apiDelete(`/admin/prompts/${record.id}`);
          message.success(t('userResources.message.deletedWithName', { name: record.title }));
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.deleteFailed')); }
      },
    });
  };

  const handleBatchDeletePrompts = () => {
    if (selectedRowKeys.length === 0) { message.warning(t('userResources.message.selectToDelete', { type: '' })); return; }
    Modal.confirm({
      title: t('userResources.deleteConfirm.batchTitle'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.okText'), cancelText: t('common.cancel'),
      content: t('userResources.deleteConfirm.batchContent', { count: selectedRowKeys.length }),
      onOk: async () => {
        try {
          const res = await apiPost<{ deletedCount: number }>('/admin/prompts/batch-delete', { ids: selectedRowKeys });
          message.success(t('userResources.message.batchDeleted', { count: res.deletedCount || selectedRowKeys.length, type: '' }));
          setSelectedRowKeys([]);
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.batchDeleteFailed')); }
      },
    });
  };

  const handleDeleteCurrentPagePrompts = () => {
    Modal.confirm({
      title: t('userResources.deleteConfirm.title'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.okText'), cancelText: t('common.cancel'),
      content: t('userResources.deleteConfirm.currentPage'),
      onOk: async () => {
        try {
          const res = await apiPost<{ deletedCount: number }>('/admin/prompts/batch-delete', { ids: selectedRowKeys });
          message.success(t('userResources.message.batchDeleted', { count: res.deletedCount || selectedRowKeys.length, type: '' }));
          setSelectedRowKeys([]);
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.deleteFailed')); }
      },
    });
  };

  const handleDeleteAllPrompts = () => {
    if (!userId) return;
    Modal.confirm({
      title: t('userResources.deleteConfirm.deleteAllTitle'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.deleteAllOk'), cancelText: t('common.cancel'),
      content: (
        <div>
          <p style={{ color: 'var(--color-error, #ff4d4f)' }}><strong>{t('userResources.deleteConfirm.danger')}</strong>{t('userResources.deleteConfirm.deleteAllContent', { username: userInfo?.username || userId, type: '', count: promptTotal })}</p>
        </div>
      ),
      onOk: async () => {
        try {
          const res = await apiPost<{ deletedCount: number }>(`/admin/prompts/user/${userId}/clear`, {});
          message.success(t('userResources.message.cleared', { count: res.deletedCount || 0, type: '' }));
          setSelectedRowKeys([]);
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.clearFailed')); }
      },
    });
  };

  // ==================== 测试记录删除操作 ====================

  const handleDeleteTestAsset = (record: Record<string, unknown>) => {
    Modal.confirm({
      title: t('userResources.deleteConfirm.title'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.okText'), cancelText: t('common.cancel'),
      content: t('userResources.deleteConfirm.testRecord'),
      onOk: async () => {
        try {
          // 测试记录应使用生成记录接口，而不是素材删除接口
          await apiDelete(`/admin/ai/generations/${record.id}`);
          message.success(t('userResources.message.deleted'));
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.deleteFailed')); }
      },
    });
  };

  const handleBatchDeleteTest = () => {
    if (selectedRowKeys.length === 0) { message.warning(t('userResources.message.selectToDelete', { type: '' })); return; }
    Modal.confirm({
      title: t('userResources.deleteConfirm.batchTitle'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.okText'), cancelText: t('common.cancel'),
      content: t('userResources.deleteConfirm.batchContent', { count: selectedRowKeys.length }),
      onOk: async () => {
        try {
          const res = await apiPost<{ deletedCount: number }>('/admin/ai/generations/batch-delete', { ids: selectedRowKeys });
          message.success(t('userResources.message.batchDeleted', { count: res.deletedCount || selectedRowKeys.length, type: '' }));
          setSelectedRowKeys([]);
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.batchDeleteFailed')); }
      },
    });
  };

  const handleDeleteCurrentPageTest = () => {
    Modal.confirm({
      title: t('userResources.deleteConfirm.title'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.okText'), cancelText: t('common.cancel'),
      content: t('userResources.deleteConfirm.currentPage'),
      onOk: async () => {
        try {
          const res = await apiPost<{ deletedCount: number }>('/admin/ai/generations/batch-delete', { ids: selectedRowKeys });
          message.success(t('userResources.message.batchDeleted', { count: res.deletedCount || selectedRowKeys.length, type: '' }));
          setSelectedRowKeys([]);
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.deleteFailed')); }
      },
    });
  };

  const handleDeleteAllTest = () => {
    if (!userId) return;
    Modal.confirm({
      title: t('userResources.deleteConfirm.deleteAllTitle'), centered: true, okType: 'danger', okText: t('userResources.deleteConfirm.deleteAllOk'), cancelText: t('common.cancel'),
      content: (
        <div>
          <p style={{ color: 'var(--color-error, #ff4d4f)' }}><strong>{t('userResources.deleteConfirm.danger')}</strong>{t('userResources.deleteConfirm.deleteAllContent', { username: userInfo?.username || userId, type: '', count: testTotal })}</p>
        </div>
      ),
      onOk: async () => {
        try {
          // 仅清空 AI 生成记录，绝不能调用素材清空接口
          const res = await apiPost<{ deletedCount: number }>(`/admin/ai/generations/user/${userId}/clear`, {});
          message.success(t('userResources.message.cleared', { count: res.deletedCount || 0, type: '' }));
          setSelectedRowKeys([]);
          setRefreshKey((k) => k + 1);
        } catch (err) { showApiError(err, t('userResources.message.clearFailed')); }
      },
    });
  };

  // ========== 行选择配置 ==========

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

  // ========== Tab 定义 ==========
  // 注意：仅提供 Tab 头，内容区（表格）统一渲染在 Tab 下方、工具栏与批量操作之后，
  // 保证"Tab → 搜索/操作 → 批量操作 → 表格"的层级顺序

  const tabItems = [
    {
      key: 'material',
      label: <span><PictureOutlined /> {t('userResources.tab.assets')}</span>,
    },
    {
      key: 'projects',
      label: <span><ProjectOutlined /> {t('userResources.tab.projects')}</span>,
    },
    {
      key: 'test',
      label: <span><PictureOutlined /> {t('userResources.tab.aiGeneration')}</span>,
    },
    {
      key: 'prompts',
      label: <span><FileTextOutlined /> {t('userResources.tab.prompts')}</span>,
    },
  ];

  return (
    <BreadcrumbLayout
      items={[
        { title: t('users.title'), onClick: () => navigate('/users') },
        { title: userInfo?.username || userId || '' },
      ]}
    >

      {/* 用户账户信息标题栏 + 返回 + 上传按钮 */}
      <UserInfoHeader
        userInfo={userInfo}
        loading={userInfoLoading}
        activeTab={activeTab}
        onUploadFile={handleUploadFile}
        onBack={() => navigate('/users')}
      />

      {!userId ? (
        <Alert title={t('userResources.invalidUserId')} type="error" showIcon />
      ) : (
        <Card>
          {/* 第1行：Tab 切换置顶 */}
          <Tabs activeKey={activeTab} items={tabItems} onChange={handleTabChange} />

          {/* 第2行：类型筛选 + 操作按钮 */}
          <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
            <Select
              placeholder={TAB_FILTERS[activeTab]?.placeholder || t('userResources.filter.materialType')}
              style={{ width: 140 }}
              allowClear
              value={tabFilter}
              onChange={(v) => setTabFilter(v)}
              options={TAB_FILTERS[activeTab]?.options}
            />
            <Button icon={<ReloadOutlined />} onClick={() => setRefreshKey((k) => k + 1)}>
              {t('common.refresh')}
            </Button>
            {activeTab === 'material' && (
              <Upload
                accept="image/*,video/*,audio/*"
                showUploadList={false}
                beforeUpload={(file) => { handleUploadFile(file); return false; }}
              >
                <Button type="primary" icon={<UploadOutlined />}>{t('userResources.uploadAsset')}</Button>
              </Upload>
            )}
            {activeTab === 'prompts' && (
              <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreatePrompt}>
                {t('userResources.createPrompt')}
              </Button>
            )}
          </div>

          {/* 第3行：批量操作 */}
          {activeTab === 'material' && (
            <BatchDeleteToolbar
              selectedCount={selectedRowKeys.length}
              totalCount={assetTotal}
              currentPageCount={selectedRowKeys.length}
              onBatchDelete={handleBatchDelete}
              onDeleteCurrentPage={handleDeleteCurrentPage}
              onDeleteAll={handleDeleteAll}
            />
          )}
          {activeTab === 'projects' && (
            <BatchDeleteToolbar
              selectedCount={selectedRowKeys.length}
              totalCount={projectTotal}
              currentPageCount={selectedRowKeys.length}
              onBatchDelete={handleBatchDeleteProjects}
              onDeleteCurrentPage={handleDeleteCurrentPageProjects}
              onDeleteAll={handleDeleteAllProjects}
            />
          )}
          {activeTab === 'test' && (
            <BatchDeleteToolbar
              selectedCount={selectedRowKeys.length}
              totalCount={testTotal}
              currentPageCount={selectedRowKeys.length}
              onBatchDelete={handleBatchDeleteTest}
              onDeleteCurrentPage={handleDeleteCurrentPageTest}
              onDeleteAll={handleDeleteAllTest}
            />
          )}
          {activeTab === 'prompts' && (
            <BatchDeleteToolbar
              selectedCount={selectedRowKeys.length}
              totalCount={promptTotal}
              currentPageCount={selectedRowKeys.length}
              onBatchDelete={handleBatchDeletePrompts}
              onDeleteCurrentPage={handleDeleteCurrentPagePrompts}
              onDeleteAll={handleDeleteAllPrompts}
            />
          )}

          {/* 第4行：当前 Tab 的表格（在 Tab / 工具栏 / 批量操作下方） */}
          {activeTab === 'material' && (
            <DynamicResourceTable
              categoryKey="material"
              userId={userId!}
              onDeleteRecord={handleDeleteAsset}
              rowSelection={rowSelection}
              onTotalChange={(n) => setAssetTotal(n)}
              refreshKey={refreshKey}
              extraFilter={tabFilter ? { kind: tabFilter } : undefined}
            />
          )}
          {activeTab === 'projects' && (
            <DynamicResourceTable
              categoryKey="project"
              userId={userId!}
              onDeleteRecord={handleDeleteProject}
              onViewSetupBrief={handleViewSetupBrief}
              onViewGraph={handleViewGraph}
              rowSelection={rowSelection}
              onTotalChange={(n) => setProjectTotal(n)}
              refreshKey={refreshKey}
              extraFilter={tabFilter ? { type: tabFilter } : undefined}
            />
          )}
          {activeTab === 'test' && (
            <DynamicResourceTable
              categoryKey="ai-generation"
              userId={userId!}
              onDeleteRecord={handleDeleteTestAsset}
              onViewMetadata={handleViewMetadata}
              rowSelection={rowSelection}
              onTotalChange={(n) => setTestTotal(n)}
              refreshKey={refreshKey}
              extraFilter={tabFilter ? { kind: tabFilter } : undefined}
            />
          )}
          {activeTab === 'prompts' && (
            <DynamicResourceTable
              categoryKey="prompt"
              userId={userId!}
              onDeleteRecord={handleDeletePrompt}
              onViewDetail={handleViewPrompt}
              rowSelection={rowSelection}
              onTotalChange={(n) => setPromptTotal(n)}
              refreshKey={refreshKey}
              extraFilter={tabFilter ? { category: tabFilter } : undefined}
            />
          )}
        </Card>
      )}

      {/* AI 生成元数据详情弹窗 */}
      <MetadataDetailModal
        record={metadataRecord}
        onClose={() => setMetadataRecord(null)}
      />

      {/* 创作项目立项引导详情抽屉 */}
      <SetupBriefDetailDrawer
        projectId={setupBriefProjectId}
        onClose={() => setSetupBriefProjectId(null)}
      />

      {/* 画布结构查看抽屉 */}
      <CanvasHierarchyViewer
        open={!!graphViewerProjectId}
        projectId={graphViewerProjectId}
        onClose={() => setGraphViewerProjectId(null)}
      />

      {/* 提示词详情弹窗 - 参考公共提示词详情样式 */}
      <Modal
        title={t('userResources.promptDetail')}
        open={!!promptDetail}
        onCancel={() => setPromptDetail(null)}
        footer={null}
        width={720}
        centered
      >
        {promptDetail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 图片展示 */}
            {(promptDetail.imageKeys as string[] | undefined)?.length ? (
              <PromptDetailImageGroup keys={promptDetail.imageKeys as string[]} />
            ) : null}
            <div>
              <div style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 12, marginBottom: 4 }}>{t('userResources.promptDetail.title')}</div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{String(promptDetail.title || '')}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color="blue" style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{CATEGORY_OPTIONS.find((o) => o.value === promptDetail.category)?.label || String(promptDetail.category || '')}</Tag>
              {(promptDetail.tags as string[] || []).map((t: string) => <Tag key={t} style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}>{t}</Tag>)}
            </div>
            <div>
              <div style={{ color: 'var(--color-text-secondary, #595959)', fontSize: 12, marginBottom: 4 }}>{t('userResources.promptDetail.content')}</div>
              <pre style={{
                background: 'var(--color-bg-code, #f6f8fa)', borderRadius: 'var(--radius-md, 6px)', padding: 12,
                fontSize: 13, lineHeight: 1.5, maxHeight: 300, overflow: 'auto',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {String(promptDetail.content || '')}
              </pre>
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 12, color: 'var(--color-text-secondary, #595959)' }}>
              <span>{t('userResources.promptDetail.createdAt', { date: promptDetail.createdAt ? new Date(promptDetail.createdAt as string).toLocaleString() : '-' })}</span>
              <span>{t('userResources.promptDetail.updatedAt', { date: promptDetail.updatedAt ? new Date(promptDetail.updatedAt as string).toLocaleString() : '-' })}</span>
            </div>
          </div>
        )}
      </Modal>

      {/* 提示词创建/编辑弹窗 */}
      {userId && (
        <PromptFormModal
          open={promptFormOpen}
          userId={userId}
          editRecord={promptEditRecord}
          onClose={() => { setPromptFormOpen(false); setPromptEditRecord(null); }}
          onSuccess={handlePromptFormSuccess}
        />
      )}
    </BreadcrumbLayout>
  );
}
