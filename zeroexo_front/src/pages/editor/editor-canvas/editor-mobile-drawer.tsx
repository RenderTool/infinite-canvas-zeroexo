/**
 * editor-mobile-drawer - 移动端层级面板抽屉(从右侧滑入)
 *
 * 从 editor-page.tsx 提取的独立组件,用于移动端展示画布层级结构。
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Layers } from 'lucide-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { GroupPlugin } from '@zeroexo/plugin-group';
import type { ThemeConfig } from '@zeroexo/shared';
import { HierarchyPanelSidebar } from '@/features/hierarchy/index.js';
import { MobileDrawerWrapper, MobileDrawerOverlay, MobileDrawerPanel } from '@/shared/components/index.js';

export interface MobileHierarchyDrawerProps {
  open: boolean;
  store: ReactGraphStore;
  groupPlugin: GroupPlugin;
  theme: ThemeConfig;
  onClose: () => void;
  onFocusNode?: (nodeId: string) => void;
}

export function MobileHierarchyDrawer({
  open,
  store,
  groupPlugin,
  theme,
  onClose,
  onFocusNode,
}: MobileHierarchyDrawerProps): React.ReactElement {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <MobileDrawerWrapper open={open}>
      {/* 遮罩降噪：更淡的背景，避免过于抢眼 */}
      <MobileDrawerOverlay open={open} onClick={onClose} style={{ background: 'rgba(0,0,0,0.25)' }} />
      <MobileDrawerPanel
        open={open}
        style={{
          background: theme.toolbar.background,
          width: 320,
          maxWidth: '85vw',
          borderRadius: '14px 0 0 14px',
          boxShadow: '-6px 0 20px rgba(0,0,0,0.08)',
        }}
      >
        {/* 头部 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 10px',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: theme.toolbar.text }}>
            <Layers size={16} style={{ opacity: 0.7 }} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t('canvasControls.hierarchyClosed')}</span>
          </div>
          <button
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, border: 'none', background: 'transparent',
              color: theme.toolbar.text, cursor: 'pointer', borderRadius: 6, opacity: 0.6,
            }}
          >
            <X size={16} />
          </button>
        </div>
        {/* 内容 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <HierarchyPanelSidebar
            closing={false}
            store={store}
            groupPlugin={groupPlugin}
            theme={theme}
            modal={true}
            onFocusNode={onFocusNode}
          />
        </div>
      </MobileDrawerPanel>
    </MobileDrawerWrapper>
  );
}