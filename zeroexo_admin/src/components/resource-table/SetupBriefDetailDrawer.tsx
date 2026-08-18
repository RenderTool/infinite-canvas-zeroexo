/**
 * SetupBriefDetailDrawer — 创作项目立项引导详情抽屉
 *
 * 在管理后台「素材管理 → 项目」Tab 中，点击创作项目的「立项详情」按钮后弹出，
 * 展示该项目 14 Phase 引导过程的字段参数（phases）与完整对话记录（messages）。
 *
 * 数据来源：GET /admin/creation/:id/setup-brief
 * 后端读取独立的 SetupVersion / SetupPhase / SetupChatMessage 三张表。
 */
import { useEffect, useState } from 'react';
import {
  Drawer, Descriptions, Tag, Typography, Spin, Empty, Timeline, Divider, Table,
} from 'antd';
import { apiGet, showApiError } from '@/services/api-client';

const { Text, Paragraph } = Typography;

/** Phase 标签映射（与前端 PHASE_META 对齐，不含 emoji） */
const PHASE_LABELS: Record<string, string> = {
  platform: '平台渠道',
  type: '视频类型',
  audience: '受众画像',
  duration: '时长节奏',
  theme: '题材方向',
  style: '视觉风格',
  topic: '核心主题',
  hook: '钩子设计',
  structure: '内容结构',
  title: '标题生成',
  competitor: '竞品分析',
  resource: '资源盘点',
  publish: '发布策略',
  risk: '风险检查',
};

interface PhaseValue {
  phase: string;
  value: unknown;
  summary: string;
  confirmedAt?: string;
}

interface ChatMsg {
  role: string;
  text: string;
  type: string | null;
  phase: string | null;
  timestamp: number;
  options: Record<string, unknown> | null;
  guideText: string | null;
}

interface VersionMeta {
  id: string;
  type: string;
  currentPhase: string | null;
  phaseCount: number;
  isComplete: boolean;
  label: string | null;
  savedAt: string;
  messageCount: number;
}

interface ActiveVersion {
  id: string;
  currentPhase: string | null;
  phaseCount: number;
  isComplete: boolean;
  label: string | null;
  savedAt: string;
  phases: PhaseValue[];
  messages: ChatMsg[];
}

interface SetupBriefResponse {
  project: {
    id: string;
    title: string;
    ownerId: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  activeVersion: ActiveVersion | null;
  versionCount: number;
  allVersions: VersionMeta[];
}

export interface SetupBriefDetailDrawerProps {
  projectId: string | null;
  onClose: () => void;
}

/** 渲染 phase value（字符串直接显示，对象用 JSON） */
function renderPhaseValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    // 多选场景 { selected: string[] }
    const v = value as { selected?: unknown };
    if (Array.isArray(v.selected)) {
      return v.selected.join('、');
    }
    return JSON.stringify(value);
  }
  return String(value);
}

/** 格式化时间戳（毫秒数字 或 ISO 字符串） */
function formatTime(ts: number | string): string {
  if (!ts) return '-';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN');
}

export default function SetupBriefDetailDrawer({ projectId, onClose }: SetupBriefDetailDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SetupBriefResponse | null>(null);

  useEffect(() => {
    if (!projectId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setData(null);
    apiGet<SetupBriefResponse>(`/admin/creation/${projectId}/setup-brief`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) showApiError(err, '加载立项详情失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const active = data?.activeVersion ?? null;

  return (
    <Drawer
      title="立项引导详情"
      placement="right"
      size="large"
      open={!!projectId}
      onClose={onClose}
      destroyOnHidden
    >
      <Spin spinning={loading}>
        {!data && !loading ? (
          <Empty description="暂无数据" />
        ) : data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* 项目基本信息 */}
            <Descriptions
              title="项目信息"
              size="small"
              column={2}
              bordered
              labelStyle={{ width: 90, fontSize: 12 }}
              contentStyle={{ fontSize: 13 }}
              items={[
                { key: 'title', label: '标题', children: data.project.title },
                { key: 'status', label: '状态', children: <Tag>{data.project.status}</Tag> },
                { key: 'owner', label: '所有者', children: data.project.ownerId },
                { key: 'versionCount', label: '版本数', children: data.versionCount },
                { key: 'createdAt', label: '创建时间', children: formatTime(data.project.createdAt) },
                { key: 'updatedAt', label: '更新时间', children: formatTime(data.project.updatedAt) },
              ]}
            />

            {/* 当前活跃版本概要 */}
            {active ? (
              <Descriptions
                title="当前版本"
                size="small"
                column={2}
                bordered
                labelStyle={{ width: 90, fontSize: 12 }}
                contentStyle={{ fontSize: 13 }}
                items={[
                  { key: 'label', label: '版本标题', children: active.label ?? '-' },
                  {
                    key: 'isComplete',
                    label: '完成状态',
                    children: active.isComplete
                      ? <Tag color="success">已完成</Tag>
                      : <Tag color="processing">进行中</Tag>,
                  },
                  {
                    key: 'currentPhase',
                    label: '当前阶段',
                    children: active.currentPhase
                      ? `${PHASE_LABELS[active.currentPhase] ?? active.currentPhase}（${active.currentPhase}）`
                      : '未开始',
                  },
                  { key: 'phaseCount', label: '已确认阶段', children: `${active.phaseCount} / 14` },
                  { key: 'savedAt', label: '保存时间', children: formatTime(active.savedAt) },
                  { key: 'msgCount', label: '消息数', children: active.messages.length },
                ]}
              />
            ) : (
              <Empty description="该项目尚无立项对话记录" />
            )}

            {/* 字段参数（Phase 列表） */}
            {active && active.phases.length > 0 && (
              <div>
                <Divider titlePlacement="start" style={{ margin: '4px 0 12px' }}>
                  <Text strong>字段参数（{active.phases.length} 个已确认阶段）</Text>
                </Divider>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {active.phases.map((p) => (
                    <div
                      key={p.phase}
                      style={{
                        padding: '8px 12px',
                        background: '#fafafa',
                        borderRadius: 6,
                        border: '1px solid #f0f0f0',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Tag color="blue">{PHASE_LABELS[p.phase] ?? p.phase}</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>{p.phase}</Text>
                      </div>
                      <div style={{ fontSize: 13, color: '#262626', marginBottom: 2 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>摘要：</Text>
                        {p.summary || '-'}
                      </div>
                      <div style={{ fontSize: 13, color: '#595959' }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>值：</Text>
                        {renderPhaseValue(p.value)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 对话记录 */}
            {active && active.messages.length > 0 && (
              <div>
                <Divider titlePlacement="start" style={{ margin: '4px 0 12px' }}>
                  <Text strong>对话记录（{active.messages.length} 条）</Text>
                </Divider>
                <div style={{ maxHeight: 480, overflow: 'auto', paddingRight: 4 }}>
                  {active.messages.map((m, idx) => (
                    <MessageRow key={idx} msg={m} />
                  ))}
                </div>
              </div>
            )}

            {/* 全部版本列表 */}
            {data.allVersions.length > 0 && (
              <div>
                <Divider titlePlacement="start" style={{ margin: '4px 0 12px' }}>
                  <Text strong>全部版本（{data.allVersions.length}）</Text>
                </Divider>
                <Table<VersionMeta>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  bordered
                  sticky
                  dataSource={data.allVersions}
                  columns={[
                    {
                      title: '类型', dataIndex: 'type', width: 80,
                      render: (v: string) => v === 'auto'
                        ? <Tag color="green">当前</Tag>
                        : <Tag>快照</Tag>,
                    },
                    { title: '标题', dataIndex: 'label', ellipsis: true, sorter: (a: VersionMeta, b: VersionMeta) => (a.label || '').localeCompare(b.label || ''), render: (v: string | null) => v ?? '-' },
                    {
                      title: '阶段', dataIndex: 'phaseCount', width: 70,
                      sorter: (a: VersionMeta, b: VersionMeta) => a.phaseCount - b.phaseCount,
                      render: (v: number) => `${v} / 14`,
                    },
                    {
                      title: '状态', dataIndex: 'isComplete', width: 80,
                      render: (v: boolean) => v ? <Tag color="success">完成</Tag> : <Tag>进行中</Tag>,
                    },
                    { title: '消息', dataIndex: 'messageCount', width: 60, sorter: (a: VersionMeta, b: VersionMeta) => a.messageCount - b.messageCount },
                    {
                      title: '保存时间', dataIndex: 'savedAt', width: 160,
                      sorter: (a: VersionMeta, b: VersionMeta) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime(),
                      render: (v: string) => formatTime(v),
                    },
                  ]}
                />
              </div>
            )}
          </div>
        ) : null}
      </Spin>
    </Drawer>
  );
}

/** 单条消息渲染 */
function MessageRow({ msg }: { msg: ChatMsg }) {
  const isAgent = msg.role === 'agent';
  const time = formatTime(msg.timestamp);

  // 选项卡片消息：展示引导语 + 选项列表
  if (msg.type === 'options') {
    const options = msg.options as { items?: Array<{ icon?: string; label?: string; desc?: string; value?: string }> } | null;
    const items = options?.items ?? [];
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>{time} · Agent 选项</div>
        {msg.guideText && (
          <div style={{ fontSize: 13, color: '#262626', marginBottom: 6, whiteSpace: 'pre-wrap' }}>{msg.guideText}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map((opt, i) => (
            <div
              key={i}
              style={{
                padding: '6px 10px',
                background: '#f6f8fa',
                borderRadius: 4,
                border: '1px solid #eaecef',
                fontSize: 12,
              }}
            >
              <Text strong style={{ fontSize: 12 }}>{opt.label ?? opt.value}</Text>
              {opt.desc ? <Text type="secondary" style={{ fontSize: 12 }}> — {opt.desc}</Text> : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 阶段确认横幅
  if (msg.type === 'phase_confirm') {
    return (
      <div style={{ marginBottom: 12 }}>
        <Timeline.Item color="green">
          <Text style={{ fontSize: 12, color: '#52c41a' }}>{msg.text}</Text>
          <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>{time}</Text>
        </Timeline.Item>
      </div>
    );
  }

  // 普通文本消息
  return (
    <div
      style={{
        marginBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        alignItems: isAgent ? 'flex-start' : 'flex-end',
      }}
    >
      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>
        {time} · {isAgent ? 'Agent' : '用户'}
      </div>
      <div
        style={{
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: 8,
          background: isAgent ? '#f6f8fa' : '#e6f4ff',
          border: `1px solid ${isAgent ? '#eaecef' : '#bae0ff'}`,
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <Paragraph style={{ margin: 0 }}>{msg.text || '(空)'}</Paragraph>
      </div>
    </div>
  );
}
