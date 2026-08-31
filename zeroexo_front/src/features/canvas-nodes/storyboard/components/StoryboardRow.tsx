/**
 * StoryboardRow - 分镜单行编辑组件
 *
 * 从 StoryboardTable.tsx 中抽离的单行编辑逻辑，包含：景别选择/运镜选择/时长输入/描述编辑/删除该行数据。
 */
import { memo, useCallback, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Input, Tooltip, Button } from 'antd';
import { Trash2, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import type { Shot, StoryboardEntity, AiSubject } from '../storyboard-types';
import { formatLighting, formatEnvironment, resolveEntityKind, ENTITY_KIND_META, collectSubjectSources, type SubjectMatchSource } from '../storyboard-utils';
import { SubjectMentionPopover } from './SubjectMentionPopover';
import { ShotStatePicker } from './ShotStatePicker';
import { CAMERA_MOVEMENT_OPTIONS, NODE_GRID_TEMPLATE, EDIT_GRID_TEMPLATE, gridCellStyle } from './StoryboardTable';

export interface StoryboardRowProps {
  shot: Shot;
  readOnly: boolean;
  selectedRowId: string | null;
  onRowSelect: (shotId: string) => void;
  selectedShotIds: Set<string>;
  onToggleSelect: (shotId: string) => void;
  onDeleteShot: (shotId: string) => void;
  onUpdateShot: (shotId: string, patch: Partial<Shot>) => void;
  cameraOpenId: string | null;
  cameraRect: { top: number; left: number; width: number } | null;
  onCameraOpen: (shotId: string, rect: { top: number; left: number; width: number }) => void;
  onCameraClose: () => void;
  entities: StoryboardEntity[];
  /** Plan#20 T3: 后端主体字典(主体列 kind 徽章兑底查找源) */
  aiSubjects?: AiSubject[];
  mentionOpen: boolean;
  mentionShotId: string | null;
  /** 2026-08-30 征集 #110: @ 选择主体 → 写入 shot.entities 关联（替代旧追加文本语义） */
  onMentionSelect: (source: SubjectMatchSource) => void;
  onMentionOpen: (shotId: string) => void;
  /** 2026-08-31 修复：@ 浮层关闭必须通知父级置空 mentionOpen/mentionShotId，否则浮层常驻不消失 */
  onMentionClose: () => void;
  onShotTypeClick: (shotId: string) => void;
  /** 2026-08-30 征集 #110: 可匹配主体集合（entities∪aiSubjects∪productionItems），供 @ 面板与自动匹配共用 */
  subjectSources?: SubjectMatchSource[];
  /** 2026-08-30 征集 #110: 描述文本回车/失焦自动匹配回调（整段扫描裸词 → 命中写 shot.entities） */
  onAutoMatchMentions?: (shotId: string, text: string) => void;
}

export const StoryboardRow = memo(function StoryboardRow({
  shot,
  readOnly,
  selectedRowId,
  onRowSelect,
  selectedShotIds,
  onToggleSelect,
  onDeleteShot,
  onUpdateShot,
  cameraOpenId,
  cameraRect,
  onCameraOpen,
  onCameraClose,
  entities,
  aiSubjects,
  mentionOpen,
  mentionShotId,
  onMentionSelect,
  onMentionOpen,
  onMentionClose,
  onShotTypeClick,
  subjectSources,
  onAutoMatchMentions,
}: StoryboardRowProps): ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const bgCanvas = isDark ? '#171717' : '#ffffff';
  const bgHover = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  const borderMuted = isDark ? '#2e2e2e' : '#e5e5e5';
  const textSecondary = isDark ? '#a8a8a8' : '#57534e';
  const accentCyan = '#5DDCFF';

  // 2026-08-22: 画面描述列统一组件(非编辑态高亮预览 + 点击进入 TextArea 编辑, blur 退出) — 全屏与节点内共用同一渲染路径, 契约色一致
  const [editingDesc, setEditingDesc] = useState(false);
  // 2026-08-30 征集 #110: @ 搜索词（Agent 同款浮层）
  const [mentionSearch, setMentionSearch] = useState('');
  // 描述输入容器 ref：@ 弹层 portal 到 body 用 fixed 定位，需视口坐标
  const descWrapRef = useRef<HTMLDivElement>(null);

  /** 可匹配主体集合（entities∪aiSubjects∪productionItems），@ 面板与自动匹配共用 */
  const mentionSubjects = useMemo(
    () => subjectSources ?? collectSubjectSources(entities, aiSubjects),
    [subjectSources, entities, aiSubjects],
  );

  /** @ 后已输入关键词：光标前文本匹配 /@([\w\u4e00-\u9fa5]*)$/ */
  const extractMentionSearch = useCallback((value: string, caret: number): string => {
    const before = value.slice(0, caret);
    const m = before.match(/@([\w\u4e00-\u9fa5]*)$/);
    return m ? (m[1] ?? '') : '';
  }, []);

  /** 描述列编辑 onChange：@ 触发浮层 + 更新描述 */
  const handleDescChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const caret = e.target.selectionStart ?? val.length;
    const at = extractMentionSearch(val, caret);
    if (val.endsWith('@') || at) {
      setMentionSearch(at);
      onMentionOpen(shot.id);
    } else {
      setMentionSearch('');
      // 关闭浮层（mentionShotId 由父级管理，这里仅清本地搜索词）
    }
    onUpdateShot(shot.id, { description: flatten(val) });
  }, [extractMentionSearch, onMentionOpen, onUpdateShot, shot.id]);

  /** 描述列编辑 回车/失焦：触发自动匹配（整段扫描裸词，跳过已 @ 词） */
  const handleDescCommit = useCallback(() => {
    setEditingDesc(false);
    onAutoMatchMentions?.(shot.id, shot.description ?? '');
  }, [onAutoMatchMentions, shot.id, shot.description]);

  // R2-7: 行复制（镜头描述 + 提示词），复制成功短暂绿勾反馈
  const [copied, setCopied] = useState(false);
  const handleCopyRow = async (): Promise<void> => {
    const promptText = (shot.prompt ?? shot.promptText ?? '').trim();
    const parts = [
      shot.description?.trim() ? `镜头 ${shot.number}：${shot.description.trim()}` : '',
      promptText ? `提示词：${promptText}` : '',
    ].filter(Boolean);
    const text = parts.join('\n') || `镜头 ${shot.number}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const sfx = Array.isArray(shot.sfx) ? shot.sfx : [];
  // 折叠换行: 数据含 \n(LLM 按句分行)时, pre-wrap 原样渲染成竖排阅读;统一折叠为空格实现左右横排
  const flatten = (v: string | undefined | null): string => (v ?? '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const descFlat = flatten(shot.description);
  // Plan#20 T2: 光影/环境双兼容字符串化展示(后端产出字符串 / 旧数据对象)
  const lightingText = formatLighting(shot.lighting);
  const envText = formatEnvironment(shot.environment);
  const moodLocParts: string[] = [];
  if (lightingText) moodLocParts.push(lightingText);
  if (envText) moodLocParts.push(envText);
  const moodLocText = flatten(moodLocParts.join(' · ')) || null;
  const dialogueFlat = flatten(shot.dialogue);
  // 描述主体名高亮词表(长名优先避免短名吞长名)
  const highlightNames = [
    ...new Set([
      ...entities.map((e) => e.name),
      ...(aiSubjects ?? []).map((s) => s.name),
    ]),
  ].filter(Boolean).sort((a, b) => b.length - a.length);
  const gridTemplate = readOnly ? NODE_GRID_TEMPLATE : EDIT_GRID_TEMPLATE;
  // 2026-08-22 竖排根因修复: 只读文本容器禁用 flex — flex 文本 item 在窄空间收缩到 min-content(中文=单字宽度)导致每字一行=竖排; 改 block 布局后正常左右换行
  const cellBase: CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '0.375rem 0.25rem', fontSize: 12, width: '100%', height: '100%', minHeight: 60, color: textColor, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden' };
  const blockCell: CSSProperties = { ...cellBase, display: 'block' };
  const editInput: CSSProperties = { width: '100%', fontSize: 12, lineHeight: '20px', color: textColor, whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 60, padding: '0.375rem 0.25rem', resize: 'none', background: 'transparent', border: 'none', boxShadow: 'none', outline: 'none' };

  // 2026-08-22: 主体名高亮统一使用契约色(角色绿/场景蓝/道具紫, ENTITY_KIND_META 对齐 KIND_COLOR), 未命中用正文色; 不再使用主题 accent 色(用户反馈节点内人物显红色)
  const highlightMentions = (text: string): ReactNode => {
    if (!text) return '';
    if (highlightNames.length === 0) return text;
    const nodes: ReactNode[] = [];
    let rest = text;
    let key = 0;
    while (rest.length > 0) {
      let best: { name: string; idx: number } | null = null;
      for (const name of highlightNames) {
        const idx = rest.indexOf(name);
        if (idx >= 0 && (best == null || idx < best.idx || (idx === best.idx && name.length > best.name.length))) {
          best = { name, idx };
        }
      }
      if (!best) { nodes.push(rest); break; }
      if (best.idx > 0) nodes.push(rest.slice(0, best.idx));
      const kind = resolveEntityKind(best.name, entities, aiSubjects);
      const meta = kind ? ENTITY_KIND_META[kind] : undefined;
      nodes.push(<span key={key++} style={{ color: meta?.color ?? textColor, fontWeight: 600 }}>{best.name}</span>);
      rest = rest.slice(best.idx + best.name.length);
    }
    return nodes;
  };

  return (
    <div
      key={shot.id}
      onClick={readOnly ? () => { onRowSelect(shot.id); } : undefined}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: gridTemplate,
        background: readOnly && selectedRowId === shot.id
          ? (isDark ? 'rgba(93,220,255,0.10)' : 'rgba(93,220,255,0.14)')
          : bgCanvas,
        cursor: readOnly ? 'pointer' : 'default',
      }}
    >
      {/* 镜号 */}
      <div
        style={{
          ...gridCellStyle(borderMuted, bgCanvas),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          color: textSecondary,
          minHeight: 60,
          gap: 4,
        }}
      >
        {!readOnly ? (
          <input
            type="checkbox"
            checked={selectedShotIds.has(shot.id)}
            onChange={() => onToggleSelect(shot.id)}
            onClick={(e) => e.stopPropagation()}
            style={{ margin: 0, cursor: 'pointer', accentColor: accent }}
          />
        ) : null}
        {shot.number}
      </div>

      {/* 日/夜 — Plan#20 T3 新增列 */}
      <div
        style={{
          ...gridCellStyle(borderMuted, bgCanvas),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          color: textSecondary,
          minHeight: 60,
        }}
      >
        {shot.dayNight || '—'}
      </div>

      {/* 时长 */}
      <div
        style={{
          ...gridCellStyle(borderMuted, bgCanvas),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          color: textColor,
          minHeight: 60,
        }}
      >
        {shot.duration}s
      </div>

      {/* 画面描述 — 2026-08-22 统一组件: 非编辑态一律契约色高亮预览(节点内/全屏同款); 编辑态点击进入 TextArea, blur 退出 */}
      <div style={{ ...gridCellStyle(borderMuted, bgCanvas), padding: '2px 4px' }}>
        {!readOnly && editingDesc ? (
          <div ref={descWrapRef} style={{ position: 'relative', width: '100%' }}>
            <Input.TextArea
              autoFocus
              size="small"
              variant="borderless"
              autoSize={{ minRows: 1, maxRows: 30 }}
              value={descFlat}
              onChange={handleDescChange}
              onBlur={handleDescCommit}
              onKeyDown={(e) => {
                // 浮层打开时 Enter 交由浮层键盘导航处理；未打开时 Enter 提交并触发自动匹配
                if (e.key === 'Enter' && !e.shiftKey && !(mentionOpen && mentionShotId === shot.id)) {
                  e.preventDefault();
                  (e.currentTarget as HTMLTextAreaElement).blur();
                }
              }}
              placeholder={t('storyboardRow.placeholderDescription')}
              style={editInput}
            />
            {mentionOpen && mentionShotId === shot.id && (
              <SubjectMentionPopover
                search={mentionSearch}
                subjects={mentionSubjects}
                position={(() => {
                  const r = descWrapRef.current?.getBoundingClientRect();
                  return { top: (r?.bottom ?? 0) + 4, left: r?.left ?? 0 };
                })()}
                theme={theme}
                onSelect={(source) => {
                  onMentionSelect(source);
                  setMentionSearch('');
                }}
                onClose={() => {
                  setMentionSearch('');
                  onMentionClose();
                }}
              />
            )}
          </div>
        ) : (
          <div
            onClick={!readOnly ? () => setEditingDesc(true) : undefined}
            style={{ ...blockCell, textAlign: 'left', ...(!readOnly ? { cursor: 'text' } : {}) }}
          >
            {descFlat ? highlightMentions(descFlat) : '—'}
          </div>
        )}
      </div>

      {/* 景别 — 编辑态点击弹出取景器;只读态纯文本 */}
      <div
        style={{
          ...gridCellStyle(borderMuted, bgCanvas),
          padding: '2px 4px',
          ...(!readOnly ? { cursor: 'pointer' } : {}),
        }}
        onClick={readOnly ? undefined : () => { onShotTypeClick(shot.id); }}
      >
        <div style={{ ...blockCell, textAlign: 'center', color: accentCyan }}>{shot.shotType || '—'}</div>
      </div>

      {/* 光影氛围 — 编辑态直接编辑;只读态纯文本(block 布局防竖排) */}
      <div style={{ ...gridCellStyle(borderMuted, bgCanvas), padding: '2px 4px' }}>
        {readOnly ? (
          <div style={{ ...blockCell, textAlign: 'left' }}>{moodLocText || '—'}</div>
        ) : (
          <Input.TextArea
            size="small"
            variant="borderless"
            autoSize={{ minRows: 1, maxRows: 30 }}
            value={moodLocText || ''}
            onChange={(e) => {
              const val = flatten(e.target.value);
              // 2026-08-31 修复退格/编辑异常：此前只回写 mood/location，重渲染时 formatLighting/formatEnvironment
              // 会把未改动的 keyLight/colorTemp/time/weather 重新拼回 value → 删掉的内容"复活"、文本不断重复。
              // 现在编辑即回写为 mood · location 两段，其余拼回因子清空 → value 与输入严格一致。
              const parts = val.split(' · ');
              if (typeof shot.lighting === 'string' || typeof shot.environment === 'string') {
                // 字符串契约：parts[0] 归 lighting，其余归 environment（两端都不复活）
                const updates: Record<string, unknown> = {};
                if (typeof shot.lighting === 'string') updates.lighting = parts[0] || '';
                if (typeof shot.environment === 'string') updates.environment = parts.slice(1).join(' · ');
                onUpdateShot(shot.id, updates);
                return;
              }
              // 对象契约：mood · location，清空拼回因子保证稳定编辑
              onUpdateShot(shot.id, {
                lighting: { keyLight: '', colorTemp: '', mood: parts[0] || '' },
                environment: { location: parts[1] || '', time: '', weather: '' },
              });
            }}
            placeholder={t('storyboardRow.placeholderLighting')}
            style={editInput}
          />
        )}
      </div>

      {/* 对白·旁白 — 编辑态直接编辑;只读态纯文本(block 布局防竖排) */}
      <div style={{ ...gridCellStyle(borderMuted, bgCanvas), padding: '2px 4px' }}>
        {readOnly ? (
          <div style={{ ...blockCell, textAlign: 'left' }}>{dialogueFlat || '—'}</div>
        ) : (
          <Input.TextArea
            size="small"
            variant="borderless"
            autoSize={{ minRows: 1, maxRows: 30 }}
            value={dialogueFlat}
            onChange={(e) => onUpdateShot(shot.id, { dialogue: flatten(e.target.value) })}
            placeholder={t('storyboardRow.placeholderDialogue')}
            style={editInput}
          />
        )}
      </div>

      {/* 音效 — 编辑态直接编辑;只读态纯文本(block 布局防竖排) */}
      <div style={{ ...gridCellStyle(borderMuted, bgCanvas), padding: '2px 4px' }}>
        {readOnly ? (
          <div style={{ ...blockCell, textAlign: 'left' }}>{sfx.join(' · ') || '—'}</div>
        ) : (
          <Input.TextArea
            size="small"
            variant="borderless"
            autoSize={{ minRows: 1, maxRows: 30 }}
            value={sfx.join(' · ')}
            onChange={(e) => {
              const parts = e.target.value.split(' · ').filter(Boolean);
              onUpdateShot(shot.id, { sfx: parts });
            }}
            placeholder={t('storyboardRow.placeholderSfx')}
            style={editInput}
          />
        )}
      </div>

      {/* 运镜 — 编辑态点击弹出预设下拉;只读态纯文本 */}
      <div
        style={{
          ...gridCellStyle(borderMuted, bgCanvas),
          padding: '2px 4px',
          ...(!readOnly ? { cursor: 'pointer' } : {}),
        }}
        onClick={readOnly ? undefined : (e) => {
          if (cameraOpenId === shot.id) {
            onCameraClose();
          } else {
            const r = e.currentTarget.getBoundingClientRect();
            onCameraOpen(shot.id, { top: r.bottom, left: r.left, width: r.width });
          }
        }}
      >
        {readOnly ? (
          <div style={{ ...blockCell, textAlign: 'left' }}>{shot.cameraMovement || '—'}</div>
        ) : (
          <div style={{ width: '100%', height: '100%', minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', fontSize: 12, color: textColor }}>
            {shot.cameraMovement || '—'}
          </div>
        )}
      </div>

      {/* 运镜下拉:使用 ShotStatePicker（支持自定义输入） */}
      {!readOnly && cameraOpenId === shot.id && cameraRect && (
        <ShotStatePicker
          rect={cameraRect}
          options={CAMERA_MOVEMENT_OPTIONS}
          currentValue={shot.cameraMovement}
          onSelect={(opt) => { onUpdateShot(shot.id, { cameraMovement: opt }); onCameraClose(); }}
          onClose={onCameraClose}
          textColor={textColor}
          mutedColor={mutedColor}
          bgHover={bgHover}
          bgCanvas={bgCanvas}
          borderMuted={borderMuted}
          accent={accent}
          showCustom
        />
      )}

      {/* 2026-08-30: 主体列已移除,原 entities 状态/剧管映射选择器一并删除(shot.entities 仍由 @ 写入,描述列契约色高亮) */}

      {/* 操作 — 仅全屏编辑态;复制该行（镜头描述+提示词，R2-7）+ 删除按钮 */}
      {!readOnly && (
        <div style={{ ...gridCellStyle(borderMuted, bgCanvas), padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <Tooltip title={copied ? t('storyboardRow.copied') : t('storyboardRow.copyShot')}>
            <Button
              size="small"
              type="text"
              icon={copied ? <Check size={13} style={{ color: '#4ade80' }} /> : <Copy size={13} />}
              onClick={(e) => { e.stopPropagation(); void handleCopyRow(); }}
              style={{ width: 24, height: 24, padding: 0, color: mutedColor }}
            />
          </Tooltip>
          <Tooltip title={t('storyboardRow.deleteShot')}>
            <Button
              size="small"
              type="text"
              danger
              icon={<Trash2 size={13} />}
              onClick={(e) => { e.stopPropagation(); onDeleteShot(shot.id); }}
              style={{ width: 24, height: 24, padding: 0, color: mutedColor }}
            />
          </Tooltip>
        </div>
      )}
    </div>
  );
});