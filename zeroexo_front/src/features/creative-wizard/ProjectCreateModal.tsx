/**
 * ProjectCreateModal - 新建项目弹窗（极简版）
 *
 * 仅需输入项目名称，创建后跳转到立项工作台进行完整配置。
 * 使用 antd Modal，遵循 DESIGN.md 规范。
 */

import { useState, useCallback, type CSSProperties } from 'react';
import { X, Rocket } from 'lucide-react';
import { App, Modal, Tooltip } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { createArtifact } from '@/services/artifact-service.js';
import i18n from '@/i18n/config';

export interface ProjectCreateModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: (projectId: string, projectTitle: string) => void;
}

export function ProjectCreateModal({ open, onClose, onComplete }: ProjectCreateModalProps): React.ReactElement {
  const { theme } = useTheme();
  const { message } = App.useApp();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;

  const [projectTitle, setProjectTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const resetState = useCallback(() => {
    setProjectTitle('');
    setCreating(false);
  }, []);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const finalTitle = projectTitle.trim() || '未命名项目';
      const project = await createArtifact({ title: finalTitle });
      resetState();
      onComplete(project.id, project.title);
    } catch {
      message.error(i18n.t('errors.INTERNAL_SERVER_ERROR'));
    } finally {
      setCreating(false);
    }
  }, [projectTitle, onComplete, message, resetState]);

  const hasTitle = projectTitle.trim().length > 0;

  const base: CSSProperties = { fontFamily: "'DM Sans', system-ui, sans-serif" };

  return (
    <Modal
      open={open}
      onCancel={() => { if (!creating) { resetState(); onClose(); } }}
      footer={null}
      width={480}
      closable={false}
      mask={{ closable: !creating }}
      centered
      destroyOnHidden
      styles={{
        body: { padding: 0, overflow: 'hidden' },
        mask: { backdropFilter: 'blur(2px)' },
      }}
    >
      <div style={{ color: theme.toolbar.text, ...base }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px 0',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            fontFamily: "'Sora', system-ui, sans-serif",
            fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em',
            color: textMuted,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: accent,
            }} />
            ZEROEXO
          </div>
          <Tooltip title="关闭">
            <button
              type="button"
              onClick={() => { resetState(); onClose(); }}
              style={{
                width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 6, border: 'none', background: 'transparent',
                color: '#78716c', cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
            </Tooltip>
        </div>

        {/* Body */}
        <div style={{ padding: '40px 48px 32px', textAlign: 'center' }}>
          {/* Icon */}
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `${accent}12`, color: accent,
            margin: '0 auto 20px',
          }}>
            <Rocket size={24} />
          </div>

          {/* Title */}
          <div style={{
            fontFamily: "'Sora', system-ui, sans-serif",
            fontSize: 22, fontWeight: 700,
            letterSpacing: '-0.03em', marginBottom: 8,
          }}>
            为你的项目取个名字
          </div>
          <div style={{ fontSize: 13, color: textMuted, marginBottom: 28, maxWidth: 320, margin: '0 auto 28px', lineHeight: 1.6 }}>
            一个好名字能让创作更有方向感<br />
            留空将使用"未命名项目"
          </div>

          {/* Name Input */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            marginBottom: 28,
            padding: '12px 18px',
            borderRadius: 10,
            border: `1.5px solid ${hasTitle ? accent : border}`,
            background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            boxShadow: hasTitle ? `0 0 0 2px ${accent}12` : 'none',
            transition: 'all .3s',
          }}>
            <Rocket size={14} style={{ color: textMuted, flexShrink: 0 }} />
            <input
              type="text"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              placeholder="为项目命名（可选）"
              autoFocus
              style={{
                flex: 1, border: 'none', background: 'transparent',
                fontSize: 15, fontWeight: 500, color: 'inherit',
                outline: 'none', fontFamily: 'inherit',
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
            />
          </div>

          {/* Create Button */}
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '12px 40px', borderRadius: 10, border: 'none',
              background: creating ? '#3a3530' : accent,
              color: creating ? textMuted : '#fff',
              fontSize: 14, fontWeight: 600,
              cursor: creating ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: creating ? 0.5 : 1,
              boxShadow: creating ? 'none' : `0 4px 24px ${accent}40`,
              transition: 'all .3s',
            }}
          >
            <Rocket size={15} />
            {creating ? '创建中...' : '创建项目'}
          </button>
        </div>
      </div>
    </Modal>
  );
}