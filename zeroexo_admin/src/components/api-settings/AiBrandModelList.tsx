import { useState, useMemo } from 'react';
import {
  Button,
  Select,
  Space,
  Table,
  Tag,
  Switch,
  Pagination,
  Checkbox,
  Tooltip,
  Input,
  Modal,
} from 'antd';
import { SearchOutlined, ArrowRightOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { BRAND_ICONS, DefaultBrandIcon } from './brand-icons';
import { MODEL_TYPE_LABELS } from './ai-brand-constants';

interface ModelEntry {
  id: string;
  type: string;
  icon: string;
}

interface ModelListProps {
  flatModelList: ModelEntry[];
  enabledModels: Record<string, boolean>;
  modelTypes: Record<string, string>;
  modelIcons: Record<string, string>;
  brandPreset: { provider: string; label: string };
  isPreset: boolean;
  onToggleModel: (modelId: string) => void;
  onOpenClassifyModal: (modelIds: string[]) => void;
  onOpenSchemaModal: (modelId: string) => void;
  onDeleteModel: (modelId: string) => void;
  onOpenIconModal: (modelId: string) => void;
  onOpenAddModelModal: () => void;
  onRefreshModels: () => void;
}

const MODEL_TYPE_ICONS: Record<string, any> = {
  llm: () => <span>🤖</span>,
  image: () => <span>🖼️</span>,
  video: () => <span>🎬</span>,
  audio: () => <span>🎵</span>,
};

export default function ModelList({
  flatModelList,
  enabledModels,
  modelTypes,
  modelIcons,
  brandPreset,
  isPreset,
  onToggleModel,
  onOpenClassifyModal,
  onOpenSchemaModal,
  onDeleteModel,
  onOpenIconModal,
  onOpenAddModelModal,
  onRefreshModels,
}: ModelListProps) {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterEnabled, setFilterEnabled] = useState<string>('all');
  const [currentModelPage, setCurrentModelPage] = useState(1);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const modelPageSize = 15;

  const allModelTypes = useMemo(() => {
    const types = new Set(['all']);
    for (const model of flatModelList) {
      types.add(model.type);
    }
    return Array.from(types);
  }, [flatModelList]);

  const filteredAllModels: ModelEntry[] = useMemo(() => {
    let result = [...flatModelList];

    const kw = searchKeyword.trim().toLowerCase();
    if (kw) {
      result = result.filter(
        (m) => m.id.toLowerCase().includes(kw) || m.type.toLowerCase().includes(kw),
      );
    }

    if (filterType !== 'all') {
      result = result.filter((m) => m.type === filterType);
    }

    if (filterEnabled === 'enabled') {
      result = result.filter((m) => enabledModels[m.id]);
    } else if (filterEnabled === 'disabled') {
      result = result.filter((m) => !enabledModels[m.id]);
    }

    return result;
  }, [flatModelList, searchKeyword, filterType, filterEnabled, enabledModels]);

  const currentModelTotal = filteredAllModels.length;

  const currentModels: ModelEntry[] = useMemo(() => {
    const start = (currentModelPage - 1) * modelPageSize;
    return filteredAllModels.slice(start, start + modelPageSize);
  }, [filteredAllModels, currentModelPage]);

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedModels(currentModels.map((m) => m.id));
    } else {
      setSelectedModels([]);
    }
  };

  const toggleSelectOne = (modelId: string, checked: boolean) => {
    if (checked) {
      setSelectedModels((prev) => [...prev, modelId]);
    } else {
      setSelectedModels((prev) => prev.filter((id) => id !== modelId));
    }
  };

  const getModelIconComponent = (iconKey: string | undefined) => {
    if (!iconKey) return DefaultBrandIcon;
    return BRAND_ICONS[iconKey] || DefaultBrandIcon;
  };

  const modelColumns = [
    {
      title: (
        <Checkbox
          checked={selectedModels.length === currentModels.length && currentModels.length > 0}
          indeterminate={selectedModels.length > 0 && selectedModels.length < currentModels.length}
          onChange={(e) => toggleSelectAll(e.target.checked)}
        />
      ),
      dataIndex: 'id',
      width: 48,
      render: (_: string, record: ModelEntry) => (
        <Checkbox
          checked={selectedModels.includes(record.id)}
          onChange={(e) => toggleSelectOne(record.id, e.target.checked)}
        />
      ),
    },
    {
      title: '图标',
      dataIndex: 'icon',
      width: 56,
      render: (_: string, record: ModelEntry) => {
        const iconKey = modelIcons[record.id.toLowerCase()] || brandPreset.provider;
        const Icon = getModelIconComponent(iconKey);
        return (
          <div
            onClick={() => onOpenIconModal(record.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            <Icon size={20} />
            <span
              style={{
                position: 'absolute',
                bottom: -4,
                right: -4,
                fontSize: 8,
                color: '#1890ff',
              }}
            >
              ✏️
            </span>
          </div>
        );
      },
    },
    {
      title: '模型',
      dataIndex: 'id',
      ellipsis: true,
      sorter: (a: ModelEntry, b: ModelEntry) => a.id.localeCompare(b.id),
      render: (id: string) => (
        <span style={{ fontSize: 13 }}>{id}</span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      render: (_: string, record: ModelEntry) => {
        const userType = modelTypes[record.id.toLowerCase()];
        const type = userType || record.type;
        const Icon = MODEL_TYPE_ICONS[type] || MODEL_TYPE_ICONS.llm;
        return (
          <Tag icon={<Icon size={12} />} color={type === 'image' ? '#1890ff' : type === 'video' ? '#fa8c16' : type === 'audio' ? '#722ed1' : '#52c41a'}>
            {MODEL_TYPE_LABELS[type] || type}
          </Tag>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'id',
      width: 80,
      render: (id: string) => (
        <Switch
          checked={enabledModels[id]}
          onChange={() => onToggleModel(id)}
          size="small"
        />
      ),
    },
    {
      title: '操作',
      dataIndex: 'id',
      width: 200,
      render: (id: string) => {
        const userType = modelTypes[id.toLowerCase()];
        const isUnclassified = !userType || userType === 'unclassified';
        return (
          <Space size={4}>
            <Button
              size="small"
              type={isUnclassified ? 'primary' : 'default'}
              icon={<ArrowRightOutlined style={{ fontSize: 12 }} />}
              onClick={(e) => {
                e.stopPropagation();
                onOpenClassifyModal([id]);
              }}
              style={{ padding: '0 8px', height: 24, fontSize: 12 }}
            >
              {isUnclassified ? '归类' : '移动分类'}
            </Button>
            {userType !== undefined && userType !== 'unclassified' && (
              <Button
                size="small"
                type="link"
                onClick={() => onOpenSchemaModal(id)}
                style={{ padding: 0, height: 22, fontSize: 12 }}
              >
                参数配置
              </Button>
            )}
            {!isPreset && (
              <Button
                size="small"
                danger
                icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                style={{ padding: '0 8px', height: 24, fontSize: 12 }}
                onClick={() => {
                  Modal.confirm({
                    title: '确认删除',
                    content: '确定删除此自定义模型吗？此操作不可恢复。',
                    centered: true,
                    okType: 'danger',
                    okText: '确定删除',
                    cancelText: '取消',
                    onOk: () => onDeleteModel(id),
                  });
                }}
              >
                删除
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Select
              value={filterType}
              onChange={setFilterType}
              options={allModelTypes.map((t) => ({
                value: t,
                label: t === 'all' ? '全部类型' : MODEL_TYPE_LABELS[t] || t,
              }))}
              style={{ width: 120 }}
              size="small"
            />
            <Select
              value={filterEnabled}
              onChange={setFilterEnabled}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'enabled', label: '已启用' },
                { value: 'disabled', label: '已禁用' },
              ]}
              style={{ width: 100 }}
              size="small"
            />
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flex: 1,
              minWidth: 200,
              maxWidth: 360,
            }}
          >
            <Input
              size="small"
              placeholder="搜索模型名称或 ID..."
              prefix={<SearchOutlined style={{ fontSize: 12, color: 'var(--color-text-tertiary, #bfbfbf)' }} />}
              value={searchKeyword}
              onChange={(e) => {
                setSearchKeyword(e.target.value);
                setCurrentModelPage(1);
              }}
              allowClear
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {selectedModels.length > 0 && (
            <Tooltip title={`已选择 ${selectedModels.length} 个模型`}>
              <Button
                size="small"
                onClick={() => onOpenClassifyModal(selectedModels)}
              >
                批量归类 ({selectedModels.length})
              </Button>
            </Tooltip>
          )}
          <Button
            size="small"
            icon={<PlusOutlined style={{ fontSize: 14 }} />}
            onClick={onOpenAddModelModal}
          >
            添加模型
          </Button>
          <Button
            size="small"
            onClick={onRefreshModels}
          >
            获取列表
          </Button>
        </div>
      </div>

      <Table
        columns={modelColumns}
        dataSource={currentModels}
        rowKey="id"
        pagination={false}
        size="small"
        bordered
        sticky
        style={{ marginTop: 8 }}
      />

      {currentModelTotal > modelPageSize && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <Pagination
            current={currentModelPage}
            total={currentModelTotal}
            pageSize={modelPageSize}
            onChange={setCurrentModelPage}
            showSizeChanger={false}
            showTotal={(total: number) => `共 ${total} 个模型`}
          />
        </div>
      )}
    </>
  );
}
