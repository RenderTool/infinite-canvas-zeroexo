/**
 * StoryboardTable - 分镜表格渲染组件
 *
 * 包含：分镜表格渲染、列配置、网格样式。
 * 单行编辑逻辑已抽离至 StoryboardRow，运镜选择器已抽离至 ShotStatePicker。
 */
import { memo, type CSSProperties, type ReactElement } from 'react';
import { Button } from 'antd';
import { RotateCcw, Maximize } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import i18n from '@/i18n/config';
import type { Shot, StoryboardEntity, EpisodeStatus, AiSubject } from '../storyboard-types';
import { StoryboardRow } from './StoryboardRow';
import { StoryboardGeneratingLoader } from './StoryboardGeneratingLoader';

// ===== 运镜预设选项 =====

export const CAMERA_MOVEMENT_OPTIONS = ['固定', '推', '拉', '摇', '移', '跟', '升', '降', '旋转', '晃动'];

// ===== 列配置 =====

// Plan#20 T3: prompt→promptText 对齐后端契约 + 补 dayNight/entities 列(列序与 NODE_COLUMN_KEYS 一致)
export const COLUMN_CONFIG = {
  gridTemplateColumns: '5.6% 5.0% 5.6% 18.0% 12.0% 7.4% 9.7% 13.8% 7.4% 7.9% 4.0% 3.6%',
  columns: [
    { key: 'number', title: i18n.t('storyboardTable.shotNumber'), widthPct: 5.6 },
    { key: 'dayNight', title: i18n.t('storyboardTable.dayNight'), widthPct: 5.0 },
    { key: 'duration', title: i18n.t('storyboardTable.duration'), widthPct: 5.6 },
    { key: 'description', title: i18n.t('storyboardTable.description'), widthPct: 18.0, textLeft: true },
    { key: 'entities', title: i18n.t('storyboardTable.entities'), widthPct: 12.0, textLeft: true },
    { key: 'shotType', title: i18n.t('storyboardTable.shotType'), widthPct: 7.4 },
    { key: 'lighting', title: i18n.t('storyboardTable.lighting'), widthPct: 9.7, textLeft: true },
    { key: 'dialogue', title: i18n.t('storyboardTable.dialogue'), widthPct: 13.8, textLeft: true },
    { key: 'sfx', title: i18n.t('storyboardTable.sfx'), widthPct: 7.4, textLeft: true },
    { key: 'cameraMovement', title: i18n.t('storyboardTable.cameraMovement'), widthPct: 7.9, textLeft: true },
    { key: 'promptText', title: i18n.t('storyboardTable.finalPrompt'), widthPct: 4.0 },
    { key: 'actions', title: i18n.t('storyboardTable.actions'), widthPct: 3.6 },
  ],
};

export const NODE_COLUMN_KEYS = ['number', 'dayNight', 'duration', 'description', 'entities', 'shotType', 'lighting', 'dialogue', 'sfx', 'cameraMovement'];
export const NODE_GRID_TEMPLATE = '6.0% 5.5% 6.0% 19.5% 13.0% 8.0% 10.5% 15.0% 8.0% 8.5%';
export const EDIT_COLUMN_KEYS = [...NODE_COLUMN_KEYS, 'actions'];
export const EDIT_GRID_TEMPLATE = '5.6% 5.1% 5.6% 18.2% 12.1% 7.5% 9.8% 14.0% 7.5% 8.0% 6.6%';

// ===== 网格样式函数 =====

export const gridCellStyle = (border: string, bg: string): CSSProperties => ({
  borderBottom: `1px solid ${border}`,
  borderRight: `1px solid ${border}`,
  padding: 0,
  background: bg,
  overflow: 'hidden',
  boxSizing: 'border-box',
});

export const gridHeaderCellStyle = (border: string, bg: string): CSSProperties => ({
  ...gridCellStyle(border, bg),
  fontWeight: 500,
  textAlign: 'center',
  whiteSpace: 'nowrap',
  userSelect: 'none',
});

// ===== Props =====

export interface StoryboardTableProps {
  readOnly: boolean;
  shots: Shot[];
  paginatedShots: Shot[];
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
  /** Plan#20 T3: 后端主体字典(主体列 kind 徽章查找源, 未命中 entities 时兑底) */
  aiSubjects?: AiSubject[];
  /** Plan#20 T9c: 实体名/别名 → 画布主体卡状态列表(shot entities 的 stateId 选择选项源) */
  subjectStatesByEntity?: Record<string, Array<{ id: string; name: string }>>;
  mentionOpen: boolean;
  mentionShotId: string | null;
  onMentionSelect: (entity: StoryboardEntity) => void;
  onMentionOpen: (shotId: string) => void;
  onShotTypeClick: (shotId: string) => void;
  status: EpisodeStatus;
  /** 当前集生成进度 0-100(生成中有效) */
  progress?: number;
  nodeId: string;
  linkedScript: { id: string; title?: string } | undefined;
  activeEpisode: { id: string; title?: string } | undefined;
  activeEpisodeId: string;
}

// ===== 表格渲染 =====

export const StoryboardTable = memo(function StoryboardTable({
  readOnly,
  shots,
  paginatedShots,
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
  status,
  progress,
  nodeId,
  linkedScript,
  activeEpisode,
  activeEpisodeId,
}: StoryboardTableProps): ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const mutedColor = theme.toolbar.textMuted;
  const bgHeader = isDark ? '#1f1f1f' : '#f5f5f5';
  const borderMuted = isDark ? '#2e2e2e' : '#e5e5e5';
  const textSecondary = isDark ? '#a8a8a8' : '#57534e';

  const fontSize = 11;

  const headerKeys = readOnly ? NODE_COLUMN_KEYS : EDIT_COLUMN_KEYS;
  const gridTemplate = readOnly ? NODE_GRID_TEMPLATE : EDIT_GRID_TEMPLATE;
  const headerCols = COLUMN_CONFIG.columns.filter((c) => headerKeys.includes(c.key));

  const renderHeader = () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: gridTemplate,
        flexShrink: 0,
        background: bgHeader,
      }}
    >
      {headerCols.map((col) => (
        <div
          key={col.key}
          style={{
            ...gridHeaderCellStyle(borderMuted, bgHeader),
            fontSize,
            padding: '0.75rem 0.4rem',
            color: textSecondary,
            textAlign: col.textLeft ? 'left' : 'center',
          }}
        >
          {col.title}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', cursor: 'default' }}>
      {renderHeader()}
      {shots.length === 0 && status === 'generating' ? (
        <StoryboardGeneratingLoader
          status="generating"
          progress={progress}
          onCancel={() => nodeActionBus.emit('storyboard:stopGenerate', { nodeId })}
        />
      ) : shots.length === 0 && status === 'error' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <div style={{ fontSize, color: textSecondary }}>{t('storyboardTable.generationFailed')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              size="small"
              type="primary"
              icon={<RotateCcw size={12} />}
              onClick={() => nodeActionBus.emit('storyboard:retryGenerate', { nodeId })}
              style={{ fontSize: 12 }}
            >
              {t('storyboardTable.retry')}
            </Button>
            <Button
              size="small"
              icon={<Maximize size={12} />}
              onClick={() => nodeActionBus.emit('storyboard:abandon', { nodeId })}
              style={{ fontSize: 12 }}
            >
              {t('storyboardTable.abandon')}
            </Button>
          </div>
        </div>
      ) : shots.length === 0 ? (
        <div style={{ flex: 1, textAlign: 'center', padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <div style={{ color: mutedColor, fontSize, fontStyle: 'italic' }}>
            {linkedScript
              ? activeEpisode
                ? t('storyboardTable.linkedScriptNotGenerated', {
                    script: linkedScript.title || t('storyboard.script'),
                    episode: activeEpisode.title || t('storyboardTable.currentEpisode'),
                  })
                : t('storyboardTable.linkedScriptNoEpisode')
              : t('storyboardTable.noShotsLinked')}
          </div>
          {linkedScript && (
            <Button
              size="small"
              type="primary"
              icon={<RotateCcw size={12} />}
              onClick={() => nodeActionBus.emit('storyboard:regenerateEpisode', { nodeId, episodeId: activeEpisodeId })}
              style={{ fontSize: 12 }}
            >
              {t('storyboardTable.generateCurrentEpisode')}
            </Button>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {paginatedShots.map((shot) => (
            <StoryboardRow
              key={shot.id}
              shot={shot}
              readOnly={readOnly}
              selectedRowId={selectedRowId}
              onRowSelect={onRowSelect}
              selectedShotIds={selectedShotIds}
              onToggleSelect={onToggleSelect}
              onDeleteShot={onDeleteShot}
              onUpdateShot={onUpdateShot}
              cameraOpenId={cameraOpenId}
              cameraRect={cameraRect}
              onCameraOpen={onCameraOpen}
              onCameraClose={onCameraClose}
              entities={entities}
              aiSubjects={aiSubjects}
              subjectStatesByEntity={subjectStatesByEntity}
              mentionOpen={mentionOpen}
              mentionShotId={mentionShotId}
              onMentionSelect={onMentionSelect}
              onMentionOpen={onMentionOpen}
              onShotTypeClick={onShotTypeClick}
            />
          ))}
        </div>
      )}
    </div>
  );
});