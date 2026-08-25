/**
 * 模型模板库 - 系统级模板管理卡片
 *
 * - 列表：内置模板（只读徽标）+ 自定义模板（可删除）
 * - 导入：统一使用 ImportTemplateModal（与参数配置弹窗同一套导入 UI/示例/错误展示）
 * - 删除：确认弹窗，仅自定义模板可删
 *
 * 导入即生效：后端落库后 refresh 内存缓存，生成面板自动渲染新模板参数。
 */
import { useState, useCallback, useEffect } from 'react';
import { Button, Card, Tag, Modal, message, Table, Space, Alert } from 'antd';
import { ImportOutlined, DeleteOutlined } from '@ant-design/icons';
import { apiGet, apiDelete, showApiError } from '@/services/api-client';
import ImportTemplateModal from '../ImportTemplateModal';

/** 模板库条目（后端 /admin/model-templates 返回结构） */
interface TemplateItem {
  id: string;
  name: string;
  modelType: string;
  protocol: string;
  endpoint: string;
  isBuiltIn: boolean;
  matchKeywords?: string[];
}

const MODEL_TYPE_LABELS: Record<string, string> = {
  llm: 'LLM',
  image: '图像',
  video: '视频',
  audio: '音频',
};

export default function ModelTemplateLibrary() {
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ items: TemplateItem[] }>('/admin/model-templates');
      setItems(res.items || []);
    } catch (err) {
      showApiError(err, '加载模型模板库失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  /**
   * 导入模板：统一由 ImportTemplateModal 处理（含示例/校验错误展示），
   * 成功后刷新列表即可。
   */

  /** 删除自定义模板（确认弹窗） */
  const handleDelete = (item: TemplateItem) => {
    Modal.confirm({
      title: `删除模板「${item.name}」？`,
      content: '删除后该模板将从全站移除，生成面板将不再渲染其参数。',
      centered: true,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await apiDelete(`/admin/model-templates/${item.id}`);
          message.success('模板已删除');
          loadTemplates();
        } catch (err) {
          showApiError(err, '删除失败');
        }
      },
    });
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <span>模型模板库</span>
          <Tag color="blue" style={{ fontWeight: 400 }}>
            系统级 · 导入即全站可用
          </Tag>
        </Space>
      }
      extra={
        <Button
          size="small"
          type="primary"
          icon={<ImportOutlined />}
          onClick={() => setImportOpen(true)}
        >
          导入模板
        </Button>
      }
      style={{ marginTop: 24 }}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="模板导入后如何生效？"
        description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>在「AI 渠道 → 品牌详情」的模型归类弹窗 / 参数配置弹窗中，模板会出现在「预设模板」下拉与「我的模板（模板库）」列表，可直接选择应用。</li>
            <li>生成面板会按模板的匹配关键词（matchKeywords）自动渲染参数；含执行协议（task/sync/auth）的模板由后端按 DSL 执行。</li>
            <li>模板全站共享：导入一次，所有渠道、所有用户可见；删除后全站移除。</li>
          </ul>
        }
      />
      <Table<TemplateItem>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: '暂无模板，点击右上角「导入模板」添加' }}
        columns={[
          {
            title: '模板',
            dataIndex: 'name',
            render: (name: string, record) => (
              <Space size={4}>
                <span>{name}</span>
                {record.isBuiltIn ? (
                  <Tag color="default" style={{ marginInlineEnd: 0 }}>
                    内置
                  </Tag>
                ) : (
                  <Tag color="green" style={{ marginInlineEnd: 0 }}>
                    自定义
                  </Tag>
                )}
              </Space>
            ),
          },
          {
            title: 'ID',
            dataIndex: 'id',
            render: (id: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{id}</span>,
          },
          {
            title: '类型',
            dataIndex: 'modelType',
            width: 80,
            render: (type: string) => MODEL_TYPE_LABELS[type] ?? type,
          },
          {
            title: '匹配关键词',
            dataIndex: 'matchKeywords',
            width: 200,
            render: (keywords?: string[]) =>
              keywords && keywords.length > 0 ? (
                <Space size={4} wrap>
                  {keywords.slice(0, 3).map((kw) => (
                    <Tag key={kw} style={{ marginInlineEnd: 0 }}>
                      {kw}
                    </Tag>
                  ))}
                </Space>
              ) : (
                '-'
              ),
          },
          {
            title: '操作',
            key: 'action',
            width: 80,
            render: (_: unknown, record) =>
              record.isBuiltIn ? (
                <span style={{ color: '#bfbfbf', fontSize: 12 }}>只读</span>
              ) : (
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(record)}
                >
                  删除
                </Button>
              ),
          },
        ]}
      />

      <ImportTemplateModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => loadTemplates()}
      />
    </Card>
  );
}
