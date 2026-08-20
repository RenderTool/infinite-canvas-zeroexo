/**
 * asset-library-toolbar - 资产库工具栏
 *
 * 包含：分类选择器（Tab）、搜索框、上传/新建按钮、视图切换、多选按钮。
 * 以及子分类筛选器、扫描进度条。
 */

import { memo } from 'react';
import {
  Search,
  Upload,
  BookOpen,
  User as UserIcon,
  Sparkles,
  Grid3X3,
  List,
  CheckSquare,
  Square,
} from 'lucide-react';
import { Input, Button, Tooltip, Progress } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { toolbarRowStyle } from '../asset-library-styles.js';
import type { AssetCategory, ViewMode } from '@/shared/components/index.js';

export interface AssetLibraryToolbarProps {
  categories: AssetCategory[];
  activeGroup: string | null;
  activeChild: string | null;
  search: string;
  viewMode: ViewMode;
  multiSelectEnabled: boolean;
  scanningProgress: number;
  scanningMessage: string;
  isMobile: boolean;
  theme: ThemeConfig;

  onGroupClick: (group: string) => void;
  onChildClick: (key: string | null) => void;
  onSearchChange: (value: string) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onMultiSelectToggle: () => void;
  onUploadMaterial: (files: FileList) => void;
  /** 上传文件选择器 ref（与页面右键菜单「上传素材」共用同一入口） */
  materialFileInputRef: { current: HTMLInputElement | null };
  onNewSubject: () => void;
  onNewPrompt: () => void;
  onNewScript: () => void;
}

export const AssetLibraryToolbar = memo(function AssetLibraryToolbar({
  categories,
  activeGroup,
  activeChild,
  search,
  viewMode,
  multiSelectEnabled,
  scanningProgress,
  scanningMessage,
  isMobile,
  theme,
  onGroupClick,
  onChildClick,
  onSearchChange,
  onViewModeChange,
  onMultiSelectToggle,
  onUploadMaterial,
  materialFileInputRef,
  onNewSubject,
  onNewPrompt,
  onNewScript,
}: AssetLibraryToolbarProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      {/* 分类选择器 Tab */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        padding: isMobile ? '8px 12px' : '8px 20px',
        gap: 0,
        background: 'transparent',
      }}>
        {categories.map((cat) => {
          const isActive = activeGroup === cat.group;
          return (
            <div
              key={cat.group}
              onClick={() => onGroupClick(cat.group)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 36,
                padding: '0 14px',
                fontSize: 13,
                fontWeight: isActive ? 500 : 400,
                color: isActive ? theme.toolbar.text : theme.toolbar.textMuted,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                position: 'relative',
                transition: 'color 0.2s ease',
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = theme.toolbar.text; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = theme.toolbar.textMuted; }}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {cat.icon}
              </span>
              {cat.label}
              {cat.count !== undefined && cat.count > 0 && (
                <span style={{
                  fontSize: 11,
                  color: isActive ? theme.toolbar.text : theme.toolbar.textMuted,
                  opacity: 0.5,
                  marginLeft: 2,
                }}>
                  {cat.count}
                </span>
              )}
              <span style={{
                position: 'absolute',
                bottom: 0,
                left: 8,
                right: 8,
                height: 2,
                borderRadius: 1,
                background: isActive ? theme.toolbar.accent : 'transparent',
                transition: 'background 0.2s ease',
              }} />
            </div>
          );
        })}
      </div>

      {/* 工具栏行 */}
      <div style={toolbarRowStyle(isMobile)}>
        <Input
          size="small"
          prefix={<Search size={14} style={{ opacity: 0.5 }} />}
          placeholder={t('assetLibrary.searchPlaceholder')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{ width: isMobile ? '100%' : 180, minWidth: isMobile ? 0 : 180 }}
          allowClear
        />
        <Tooltip title="上传素材">
          <Button
            size="small"
            icon={<Upload size={14} />}
            onClick={() => materialFileInputRef.current?.click()}
          />
        </Tooltip>
        <input
          ref={materialFileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,text/plain,.txt,.md"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) {
              onUploadMaterial(e.target.files);
            }
            e.target.value = '';
          }}
        />
        <Tooltip title="新建主体">
          <Button
            size="small"
            icon={<UserIcon size={14} />}
            onClick={onNewSubject}
          />
        </Tooltip>
        <Tooltip title="新建提示词">
          <Button
            size="small"
            icon={<Sparkles size={14} />}
            onClick={onNewPrompt}
          />
        </Tooltip>
        <Tooltip title="新建剧本">
          <Button
            size="small"
            icon={<BookOpen size={14} />}
            onClick={onNewScript}
          />
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Tooltip title="网格视图">
          <Button
            size="small"
            type={viewMode === 'grid' ? 'primary' : 'default'}
            icon={<Grid3X3 size={14} />}
            onClick={() => onViewModeChange('grid')}
          />
        </Tooltip>
        <Tooltip title="列表视图">
          <Button
            size="small"
            type={viewMode === 'list' ? 'primary' : 'default'}
            icon={<List size={14} />}
            onClick={() => onViewModeChange('list')}
          />
        </Tooltip>
        <div style={{ width: 1, height: 24, background: theme.toolbar.border, margin: '0 6px' }} />
        <Tooltip title={multiSelectEnabled ? '退出多选' : '多选'}>
          <Button
            icon={multiSelectEnabled ? <CheckSquare size={14} /> : <Square size={14} />}
            size="small"
            onClick={onMultiSelectToggle}
          />
        </Tooltip>
      </div>

      {/* 扫描进度条 */}
      {scanningProgress >= 0 && (
        <div style={{ padding: '12px 24px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Progress
              percent={scanningProgress}
              size="small"
              style={{ flex: 1, margin: 0 }}
              strokeColor={theme.toolbar.accent}
              railColor={theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
              showInfo={false}
            />
            <span style={{ fontSize: 12, color: theme.toolbar.textMuted, whiteSpace: 'nowrap' }}>
              {scanningMessage}
            </span>
          </div>
        </div>
      )}

      {/* 子分类筛选器 */}
      {(() => {
        const cat = categories.find((c) => c.group === activeGroup);
        if (!cat || !cat.children || cat.children.length <= 1) return null;
        return (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            padding: '8px 20px 0',
            flexShrink: 0,
          }}>
            {cat.children.map((child) => {
              const isActive = activeChild === child.key || (!activeChild && child.key === 'all');
              return (
                <button
                  key={child.key}
                  type="button"
                  onClick={() => onChildClick(child.key === 'all' ? null : child.key)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    height: 28,
                    padding: '0 10px',
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 400,
                    borderRadius: 6,
                    cursor: 'pointer',
                    border: isActive ? `1px solid ${theme.toolbar.accent}` : '1px solid transparent',
                    background: isActive ? theme.toolbar.accent : 'transparent',
                    color: isActive ? '#fff' : theme.toolbar.textMuted,
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {child.label}
                </button>
              );
            })}
          </div>
        );
      })()}
    </>
  );
});