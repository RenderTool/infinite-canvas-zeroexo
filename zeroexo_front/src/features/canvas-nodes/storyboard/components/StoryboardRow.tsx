/**
 * StoryboardRow - 分镜单行编辑组件
 *
 * 从 StoryboardTable.tsx 中抽离的单行编辑逻辑，包含：景别选择/运镜选择/时长输入/描述编辑/删除该行数据。
 */
import { memo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Input, Tooltip, Button } from 'antd';
import { Trash2 } from 'lucide-react';
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

  const sfx = Array.isArray(shot.sfx) ? shot.sfx : [];
  // Plan#20 T2: 光影/环境双兼容字符串化展示(后端产出字符串 / 旧数据对象)
  const lightingText = formatLighting(shot.lighting);
  const envText = formatEnvironment(shot.environment);
  const moodLocParts: string[] = [];
  if (lightingText) moodLocParts.push(lightingText);
  if (envText) moodLocParts.push(envText);
  const moodLocText = moodLocParts.join(' · ') || null;
  // Plan#20 T3: 主体列条目(双兼容 EntityRef|string) + 描述主体名高亮词表(长名优先避免短名吞长名)
  const entityItems = (Array.isArray(shot.entities) ? shot.entities : []).map(entityDisplayName).filter(Boolean);
  const highlightNames = [
    ...new Set([
      ...entities.map((e) => e.name),
      ...(aiSubjects ?? []).map((s) => s.name),
    ]),
  ].filter(Boolean).sort((a, b) => b.length - a.length);
  const gridTemplate = readOnly ? NODE_GRID_TEMPLATE : EDIT_GRID_TEMPLATE;
  const cellBase: CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '0.375rem 0.25rem', fontSize: 12, width: '100%', height: '100%', minHeight: 60, color: textColor, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden' };
  const editInput: CSSProperties = { width: '100%', fontSize: 12, lineHeight: '20px', color: textColor, whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 60, padding: '0.375rem 0.25rem', resize: 'none', background: 'transparent', border: 'none', boxShadow: 'none', outline: 'none' };

  // Plan#20 T3: 描述列主体名高亮(只读态; 长名优先匹配, 命中用 accent 色标注)
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
      nodes.push(<span key={key++} style={{ color: accent, fontWeight: 600 }}>{best.name}</span>);
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

      {/* 画面描述 — 编辑态直接编辑 + @ 提及;只读态纯文本(主体名高亮) */}
      <div style={{ ...gridCellStyle(borderMuted, bgCanvas), padding: '2px 4px' }}>
        {readOnly ? (
          <div style={{ ...cellBase, justifyContent: 'flex-start', textAlign: 'left' }}>{shot.description ? highlightMentions(shot.description) : '—'}</div>
        ) : (
          <div style={{ position: 'relative', width: '100%' }}>
            <Input.TextArea
              size="small"
              variant="borderless"
              autoSize={{ minRows: 1, maxRows: 30 }}
              value={shot.description}
              onChange={(e) => {
                const val = e.target.value;
                if (val.endsWith('@')) {
                  onMentionOpen(shot.id);
                }
                onUpdateShot(shot.id, { description: val });
              }}
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
        )}
      </div>

      {/* 主体 — Plan#20 T3 新增列: kind 徽章(角色/场景/道具色区分, 色板对齐 ENTITY_KIND_META) */}
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
            const clickable = states.length > 0 && !readOnly;
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

      {/* 景别 — 编辑态点击弹出取景器;只读态纯文本 */}
      <div
        style={{
          ...gridCellStyle(borderMuted, bgCanvas),
          padding: '2px 4px',
          ...(!readOnly ? { cursor: 'pointer' } : {}),
        }}
        onClick={readOnly ? undefined : () => { onShotTypeClick(shot.id); }}
      >
        <div style={{ width: '100%', height: '100%', minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: accentCyan }}>
          {shot.shotType || '—'}
        </div>
      </div>

      {/* 光影氛围 — 编辑态直接编辑;只读态纯文本 */}
      <div style={{ ...gridCellStyle(borderMuted, bgCanvas), padding: '2px 4px' }}>
        {readOnly ? (
          <div style={{ ...cellBase, justifyContent: 'flex-start', textAlign: 'left' }}>{moodLocText || '—'}</div>
        ) : (
          <Input.TextArea
            size="small"
            variant="borderless"
            autoSize={{ minRows: 1, maxRows: 30 }}
            value={moodLocText || ''}
            onChange={(e) => {
              const val = e.target.value;
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

      {/* 对白·旁白 — 编辑态直接编辑;只读态纯文本 */}
      <div style={{ ...gridCellStyle(borderMuted, bgCanvas), padding: '2px 4px' }}>
        {readOnly ? (
          <div style={{ ...cellBase, justifyContent: 'flex-start', textAlign: 'left' }}>{shot.dialogue || '—'}</div>
        ) : (
          <Input.TextArea
            size="small"
            variant="borderless"
            autoSize={{ minRows: 1, maxRows: 30 }}
            value={shot.dialogue || ''}
            onChange={(e) => onUpdateShot(shot.id, { dialogue: e.target.value })}
            placeholder={t('storyboardRow.placeholderDialogue')}
            style={editInput}
          />
        )}
      </div>

      {/* 音效 — 编辑态直接编辑;只读态纯文本 */}
      <div style={{ ...gridCellStyle(borderMuted, bgCanvas), padding: '2px 4px' }}>
        {readOnly ? (
          <div style={{ ...cellBase, justifyContent: 'flex-start', textAlign: 'left' }}>{sfx.join(' · ') || '—'}</div>
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
          <div style={{ ...cellBase, justifyContent: 'flex-start', textAlign: 'left' }}>{shot.cameraMovement || '—'}</div>
        ) : (
          <div style={{ width: '100%', height: '100%', minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', fontSize: 12, color: textColor }}>
            {shot.cameraMovement || '—'}
          </div>
        )}
      </div>

      {/* 运镜下拉:使用 ShotStatePicker */}
      {!readOnly && cameraOpenId === shot.id && cameraRect && (
        <ShotStatePicker
          rect={cameraRect}
          options={CAMERA_MOVEMENT_OPTIONS}
          currentValue={shot.cameraMovement}
          onSelect={(opt) => { onUpdateShot(shot.id, { cameraMovement: opt as any }); onCameraClose(); }}
          onClose={onCameraClose}
          textColor={textColor}
          mutedColor={mutedColor}
          bgHover={bgHover}
          bgCanvas={bgCanvas}
          borderMuted={borderMuted}
          accent={accent}
        />
      )}

      {/* Plan#20 T9c: entities 列状态选择器(点实体 chip 弹窗选状态,stateId 落 shot.entities) */}
      {!readOnly && statePicker && (
        <ShotStatePicker
          rect={statePicker.rect}
          options={(() => {
            const name = entityItems[statePicker.index];
            const states = (name && subjectStatesByEntity ? subjectStatesByEntity[name] : undefined) ?? [];
            return states.map((s) => s.name);
          })()}
          currentValue={(() => {
            const raw = shot.entities?.[statePicker.index];
            const ref = raw && typeof raw === 'object' ? (raw as EntityRef) : undefined;
            const name = entityItems[statePicker.index];
            const states = (name && subjectStatesByEntity ? subjectStatesByEntity[name] : undefined) ?? [];
            return states.find((s) => s.id === ref?.stateId)?.name ?? '';
          })()}
          onSelect={(opt) => {
            const name = entityItems[statePicker.index];
            const states = (name && subjectStatesByEntity ? subjectStatesByEntity[name] : undefined) ?? [];
            const target = states.find((s) => s.name === opt);
            const ents = Array.isArray(shot.entities) ? shot.entities.map((e, i) => {
              if (i !== statePicker.index || typeof e !== 'object' || !e) return e;
              return { ...e, stateId: target?.id ?? undefined };
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

      {/* 操作 — 仅全屏编辑态;放置删除按钮 */}
      {!readOnly && (
        <div style={{ ...gridCellStyle(borderMuted, bgCanvas), padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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