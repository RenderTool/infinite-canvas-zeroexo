/**
 * WorkbenchPromptDock - 出片工作台提示词输入面板（2026-08-31）
 *
 * 用户要求：**只把数据/逻辑层独立成块，UI 框架必须与画布节点 dock 完全一致**。
 *
 * 实现方式：直接复用 NodeGenerateDock 的三个呈现子组件
 * （DockReferencesSection / DockInputSection / DockFooterBar）——
 * 视觉、交互、布局零改动；本组件只负责把 WorkbenchShot 数据归一化为
 * 这三个子组件所需的 props（数据视图分离）。
 *
 * 数据流：
 *   workbench-sheet (currentShot 受控数据)
 *     → WorkbenchPromptDock（归一化组装）
 *       → DockReferencesSection（参考素材区）/ DockInputSection（输入区）/ DockFooterBar（底栏）
 */
import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Film, ChevronUp, ChevronDown } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import {
  DockReferencesSection,
  DockInputSection,
  DockFooterBar,
} from '@/features/tools-dock/node-generate-dock.js';
import type { GenerationMode } from '@/features/tools-dock/node-generate-dock.js';

// ===== 折叠常量（与 NodeGenerateDock 同款，保证视觉一致） =====
const COLLAPSE_EASE = '0.28s cubic-bezier(0.22, 1, 0.36, 1)';
const COLLAPSED_BAR_HEIGHT = 34;
import { apiGet } from '@/services/api-client.js';
import { filterChannelModelsByCapability } from '@/features/ai-config/use-ai-config-store.js';
import type { ModelCapability, ModelChannel } from '@/features/ai-config/use-ai-config-store.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import type { WorkbenchShotReference } from './workbench-types';

export type WorkbenchPromptDockMode = GenerationMode;

export interface WorkbenchPromptDockProps {
  /** 唯一键（= 当前镜头 id），仅用于调试标记 */
  shotId: string;
  /** 提示词文本（受控，读写 currentShot.imagePrompt） */
  value: string;
  onValueChange: (value: string) => void;
  /** 参考素材列表（受控，读写 currentShot.references） */
  references: WorkbenchShotReference[];
  onReferencesChange: (items: WorkbenchShotReference[]) => void;
  /** 模型（"channelId::model" 编码） */
  model?: string;
  onModelChange: (model: string) => void;
  /** 契约参数值 */
  paramValues: Record<string, any>;
  onParamValuesChange: (patch: Record<string, any>) => void;
  /** 是否生成中 */
  isRunning: boolean;
  onGenerate: () => void;
  onStop: () => void;
  /** 生成模式（出片工作台 = video） */
  mode?: GenerationMode;
  /** 首尾帧从当前视频取帧（T2，2026-08-31） */
  onExtractFrame?: (slot: 'first' | 'last') => void;
  /** 展开高度（px）。默认 285，折叠时收缩为 34px 细条吸附底部（fitToHeight 语义）。 */
  expandedHeight?: number;
}

/** 模型渠道加载（与 NodeGenerateDock 同源，复用全局渠道接口） */
function useModelChannels() {
  const [channels, setChannels] = useState<ModelChannel[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiGet<{ items: Array<{
      id: string; name: string; provider: string; baseUrl: string;
      apiFormat: string; modelIcons?: Record<string, string>;
      models: Array<{ name: string; capabilities?: string[] }>;
    }> }>('/ai/channels')
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        setChannels(items.map((item) => ({
          id: item.id,
          name: item.name,
          provider: item.provider,
          baseUrl: item.baseUrl,
          apiKey: '',
          apiFormat: (item.apiFormat as 'openai' | 'gemini') || 'openai',
          models: Array.isArray(item.models) ? item.models.map((m) => m.name) : [],
          modelConfigs: Array.isArray(item.models) ? item.models.map((m) => ({
            name: m.name,
            capabilities: m.capabilities ?? [],
          })) : undefined,
          modelIcons: item.modelIcons || {},
        })));
      })
      .catch(() => { if (!cancelled) setChannels([]); });
    return () => { cancelled = true; };
  }, []);
  return channels;
}

function modeCapability(mode: GenerationMode): ModelCapability {
  if (mode === 'image' || mode === 'video' || mode === 'audio') return mode;
  return 'text';
}

/**
 * WorkbenchPromptDock - 出片工作台提示词面板
 *
 * 布局与 NodeGenerateDock 完全一致：
 *   ┌ 参考素材区（DockReferencesSection）──────────────┐
 *   │ 输入区（DockInputSection / GeneratorPromptEditor）│
 *   │ 底栏（DockFooterBar：模型+参数+字数+生成）        │
 *   └────────────────────────────────────────────────┘
 */
export const WorkbenchPromptDock = memo(function WorkbenchPromptDock({
  shotId,
  value,
  onValueChange,
  references,
  onReferencesChange,
  model,
  onModelChange,
  paramValues,
  onParamValuesChange,
  isRunning,
  onGenerate,
  onStop,
  mode = 'video',
  onExtractFrame,
  expandedHeight = 285,
}: WorkbenchPromptDockProps): ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';

  const channels = useModelChannels();

  // 模型选项（按 mode 能力过滤，与 NodeGenerateDock 同源）
  const modelOptions = useMemo(() => {
    const encoded = filterChannelModelsByCapability(channels, modeCapability(mode));
    return encoded.map((enc) => {
      const parts = enc.split('::');
      const modelName = parts[1] ?? enc;
      const ch = channels.find((c) => c.id === parts[0]);
      const iconKey = ch?.modelIcons?.[modelName] || ch?.provider || undefined;
      return { value: enc, label: ch ? `${modelName}(${ch.name})` : modelName, iconKey };
    });
  }, [channels, mode]);

  // 参考素材 → DockReferencesSection 的 incomingNodes 归一化
  // （id=ref.id, type=ref.kind, title=ref.title, content=预览url, storageKey）
  const incomingNodes = useMemo(() => {
    return references.map((r) => ({
      id: r.id,
      type: r.kind === 'text' ? 'text' : r.kind,
      title: r.title ?? (r.slot ? `@${r.slot}` : r.storageKey ?? r.kind),
      content: r.url,
      storageKey: r.storageKey,
    }));
  }, [references]);

  // 缩略图 url 映射（DockReferencesSection 用 refUrlMap[n.id] 渲染封面）
  const refUrlMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of references) {
      if (r.url) map[r.id] = r.url;
      else if (r.kind === 'image' && r.storageKey) map[r.id] = r.storageKey;
    }
    return map;
  }, [references]);

  // 兼容性全部视为 true（出片工作台无画布节点类型兼容性概念）
  const nodeCompatibility = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const r of references) map[r.id] = true;
    return map;
  }, [references]);

  // 参考素材模式（从 paramValues.mode 推导，与 NodeGenerateDock 同款）
  const currentVideoMode = mode === 'video' && typeof paramValues?.mode === 'string'
    ? paramValues.mode
    : 'multi-modal-reference';
  const refBounds: { maxReferenceImages?: number; maxReferenceVideos?: number; maxReferenceAudios?: number } = {};

  // 受控上传：上传 → 写入 references
  const handleUpload = useCallback(async (file: File) => {
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data;
      let refKind: WorkbenchShotReference['kind'] = 'text';
      let storageKey: string | undefined;
      let url: string | undefined;
      if (d.kind === 'image') {
        refKind = 'image'; storageKey = d.storageKey; url = d.dataUrl;
      } else if (d.kind === 'video') {
        refKind = 'video'; storageKey = d.storageKey; url = d.url;
      } else if (d.kind === 'audio') {
        refKind = 'audio'; storageKey = d.storageKey; url = d.url;
      }
      const ref: WorkbenchShotReference = {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: refKind,
        title: uploaded.title.replace(/\.[^.]+$/, ''),
        storageKey,
        url,
      };
      onReferencesChange([...references, ref]);
    } catch {
      // 上传失败静默（不打断当前编辑）
    }
  }, [onReferencesChange, references]);

  // 移除参考
  const handleRemoveRef = useCallback((sourceNodeId: string) => {
    onReferencesChange(references.filter((r) => r.id !== sourceNodeId));
  }, [onReferencesChange, references]);

  // 底栏交互：生成/停止（与 NodeGenerateDock 语义一致）
  const handleAction = useCallback(() => {
    if (isRunning) onStop();
    else onGenerate();
  }, [isRunning, onStop, onGenerate]);

  const hasText = value.trim().length > 0;

  // ===== 折叠/收起（2026-08-31 恢复：与 NodeGenerateDock 同款细条 + 0fr↔1fr 过渡） =====
  // 折叠细条与展开内容始终同在 DOM：细条 height→0 + 淡出，内容用 grid-template-rows 0fr→1fr 过渡；
  // 折叠态内容 overflow hidden + pointerEvents none（不可点，不卸载 → 再次展开无白屏）。
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      data-workbench-prompt-dock
      data-shot-id={shotId}
      style={{
        width: '100%',
        // 2026-08-31 恢复 fitToHeight 折叠语义：自身管理高度
        // 展开 = expandedHeight(默认 285)；折叠 = 34px 细条 + marginTop:auto 吸附底部
        height: collapsed ? COLLAPSED_BAR_HEIGHT : expandedHeight,
        flexShrink: 0,
        marginTop: collapsed ? 'auto' : 0,
        transition: `height ${COLLAPSE_EASE}, margin-top ${COLLAPSE_EASE}`,
        display: 'flex', flexDirection: 'column',
        background: theme.toolbar.panel ?? (isDark ? '#1e1e20' : '#fafaf7'),
        color: theme.toolbar.text, overflow: 'hidden',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 折叠细条（展开时高度收为 0 并淡出） */}
      <div
        style={{
          height: collapsed ? COLLAPSED_BAR_HEIGHT : 0,
          opacity: collapsed ? 1 : 0,
          transform: collapsed ? 'translateY(0)' : 'translateY(-6px)',
          transition: `height ${COLLAPSE_EASE}, opacity 0.18s ease, transform ${COLLAPSE_EASE}`,
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          padding: '0 14px', boxSizing: 'border-box', overflow: 'hidden',
          color: theme.toolbar.text, fontSize: 12, cursor: 'pointer', userSelect: 'none',
          pointerEvents: collapsed ? 'auto' : 'none',
        }}
        onClick={(e) => { e.stopPropagation(); setCollapsed(false); }}
        title={t('nodeDock.expand', '展开生成面板')}
      >
        <span style={{ display: 'inline-flex', flexShrink: 0 }}><Film size={14} /></span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {t('canvasNodes.stage.workbench', '出片')} · {t('nodeDock.generate', '生成')}
        </span>
        <ChevronUp size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
      </div>

      {/* 展开内容（折叠时 grid rows 收为 0fr） */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: collapsed ? '0fr' : '1fr',
          opacity: collapsed ? 0 : 1,
          transform: collapsed ? 'translateY(-4px)' : 'translateY(0)',
          transition: `grid-template-rows ${COLLAPSE_EASE}, opacity 0.2s ease, transform ${COLLAPSE_EASE}`,
          pointerEvents: collapsed ? 'none' : 'auto',
          flex: 1, minHeight: 0,
        }}
        aria-hidden={collapsed}
      >
        <div style={{ overflow: 'hidden', minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {/* 收起按钮（右上角小图标） */}
          <button
            type="button"
            title={t('nodeDock.collapse', '收起')}
            onClick={(e) => { e.stopPropagation(); setCollapsed(true); }}
            style={{
              position: 'absolute', top: 8, right: 8, zIndex: 2,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 20, border: 'none', borderRadius: 8,
              background: 'transparent', color: theme.toolbar.text, cursor: 'pointer',
              padding: 0, transition: 'opacity 0.12s', opacity: 0.45,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.45'; }}
          >
            <ChevronDown size={13} />
          </button>

          {/* 参考素材区（与 NodeGenerateDock 同款 UI，原样复用） */}
          <div style={{ margin: '0 10px', padding: '10px 14px 4px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <DockReferencesSection
              nodeId={shotId}
              incomingNodes={incomingNodes}
              refUrlMap={refUrlMap}
              nodeCompatibility={nodeCompatibility}
              onRemoveIncoming={handleRemoveRef}
              mode={currentVideoMode}
              bounds={refBounds}
              onUpload={handleUpload}
              onExtractFrame={onExtractFrame}
            />
          </div>

          {/* 输入区（与 NodeGenerateDock 同款 UI，原样复用；可压缩滚动区域） */}
          <div style={{ margin: '0 10px', padding: '4px 14px', flex: 1, minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <DockInputSection
              value={value}
              onChange={onValueChange}
              references={[]}
              placeholder={t('nodeDock.placeholder', '输入提示词... 连入的素材会自动作为输入源(堆叠节点需 @ 内部资源)')}
            />
          </div>

          {/* 底栏（与 NodeGenerateDock 同款 UI，原样复用）
               ⚠️ DockFooterBar 内部是裸片段，必须由宿主包 flex 容器排布
               （与 node-generate-dock.tsx line 1363 同款：flex + center + gap + wrap）
               —— 缺 flex 会导致模型/参数/按钮块级堆叠，生成按钮换行。 */}
          <div style={{ margin: '0 10px 10px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <DockFooterBar
              nodeId={shotId}
              mode={mode}
              model={model ?? ''}
              modelOptions={modelOptions}
              paramValues={paramValues}
              isRunning={isRunning}
              hasText={hasText}
              textLength={value.length}
              interruptible={mode === 'text'}
              onAction={handleAction}
              onConfigChange={(_id, patch) => {
                if (typeof patch.model === 'string') onModelChange(patch.model);
              }}
              onParamValuesChange={onParamValuesChange}
              dropUp={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
