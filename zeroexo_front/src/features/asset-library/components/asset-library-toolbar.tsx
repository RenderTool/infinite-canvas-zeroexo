/**
 * asset-library-toolbar - 资产库工具栏
 *
 * 包含：分类选择器（Tab）、搜索框、上传/新建按钮、多选按钮。
 * 以及子分类筛选器、扫描进度条。
 * 征集 #87 验收轮九：列表/网格视图切换已移除（全局固定网格视图，含首页）。
 *
 * 征集 #94（Plan#49 T27）画布抽屉内嵌排版（embeddedInCanvas=true，仅抽屉生效，主页不变）：
 * - 去掉「资产库」标题行 + Tab 下方分割线
 * - 子分类筛选折叠为「模型渠道同款」下拉（触发器 26 高 + ChevronDown；fixed portal 弹层，
 *   视觉数值取自 features/top-bar/components/ai-model-picker.tsx 与 settings-popover-shell.tsx）
 * - 搜索 + 多选并入筛选行（下拉腾出横向空间）
 * - 移除上传素材/新建提示词/新建剧本按钮 → 改为各自 Tab 下「虚线加号格子」
 *   （占满宽度、高度对齐层级一个节点 = 44，常驻在 筛选+搜索+多选 行下方）
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  Upload,
  BookOpen,
  Sparkles,
  CheckSquare,
  Square,
  Plus,
  ChevronDown,
  Check,
} from 'lucide-react';
import { Button, Tooltip, Progress } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { toolbarRowStyle } from '../asset-library-styles.js';
import { SearchButton } from '@/shared/components/search-button.js';
import type { AssetCategory } from '@/shared/components/index.js';

/** 层级面板一个节点的高度（HierarchyListView rowStyle minHeight，征集 #94：虚线格子对齐该值） */
const NODE_ROW_HEIGHT = 44;

export interface AssetLibraryToolbarProps {
  categories: AssetCategory[];
  activeGroup: string | null;
  activeChild: string | null;
  search: string;
  multiSelectEnabled: boolean;
  scanningProgress: number;
  scanningMessage: string;
  isMobile: boolean;
  theme: ThemeConfig;
  onGroupClick: (group: string) => void;
  onChildClick: (key: string | null) => void;
  onSearchChange: (value: string) => void;
  onMultiSelectToggle: () => void;
  onUploadMaterial: (files: FileList) => void;
  /** 上传文件选择器 ref（与页面右键菜单「上传素材」共用同一入口） */
  materialFileInputRef: { current: HTMLInputElement | null };
  onNewPrompt: () => void;
  onNewScript: () => void;
  /** 画布抽屉内嵌模式（征集 #94）：启用抽屉专属排版，主页资产库保持原样 */
  embeddedInCanvas?: boolean;
  /** 层级类型筛选（征集 #96）：筛选下拉并入本工具栏「筛选+搜索+多选」行；非层级分组/非抽屉传 null */
  hierarchyFilter?: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
  } | null;
  /** 层级节点总数（征集 #96：统计徽标并入筛选行右侧） */
  hierarchyNodeCount?: number;
}

// ===== 抽屉模式：模型渠道同款下拉（征集 #94） =====

interface FilterDropdownProps {
  /** 当前选中标签 */
  activeLabel: string;
  options: Array<{ key: string | null; label: string; selected?: boolean }>;
  theme: ThemeConfig;
  onSelect: (key: string | null) => void;
}

/**
 * 子分类筛选下拉：触发器/弹层视觉对齐「模型渠道」下拉（ai-model-picker dropdown 变体）。
 * 弹层走 createPortal + fixed 定位，避免被抽屉 overflow:hidden 裁剪（画布抽屉场景必踩）。
 */
export function FilterDropdown({ activeLabel, options, theme, onSelect }: FilterDropdownProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isDark = theme.mode === 'dark';

  const panelWidth = 168;
  const optionH = 34;

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const estimated = Math.min(options.length * optionH + 32, 320);
    const below = window.innerHeight - r.bottom;
    const top = below > estimated + 16 ? r.bottom + 8 : Math.max(12, r.top - estimated - 8);
    setPos({ top, left: Math.max(12, Math.min(r.left, window.innerWidth - panelWidth - 12)) });
    setOpen(true);
  }, [open, options.length]);

  // 点击外部关闭（捕获阶段）；弹层内部点击自行 stopPropagation
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onDown);
    window.addEventListener('wheel', onDown, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onDown);
      window.removeEventListener('wheel', onDown);
    };
  }, [open]);

  const triggerStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    height: 26,
    maxWidth: 180,
    padding: '0 6px',
    border: 'none',
    borderRadius: 4,
    background: 'transparent',
    color: theme.toolbar.text,
    fontSize: 12,
    fontFamily: 'inherit',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.12s',
  };
  const panelStyle: CSSProperties = {
    position: 'fixed',
    top: pos.top,
    left: pos.left,
    width: panelWidth,
    zIndex: 1200,
    background: theme.toolbar.panel,
    borderRadius: 14,
    boxShadow: '0 18px 54px rgba(28,25,23,0.16)',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    maxHeight: 320,
    overflowY: 'auto',
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label={activeLabel}
        style={triggerStyle}
        onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeLabel}
        </span>
        <ChevronDown size={12} style={{ opacity: 0.6, flexShrink: 0 }} />
      </button>
      {open && createPortal(
        <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()}>
          {options.map((opt) => (
            <button
              key={opt.key ?? 'all'}
              type="button"
              onClick={() => {
                onSelect(opt.key);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                color: theme.toolbar.text,
                fontSize: 12.5,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {opt.label}
              </span>
              {opt.selected && <Check size={13} style={{ color: theme.toolbar.accent, flexShrink: 0 }} />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/** 虚线加号格子（征集 #94）：占满宽度、高度对齐层级节点，点击触发对应新建动作 */
function AddTile({ label, theme, onClick }: { label: string; theme: ThemeConfig; onClick: () => void }): React.ReactElement {
  const isDark = theme.mode === 'dark';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        width: '100%',
        height: NODE_ROW_HEIGHT,
        flexShrink: 0,
        border: `1.5px dashed ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`,
        borderRadius: 8,
        background: 'transparent',
        color: theme.toolbar.textMuted,
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'border-color 0.15s, color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = theme.toolbar.accent;
        e.currentTarget.style.color = theme.toolbar.accent;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';
        e.currentTarget.style.color = theme.toolbar.textMuted;
      }}
    >
      <Plus size={16} />
      {label}
    </button>
  );
}

export const AssetLibraryToolbar = memo(function AssetLibraryToolbar({
  categories,
  activeGroup,
  activeChild,
  search,
  multiSelectEnabled,
  scanningProgress,
  scanningMessage,
  isMobile,
  theme,
  onGroupClick,
  onChildClick,
  onSearchChange,
  onMultiSelectToggle,
  onUploadMaterial,
  materialFileInputRef,
  onNewPrompt,
  onNewScript,
  embeddedInCanvas = false,
  hierarchyFilter = null,
  hierarchyNodeCount = 0,
}: AssetLibraryToolbarProps): React.ReactElement {
  const { t } = useTranslation();

  const activeCat = categories.find((c) => c.group === activeGroup);
  const childOptions = (activeCat?.children ?? [])
    .filter((c) => c.key !== undefined)
    .map((c) => ({
      key: c.key === 'all' ? null : (c.key as string),
      label: c.label,
      selected: c.key === 'all' ? !activeChild : activeChild === c.key,
    }));
  const activeChildLabel = childOptions.find((o) => o.selected)?.label ?? childOptions[0]?.label ?? '';

  // 抽屉模式：当前 Tab 对应的「新增格子」（层级 Tab 无格子——节点由画布创建）
  const addTile = ((): { label: string; onClick: () => void } | null => {
    if (activeGroup === 'material') {
      return { label: '上传素材', onClick: () => materialFileInputRef.current?.click() };
    }
    if (activeGroup === 'prompt') {
      return { label: '新建提示词', onClick: onNewPrompt };
    }
    if (activeGroup === 'script') {
      return { label: '新建剧本', onClick: onNewScript };
    }
    return null;
  })();

  // ===== 分类 Tab（双端共用样式；征集 #92:overflowX auto 防窄屏截断/换行） =====
  const tabRow = (
    <div style={{
      display: 'flex',
      flexWrap: 'nowrap',
      overflowX: 'auto',
      overflowY: 'hidden',
      overscrollBehavior: 'contain',
      padding: isMobile ? '0 12px 0' : '0 20px 0',
      gap: 24,
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
              padding: 0,
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
            {cat.label}
            {!isMobile && cat.count !== undefined && cat.count > 0 && (
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
              left: 0, right: 0,
              height: 2,
              borderRadius: 1,
              background: isActive ? theme.toolbar.accent : 'transparent',
              transition: 'background 0.2s ease',
            }} />
          </div>
        );
      })}
    </div>
  );

  /** 扫描进度条（双端共用） */
  const progressBar = scanningProgress >= 0 ? (
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
  ) : null;

  // 隐藏上传入口（抽屉模式点击「上传素材」格子触发；主页由工具行按钮触发）
  const hiddenFileInput = (
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
  );

  // ===== 画布抽屉模式（征集 #94）：无标题 / 无分割线 / 筛选下拉 + 搜索 + 多选 / 虚线格子 =====
  if (embeddedInCanvas) {
    const pad = isMobile ? 12 : 20;
    return (
      <>
        {tabRow}
        {/* 筛选 + 搜索 + 多选同行（下拉化后横向空间足够） */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: `8px ${pad}px 12px`,
          flexWrap: 'nowrap',
          overflowX: 'auto',
          overscrollBehavior: 'contain',
        }}>
          {childOptions.length > 1 && (
            <FilterDropdown
              activeLabel={activeChildLabel}
              options={childOptions}
              theme={theme}
              onSelect={(key) => onChildClick(key)}
            />
          )}
          {/* 征集 #96:层级类型筛选下拉与子分类同款,与搜索/统计/多选同一行 */}
          {hierarchyFilter && (
            <FilterDropdown
              activeLabel={hierarchyFilter.options.find((o) => o.value === hierarchyFilter.value)?.label ?? hierarchyFilter.options[0]?.label ?? ''}
              options={hierarchyFilter.options.map((o) => ({
                key: o.value === 'all' ? null : o.value,
                label: o.label,
                selected: hierarchyFilter.value === o.value,
              }))}
              theme={theme}
              onSelect={(key) => hierarchyFilter.onChange(key ?? 'all')}
            />
          )}
          <SearchButton
            value={search}
            onChange={onSearchChange}
            placeholder={t('assetLibrary.searchPlaceholder')}
            theme={theme}
          />
          {/* 征集 #96:节点统计徽标并入筛选行(原层级面板底部) */}
          {hierarchyFilter && (
            <Tooltip title={t('hierarchy.nodeCount', { count: hierarchyNodeCount })}>
              <span style={{
                marginLeft: 'auto', fontSize: 10, padding: '1px 7px', borderRadius: 999,
                background: theme.toolbar.border + '55', color: theme.toolbar.textMuted,
                fontVariantNumeric: 'tabular-nums', flexShrink: 0,
              }}>
                {hierarchyNodeCount}
              </span>
            </Tooltip>
          )}
          <Tooltip title={multiSelectEnabled ? '退出多选' : '多选'}>
            <Button
              icon={multiSelectEnabled ? <CheckSquare size={14} /> : <Square size={14} />}
              size="small"
              onClick={onMultiSelectToggle}
            />
          </Tooltip>
        </div>
        {/* 各自 Tab 的「新增格子」：水平虚线加号，占满宽度，高度对齐层级节点 */}
        {addTile && (
          <div style={{ padding: `0 ${pad}px 12px`, flexShrink: 0 }}>
            <AddTile label={addTile.label} theme={theme} onClick={addTile.onClick} />
          </div>
        )}
        {hiddenFileInput}
        {progressBar}
      </>
    );
  }

  // ===== 主页资产库（原样保留，征集 #94 不改动） =====
  return (
    <>
      {/* 标题行 */}
      <div style={toolbarRowStyle(isMobile)}>
        <span style={{ fontSize: 16, fontWeight: 600, color: theme.toolbar.text, whiteSpace: 'nowrap' }}>
          资产库
        </span>
        <SearchButton
          value={search}
          onChange={onSearchChange}
          placeholder={t('assetLibrary.searchPlaceholder')}
          theme={theme}
        />
        {/* 征集 #87 验收轮十三:上传/新建提示词/新建剧本在层级分组隐藏(层级面板不需要) */}
        {activeGroup !== 'hierarchy' && (
          <>
            <Tooltip title="上传素材">
              <Button
                size="small"
                icon={<Upload size={14} />}
                onClick={() => materialFileInputRef.current?.click()}
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
          </>
        )}
        <Tooltip title={multiSelectEnabled ? '退出多选' : '多选'}>
          <Button
            icon={multiSelectEnabled ? <CheckSquare size={14} /> : <Square size={14} />}
            size="small"
            onClick={onMultiSelectToggle}
          />
        </Tooltip>
      </div>

      {tabRow}

      {/* 分割线（验收轮十七：Tab 下划线贴合分割线；验收轮十八：分割线下留 12px 与下方筛选按钮拉开距离） */}
      <div style={{
        height: 1,
        margin: '0 20px 12px',
        background: theme.toolbar.border || 'rgba(128,128,128,0.15)',
      }} />

      {progressBar}

      {/* 征集 #87 验收轮十二纠正:子分类筛选独立行(工具行只留搜索/上传/新建/多选);
          单行不换行,窄屏横向滚动,紧凑样式 */}
      {childOptions.length > 1 && (
        <div style={{
          display: 'flex',
          flexWrap: 'nowrap',
          gap: 4,
          padding: isMobile ? '0 12px 12px' : '0 20px 12px',
          flexShrink: 0,
          overflowX: 'auto',
          overscrollBehavior: 'contain',
        }}>
          {childOptions.map((child) => (
            <button
              key={child.key ?? 'all'}
              type="button"
              onClick={() => onChildClick(child.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                height: 24,
                padding: '0 8px',
                fontSize: 11,
                fontWeight: child.selected ? 600 : 400,
                borderRadius: 6,
                cursor: 'pointer',
                flexShrink: 0,
                border: child.selected ? `1px solid ${theme.toolbar.accent}` : '1px solid transparent',
                background: child.selected ? theme.toolbar.accent : 'transparent',
                color: child.selected ? '#fff' : theme.toolbar.textMuted,
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {child.label}
            </button>
          ))}
        </div>
      )}

      {hiddenFileInput}
    </>
  );
});
