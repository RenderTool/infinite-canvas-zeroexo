/**
 * StoryboardRow - 分镜单行编辑组件
 *
 * 从 StoryboardTable.tsx 中抽离的单行编辑逻辑，包含：景别选择/运镜选择/时长输入/描述编辑/删除该行数据。
 */
import { memo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Input, Tooltip, Button } from 'antd';
import { Trash2, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import type { Shot, StoryboardEntity, LightingDesign, EnvironmentDesign, AiSubject, EntityRef } from '../storyboard-types';
import { formatLighting, formatEnvironment, entityDisplayName, resolveEntityKind, ENTITY_KIND_META } from '../storyboard-utils';
import { MentionDropdown } from './EntityManager';
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
  /** Plan#20 T9c: 实体名/别名 → 画布主体卡状态列表(shot entities 的 stateId 选择选项源) */
  subjectStatesByEntity?: Record<string, Array<{ id: string; name: string }>>;
  /** 2026-08-21: 实体名/别名 → 剧管条目列表(主体列点击实体可映射到剧管条目, 剧管=分镜后置) */
  pmItemsByEntity?: Record<string, Array<{ id: string; name: string; kind: string }>>;
  mentionOpen: boolean;
  mentionShotId: string | null;
  onMentionSelect: (entity: StoryboardEntity) => void;
  onMentionOpen: (shotId: string) => void;
  onShotTypeClick: (shotId: string) => void;
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
  subjectStatesByEntity,
  pmItemsByEntity,
  mentionOpen,
  mentionShotId,
  onMentionSelect,
  onMentionOpen,
  onShotTypeClick,
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

  // Plan#20 T9c: entities 列状态选择器(点击实体 chip 弹 ShotStatePicker)
  const [statePicker, setStatePicker] = useState<{ index: number; rect: { top: number; left: number; width: number } } | null>(null);
  // 2026-08-22: 画面描述列统一组件(非编辑态高亮预览 + 点击进入 TextArea 编辑, blur 退出) — 全屏与节点内共用同一渲染路径, 契约色一致
  const [editingDesc, setEditingDesc] = useState(false);

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
  // Plan#20 T3: 主体列条目(双兼容 EntityRef|string) + 描述主体名高亮词表(长名优先避免短名吞长名)
  const entityItems = (Array.isArray(shot.entities) ? shot.entities : []).map(entityDisplayName).filter(Boolean);
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
          <div style={{ position: 'relative', width: '100%' }}>
            <Input.TextArea
              autoFocus
              size="small"
              variant="borderless"
              autoSize={{ minRows: 1, maxRows: 30 }}
              value={descFlat}
              onChange={(e) => {
                const val = e.target.value;
                if (val.endsWith('@')) {
                  onMentionOpen(shot.id);
                }
                onUpdateShot(shot.id, { description: flatten(val) });
              }}
              onBlur={() => setEditingDesc(false)}
              placeholder={t('storyboardRow.placeholderDescription')}
              style={editInput}
            />
            {mentionOpen && mentionShotId === shot.id && (
              <MentionDropdown
                mentionShotId={mentionShotId}
                entities={entities}
                onSelect={onMentionSelect}
                textColor={textColor}
                mutedColor={mutedColor}
                bgHover={bgHover}
                bgCanvas={bgCanvas}
                borderMuted={borderMuted}
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

      {/* 主体 — Plan#20 T3 新增列: kind 徽章(角色/场景/道具色区分, 色板对齐 ENTITY_KIND_META)
          2026-08-22 折叠契约(用户拍板): 节点内(readOnly)折叠本列——描述列已契约色高亮主体; 全屏编辑展开 */}
      {!readOnly && (
        <div style={{ ...gridCellStyle(borderMuted, bgCanvas), padding: '2px 4px' }}>
          <div style={{ ...cellBase, justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
            {entityItems.length === 0 ? '—' : entityItems.map((name, i) => {
              const kind = resolveEntityKind(name, entities, aiSubjects);
              const meta = kind ? ENTITY_KIND_META[kind] : undefined;
              // Plan#20 T9c: EntityRef 形态且能匹配到画布主体卡状态 → 可点击选择状态
              const raw = shot.entities?.[i];
              const ref = raw && typeof raw === 'object' ? (raw as EntityRef) : undefined;
              const states = ref && subjectStatesByEntity ? (subjectStatesByEntity[name] ?? []) : [];
              const activeState = states.find((s) => s.id === ref?.stateId);
              // 2026-08-21: 剧管条目映射选项(剧管=分镜后置, 主体列点击实体可映射到剧管条目)
              const pmOptions = pmItemsByEntity?.[name] ?? [];
              const mappedItem = ref?.cardId ? pmOptions.find((it) => it.id === ref.cardId) : undefined;
              const clickable = !readOnly && (states.length > 0 || pmOptions.length > 0);
              return (
                <span
                  key={`${name}-${i}`}
                  onClick={clickable ? (e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setStatePicker({ index: i, rect: { top: r.top, left: r.left, width: r.width } });
                  } : undefined}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '1px 6px',
                    borderRadius: 999,
                    fontSize: 11,
                    lineHeight: '16px',
                    color: meta?.color ?? textSecondary,
                    background: meta ? `${meta.color}1f` : 'transparent',
                    border: `1px solid ${meta ? `${meta.color}55` : borderMuted}`,
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta?.color ?? textSecondary, flexShrink: 0 }} />
                  {name}
                  {mappedItem && (
                    <span
                      title={t('storyboard.mappedToProduction', { name: mappedItem.name })}
                      style={{ width: 5, height: 5, borderRadius: '50%', background: accent, flexShrink: 0, boxShadow: `0 0 0 2px ${bgCanvas}` }}
                    />
                  )}
                  {activeState && (
                    <span style={{ fontSize: 10, color: textSecondary, background: bgHover, borderRadius: 999, padding: '0 5px', lineHeight: '14px', flexShrink: 0 }}>
                      {activeState.name}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

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
              // Plan#20 T2: 字符串形态整体回写 lighting(保持字符串契约); 对象形态沿用 mood·loc 拆分
              if (typeof shot.lighting === 'string' || typeof shot.environment === 'string') {
                onUpdateShot(shot.id, { lighting: val });
                return;
              }
              const parts = val.split(' · ');
              onUpdateShot(shot.id, {
                lighting: { ...(shot.lighting as LightingDesign), mood: parts[0] || '' },
                environment: { ...(shot.environment as EnvironmentDesign), location: parts[1] || '' },
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

      {/* Plan#20 T9c + 2026-08-21: entities 列状态/剧管映射选择器(点实体 chip 弹窗, stateId/cardId 落 shot.entities) */}
      {!readOnly && statePicker && (
        <ShotStatePicker
          rect={statePicker.rect}
          options={(() => {
            const name = entityItems[statePicker.index] ?? '';
            const pm = (pmItemsByEntity?.[name] ?? []).map((it) => it.name);
            return [...pm, t('storyboard.cancelMapping')];
          })()}
          currentValue={(() => {
            const raw = shot.entities?.[statePicker.index];
            const ref = raw && typeof raw === 'object' ? (raw as EntityRef) : undefined;
            const name = entityItems[statePicker.index] ?? '';
            return (pmItemsByEntity?.[name] ?? []).find((it) => it.id === ref?.cardId)?.name ?? '';
          })()}
          onSelect={(opt) => {
            const name = entityItems[statePicker.index] ?? '';
            const ents = Array.isArray(shot.entities) ? shot.entities.map((e, i) => {
              if (i !== statePicker.index || typeof e !== 'object' || !e) return e;
              if (opt === t('storyboard.cancelMapping')) return { ...e, cardId: undefined };
              const target = (pmItemsByEntity?.[name] ?? []).find((it) => it.name === opt);
              return { ...e, cardId: target?.id };
            }) : shot.entities;
            onUpdateShot(shot.id, { entities: ents as unknown as Shot['entities'] });
            setStatePicker(null);
          }}
          onClose={() => setStatePicker(null)}
          textColor={textColor}
          mutedColor={mutedColor}
          bgHover={bgHover}
          bgCanvas={bgCanvas}
          borderMuted={borderMuted}
          accent={accent}
        />
      )}

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