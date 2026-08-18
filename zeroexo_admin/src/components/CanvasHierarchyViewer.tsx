import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer, Tree, Empty, Tag, Descriptions, Table, Button } from 'antd';
import {
  AppstoreOutlined,
  FileTextOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  SoundOutlined,
  SettingOutlined,
  FileOutlined,
  ClusterOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { apiGet, showApiError } from '@/services/api-client';

interface CanvasNode {
  id: string;
  type: string;
  title: string;
  parentId: string | null;
  data: Record<string, unknown> | null;
  hidden: boolean;
  locked: boolean;
  updatedAt: string | null;
}

interface CanvasConnection {
  id?: string;
  source: { nodeId: string; pinId?: string } | string;
  target: { nodeId: string; pinId?: string } | string;
  [key: string]: unknown;
}

interface CanvasProject {
  id: string;
  title: string;
  ownerId: string;
  version: number;
  updatedAt: string;
}

interface CanvasGraph {
  project: CanvasProject;
  totalNodes: number;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
}

interface CanvasHierarchyViewerProps {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
}

function buildTree(nodes: CanvasNode[], getTypeInfo: (type: string) => { label: string; color: string; icon: React.ReactNode }, t: (key: string, options?: any) => string): any[] {
  const nodeMap = new Map<string, CanvasNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  const childMap = new Map<string | null, CanvasNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? '__root';
    if (!childMap.has(key)) childMap.set(key, []);
    childMap.get(key)!.push(n);
  }

  const toTree = (node: CanvasNode): any => {
    const info = getTypeInfo(node.type);
    const titleNode = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13 }}>{info.icon}</span>
        <span style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: node.hidden ? '#bfbfbf' : undefined,
        }}>
          {node.title || t('canvas.unnamed', { label: info.label })}
        </span>
        {node.locked && <span style={{ fontSize: 10, color: '#bfbfbf' }}>🔒</span>}
      </span>
    );

    const childrenNodes = childMap.get(node.id) || [];
    return {
      title: titleNode,
      key: node.id,
      node,
      children: childrenNodes.length > 0 ? childrenNodes.map(toTree) : undefined,
    };
  };

  const rootChildren = childMap.get('__root') || [];
  return rootChildren.map(toTree);
}

export default function CanvasHierarchyViewer({ open, projectId, onClose }: CanvasHierarchyViewerProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [graph, setGraph] = useState<CanvasGraph | null>(null);
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
  const [searchText, setSearchText] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<string[] | 'auto'>('auto');

  const TYPE_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    group: { label: t('canvas.nodeType.group'), color: 'gold', icon: <ClusterOutlined /> },
    image: { label: t('canvas.nodeType.image'), color: 'blue', icon: <PictureOutlined /> },
    video: { label: t('canvas.nodeType.video'), color: 'cyan', icon: <PlayCircleOutlined /> },
    audio: { label: t('canvas.nodeType.audio'), color: 'green', icon: <SoundOutlined /> },
    text: { label: t('canvas.nodeType.text'), color: 'default', icon: <FileTextOutlined /> },
    generator: { label: t('canvas.nodeType.generator'), color: 'purple', icon: <SettingOutlined /> },
    script: { label: t('canvas.nodeType.script'), color: 'orange', icon: <FileTextOutlined /> },
    storyboard: { label: t('canvas.nodeType.storyboard'), color: 'magenta', icon: <AppstoreOutlined /> },
    workbench: { label: t('canvas.nodeType.workbench'), color: 'red', icon: <AppstoreOutlined /> },
  };

  const getTypeInfo = useCallback((type: string) => {
    return TYPE_LABELS[type] || { label: type, color: 'default', icon: <FileOutlined /> };
  }, [TYPE_LABELS]);

  const loadGraph = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await apiGet<CanvasGraph>(`/admin/projects/${projectId}/graph`);
      setGraph(data);
      setSelectedNode(null);
      setExpandedKeys('auto');
    } catch (err) {
      showApiError(err, t('canvas.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open && projectId) {
      loadGraph();
    }
  }, [open, projectId, loadGraph]);

  const treeData = useMemo(() => {
    if (!graph) return [];
    return buildTree(graph.nodes, getTypeInfo, t);
  }, [graph, getTypeInfo, t]);

  const filteredTreeData = useMemo(() => {
    if (!searchText) return treeData;
    const lower = searchText.toLowerCase();
    const filterNodes = (nodes: any[]): any[] => {
      return nodes
        .map((node) => {
          const selfMatch = node.node.title?.toLowerCase().includes(lower) ||
            node.node.type.toLowerCase().includes(lower);
          const filteredChildren = node.children ? filterNodes(node.children) : [];
          if (selfMatch || filteredChildren.length > 0) {
            return { ...node, children: filteredChildren.length > 0 ? filteredChildren : undefined };
          }
          return null;
        })
        .filter(Boolean) as any[];
    };
    return filterNodes(treeData);
  }, [treeData, searchText]);

  const handleSelect = (key: string) => {
    const node = graph?.nodes.find((n) => n.id === key);
    if (node) setSelectedNode(node);
  };

  const nodeColumns: ColumnsType<Record<string, unknown>> = [
    { title: t('canvas.table.property'), dataIndex: 'key', width: 120, render: (v) => <span style={{ color: 'var(--color-text-secondary, #595959)' }}>{v}</span> },
    { title: t('canvas.table.value'), dataIndex: 'value', render: (v) => <code style={{ fontSize: 12, background: 'var(--color-bg-page, #f5f5f5)', padding: '0 4px', borderRadius: 2 }}>{v}</code> },
  ];

  const nodeTableData = selectedNode
    ? [
        { key: 'ID', value: selectedNode.id },
        { key: t('canvas.property.type'), value: getTypeInfo(selectedNode.type).label },
        { key: t('canvas.property.title'), value: selectedNode.title || '-' },
        { key: t('canvas.property.parent'), value: selectedNode.parentId || '-' },
        { key: t('canvas.property.hidden'), value: selectedNode.hidden ? t('common.yes') : t('common.no') },
        { key: t('canvas.property.locked'), value: selectedNode.locked ? t('common.yes') : t('common.no') },
        { key: t('canvas.property.updatedAt'), value: selectedNode.updatedAt ? new Date(selectedNode.updatedAt).toLocaleString() : '-' },
      ]
    : [];

  const renderNodeData = (data: Record<string, unknown> | null) => {
    if (!data) return <Empty description={t('canvas.empty')} style={{ marginTop: 24 }} />;
    return (
      <pre style={{
        background: 'var(--color-bg-code, #f6f8fa)',
        borderRadius: 'var(--radius-md, 6px)',
        padding: 12,
        fontSize: 12,
        lineHeight: 1.5,
        maxHeight: 300,
        overflow: 'auto',
        margin: 0,
        fontFamily: 'monospace',
      }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  };

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <EyeOutlined />
          <span>{t('canvas.title')}</span>
          {graph && (
            <Tag color="blue" style={{ marginLeft: 8 }}>
              {t('canvas.nodeCount', { count: graph.totalNodes })}
            </Tag>
          )}
        </div>
      }
      placement="right"
      size={720}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Button icon={<ReloadOutlined />} onClick={loadGraph} loading={loading}>
          {t('common.refresh')}
        </Button>
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-secondary, #595959)' }}>{t('common.loading')}</div>
      ) : !graph ? (
        <Empty description={t('canvas.empty')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
          {/* 项目信息 */}
          <Descriptions
            title={t('canvas.projectInfo')}
            column={2}
            size="small"
            style={{ background: 'var(--color-bg-elevated, #fafafa)', borderRadius: 'var(--radius-sm, 4px)', padding: 12 }}
            styles={{ label: { color: 'var(--color-text-secondary, #595959)', fontSize: 12 } }}
          >
            <Descriptions.Item label={t('canvas.property.title')}>{graph.project.title}</Descriptions.Item>
            <Descriptions.Item label={t('canvas.property.version')}>v{graph.project.version}</Descriptions.Item>
            <Descriptions.Item label={t('canvas.property.owner')}>{graph.project.ownerId}</Descriptions.Item>
            <Descriptions.Item label={t('canvas.property.updatedAt')}>
              {new Date(graph.project.updatedAt).toLocaleString()}
            </Descriptions.Item>
          </Descriptions>

          {/* 搜索框 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SearchOutlined style={{ color: '#bfbfbf' }} />
            <input
              placeholder={t('canvas.searchPlaceholder')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{
                flex: 1,
                border: '1px solid var(--color-border-secondary, #e8e8e8)',
                borderRadius: 'var(--radius-sm, 4px)',
                padding: '4px 8px',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
            {/* 左侧树 */}
            <div style={{ flex: 1, minWidth: 0, overflow: 'auto', border: '1px solid var(--color-border, #f0f0f0)', borderRadius: 'var(--radius-sm, 4px)' }}>
              {filteredTreeData.length === 0 ? (
                <Empty description={t('canvas.noMatch')} style={{ marginTop: 40 }} />
              ) : (
                <Tree
                  treeData={filteredTreeData}
                  expandedKeys={expandedKeys === 'auto' ? undefined : expandedKeys}
                  onExpand={(keys: React.Key[]) => setExpandedKeys(keys as string[])}
                  selectedKeys={selectedNode ? [selectedNode.id] : []}
                  onSelect={(keys) => {
                    if (keys.length > 0) handleSelect(keys[0] as string);
                  }}
                  blockNode
                  style={{ padding: '8px 4px' }}
                />
              )}
            </div>

            {/* 右侧节点详情 */}
            <div style={{ width: 320, flexShrink: 0, overflow: 'auto' }}>
              {selectedNode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* 节点头部 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {getTypeInfo(selectedNode.type).icon}
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {selectedNode.title || t('canvas.unnamed', { label: getTypeInfo(selectedNode.type).label })}
                    </span>
                  </div>

                  {/* 类型标签 */}
                  <div>
                    <Tag color={getTypeInfo(selectedNode.type).color}>
                      {getTypeInfo(selectedNode.type).label}
                    </Tag>
                    {selectedNode.hidden && <Tag color="default">{t('canvas.hidden')}</Tag>}
                    {selectedNode.locked && <Tag color="warning">{t('canvas.locked')}</Tag>}
                  </div>

                  {/* 基础属性表格 */}
                  <Table
                    columns={nodeColumns}
                    dataSource={nodeTableData}
                    size="small"
                    pagination={false}
                    bordered
                    showHeader={false}
                  />

                  {/* 节点数据 */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-text-secondary, #595959)', marginBottom: 6 }}>
                      {t('canvas.nodeData')}
                    </div>
                    {renderNodeData(selectedNode.data)}
                  </div>
                </div>
              ) : (
                <Empty description={t('canvas.selectHint')} />
              )}
            </div>
          </div>

          {/* 连接线信息 */}
          {graph.connections.length > 0 && (
            <div style={{ borderTop: '1px solid var(--color-border, #f0f0f0)', paddingTop: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #595959)', marginBottom: 8 }}>
                {t('canvas.connections', { count: graph.connections.length })}
              </div>
              <div style={{ maxHeight: 100, overflow: 'auto' }}>
                {graph.connections.slice(0, 10).map((conn, i) => {
                  const src = typeof conn.source === 'string' ? conn.source : conn.source.nodeId;
                  const tgt = typeof conn.target === 'string' ? conn.target : conn.target.nodeId;
                  return (
                    <div key={i} style={{ fontSize: 11, color: 'var(--color-text-secondary, #595959)', fontFamily: 'monospace' }}>
                      {src} → {tgt}
                    </div>
                  );
                })}
                {graph.connections.length > 10 && (
                  <div style={{ fontSize: 11, color: '#bfbfbf' }}>
                    {t('canvas.moreConnections', { count: graph.connections.length - 10 })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}