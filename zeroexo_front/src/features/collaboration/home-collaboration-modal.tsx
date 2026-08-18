/**
 * HomeCollaborationModal - 首页协作入口弹窗
 *
 * 功能:
 * - Tab「发起协作」: 选择我的项目发起协作（打开画布时自动创建/加入房间）
 * - Tab「加入协作」: 输入 6 位邀请码加入已有协作
 * - 我的协作房间列表: 展示我加入的所有协作房间，点击跳转到对应画布
 */

import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Modal, Tabs, Button, Input, message, Empty, Spin } from 'antd';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { listArtifacts } from '@/services/artifact-service.js';
import type { Project } from '@/services/artifact-service.js';
import { listMyRooms, verifyInvite } from './collaboration-api.js';
import type { MyRoomItem } from './collaboration-types.js';

export interface HomeCollaborationModalProps {
  open: boolean;
  theme: ThemeConfig;
  /** 打开指定项目/画布（画布打开时会自动加入对应协作房间） */
  onOpenCanvas: (canvasId: string) => void;
  onClose: () => void;
}

export function HomeCollaborationModal({
  open,
  theme,
  onOpenCanvas,
  onClose,
}: HomeCollaborationModalProps): React.ReactElement {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');
  const [joinCode, setJoinCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);

  // 我的协作房间
  const [rooms, setRooms] = useState<MyRoomItem[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

  // 我的项目列表（发起协作时选择）
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // 加载我的协作房间
  const loadRooms = async () => {
    setRoomsLoading(true);
    try {
      const data = await listMyRooms();
      setRooms(data);
    } catch (err) {
      console.error('[HomeCollaborationModal] load rooms failed:', err);
    } finally {
      setRoomsLoading(false);
    }
  };

  // 加载我的项目
  const loadProjects = async () => {
    setProjectsLoading(true);
    try {
      const res = await listArtifacts();
      const sorted = [...res.items].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setProjects(sorted.slice(0, 12));
    } catch (err) {
      console.error('[HomeCollaborationModal] load projects failed:', err);
    } finally {
      setProjectsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setJoinCode('');
      setActiveTab('create');
      void loadRooms();
    }
  }, [open]);

  // 通过邀请码加入
  const handleJoin = async () => {
    const code = joinCode.trim();
    if (!code) {
      message.warning(t('collab.applyJoinCodeRequired'));
      return;
    }
    setJoinLoading(true);
    try {
      const room = await verifyInvite(code);
      if (!room) {
        message.error(t('collab.inviteCodeInvalid'));
        return;
      }
      onOpenCanvas(room.canvasId);
      onClose();
    } catch (err) {
      console.error('[HomeCollaborationModal] verify invite failed:', err);
      message.error(t('collab.inviteCodeInvalid'));
    } finally {
      setJoinLoading(false);
    }
  };

  const cardStyle: CSSProperties = {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    border: `1px solid ${theme.toolbar.border}`,
  };

  const cardTitleStyle: CSSProperties = {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 12,
    color: theme.toolbar.text,
  };

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 0',
    borderBottom: `1px solid ${theme.toolbar.border}`,
    cursor: 'pointer',
  };

  const rowTitleStyle: CSSProperties = {
    fontSize: 13,
    color: theme.toolbar.text,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const rowMetaStyle: CSSProperties = {
    fontSize: 11,
    color: theme.toolbar.textMuted,
    marginTop: 2,
  };

  return (
    <Modal
      open={open}
      title={t('collab.title')}
      centered
      onCancel={onClose}
      width={680}
      destroyOnHidden
      footer={null}
      styles={{
        mask: { background: 'transparent' },
        body: {
          padding: 20,
          background: theme.toolbar.panel,
          color: theme.toolbar.text,
        },
        header: {
          background: theme.toolbar.panel,
          color: theme.toolbar.text,
        },
      }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          const tab = key as 'create' | 'join';
          setActiveTab(tab);
          if (tab === 'create' && projects.length === 0) {
            void loadProjects();
          }
        }}
        style={{ marginBottom: 0 }}
        items={[
          {
            key: 'create',
            label: t('collab.createRoom'),
            children: (
              <div style={cardStyle}>
                <div style={cardTitleStyle}>{t('collab.createRoomPickProject')}</div>
                {projectsLoading ? (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <Spin size="small" />
                  </div>
                ) : projects.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <span style={{ fontSize: 13, color: theme.toolbar.textMuted }}>
                        {t('collab.createRoomEmpty')}
                      </span>
                    }
                  />
                ) : (
                  <div>
                    {projects.map((project) => (
                      <div
                        key={project.id}
                        style={rowStyle}
                        onClick={() => {
                          onOpenCanvas(project.id);
                          onClose();
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={rowTitleStyle}>{project.title}</div>
                          <div style={rowMetaStyle}>
                            {t('collab.createRoomPickHint')}
                          </div>
                        </div>
                        <Button size="small">{t('collab.open')}</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'join',
            label: t('collab.joinRoom'),
            children: (
              <div style={cardStyle}>
                <div style={cardTitleStyle}>{t('collab.applyJoinSection')}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input
                    size="small"
                    placeholder={t('collab.applyJoinPlaceholder')}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    onPressEnter={() => void handleJoin()}
                    style={{ flex: 1 }}
                  />
                  <Button
                    type="primary"
                    size="small"
                    loading={joinLoading}
                    onClick={() => void handleJoin()}
                  >
                    {t('collab.applyJoin')}
                  </Button>
                </div>
              </div>
            ),
          },
        ]}
      />

      {/* 我的协作房间 */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Users size={14} />
            {t('collab.myRooms')} ({rooms.length})
          </span>
        </div>
        {roomsLoading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Spin size="small" />
          </div>
        ) : rooms.length === 0 ? (
          <div style={{ color: theme.toolbar.textMuted, fontSize: 13, padding: '8px 0' }}>
            {t('collab.myRoomsEmpty')}
          </div>
        ) : (
          rooms.map((room) => (
            <div
              key={room.id}
              style={rowStyle}
              onClick={() => {
                onOpenCanvas(room.canvasId);
                onClose();
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={rowTitleStyle}>
                  {room.ownerName || t('collab.unnamed')}
                </div>
                <div style={rowMetaStyle}>
                  {room.memberCount} {t('collab.membersCount')}
                </div>
              </div>
              <Button size="small">{t('collab.enterRoom')}</Button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
