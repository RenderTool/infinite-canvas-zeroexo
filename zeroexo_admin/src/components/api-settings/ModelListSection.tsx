/**
 * ModelListSection - AI 品牌详情中的模型列表区块
 *
 * 包含模型列表上方的筛选工具栏（类型 / 启用状态 / 关键词搜索 / 批量归类 / 获取列表）
 * 以及下方的模型列表（含分页、批量选择、启用切换、归类/参数配置/删除操作）。
 *
 * 该组件为纯展示 + 回调型组件，所有状态由父组件 AiBrandDetail 持有并通过 props 传入。
 */
import {
  Button,
  Input,
  Select,
  Tag,
  Switch,
  Checkbox,
  Pagination,
  Spin,
  Modal,
  Tabs,
} from 'antd';
import {
  ReloadOutlined,
  ArrowRightOutlined,
  BarsOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { ModelEntry } from './ai-brand-types';
import {
  MODEL_TYPE_LABELS,
  MODEL_TYPE_ICONS,
  MODEL_CAPABILITY_DESCRIPTIONS,
} from './ai-brand-constants';
import { getModelIconComponent } from './ai-brand-utils';

export interface ModelListSectionProps {
  /** 原始按类型分组的模型映射（用于判断是否已获取列表、各分类模型数量） */
  fetchedModels: Record<string, string[]> | null;
  /** 打平后的全部模型列表（带类型、图标、启用状态） */
  flatModelList: ModelEntry[];
  /** 经筛选后的全部模型列表 */
  filteredAllModels: ModelEntry[];
  /** 全部可用模型类型（用于筛选器） */
  allModelTypes: string[];
  /** 当前类型筛选值 */
  filterType: string;
  /** 类型筛选 setter */
  onFilterTypeChange: (value: string) => void;
  /** 当前启用状态筛选值 */
  filterEnabled: string;
  /** 启用状态筛选 setter */
  onFilterEnabledChange: (value: string) => void;
  /** 搜索关键词 */
  searchKeyword: string;
  /** 搜索关键词 setter */
  onSearchKeywordChange: (value: string) => void;
  /** 当前分页页码 */
  currentModelPage: number;
  /** 分页页码 setter */
  onCurrentModelPageChange: (page: number) => void;
  /** 每页条数 */
  modelPageSize: number;
  /** 当前分页的模型列表 */
  currentModels: ModelEntry[];
  /** 筛选后模型总数 */
  currentModelTotal: number;
  /** 是否正在获取模型列表 */
  testing: boolean;
  /** 当前选中的模型 ID 列表（批量归类用） */
  selectedModels: string[];
  /** 切换单个模型的选中状态 */
  onToggleSelectModel: (modelId: string) => void;
  /** 切换全选 / 取消全选 */
  onToggleSelectAll: () => void;
  /** 切换模型启用状态 */
  onToggleModel: (modelId: string) => void;
  /** 打开归类弹窗（传入模型 ID 列表） */
  onOpenClassifyModal: (modelIds: string[]) => void;
  /** 打开参数配置弹窗（modelId, modelType） */
  onOpenSchemaModal: (modelId: string, modelType: string) => void;
  /** 删除自定义模型 */
  onDeleteModel: (modelId: string) => void;
  /** 打开图标选择弹窗 */
  onOpenIconModal: (modelId: string) => void;
  /** 重新获取模型列表 */
  onRefreshModels: () => void;
}

export default function ModelListSection({
  fetchedModels,
  flatModelList,
  filteredAllModels,
  allModelTypes,
  filterType,
  onFilterTypeChange,
  filterEnabled,
  onFilterEnabledChange,
  searchKeyword,
  onSearchKeywordChange,
  currentModelPage,
  onCurrentModelPageChange,
  modelPageSize,
  currentModels,
  currentModelTotal,
  testing,
  selectedModels,
  onToggleSelectModel,
  onToggleSelectAll,
  onToggleModel,
  onOpenClassifyModal,
  onOpenSchemaModal,
  onDeleteModel,
  onOpenIconModal,
  onRefreshModels,
}: ModelListSectionProps) {
  /* ---------- 模型列表工具栏（始终显示） ---------- */
  const renderToolbar = () => {
    const hasData = fetchedModels !== null;
    const totalCount = flatModelList.length;
    const enabledCount = flatModelList.filter((m) => m.enabled).length;

    return (
      <div>
        {/* 模型分类 Tab（全局共识：分类统一使用 Tab，置于顶部） */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <Tabs
            style={{ marginBottom: 0 }}
            activeKey={filterType || 'all'}
            onChange={(key) => onFilterTypeChange(key)}
            items={[
              {
                key: 'all',
                label: (
                  <span>
                    <BarsOutlined style={{ marginRight: 4, verticalAlign: -2 }} />
                    全部（{totalCount}）
                  </span>
                ),
              },
              ...allModelTypes.map((typeKey) => {
                const IconComp = MODEL_TYPE_ICONS[typeKey] || QuestionCircleOutlined;
                return {
                  key: typeKey,
                  label: (
                    <span>
                      <IconComp style={{ marginRight: 4, verticalAlign: -2 }} />
                      {MODEL_TYPE_LABELS[typeKey] || typeKey}（{fetchedModels?.[typeKey]?.length || 0}）
                    </span>
                  ),
                };
              }),
            ]}
          />
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #8c8c8c)' }}>
            {hasData
              ? `共 ${totalCount} 个模型，已启用 ${enabledCount} 个`
              : '尚未获取模型列表'}
          </span>
        </div>

        {/* 搜索 + 操作（Tab 下方，同用户列表同款尺寸） */}
        {hasData && totalCount > 0 && (
          <div style={{ marginTop: 12, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select
              value={filterEnabled}
              onChange={onFilterEnabledChange}
              style={{ width: 140 }}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'enabled', label: '已启用' },
                { value: 'disabled', label: '已禁用' },
              ]}
            />
            <Input
              placeholder="搜索模型名称或 ID..."
              prefix={<SearchOutlined />}
              value={searchKeyword}
              onChange={(e) => onSearchKeywordChange(e.target.value)}
              allowClear
              style={{ width: 240 }}
            />
            {hasData && selectedModels.length > 0 && (
              <Tag color="blue" style={{ margin: 0 }}>
                已选 {selectedModels.length} 个
              </Tag>
            )}
            <div style={{ flex: 1 }} />
            {hasData && selectedModels.length > 0 && (
              <Button
                type="primary"
                icon={<ArrowRightOutlined />}
                onClick={() => onOpenClassifyModal(selectedModels)}
              >
                批量归类（{selectedModels.length}）
              </Button>
            )}
            <Button icon={<ReloadOutlined />} onClick={onRefreshModels} loading={testing}>
              获取列表
            </Button>
          </div>
        )}
      </div>
    );
  };

  /* ---------- 渲染模型列表（列表视图） ---------- */
  const renderModelList = () => {
    if (!fetchedModels) {
      return (
        <div style={{ color: '#8c8c8c', padding: '40px 0', textAlign: 'center', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          输入 API Key 后将自动获取模型列表
        </div>
      );
    }

    if (currentModelTotal === 0) {
      return (
        <div style={{ color: '#8c8c8c', padding: '40px 0', textAlign: 'center', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          暂无匹配的模型
        </div>
      );
    }

    const isAllSelected = filteredAllModels.length > 0 && selectedModels.length === filteredAllModels.length;

    return (
      <div>
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 12px',
              background: '#fafafa',
              borderBottom: '1px solid #f0f0f0',
              fontSize: 12,
              color: '#8c8c8c',
              fontWeight: 500,
            }}
          >
            <div style={{ width: 32, display: 'flex', justifyContent: 'center' }}>
              <Checkbox checked={isAllSelected} onChange={onToggleSelectAll} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>模型</div>
            <div style={{ width: 100, textAlign: 'center' }}>类型</div>
            <div style={{ width: 80, textAlign: 'center' }}>状态</div>
            <div style={{ width: 280, textAlign: 'right' }}>操作</div>
          </div>

          {currentModels.map((model) => {
            const isSelected = selectedModels.includes(model.id);
            const ModelIcon = getModelIconComponent(model.icon);
            const TypeIcon = MODEL_TYPE_ICONS[model.type || ''];
            const cap = MODEL_CAPABILITY_DESCRIPTIONS[model.id];

            return (
              <div
                key={model.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderBottom: '1px solid #f5f5f5',
                  background: isSelected ? '#e6f4ff' : '#fff',
                  opacity: model.enabled ? 1 : 0.55,
                  transition: 'background 0.2s',
                }}
              >
                <div style={{ width: 32, display: 'flex', justifyContent: 'center' }}>
                  <Checkbox
                    checked={isSelected}
                    onChange={() => onToggleSelectModel(model.id)}
                  />
                </div>

                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      background: '#f5f5f5',
                      flexShrink: 0,
                      position: 'relative',
                    }}
                    title="点击修改品牌图标"
                    onClick={() => onOpenIconModal(model.id)}
                  >
                    <ModelIcon size={18} />
                    <div
                      style={{
                        position: 'absolute',
                        top: -2,
                        right: -2,
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        background: '#fff',
                        border: '1px solid #d9d9d9',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 8,
                        color: '#8c8c8c',
                      }}
                    >
                      ✎
                    </div>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4, color: '#262626' }}>
                      {model.name || model.id}
                    </div>
                    <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2, fontFamily: 'monospace' }}>
                      {model.id}
                    </div>
                    {cap?.details && (
                      <div style={{ fontSize: 11, color: '#595959', marginTop: 4, lineHeight: 1.4 }}>
                        {cap.details}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ width: 100, textAlign: 'center' }}>
                  <Tag
                    color={model.type === 'unclassified' ? 'default' : 'blue'}
                    style={{ margin: 0, fontSize: 11 }}
                    icon={TypeIcon ? <TypeIcon style={{ fontSize: 12 }} /> : undefined}
                  >
                    {MODEL_TYPE_LABELS[model.type || ''] || model.type}
                  </Tag>
                </div>

                <div style={{ width: 80, textAlign: 'center' }}>
                  <Switch
                    checked={model.enabled}
                    onChange={() => onToggleModel(model.id)}
                    size="small"
                  />
                </div>

                <div style={{ width: 280, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <Button
                    size="small"
                    icon={<ArrowRightOutlined style={{ fontSize: 12 }} />}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenClassifyModal([model.id]);
                    }}
                    style={{ padding: '0 8px', height: 24, fontSize: 12 }}
                  >
                    {model.type === 'unclassified' ? '归类' : '移动分类'}
                  </Button>
                  {model.type !== 'unclassified' && (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => onOpenSchemaModal(model.id, model.type ?? '')}
                      style={{ padding: '0 8px', height: 24, fontSize: 12 }}
                    >
                      参数配置
                    </Button>
                  )}
                  {model.type === 'unclassified' && (
                    <Button
                      size="small"
                      danger
                      type="text"
                      style={{ padding: '0 4px', height: 24, fontSize: 12 }}
                      onClick={() => {
                        Modal.confirm({
                          title: '确认删除',
                          content: '确定删除此模型吗？此操作不可恢复。',
                          centered: true,
                          okType: 'danger',
                          okText: '确定删除',
                          cancelText: '取消',
                          onOk: () => onDeleteModel(model.id),
                        });
                      }}
                    >
                      删除
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {currentModelTotal > modelPageSize && (
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <Pagination
              current={currentModelPage}
              pageSize={modelPageSize}
              total={currentModelTotal}
              onChange={onCurrentModelPageChange}
              showSizeChanger
              showTotal={(total: number, range: number[]) => `${range[0]}-${range[1]} / 共 ${total} 条`}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {renderToolbar()}
      <Spin spinning={testing}>{renderModelList()}</Spin>
    </div>
  );
}
