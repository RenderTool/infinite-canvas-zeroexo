/**
 * 剧创节点独立页面壳 - 出片(workbench)
 *
 * 独立页面壳:内容写入 node.data,随画布 Yjs 同步。
 * 约束:去掉顶部 toolbar(节点会在左侧注册自己的 toolbar),故本壳不渲染顶部工具栏。
 * 出片工作台 UI 待后续引导完善。
 */

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Empty } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';

export interface WorkbenchSheetProps {
  nodeId: string;
}

export function WorkbenchSheet({ nodeId: _nodeId }: WorkbenchSheetProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();

  return (
    <div style={shellStyle}>
      <Empty
        styles={{ image: { height: 48 } }}
        description={<span style={{ color: theme.toolbar.textMuted, fontSize: 12 }}>{t('canvasNodes.workbenchPending')}</span>}
      />
    </div>
  );
}

const shellStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  padding: 16,
  // 无顶部 toolbar
};