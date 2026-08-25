// TODO(拆分): 该文件超过 1000 行，计划按「状态层/交互层/渲染层」拆分，见 DESIGN.md
/**
 * useEditorInteractions - 画布编辑页交互回调逻辑
 *
 * 从 EditorPage 提取的交互回调、计算值和事件监听,统一管理。
 */

import { useCallback, createElement, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { App } from 'antd';
import { EDITOR_ICONS } from './icons.js';
import { useTheme } from '@zeroexo/plugin-theme';
import { AddNodeCommand, AddEdgeCommand, RemoveEdgeCommand, RemoveNodeCommand, DuplicateNodeCommand, UpdateNodeDataCommand, UpdateNodeTitleCommand, MoveNodeCommand, ResizeNodeCommand, BatchCommand, resolveNodeSize, resolvePlacement } from '@zeroexo/core';
import type { Command, NodeRecord, NodeTypeExtension, ToolContext, ToolDefinition } from '@zeroexo/core';
import type {
  ImageNodeData,
  VideoNodeData,
  AudioNodeData,
} from '@zeroexo/plugin-ai-provider';
import { AiError, classifyError } from '@zeroexo/plugin-ai-provider';
import type { AiErrorType } from '@zeroexo/plugin-ai-provider';
import { nodeActionBus, replaceNodeImage, replaceNodeVideo, replaceNodeAudio, convertToStack, createStackNode, stackSelectedNodes, resolveStackSpawnPosition, createAssetNode } from '@zeroexo/plugin-nodes';
import type { AssetNodePayload, ReferenceItem } from '@zeroexo/plugin-nodes';
import { duplicateSubtree } from '@zeroexo/preset-default';
import { apiGet } from '@/services/api-client.js';
import { PREVIEW_GROUP_ID, getChildren, getGroupBounds, getGroupBoundsWithEmptyFallback, MoveGroupCommand } from '@zeroexo/plugin-group';
import { arrangeNodes, alignNodes, distributeNodes, unifyNodeSizes } from '@zeroexo/plugin-layout';
import type { ArrangeMode, AlignMode, DistributeMode, UnifySizeMode, LayoutNode } from '@zeroexo/plugin-layout';
import { configToPinDefaults, configToNodeDefaults, configToGroupDefaults } from '@/features/top-bar/index.js';
import type { CanvasConfig } from '@/features/top-bar/index.js';
import type { GenerationMode } from '@/features/tools-dock/node-generate-dock';
import { assetInputFromNode, serializeScriptContent } from '@/features/asset-picker/services/upload-asset.js';
import { modelOptionLabel } from '@/features/ai-config/use-ai-config-store.js';
import type { AiConfig } from '@/features/ai-config/use-ai-config-store.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import type { EditorRefs } from './use-editor-state.js';
import type { ContextMenuItem } from '@/shared/components/index.js';
import type { ImageDialogState } from '@/features/image-editor/image-dialog-renderer.js';
import type { Shot, StoryboardNodeData } from '@/features/canvas-nodes/storyboard/storyboard-types.js';
import { normalizeShotForUi, SAMPLE_SUBJECTS } from '@/features/canvas-nodes/storyboard/storyboard-utils.js';
import { createProductionItem, productionItemKeys, type ProductionItem, type ProductionItemKind } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import { agentClient } from '@/features/agent-panel/AgentClient.js';
import { buildTemplateParams } from './interactions/ai-generation-utils.js';
import { promptTitleSummary } from './interactions/ai-generation.js';
import { collectAgentNodeSnapshots, notifyAgentNodesDeleted } from '@/features/canvas-agent/ui/agent-node-reminder.js';
import i18n from '@/i18n/config';

// ===== 反推提示词预设 =====
const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

// 节点类型 → 输入/输出引脚 id(NodeGenerateDock 参考素材连线用;image/video/audio 的输入引脚是 prompt,输出引脚按类型命名)
const NODE_INPUT_PIN: Record<string, string> = { text: 'input', image: 'prompt', video: 'prompt', audio: 'prompt' };
const NODE_OUTPUT_PIN: Record<string, string> = { text: 'output', image: 'image', video: 'video', audio: 'audio' };

/** 将 content(blob:/data:/http URL)转为 dataUrl(base64),供 AI referenceImages 使用 */
async function contentToDataUrl(content: string): Promise<string> {
  if (content.startsWith('data:')) return content;
  if (content.startsWith('blob:')) {
    const res = await fetch(content);
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  // http(s) URL 直接返回
  return content;
}

/** 将剧本剧集 HTML 内容提取为纯文本 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 计算节点列表包围盒(用于多选堆叠的新节点落点) */
function computeNodesBounds(nodes: NodeRecord[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const x = n.position?.x ?? 0;
    const y = n.position?.y ?? 0;
    // 包围盒估算:无尺寸节点统一走契约兜底(FALLBACK_NODE_SIZE)
    const { width: w, height: h } = resolveNodeSize(n);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** 范文模板分镜(与剧本范文内容一致,标注 isSample 供分镜节点渲染"范文示例") */
function buildTemplateShots(): Shot[] {
  const now = Date.now();
  const base: Array<{
    sceneId: string; duration: number; description: string; shotType: Shot['shotType'];
    cameraMovement: Shot['cameraMovement']; dialogue: string; lighting: string; location: string;
    emotion: string; sfx: string[]; dayNight: string; entities: string[];
  }> = [
    { sceneId: '1-1', duration: 5, description: '黄昏江边，夕阳洒在江面上泛起金色波光。男主站在栈桥尽头，望向远方。', shotType: '远景', cameraMovement: '固定', dialogue: '又到了这个时间。', lighting: '黄昏逆光，暖金色调', location: '江边栈桥', emotion: '怅惘', sfx: ['江水声', '风声'], dayNight: '黄昏', entities: ['男主', '江边栈桥'] },
    { sceneId: '1-2', duration: 4, description: '镜头推近男主面部特写，风吹动他的发丝，眼神中带着回忆。', shotType: '近景', cameraMovement: '推', dialogue: '', lighting: '侧逆光，黄昏余晖', location: '江边栈桥', emotion: '怀念', sfx: ['微风'], dayNight: '黄昏', entities: ['男主'] },
    { sceneId: '1-3', duration: 6, description: '女主从远处走来，逆光剪影，脚步轻盈。男主回头，两人四目相对。', shotType: '中景', cameraMovement: '移', dialogue: '你来了。', lighting: '逆光剪影，暖色调', location: '江边栈桥', emotion: '温暖', sfx: ['脚步声'], dayNight: '黄昏', entities: ['男主', '女主', '江边栈桥'] },
    { sceneId: '2-1', duration: 5, description: 'CUT TO 老茶馆内，木桌竹椅，茶香袅袅。两人相对而坐，端起茶碗。', shotType: '中景', cameraMovement: '固定', dialogue: '这么多年，还是这家茶馆。', lighting: '室内暖黄灯光', location: '老茶馆', emotion: '平静', sfx: ['瓷器碰撞声', '水声'], dayNight: '夜', entities: ['男主', '女主', '老茶馆'] },
    { sceneId: '2-2', duration: 4, description: '男主为女主斟茶，氤氲的茶气升起，两人的手在桌边交错。', shotType: '特写', cameraMovement: '固定', dialogue: '', lighting: '暖黄侧光', location: '老茶馆', emotion: '温情', sfx: ['倒水声'], dayNight: '夜', entities: ['男主', '女主', '老茶馆'] },
  ];
  return base.map((s, i) => ({
    id: `shot-${now}-${i + 1}`,
    number: i + 1,
    sceneId: s.sceneId,
    dayNight: s.dayNight,
    duration: s.duration,
    description: s.description,
    shotType: s.shotType,
    cameraMovement: s.cameraMovement,
    dialogue: s.dialogue,
    voiceoverText: '',
    monologue: '',
    sfx: s.sfx,
    entities: s.entities,
    emotion: s.emotion,
    lighting: { keyLight: '自然光', colorTemp: '5500K', mood: s.lighting },
    environment: { location: s.location, time: '傍晚', weather: '晴' },
    continuity: { transition: 'cut' },
    prompt: '',
  }));
}

export function useEditorInteractions({
  refs,
  state,
  actions,
  t,
  aiConfig,
  addAssetToStore,
  canvasConfig,
  containerRef,
  setRenamingNodeId,
  setNodeCreateMenuPos,
  nodeCreateMenuPos,
  setContextMenuItems,
  setConnectionDrop,
  setImageDialog,
  setDetailNode,
  setAssetPickerOpen,
  setReplaceNodeId,
  replaceNodeId,
  setReplaceAccept,
  replaceInputRef,
  setGroupStyleDialog,
  onRenameGroup,
}: {
  refs: EditorRefs;
  state: {
    editor: any;
    extensions: Map<string, NodeTypeExtension>;
    selectedNodeId: string | null;
    selectedNodeType: string | null;
    selectedNodeData: Record<string, unknown> | null;
    selectedCount: number;
    selectedHasGroup: boolean;
    isMixedSelection: boolean;
    isGroupPreviewing: boolean;
    containerSize: { width: number; height: number };
    interactionMode: string;
  };
  actions: { deleteSelected: () => void };
  t: (key: string, opts?: any) => string;
  aiConfig: AiConfig;
  addAssetToStore: (input: any) => Promise<void>;
  canvasConfig: CanvasConfig;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setRenamingNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  setNodeCreateMenuPos: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  nodeCreateMenuPos: { x: number; y: number } | null;
  setContextMenuItems: React.Dispatch<React.SetStateAction<ContextMenuItem[] | null | undefined>>;
  setConnectionDrop: React.Dispatch<React.SetStateAction<any>>;
  setImageDialog: React.Dispatch<React.SetStateAction<ImageDialogState | null>>;
  setDetailNode: React.Dispatch<React.SetStateAction<NodeRecord | null>>;
  setAssetPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setReplaceNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  replaceNodeId: string | null;
  setReplaceAccept: React.Dispatch<React.SetStateAction<string>>;
  replaceInputRef: React.RefObject<HTMLInputElement | null>;
  setGroupStyleDialog: React.Dispatch<React.SetStateAction<{
    groupId: string;
    currentBgColor: string | undefined;
    currentOpacity: number | undefined;
    currentRadius: number | undefined;
  } | null>>;
  onRenameGroup: (groupId: string) => void;
}) {
  const { theme } = useTheme();
  const { message, modal } = App.useApp();

  // P3.5 失败机制: 每个节点的 AbortController 映射(用户点停止时 abort)
  // 同时跟踪每个节点连续失败次数(用于达 3 次时建议检查 API KEY)
  const nodeAbortControllersRef = useRef<Map<string, any>>(new Map());
  // 已取消生成的分镜节点集合(防取消后 SSE 尾马事件把状态写成 error)
  const cancelledStoryboardsRef = useRef<Set<string>>(new Set());
  const nodeFailureCountRef = useRef<Map<string, number>>(new Map());

  // ===== useSyncExternalStore 状态(订阅 connectionController) =====

  // 连线拖拽期间强制显示所有节点 Pin(订阅 connectionController 的 pending 状态)
  const forceShowPins = useSyncExternalStore(
    useCallback((cb: () => void) => {
      const ctrl = refs.connectionController;
      if (!ctrl) return () => {};
      // subscribePending 返回 unsubscribe 函数
      return ctrl.subscribePending(cb);
    }, [refs.connectionController]),
    useCallback(() => {
      const ctrl = refs.connectionController;
      return ctrl ? ctrl.getPending() !== null : false;
    }, [refs.connectionController]),
  );

  // 连线拖拽时高亮鼠标下方的节点(提示可自动连接)
  // 仅 pending 期间返回 hoverNodeId:普通节点悬停(handleNodePointerEnter)也会写
  // hoverNodeId 供 Pin 可见性使用,若不判 pending,普通 hover 会误触发 NodeShell
  // 的蓝色 connectionHover 描边(用户验收反馈 Hover 变蓝)
  const connectionHoverNodeId = useSyncExternalStore(
    useCallback((cb: () => void) => {
      const ctrl = refs.connectionController;
      if (!ctrl) return () => {};
      return ctrl.subscribePending(cb);
    }, [refs.connectionController]),
    useCallback(() => {
      const ctrl = refs.connectionController;
      return ctrl && ctrl.getPending() !== null ? ctrl.getHoverNodeId() : null;
    }, [refs.connectionController]),
  );

  // 悬停节点 id(用于 Pin 可见性控制)
  const hoveredNodeId = useSyncExternalStore(
    useCallback((cb: () => void) => {
      const ctrl = refs.connectionController;
      if (!ctrl) return () => {};
      return ctrl.subscribePending(cb);
    }, [refs.connectionController]),
    useCallback(() => {
      const ctrl = refs.connectionController;
      return ctrl ? ctrl.getHoverNodeId() : null;
    }, [refs.connectionController]),
  );

  // ===== useMemo 计算值 =====

  // 依赖字段化拆分(确认制):改节点参数不触发 group/pin memo 重算,
  // 确认生效时重渲染面按字段域收敛,千节点场景避免连锁全量
  const pinDefaults = useMemo(() => ({
    ...configToPinDefaults(canvasConfig),
    color: theme.node.pinDefaultColor,
  }), [
    canvasConfig.pinColor, canvasConfig.pinShape, canvasConfig.pinSize, canvasConfig.pinOpacity,
    theme.node.pinDefaultColor,
  ]);

  // GroupDefaultsProvider 的 value:从 canvasConfig 构建(Group 样式默认,由 GroupLayer 消费作为回退)
  // 映射函数与配置面板预览同源(config-dialog.tsx),保证预览与画布真实节点一致
  const groupDefaultsValue = useMemo(
    () => configToGroupDefaults(canvasConfig, theme),
    [
      canvasConfig.groupBackground, canvasConfig.groupBorderRadius,
      canvasConfig.groupOutlineWidth, canvasConfig.groupOutlineColor,
      canvasConfig.groupOutlineType, canvasConfig.groupOutlineOffset,
      canvasConfig.groupOpacity,
      theme,
    ],
  );

  // NodeDefaultsProvider 的 value:圆角/轮廓宽度来自 canvasConfig,颜色来自 theme.node
  const nodeDefaultsValue = useMemo(
    () => configToNodeDefaults(canvasConfig, theme),
    [canvasConfig.nodeBorderRadius, canvasConfig.nodeOutlineWidth, theme],
  );

  // selectedNodeData 由 useEditorState 在 onChanged 中直接计算并缓存
  const selectedNodeData = state.selectedNodeData;

  const isPromptRunning = selectedNodeData?.status === 'loading';

  // 配置节点专用 — 当前生成模式(仅 generator 节点:堆叠节点不再作为生成目标)
  const selectedConfigMode = useMemo<GenerationMode | undefined>(() => {
    if (state.selectedNodeType !== 'generator') return undefined;
    const m = selectedNodeData?.generationMode as string | undefined;
    if (m === 'text' || m === 'image' || m === 'video' || m === 'audio') return m;
    return 'image';
  }, [state.selectedNodeType, selectedNodeData]);

  // 节点尺寸访问器(统一走 resolveNodeSize: node.size > 扩展契约 > 兜底)
  const getNodeSize = useMemo(
    () => (node: NodeRecord): { width: number; height: number } => {
      return resolveNodeSize(node, state.extensions.get(node.type));
    },
    [state.extensions],
  );

  // 预览组虚拟节点(不在 graph 中,作为 ToolsDock 的 node prop 传入)
  const previewGroupNode = useMemo<NodeRecord>(
    () => ({
      id: PREVIEW_GROUP_ID,
      type: 'group',
      position: { x: 0, y: 0 },
      data: { title: t('group.previewTitle') },
    }),
    [t],
  );

  // ===== useEffect 事件监听 =====

  // 节点重命名/删除/详情事件监听
  useEffect(() => {
    if (!state.editor) return;
    const editor = state.editor;
    const handleNodeRename = ({ nodeId }: { nodeId: string }) => {
      setRenamingNodeId(nodeId);
      const graph = editor.store.getGraph();
      const node = graph.nodes.find((n: any) => n.id === nodeId);
      if (node) {
        // 重命名前聚焦节点(平滑动画,统一走 focusOnNode 几何公式,节点可能在视口外)
        editor.store.focusOnNode(nodeId, state.containerSize, node.size?.width, node.size?.height, 400, 51);
      }
    };
    const handleNodeDelete = () => {
      // R3-D3: 删除前收集 Agent 节点快照（调皮回应）；用户自己的节点（无烙印）不触发
      const store = refs.store;
      const snaps = store
        ? collectAgentNodeSnapshots(
            [...store.getSelection().selectedNodeIds]
              .map((id) => store.getNode(id))
              .filter((n): n is NodeRecord => !!n),
          )
        : [];
      actions.deleteSelected();
      notifyAgentNodesDeleted(snaps);
    };
    const handleNodeDetail = ({ node }: { node: NodeRecord }) => {
      setDetailNode(node);
    };
    editor.core.eventBus.on('node:rename', handleNodeRename);
    editor.core.eventBus.on('node:delete', handleNodeDelete);
    editor.core.eventBus.on('node:detail', handleNodeDetail);

    return () => {
      editor.core.eventBus.off('node:rename', handleNodeRename);
      editor.core.eventBus.off('node:delete', handleNodeDelete);
      editor.core.eventBus.off('node:detail', handleNodeDetail);
    };
  }, [state.editor, state.containerSize, actions, t, addAssetToStore]);

  // 注册连线释放回调(拖拽到空白区域时弹出节点创建菜单)
  useEffect(() => {
    const ctrl = refs.connectionController;
    if (!ctrl) return;
    ctrl.setDropCallback((source: any, screenX: number, screenY: number, worldX: number, worldY: number) => {
      setConnectionDrop({ source, screenX, screenY, worldX, worldY });
    });
    return () => { ctrl.setDropCallback(null); };
  }, [refs.connectionController]);

  // 节点视图内重试/取消按钮 → nodeActionBus 事件 → 对接生成/停止逻辑
  // 裁切连线
  const handleCutEdge = useCallback((edgeId: string) => {
    refs.commandQueue?.execute(new RemoveEdgeCommand(edgeId));
  }, [refs.commandQueue]);

  /**
   * 一键同款(征集#43 G4/H1):完整复原生成链路 = 新节点(提示词/参数/模型) + 全部引用副本。
   * 两套缓存隔离(用户拍板):画布态高频变动,复原只读生成时刻冻结的快照(_inputs),引用一律创建副本节点,
   * 不连接画布现存节点(避免把用户已改动的新内容误当原始引用)。遗留记录(无快照)降级从现存连入节点取存档。
   * 渠道/模型失效 → 回退默认模型+提示。
   */
  const handleReplayGeneration = useCallback(
    async (nodeId: string): Promise<void> => {
      const store = refs.store;
      const cq = refs.commandQueue;
      if (!store || !cq) return;
      const srcNode = store.getGraph().nodes.find((n: any) => n.id === nodeId) as NodeRecord | undefined;
      const srcData = (srcNode?.data ?? {}) as Record<string, any>;
      const generationId = srcData?.generationId as string | undefined;
      if (!srcNode || !generationId) {
        message.info(t('editor.replayNoRecord'));
        return;
      }
      // 1. 拉生成记录(后端已存 prompt/参数/模型/_inputs 快照)
      let record: any;
      try {
        record = await apiGet(`/ai/generations/${generationId}`);
      } catch {
        message.error(t('editor.replayNoRecord'));
        return;
      }
      const params = (record?.params ?? {}) as Record<string, any>;
      const graph = store.getGraph();
      // 2. 新节点落点:用户视口中心 + 重叠避让(征集#45 验收反馈:不再跟随源节点位置,保证在画面合适位置可见),
      //    无视口信息时回退源节点右侧(与堆叠落点契约同源)
      const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const w = srcNode.size?.width ?? 340;
      const h = srcNode.size?.height ?? 240;
      const spawn = resolveStackSpawnPosition(
        { commandQueue: cq, getViewport: () => store.getViewport(), getContainerSize: () => state.containerSize } as never,
        { ignoreNodeIds: new Set([nodeId]) },
      );
      const newPos = spawn ?? { x: srcNode.position.x + w + 160, y: srcNode.position.y };
      // 3. 渠道/模型失效判定:被删或禁用 → 回退默认模型(新节点 model 留空)+提示
      let modelValue = '';
      let modelInvalid = false;
      if (record?.providerId && record?.model) {
        try {
          const ch = await apiGet<{ items: Array<{ id: string; models: Array<{ name: string }> }> }>('/ai/channels');
          const channel = (ch.items ?? []).find((c) => c.id === record.providerId);
          if (channel && (channel.models ?? []).some((m) => m.name === record.model)) {
            modelValue = `${record.providerId}::${record.model}`;
          } else {
            modelInvalid = true;
          }
        } catch {
          modelInvalid = true;
        }
      }
      // 4. 干净参数:剩离内部 _ 字段(_inputs/_resultUrl/_tags/_isTest 等)
      const cleanParams: Record<string, any> = {};
      for (const [k, v] of Object.entries(params)) {
        if (!k.startsWith('_') && v !== undefined && v !== null) cleanParams[k] = v;
      }
      // 5. 命令集:建新节点(提示词/参数/模型) + 引用链路全量复原
      const commands: Command[] = [
        new AddNodeCommand({
          id: newId,
          type: srcNode.type,
          position: newPos,
          title: t('editor.replaySuffix'),
          data: {
            prompt: record.prompt ?? '',
            ...(record.negativePrompt ? { negativePrompt: record.negativePrompt } : {}),
            status: 'idle',
            ...(modelValue ? { model: modelValue } : {}),
            ...cleanParams,
          },
        } as NodeRecord),
      ];
      const targetPin = NODE_INPUT_PIN[srcNode.type] ?? 'input';
      // 5a. 引用清单:只基于生成时刻冻结快照(_inputs)重建,与画布现状完全隔离
      //    (画布源节点可能早已迭代/被删/被拷贝,快照才是唯一可信源——用户拍板 2026-08-25)
      type RefSpec = { type: string; storageKey?: string; content?: string; text?: string; title?: string };
      const refSpecs: RefSpec[] = [];
      let unrestorable = 0;
      const inputs: Array<{ nodeId: string; nodeType: string; assetStorageKey?: string; content?: string; title?: string; textPreview?: string }> =
        Array.isArray(params._inputs) ? params._inputs : [];
      if (inputs.length > 0) {
        for (const it of inputs) {
          const isMedia = it.nodeType === 'image' || it.nodeType === 'video' || it.nodeType === 'audio';
          if (isMedia && it.assetStorageKey) {
            refSpecs.push({ type: it.nodeType, storageKey: it.assetStorageKey, title: it.title });
          } else if (isMedia && it.content) {
            refSpecs.push({ type: it.nodeType, content: it.content, title: it.title });
          } else if (it.nodeType === 'text' && it.textPreview) {
            refSpecs.push({ type: 'text', text: it.textPreview, title: it.title });
          } else {
            // 快照未存档内容(旧记录生成时未存 media content):无法重建,计入缺失提示;
            // 不查现存画布节点(与画布隔离原则,避免用已迭代的源节点内容误导复原)
            unrestorable += 1;
          }
        }
      } else {
        // 遗留记录无快照:从现存连入节点读内容建副本(降级链路,新记录不再出现)
        for (const e of graph.edges.filter((ed: any) => ed.target?.nodeId === nodeId)) {
          const src = graph.nodes.find((n: any) => n.id === e.source.nodeId);
          if (!src) continue;
          const d = (src.data ?? {}) as Record<string, any>;
          if ((src.type === 'image' || src.type === 'video' || src.type === 'audio') && (d.storageKey || d.content)) {
            refSpecs.push({ type: src.type, storageKey: d.storageKey, content: typeof d.content === 'string' ? d.content : undefined, title: src.title });
          } else if (src.type === 'text' && typeof d.content === 'string' && d.content) {
            refSpecs.push({ type: 'text', text: d.content.slice(0, 2000), title: src.title });
          }
        }
      }
      // 5b. 一律创建引用副本节点(新 id)并重连新节点:不触碰画布现存节点(画布高频改动,快照才是唯一可信源)
      let copiedCount = 0;
      for (const spec of refSpecs) {
        const copyId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-rv${copiedCount}`;
        const isMedia = spec.type === 'image' || spec.type === 'video' || spec.type === 'audio';
        commands.push(new AddNodeCommand({
          id: copyId,
          type: spec.type,
          position: { x: newPos.x - 460, y: newPos.y + copiedCount * 280 },
          title: spec.title || undefined,
          data: isMedia
            ? { storageKey: spec.storageKey, content: spec.content ?? '', status: 'idle' }
            : { content: spec.text ?? '', prompt: '', status: 'idle' },
        } as NodeRecord));
        commands.push(new AddEdgeCommand({
          id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-r${copiedCount}`,
          source: { nodeId: copyId, pinId: NODE_OUTPUT_PIN[spec.type] ?? 'output' },
          target: { nodeId: newId, pinId: targetPin },
        }));
        copiedCount += 1;
      }
      cq.execute(new BatchCommand(commands, 'replay-generation'));
      store.setSelection({ selectedNodeIds: new Set([newId]), selectedEdgeIds: new Set() });
      // 6. 反馈:三级降级提示(引用全复原→成功;有缺失→警告;渠道失效另提示)
      if (unrestorable > 0) message.warning(t('editor.replayPartial', { n: unrestorable }));
      else if (modelInvalid) message.warning(t('editor.replayModelInvalid'));
      else message.success(t('editor.replayDone', { n: copiedCount }));
      store.focusOnNode(newId, state.containerSize, w, h, 400, 51);
    },
    [refs, state.containerSize, t, message],
  );

  // 右键菜单:检测点击目标并构建菜单项
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    // 先取消正在进行的连线拖拽
    refs.connectionController?.cancel();
    const target = e.target as Element;

    // 优先检测连线
    const edgeEl = target.closest('[data-edge-id]');
    if (edgeEl) {
      const edgeId = edgeEl.getAttribute('data-edge-id');
      if (edgeId) {
        setNodeCreateMenuPos(null);
        setContextMenuItems([
          { key: 'delete-edge', label: t('editor.deleteEdge'), icon: createElement(EDITOR_ICONS.delete, { size: 14 }), danger: true, onClick: () => {
            refs.commandQueue?.execute(new RemoveEdgeCommand(edgeId));
          }},
        ]);
        return;
      }
    }

    // 检测节点
    const nodeEl = target.closest('[data-node-id]');
    if (nodeEl) {
      const nodeId = nodeEl.getAttribute('data-node-id');
      if (nodeId) {
        setNodeCreateMenuPos(null);
        // 查找节点以判断类型
        const graph = refs.store?.getGraph();
        const node = graph?.nodes.find((n: any) => n.id === nodeId);
        const nodeType = node?.type;
        // 支持存入资产/下载的节点类型:文本、图片、视频、音频、剧本
        const isAssetNode = nodeType === 'text' || nodeType === 'image' || nodeType === 'video' || nodeType === 'audio' || nodeType === 'script';
        const nodeData = (node?.data ?? {}) as Record<string, unknown>;
        const hasContent = !!((nodeData['content'] as string)?.trim());
        const hasEpisodes = !!((nodeData['episodes'] as unknown[])?.length);
        const canDownload = isAssetNode && (hasContent || (nodeType === 'script' && hasEpisodes));
        const canSaveAsset = isAssetNode && (hasContent || (nodeType === 'script' && hasEpisodes));

        const items: ContextMenuItem[] = [
          // ===== 聚焦置顶(测试画布验证最高频;组走 bounds 含空组回退) =====
          { key: 'focus', label: t('editor.focusNode'), icon: createElement(EDITOR_ICONS.focus, { size: 14 }), onClick: () => {
            const store = refs.store;
            if (!store) return;
            const g = store.getGraph();
            const n = g.nodes.find((nn) => nn.id === nodeId);
            if (!n) return;
            if (n.type === 'group') {
              const bounds = getGroupBoundsWithEmptyFallback(g.nodes, nodeId, getNodeSize);
              if (bounds) { store.focusOnBounds(bounds, state.containerSize, 400, 51); return; }
            }
            const size = getNodeSize(n as NodeRecord);
            store.focusOnNode(nodeId, state.containerSize, size.width, size.height, 400, 51);
          }},
          // ===== 基础操作组 =====
          { key: 'copy', label: t('editor.copy'), icon: createElement(EDITOR_ICONS.copy, { size: 14 }), onClick: () => {
            // 组节点/多选(右键目标在选择集内)走子树复制(与 Ctrl+D 同逻辑):
            // 组复制不再产生坏组壳(childrenIds 悬空),多选复制与快捷键行为一致(Plan#21)
            const store = refs.store;
            if (!store || !refs.commandQueue) return;
            const sel = store.getSelection().selectedNodeIds;
            const multi = sel.has(nodeId) && sel.size >= 2;
            if (multi || node?.type === 'group') {
              duplicateSubtree(store, refs.commandQueue, multi ? sel : new Set([nodeId]));
            } else {
              refs.commandQueue.execute(new DuplicateNodeCommand(nodeId));
            }
          }},
          { key: 'rename', label: t('editor.rename'), icon: createElement(EDITOR_ICONS.edit, { size: 14 }), onClick: () => {
            const store = refs.store;
            if (!store) return;
            // 组节点:聚焦组 bounds(含空组回退) + 走 onRenameGroup 状态机
            // (GroupLayer 消费 renamingGroupId;setRenamingNodeId 对组无效 — Plan#21 顺带修复)
            if (store.getNode(nodeId)?.type === 'group') {
              const bounds = getGroupBoundsWithEmptyFallback(store.getGraph().nodes, nodeId, getNodeSize);
              if (bounds) { store.focusOnBounds(bounds, state.containerSize, 400, 51); }
              onRenameGroup(nodeId);
              return;
            }
            // 普通节点:聚焦 + 进重命名态
            const n = store.getNode(nodeId);
            const size = n ? getNodeSize(n as NodeRecord) : undefined;
            store.focusOnNode(nodeId, state.containerSize, size?.width, size?.height, 400, 51);
            setRenamingNodeId(nodeId);
          }},
          // 替换媒体(image/video/audio):与胶囊 replace 工具同源(文件选择)
          ...(nodeType === 'image' || nodeType === 'video' || nodeType === 'audio'
            ? [{ key: 'replace', label: t('contextMenu.replace'), icon: createElement(EDITOR_ICONS.replace, { size: 14 }), onClick: () => {
              setReplaceNodeId(nodeId);
              if (nodeType === 'video') setReplaceAccept('video/*');
              else if (nodeType === 'audio') setReplaceAccept('audio/*');
              else setReplaceAccept('image/*');
              replaceInputRef.current?.click();
            }}]
            : []),
          // 一键同款(征集#43):有生成记录的 AI 生成型资源(含文本/剧本) → 复原完整生成链路(提示词/参数/模型/引用)
          ...((['image', 'video', 'audio', 'text', 'script'].includes(nodeType ?? '') && !!nodeData['generationId'])
            ? [{ key: 'replay-generation', label: t('editor.replaySame'), icon: createElement(EDITOR_ICONS.replay, { size: 14 }), onClick: () => {
              void handleReplayGeneration(nodeId);
            }}]
            : []),
          // 编辑内容(text 节点):与双击/胶囊 editText 同源(进节点内编辑态)
          ...(nodeType === 'text'
            ? [{ key: 'edit-content', label: t('editor.editContent'), icon: createElement(EDITOR_ICONS.edit, { size: 14 }), onClick: () => {
              refs.store?.updateNodeData(nodeId, { __editing: true });
            }}]
            : []),
        ];

        // ===== 组专属操作(样式/解组;与胶囊组工具同源) =====
        // 预览组态下解组无意义(尚未成组),隐藏入口(用户拍板:多余菜单)
        if (node?.type === 'group' && !state.isGroupPreviewing) {
          items.push({ key: 'group-style', label: t('groupTools.styleLabel'), icon: createElement(EDITOR_ICONS.style, { size: 14 }), onClick: () => {
            setGroupStyleDialog({ groupId: nodeId, currentBgColor: node.backgroundColor || undefined, currentOpacity: node.opacity, currentRadius: node.borderRadius });
          }});
          items.push({ key: 'ungroup', label: t('toolbar.ungroup'), icon: createElement(EDITOR_ICONS.ungroup, { size: 14 }), onClick: () => {
            refs.groupPlugin?.getController().ungroup([nodeId]);
          }});
        }

        // 基准尺寸恢复(非组节点):定向对右键目标节点生效,与胶囊菜单"基准尺寸"同源
        // 特化外观节点(气泡音频/资源浏览器)不参与尺寸计算,不提供该项
        if (node && node.type !== 'group' && !state.extensions.get(node.type)?.specialAppearance) {
          items.push({ key: 'baseline-size', label: t('toolsDock.restoreBaseline'), icon: createElement(EDITOR_ICONS.restoreBaseline, { size: 14 }), onClick: () => {
            refs.layoutController?.unifySelectionSizes([nodeId], 'baseline');
          }});
        }

        // ===== 资产操作组(分割线分隔) =====
        if (canSaveAsset) {
          items.push({ key: 'divider-asset', divider: true, label: '', onClick: () => {} });
          items.push({
            key: 'saveAsset', label: t('editor.saveToAssets'), icon: createElement(EDITOR_ICONS.saveAsset, { size: 14 }), onClick: () => {
              if (node) {
                const input = assetInputFromNode(node);
                if (input) {
                  void addAssetToStore(input).then(() => {
                    message.success(t('editor.assetsSaved'));
                    setAssetPickerOpen(true);
                  });
                }
              }
            },
          });
        }

        // ===== 下载操作(与资产操作同组,紧邻) =====
        if (canDownload) {
          if (!canSaveAsset) {
            items.push({ key: 'divider-asset', divider: true, label: '', onClick: () => {} });
          }
          items.push({
            key: 'download', label: t('common.download'), icon: createElement(EDITOR_ICONS.download, { size: 14 }), onClick: () => {
              if (!node) return;
              void (async () => {
                const data = node.data as Record<string, unknown> | undefined;
                // 剧本节点:序列化 episodes 为文本
                if (node.type === 'script') {
                  const text = serializeScriptContent(node);
                  if (!text.trim()) return;
                  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${(node.title ?? '剧本').trim() || '剧本'}.txt`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  return;
                }
                // 文本节点:直接下载 content
                if (node.type === 'text') {
                  const text = (data?.content as string) ?? '';
                  if (!text.trim()) return;
                  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${(node.title ?? '文本').trim() || '文本'}.txt`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  return;
                }
                // 媒体节点(图片/视频/音频):下载二进制内容
                const content = data?.content as string | undefined;
                if (!content) return;
                const mimeType = (data?.mimeType as string) || '';
                const ext = mimeType ? (mimeType.split('/')[1] || 'bin') : 'bin';
                const now = new Date();
                const pad = (n: number): string => n.toString().padStart(2, '0');
                const filename = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.${ext}`;
                const isBlob = content.startsWith('blob:');
                const isData = content.startsWith('data:');
                let downloadUrl = content;
                let needsRevoke = false;
                if (!isBlob && !isData) {
                  try {
                    const res = await fetch(content);
                    const blob = await res.blob();
                    downloadUrl = URL.createObjectURL(blob);
                    needsRevoke = true;
                  } catch { /* fall through */ }
                }
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                if (needsRevoke) URL.revokeObjectURL(downloadUrl);
              })();
            },
          });
        }

        // ===== 多选操作(选中≥2 且右键目标属于选择集,对整组选择生效) =====
        const selection = refs.store?.getSelection();
        const selectedIds = selection?.selectedNodeIds;
        if (node && selectedIds && selectedIds.has(nodeId) && selectedIds.size >= 2) {
          // 成组(与胶囊 onGroup 同源:创建预览 → 立即确认,二段式合并一步)
          items.push({ key: 'divider-group-selected', divider: true, label: '', onClick: () => {} });
          items.push({
            key: 'group-selected',
            label: t('toolbar.group'),
            icon: createElement(EDITOR_ICONS.group, { size: 14 }),
            onClick: () => {
              const ctrl = refs.groupPlugin?.getController();
              if (!ctrl || selectedIds.size < 2) return;
              ctrl.createPreview(selectedIds);
              ctrl.confirmPreview(t('groupTools.defaultGroupName'));
            },
          });
          const isNodeStackable = (n: NodeRecord): boolean => {
            if (n.type === 'group') return false;
            const ext = state.extensions.get(n.type);
            return Boolean(ext?.capabilities?.stackable);
          };
          const graphNow = refs.store?.getGraph();
          const selectedNodes = (graphNow?.nodes ?? []).filter((n) => selectedIds.has(n.id));
          const stackableCount = selectedNodes.filter(isNodeStackable).length;
          if (stackableCount > 0) {
            items.push({ key: 'divider-stack-selected', divider: true, label: '', onClick: () => {} });
            items.push({
              key: 'stackSelected',
              label: t('nodes.stackSelected', { count: stackableCount }),
              icon: createElement(EDITOR_ICONS.stack, { size: 14 }),
              onClick: handleStackSelected,
            });
          }
        }

        // ===== StackNode 操作组(仅图片/视频节点) =====
        if (nodeType === 'image' || nodeType === 'video') {
          items.push({ key: 'divider-stack', divider: true, label: '', onClick: () => {} });
          const stackCtx = { commandQueue: refs.commandQueue } as ToolContext;
          items.push({
            key: 'convertToStack',
            label: t('nodes.stackConvertTo'),
            icon: createElement(EDITOR_ICONS.stack, { size: 14 }),
            onClick: () => { if (node) convertToStack(node, stackCtx); },
          });
          items.push({
            key: 'createStackNode',
            label: t('nodes.stackCreateNew'),
            icon: createElement(EDITOR_ICONS.stack, { size: 14 }),
            onClick: () => { if (node) createStackNode(node, stackCtx); },
          });
        }

        // ===== 危险操作组(分割线分隔) =====
        items.push({ key: 'divider-delete', divider: true, label: '', onClick: () => {} });
        items.push({ key: 'delete', label: t('editor.delete'), icon: createElement(EDITOR_ICONS.delete, { size: 14 }), danger: true, onClick: () => {
          // 与 std:delete 同逻辑:多选(右键目标在选择集内)删整个选择集;
          // 含组走 deleteNodes(解组保留子节点),否则 BatchCommand 一次撤销(Plan#21 一致性修复)
          const store = refs.store;
          if (!store || !refs.commandQueue) return;
          const sel = store.getSelection().selectedNodeIds;
          const targetIds = sel.has(nodeId) && sel.size >= 2 ? sel : new Set([nodeId]);
          // R3-D3: 删除前收集 Agent 节点快照（调皮回应；无烙印的用户节点不触发）
          const snaps = collectAgentNodeSnapshots(
            [...targetIds].map((id) => store.getNode(id)).filter((n): n is NodeRecord => !!n),
          );
          if (refs.groupPlugin) {
            const graph = store.getGraph();
            const hasGroup = [...targetIds].some((id) => graph.nodes.find((nn) => nn.id === id)?.type === 'group');
            if (hasGroup) {
              refs.groupPlugin.getController().deleteNodes(targetIds);
              notifyAgentNodesDeleted(snaps);
              return;
            }
          }
          const cmds: Command[] = [];
          for (const id of targetIds) cmds.push(new RemoveNodeCommand(id));
          for (const edgeId of store.getSelection().selectedEdgeIds) cmds.push(new RemoveEdgeCommand(edgeId));
          refs.commandQueue.execute(new BatchCommand(cmds as unknown as Command[]));
          store.clearSelection();
          notifyAgentNodesDeleted(snaps);
        }});

        setContextMenuItems(items);
        return;
      }
    }

    // 空白区域 — 使用通用 NodeCreateMenu 组件,跳过内置右键菜单
    (e as unknown as { skipBuiltinMenu?: boolean }).skipBuiltinMenu = true;
    setNodeCreateMenuPos({ x: e.clientX, y: e.clientY });
    setContextMenuItems(null);
  }, [refs, setRenamingNodeId, setNodeCreateMenuPos, setContextMenuItems, containerRef, t, addAssetToStore, message, setAssetPickerOpen, state.extensions, getNodeSize, onRenameGroup, setReplaceNodeId, setReplaceAccept, setGroupStyleDialog, handleReplayGeneration]);

  // 空白区域 NodeCreateMenu 选择节点类型后创建节点
  // 节点语义重构(Plan#33 延伸):创建逻辑恢复原逻辑——直接创建空节点。
  // 空节点默认即为生成器态(选中后显示生成面板),无需再创建独立生成器节点。
  const handleNodeCreateMenuSelect = useCallback((type: 'text' | 'image' | 'video' | 'audio' | 'generator' | 'stacked-media' | 'script' | 'storyboard' | 'workbench' | 'production-manager') => {
    setNodeCreateMenuPos(null);
    if (!nodeCreateMenuPos || !containerRef.current || !refs.store) return;
    const rect = containerRef.current.getBoundingClientRect();
    const vp = refs.store.getViewport();
    const worldX = rect && vp ? (nodeCreateMenuPos.x - rect.left - vp.x) / vp.k : 0;
    const worldY = rect && vp ? (nodeCreateMenuPos.y - rect.top - vp.y) / vp.k : 0;
    const offsetX = (Math.random() - 0.5) * 80;
    const offsetY = (Math.random() - 0.5) * 80;
    const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sameTypeCount = refs.store?.getGraph().nodes.filter((n: any) => n.type === type).length ?? 0;
    const isCreation = type === 'script' || type === 'storyboard' || type === 'workbench' || type === 'production-manager';
    const isGenerator = type === 'generator';
    const isStackedMedia = type === 'stacked-media';
    const baseNameKey = type === 'production-manager'
      ? 'canvasNodes.stage.productionManager'
      : isCreation
      ? `canvasNodes.stage.${type}`
      : isGenerator ? 'nodes.generatorTitle'
        : isStackedMedia ? 'nodes.stackedMediaTitle'
          : type === 'text' ? 'nodeTypes.text'
            : type === 'image' ? 'nodeTypes.ai.image'
              : type === 'video' ? 'nodeTypes.ai.video'
                : type === 'audio' ? 'nodeTypes.ai.audio'
                  : 'nodes.generatorTitle';
    const nodeTitle = `${t(baseNameKey)}${sameTypeCount + 1}`;

    refs.commandQueue?.execute(
      new AddNodeCommand({
        id,
        type,
        position: { x: worldX + offsetX, y: worldY + offsetY },
        title: nodeTitle,
        data: isCreation
          ? type === 'script'
            ? { title: nodeTitle, status: 'idle', content: '' }
            : type === 'production-manager'
                ? { title: nodeTitle, items: [] }
                : { title: nodeTitle, status: 'idle' }
          : isStackedMedia
            ? { cards: [], activeIndex: 0, title: nodeTitle }
            : isGenerator
              ? { prompt: '', status: 'idle', generationMode: 'image', referenceImages: [], channelId: '', model: '', title: nodeTitle }
              : type === 'text'
                ? { content: t('editor.newTextNode'), prompt: '', status: 'idle', title: nodeTitle }
                : { prompt: '', content: '', status: 'idle', title: nodeTitle },
      }),
    );
  }, [refs, containerRef, nodeCreateMenuPos, t, state.extensions]);

  const handlePromptChange = useCallback(
    (nodeId: string, prompt: string): void => {
      if (!refs.commandQueue) return;
      refs.commandQueue.execute(new UpdateNodeDataCommand(nodeId, { prompt }));
    },
    [refs.commandQueue],
  );

  // 节点配置变更(模型/尺寸/质量等)
  // paramValues 增量合并基于 graph 最新值:一次点击可能连发多个 patch(如分辨率联动尺寸),
  // 若在组件层用旧闭包合并会互相覆盖(曾导致「点 1k 不高亮」「AUTO 切 4K 尺寸变 4096x4096」)
  const handleNodeConfigChange = useCallback(
    (nodeId: string, patch: Record<string, unknown>): void => {
      if (!refs.commandQueue) return;
      let finalPatch = patch;
      const pv = patch.paramValues;
      if (pv && typeof pv === 'object') {
        const node = refs.store?.getGraph().nodes.find((n: any) => n.id === nodeId);
        const cur = (node?.data as Record<string, any> | undefined)?.paramValues;
        finalPatch = {
          ...patch,
          paramValues: { ...(cur && typeof cur === 'object' ? cur : {}), ...(pv as Record<string, any>) },
        };
      }
      refs.commandQueue.execute(new UpdateNodeDataCommand(nodeId, finalPatch));
    },
    [refs.commandQueue, refs.store],
  );

  const handlePromptGenerate = useCallback(
    async (nodeId: string, mode: GenerationMode, prompt: string, mentionedRefs?: ReferenceItem[]): Promise<void> => {
      const provider = refs.aiProvider;
      if (!provider || !refs.commandQueue || !refs.store) return;
      // 取消该节点上正在进行的请求(若有)
      const prevCtl = nodeAbortControllersRef.current.get(nodeId);
      if (prevCtl) prevCtl.abort();
      const ctl = new AbortController();
      nodeAbortControllersRef.current.set(nodeId, ctl);
      // 从 graph 读取节点自身配置(支持重试非选中节点,避免依赖 selectedNodeData)
      const nodeRec = refs.store.getGraph().nodes.find((n: any) => n.id === nodeId);
      const nodeData = (nodeRec?.data ?? {}) as Partial<ImageNodeData> & Partial<VideoNodeData> & Partial<AudioNodeData>;
      // 生成结果落盘:写宿主 data(可选尺寸调整)
      const applyResult = (
        patch: Record<string, unknown>,
        mediaSize?: { width: number; height: number; fallbackWidth: number; fallbackHeight: number },
      ): void => {
        // 闭包内重新收窄(TS 不跨闭包推断开头守卫的 narrowing)
        const cq = refs.commandQueue;
        const storeNow = refs.store;
        if (!cq || !storeNow) return;
        cq.execute(new UpdateNodeDataCommand(nodeId, patch));
        if (!mediaSize) return;
        const { width, height, fallbackWidth, fallbackHeight } = mediaSize;
        if (!width || !height) return;
        // AI 生成媒体:同步调整节点尺寸为媒体比例(完全无边框)
        const graph = storeNow.getGraph();
        const node = graph.nodes.find((n: NodeRecord) => n.id === nodeId);
        if (!node) return;
        const currentWidth = node.size?.width ?? fallbackWidth;
        const ratio = height / width;
        const newHeight = Math.round(currentWidth * ratio);
        const oldRect = {
          x: node.position.x,
          y: node.position.y,
          width: node.size?.width ?? fallbackWidth,
          height: node.size?.height ?? fallbackHeight,
        };
        cq.execute(new ResizeNodeCommand(nodeId, oldRect, {
          ...oldRect,
          height: newHeight,
        }));
      };
      const modelValue = (nodeData?.model as string) ?? '';
      const taskLabel = modelValue ? modelOptionLabel(aiConfig, modelValue) : undefined;
      // 设置 loading + 写入 prompt + 清除旧错误 + 记录任务信息
      refs.commandQueue.execute(
        new UpdateNodeDataCommand(nodeId, {
          prompt,
          status: 'loading',
          errorDetails: undefined,
          errorType: undefined,
          taskLabel,
        } as Record<string, unknown>),
      );
      try {
        // 输入源收集(2026-08-25 用户拍板:连入即输入,无需逐个 @):媒体走 reference 通道,
        // 文本引用无 API 通道 → 内容拼入 prompt 参考段;堆叠整体条目不发送,展开卡片按支持类型过滤
        const refImages: string[] = [];
        const refVideos: Array<{ dataUrl?: string; durationMs?: number }> = [];
        const refAudios: Array<{ dataUrl?: string; durationMs?: number }> = [];
        let effectivePrompt = prompt;
        const refTextParts: string[] = [];
        for (const r of mentionedRefs ?? []) {
          if (r.type === 'text') {
            const rawText = r.asset?.content;
            if (typeof rawText === 'string' && rawText.trim()) {
              refTextParts.push(rawText.trim().slice(0, 1500));
            }
            continue;
          }
          // 空字符串 content 也兑底 storageKey(?? 不兑底 falsy 值,曾致参考图静默丢失走文生图 → 2026-08-25 seedream-4.0 修复)
          const raw = r.asset?.content || (r.asset?.storageKey ? getResourceUrl(r.asset.storageKey, 'full') : undefined);
          if (!raw) continue;
          const src = await contentToDataUrl(raw);
          if (r.type === 'image') refImages.push(src);
          else if (r.type === 'video') refVideos.push({ dataUrl: src });
          else if (r.type === 'audio') refAudios.push({ dataUrl: src });
        }
        if (refTextParts.length > 0) {
          effectivePrompt = `${prompt}\n\n[参考文本]\n${refTextParts.join('\n---\n')}`;
        }
        // 连线自动参考图(征集#51:连线到本节点的图片自动作为参考图,无需手动 @)
        // 与 @ 显式引用合并去重;堆叠展开为具体卡片,仅收集 image 内容
        {
          const graph = refs.store.getGraph();
          for (const edge of graph.edges) {
            if (edge.target?.nodeId !== nodeId) continue;
            const sourceNode = graph.nodes.find((n: any) => n.id === edge.source?.nodeId);
            if (!sourceNode) continue;
            if (sourceNode.type === 'stacked-media') {
              const cards = ((sourceNode.data as { cards?: Array<{ sourceType: string; data?: Record<string, unknown> }> } | undefined)?.cards) ?? [];
              for (const card of cards) {
                if (card.sourceType !== 'image') continue;
                const cardData = (card.data as Record<string, unknown>) ?? {};
                // 空字符串/缺 content 时兑底 storageKey(与主路径同策略,2026-08-25)
                const cardRaw =
                  (cardData.content as string | undefined) ||
                  (typeof cardData.storageKey === 'string' ? getResourceUrl(cardData.storageKey, 'full') : undefined);
                if (!cardRaw) continue;
                try {
                  const srcUrl = await contentToDataUrl(cardRaw);
                  if (srcUrl && !refImages.includes(srcUrl)) refImages.push(srcUrl);
                } catch { /* 跳过无效引用 */ }
              }
            } else if (sourceNode.type === 'image') {
              const srcData = (sourceNode.data as Record<string, unknown>) ?? {};
              // 空字符串/缺 content 时兑底 storageKey(2026-08-25 seedream-4.0 修复:content='' 曾致参考图静默丢失)
              const srcContent =
                (srcData.content as string | undefined) ||
                (typeof srcData.storageKey === 'string' ? getResourceUrl(srcData.storageKey, 'full') : undefined);
              if (!srcContent) continue;
              try {
                const srcUrl = await contentToDataUrl(srcContent);
                if (srcUrl && !refImages.includes(srcUrl)) refImages.push(srcUrl);
              } catch { /* 跳过无效引用 */ }
            }
          }
        }
        // 契约参数模块:从 node.data.paramValues 组装模板参数 + provider 强类型兜底字段
        const { params, fallback } = buildTemplateParams(mode, nodeData as Record<string, unknown>);
        // 生成引用快照(征集#43 方案 A):本次作为输入源的全部引用节点摘要,后端存 AiGeneration.params._inputs,
        // 供溯源/一键同款。与画布现状完全隔离:media 无 storageKey 时存档 http(s) 内容 URL(data:/blob: 体积大不入库),
        // 文本存 textPreview —— 一键同款只依赖快照本身,不查现存画布节点(画布源节点可能早已迭代/被删)
        const inputRefs = (mentionedRefs ?? []).map((r) => {
          const rawContent = r.asset?.content;
          const content =
            typeof rawContent === 'string' && /^https?:\/\//.test(rawContent) ? rawContent.slice(0, 2000) : undefined;
          return {
            nodeId: r.id,
            nodeType: r.type,
            assetStorageKey: r.asset?.storageKey,
            content,
            title: r.title ?? r.name,
            textPreview: r.type === 'text' && r.asset?.content ? r.asset.content.slice(0, 2000) : undefined,
          };
        });
        if (mode === 'image') {
          const data = nodeData;
          // 有 @ 参考图 → 图生图(editImage);否则文生图
          const results = refImages.length > 0
            ? await provider.editImage({
                prompt: effectivePrompt,
                model: (data?.model as string) ?? 'gpt-4o',
                params,
                size: fallback.size,
                quality: fallback.quality!,
                count: fallback.count!,
                referenceImages: refImages,
                inputs: inputRefs,
                signal: ctl.signal,
              })
            : await provider.generateImage({
                prompt: effectivePrompt,
                model: (data?.model as string) ?? 'gpt-4o',
                params,
                size: fallback.size,
                quality: fallback.quality!,
                count: fallback.count!,
                inputs: inputRefs,
                signal: ctl.signal,
              });
          const first = results[0];
          if (!first) throw new Error(t('nodes.noImageReturned'));
          applyResult({
            content: first.dataUrl,
            status: 'success',
            naturalWidth: first.width,
            naturalHeight: first.height,
            mimeType: first.mimeType,
            bytes: first.bytes,
            generationId: first.generationId,
            errorDetails: undefined,
            errorType: undefined,
          } as Record<string, unknown>, { width: first.width, height: first.height, fallbackWidth: 340, fallbackHeight: 240 });
        } else if (mode === 'text') {
          const data = nodeData;
          const text = await provider.generateText({
            prompt: effectivePrompt,
            // 用户从下拉选择的 LLM(编码值 channelId::modelName,provider 内部解析渠道配置)
            model: (data?.model as string) ?? 'gpt-4o',
            referenceImages: refImages.length > 0 ? refImages : undefined,
            signal: ctl.signal,
          });
          applyResult({
            content: text,
            status: 'success',
            errorDetails: undefined,
            errorType: undefined,
          } as Record<string, unknown>);
        } else if (mode === 'video') {
          const data = nodeData;
          const result = await provider.generateVideo({
            prompt: effectivePrompt,
            model: (data?.model as string) ?? 'sora-2',
            params,
            size: fallback.size,
            seconds: fallback.seconds!,
            vquality: fallback.vquality!,
            generateAudio: fallback.generateAudio!,
            watermark: fallback.watermark!,
            returnLastFrame: fallback.returnLastFrame!,
            referenceImages: refImages.length > 0 ? refImages : undefined,
            referenceVideos: refVideos.length > 0 ? refVideos : undefined,
            referenceAudios: refAudios.length > 0 ? refAudios : undefined,
            inputs: inputRefs,
            signal: ctl.signal,
          });
          const url = URL.createObjectURL(result.blob);
          applyResult({
            content: url,
            status: 'success',
            naturalWidth: result.width,
            naturalHeight: result.height,
            durationMs: result.durationMs,
            mimeType: result.mimeType,
            bytes: result.bytes,
            generationId: result.generationId,
            errorDetails: undefined,
            errorType: undefined,
          } as Record<string, unknown>, { width: result.width, height: result.height, fallbackWidth: 420, fallbackHeight: 236 });
          // 尾帧闭环:勾选「返回尾帧」且后端返回尾帧 → 在视频节点下方创建尾帧图片节点,
          // 尾帧可直接 @ 引用作为下一段视频的首帧(连续视频工作流)
          if (result.lastFrameUrl) {
            const graph = refs.store.getGraph();
            const videoNode = graph.nodes.find((n: NodeRecord) => n.id === nodeId);
            if (videoNode) {
              const lastFrameId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const vSize = videoNode.size ?? { width: 420, height: 236 };
              refs.commandQueue.execute(new AddNodeCommand({
                id: lastFrameId,
                type: 'image',
                position: {
                  x: videoNode.position.x,
                  y: videoNode.position.y + (vSize.height ?? 236) + 24,
                },
                title: '尾帧',
                data: {
                  content: result.lastFrameUrl,
                  status: 'success',
                  prompt: `${prompt}\n[尾帧]`,
                  model: (data?.model as string) ?? '',
                },
              }));
            }
          }
        } else if (mode === 'audio') {
          const data = nodeData;
          const result = await provider.generateAudio({
            prompt: effectivePrompt,
            model: (data?.model as string) ?? 'tts-1',
            params,
            voice: fallback.voice!,
            format: fallback.format!,
            speed: fallback.speed!,
            instructions: fallback.instructions,
            inputs: inputRefs,
            signal: ctl.signal,
          });
          const url = URL.createObjectURL(result.blob);
          applyResult({
            content: url,
            status: 'success',
            durationMs: result.durationMs,
            mimeType: result.mimeType,
            bytes: result.bytes,
            generationId: result.generationId,
            errorDetails: undefined,
            errorType: undefined,
          } as Record<string, unknown>);
        }
        // 生成成功:标题替换为提示词摘要(简写截断,失败/取消不改标题,保留原标题)
        const titleSummary = promptTitleSummary(prompt);
        if (titleSummary) {
          refs.commandQueue.execute(new UpdateNodeTitleCommand(nodeId, titleSummary));
        }
        // 成功:清空失败计数
        nodeFailureCountRef.current.delete(nodeId);
      } catch (err) {
        // 用户主动取消:回到 idle,不算失败
        if (ctl.signal.aborted) {
          refs.commandQueue.execute(
            new UpdateNodeDataCommand(nodeId, {
              status: 'idle',
              errorDetails: undefined,
              errorType: undefined,
            } as Record<string, unknown>),
          );
          return;
        }
        // 错误分类
        const errorType: AiErrorType = err instanceof AiError
          ? err.errorType
          : classifyError(err);
        let message = err instanceof Error ? err.message : String(err);
        // 连续失败计数 + 提示
        const failCount = (nodeFailureCountRef.current.get(nodeId) ?? 0) + 1;
        nodeFailureCountRef.current.set(nodeId, failCount);
        if (failCount >= 3) {
          message = `${message}\n\n${t('nodes.checkApiKeyHint')}`;
        }
        refs.commandQueue.execute(
          new UpdateNodeDataCommand(nodeId, {
            status: 'error',
            errorDetails: message,
            errorType,
          } as Record<string, unknown>),
        );
      } finally {
        // 清理 AbortController(仅当仍是当前这个)
        if (nodeAbortControllersRef.current.get(nodeId) === ctl) {
          nodeAbortControllersRef.current.delete(nodeId);
        }
      }
    },
    [refs.aiProvider, refs.commandQueue, refs.store, aiConfig, t],
  );

  const handlePromptStop = useCallback(
    (nodeId: string): void => {
      // 触发 AbortController → 上游 fetch 抛 AbortError → catch 中识别为取消
      const ctl = nodeAbortControllersRef.current.get(nodeId);
      if (ctl) ctl.abort();
      // 立即切回 idle(防止 provider 重试中的延迟)
      if (refs.commandQueue) {
        refs.commandQueue.execute(
          new UpdateNodeDataCommand(nodeId, { status: 'idle' } as Record<string, unknown>),
        );
      }
    },
    [refs.commandQueue],
  );

  // nodeActionBus 事件:监听节点内重试/取消按钮,对接生成/停止逻辑
  useEffect(() => {
    const unsubRetry = nodeActionBus.on('retry', (event: { nodeId: string }) => {
      const node = refs.store?.getGraph().nodes.find((n: any) => n.id === event.nodeId);
      if (!node) return;
      const prompt = (node.data as { prompt?: string } | null)?.prompt;
      if (!prompt) return;
      const mode = (node.type === 'text' || node.type === 'image' || node.type === 'video' || node.type === 'audio'
        ? node.type
        : 'image') as GenerationMode;
      void handlePromptGenerate(node.id, mode, prompt);
    });
    // 一键同款(征集#43):胶囊工具栏/右键菜单 emit → 复原完整生成链路
    const unsubReplay = nodeActionBus.on('replayGeneration', (event: { nodeId: string }) => {
      void handleReplayGeneration(event.nodeId);
    });
    const unsubCancel = nodeActionBus.on('cancel', (event: { nodeId: string }) => {
      // 分镜节点: 嵌套 Map(epKey → { taskId }), 断开 SSE + 取消后端任务
      const ctlMap = nodeAbortControllersRef.current.get(event.nodeId);
      if (ctlMap instanceof Map) {
        for (const ctl of ctlMap.values()) {
          if (ctl?.taskId) void agentClient.cancelTask(ctl.taskId);
        }
        agentClient.unsubscribe();
        return;
      }
      handlePromptStop(event.nodeId);
    });
    // 停止分镜生成(加载态取消按钮):取消后端任务 + 断开 SSE + 恢复节点初始态(修复:此前无订阅,取消无效且节点卡死在生成中)
    const unsubStopGen = nodeActionBus.on('storyboard:stopGenerate', (event: { nodeId: string }) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const ctlMap = nodeAbortControllersRef.current.get(event.nodeId);
      if (ctlMap instanceof Map) {
        for (const ctl of ctlMap.values()) {
          if (ctl?.taskId) void agentClient.cancelTask(ctl.taskId);
        }
        agentClient.unsubscribe();
        nodeAbortControllersRef.current.delete(event.nodeId);
      }
      cancelledStoryboardsRef.current.add(event.nodeId);
      // 恢复初始态:整体 idle + 生成中的集改回 idle 并清进度
      const node = store.getGraph().nodes.find((n: any) => n.id === event.nodeId);
      const d = (node?.data ?? {}) as Record<string, unknown>;
      const statusByEpisode = { ...((d.statusByEpisode as Record<string, string>) ?? {}) };
      const progressByEpisode = { ...((d.progressByEpisode as Record<string, number>) ?? {}) };
      for (const [ep, st] of Object.entries(statusByEpisode)) {
        if (st === 'generating') {
          statusByEpisode[ep] = 'idle';
          progressByEpisode[ep] = 0;
        }
      }
      q.execute(new UpdateNodeDataCommand(event.nodeId, {
        status: 'idle',
        statusByEpisode,
        progressByEpisode,
      }));
    });
    // ==== AI 生成分镜(真实剧本)的复用逻辑:支持进度条与按集生成,供初次生成/重试/切换集共用 ====
    // Plan#9: 直连 provider 改为后端 storyboard_generate 任务(后端 storyboard_assistant 分块编排 + SSE)
    // Plan#29 T6 + 2026-08-21 架构修正: 剧管 = 分镜后置工序(剧本→分镜→剧管)
    // 剧管节点锚定分镜节点(右侧 + storyboard→pm 连线 + 双向关联), 一个分镜节点对应一个剧管,
    // 生成新分镜节点 → 新建对应剧管, 不再按 scriptId 复用导致旧分镜引用被覆盖(幂等)
    const ensureProductionManager = (store: any, q: any, storyboardNode: any): string => {
      const graph = store.getGraph();
      const storyboardId = storyboardNode.id;
      // 已关联本分镜节点的剧管直接复用
      const existing = graph.nodes.find((n: any) => n.type === 'production-manager' && n.data?.storyboardId === storyboardId);
      if (existing) return existing.id;
      const pmId = `node-pm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sbData = (storyboardNode.data ?? {}) as Record<string, unknown>;
      // 2026-08-22: 剧管=分镜后置, 位置走布局契约(右侧 + 垂直整理避让)
      const pmPos = resolvePlacement({
        anchor: storyboardNode,
        ext: state.extensions.get('production-manager'),
        existingNodes: graph.nodes,
      });
      q.execute(new BatchCommand([
        new AddNodeCommand({
          id: pmId,
          type: 'production-manager',
          position: pmPos,
          title: i18n.t('productionManager.editorTitle'),
          data: {
            title: (sbData.title as string) || i18n.t('productionManager.editorTitle'),
            storyboardId,
            scriptId: (sbData.sourceScriptId as string) ?? undefined,
            items: [],
          },
        }),
        new AddEdgeCommand({
          id: `edge-pm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: { nodeId: storyboardId, pinId: 'output' },
          target: { nodeId: pmId, pinId: 'input' },
        }),
      ], 'create-production-manager'));
      // 分镜节点记录关联剧管(双向关联)
      q.execute(new UpdateNodeDataCommand(storyboardId, { productionManagerId: pmId }));
      return pmId;
    };

    // Plan#29 T5 + 2026-08-21: AI 识别主体幂等登记进剧管条目(名字/别名命中 → 合并别名+出场集;新名字 → 新建条目)
    // 锚定分镜节点(剧管=分镜后置); 跳过用户已删除的 deletedNames(已删条目不复活); 手动重建同名条目时清除删除标记
    const registerAiSubjectsToProduction = (store: any, q: any, storyboardNode: any, aiSubjects: Array<{ name: string; kind: string; aliases: string[]; description: string }>, episodeId?: string) => {
      if (!aiSubjects || aiSubjects.length === 0) return;
      const pmId = ensureProductionManager(store, q, storyboardNode);
      const pm = store.getGraph().nodes.find((n: any) => n.id === pmId);
      const data = (pm?.data ?? {}) as { items?: ProductionItem[]; deletedNames?: string[] };
      const items: ProductionItem[] = Array.isArray(data.items)
        ? (data.items as ProductionItem[]).map((it) => ({ ...it }))
        : [];
      const deletedNames = Array.isArray(data.deletedNames) ? [...data.deletedNames] : [];
      const removedDeleted = new Set<string>();
      let added = 0;
      for (const subj of aiSubjects) {
        if (!subj.name) continue;
        const subjKeys = productionItemKeys({ name: subj.name, aliases: Array.isArray(subj.aliases) ? subj.aliases : [] });
        const hit = items.find((it) => [...productionItemKeys(it)].some((k) => subjKeys.has(k)));
        if (hit) {
          // 用户手动重建同名条目 → 从删除记录中移除该名(允许后续 AI 识别再次合并)
          if (deletedNames.includes(subj.name)) {
            removedDeleted.add(subj.name);
          }
          hit.aliases = [...new Set([...hit.aliases, ...(Array.isArray(subj.aliases) ? subj.aliases : [])])];
          if (episodeId && !hit.episodeIds.includes(episodeId)) hit.episodeIds = [...hit.episodeIds, episodeId];
          // 2026-08-22 BUG 修复: 历史条目 kind 可能为旧版误判(场景色吞噬角色/道具), AI 语义识别更可靠, 命中时以 AI kind 收敛
          const aiKind = subj.kind === 'scene' || subj.kind === 'prop' ? subj.kind : 'character';
          if (hit.kind !== aiKind) hit.kind = aiKind;
        } else if (!deletedNames.includes(subj.name)) {
          const kind = (subj.kind === 'scene' || subj.kind === 'prop' ? subj.kind : 'character') as ProductionItemKind;
          items.push({
            ...createProductionItem(kind, subj.name),
            aliases: Array.isArray(subj.aliases) ? subj.aliases : [],
            consistency: subj.description ?? '',
            episodeIds: episodeId ? [episodeId] : [],
          });
          added += 1;
        }
      }
      const nextDeleted = deletedNames.filter((n) => !removedDeleted.has(n));
      q.execute(new UpdateNodeDataCommand(pmId, nextDeleted.length !== deletedNames.length ? { items, deletedNames: nextDeleted } : { items }));
      if (added > 0) message.success(i18n.t('productionManager.registered', { count: added }));
    };

    const runAiStoryboard = (_store: any, q: any, scriptNode: any, storyboardId: string, episodeId?: string, _createSubjects?: boolean, autoExtractSubjects = true) => {
      const scriptData = (scriptNode.data ?? {}) as { episodes?: Array<{ id: string; content?: string }>; activeEpisodeId?: string };
      const episodes = scriptData.episodes ?? [];
      // 2026-08-21 BUG 修复: episodeId 未传入时,优先读取 storyboard 节点自身的 activeEpisodeId
      const sbData = q.getState().nodes.find((n: any) => n.id === storyboardId)?.data as Record<string, unknown> | undefined;
      const sbActiveEpisodeId = (sbData?.activeEpisodeId as string) ?? '';
      const resolvedEpisodeId = episodeId || sbActiveEpisodeId || undefined;
      const targetEp = episodes.find((e) => e.id === resolvedEpisodeId) ?? episodes.find((e) => e.id === scriptData.activeEpisodeId) ?? episodes[0];
      const scriptText = htmlToPlainText(targetEp?.content ?? '');
      const epKey = resolvedEpisodeId ?? targetEp?.id ?? '_legacy';

      // 读-改-写:UpdateNodeDataCommand 是浅合并,必须合并指定集到每集映射,否则会整体覆盖 shotsByEpisode/statusByEpisode/progressByEpisode
      const setEpData = (patch: { shotsByEpisode?: unknown; statusByEpisode?: unknown; progressByEpisode?: unknown }) => {
        const graph = q.getState();
        const node = graph.nodes.find((n: any) => n.id === storyboardId);
        const cur = (node?.data ?? {}) as Record<string, unknown>;
        const base: Record<string, unknown> = { sourceScriptId: scriptNode.id };
        if (episodeId) base.activeEpisodeId = episodeId;
        const merged: Record<string, unknown> = { ...base };
        if (patch.shotsByEpisode !== undefined) {
          merged.shotsByEpisode = { ...((cur.shotsByEpisode as Record<string, unknown>) ?? {}), [epKey]: patch.shotsByEpisode };
        }
        if (patch.statusByEpisode !== undefined) {
          merged.statusByEpisode = { ...((cur.statusByEpisode as Record<string, unknown>) ?? {}), [epKey]: patch.statusByEpisode };
        }
        if (patch.progressByEpisode !== undefined) {
          merged.progressByEpisode = { ...((cur.progressByEpisode as Record<string, unknown>) ?? {}), [epKey]: patch.progressByEpisode };
        }
        q.execute(new UpdateNodeDataCommand(storyboardId, merged));
      };

      if (!targetEp || !scriptText) {
        setEpData({ statusByEpisode: 'ready' });
        return;
      }
      setEpData({ statusByEpisode: 'generating', progressByEpisode: 0 });
      // 同时更新整体节点状态(用于无内容新节点显示 StaggerGridRipple 骨架态)
      q.execute(new UpdateNodeDataCommand(storyboardId, { status: 'generating' }));

      // 停止控制按 nodeId → episodeId 双层 Map, 存任务 id 供取消
      let nodeCtlMap = nodeAbortControllersRef.current.get(storyboardId);
      if (!nodeCtlMap) {
        nodeCtlMap = new Map();
        nodeAbortControllersRef.current.set(storyboardId, nodeCtlMap);
      }
      const ctlInfo = { taskId: '' };
      nodeCtlMap.set(epKey, ctlInfo);

      // Plan#29: 注入统筹条目字典(跨集续写时后端提示 AI 沿用既有命名, 不重复登记)
      const existingSubjects = _store.getGraph().nodes
        .filter((n: any) => n.type === 'production-manager')
        .flatMap((n: any) => (Array.isArray(n.data?.items) ? n.data.items : []) as Array<{ name?: string; kind?: string; aliases?: string[]; consistency?: string }>)
        .map((it: { name?: string; kind?: string; aliases?: string[]; consistency?: string }) => ({ name: it.name ?? '', kind: it.kind, aliases: it.aliases ?? [], description: it.consistency ?? '' }))
        .filter((s: { name: string }) => s.name.trim());

      // 提交后端分块生成任务(超长剧本由后端切块并发, 进度按块折算 0-95)
      void agentClient.send('storyboard_generate', {
        scriptText,
        episodeId: targetEp.id,
        ...(existingSubjects.length > 0 ? { subjects: existingSubjects } : {}),
      })
        .then(({ taskId }) => {
          ctlInfo.taskId = taskId;
          agentClient.subscribe(taskId, {
            onProgress: (progress) => {
              setEpData({ progressByEpisode: Math.max(0, Math.min(100, progress)) });
            },
            onDone: (output) => {
              const result = (output as any)?.output ?? output;
              // Plan#20 T2: onDone 适配层——后端字符串产出/旧对象数据双兼容归一
              const shots = Array.isArray(result?.shots) ? result.shots.map(normalizeShotForUi) : result?.shots;
              const failed = result?.blocks?.failed;
              if (!Array.isArray(shots)) {
                console.error('分镜任务返回异常:', output);
                setEpData({ statusByEpisode: 'error' });
                q.execute(new UpdateNodeDataCommand(storyboardId, { status: 'error' }));
                return;
              }
              setEpData({ shotsByEpisode: shots, statusByEpisode: 'ready', progressByEpisode: 100 });
              // Plan#20 T4: 后端主体字典落节点数据(供 T5/T8 占位主体堆叠创建与主体标注匹配)
              const aiSubjects = Array.isArray(result?.subjects) ? result.subjects : undefined;
              q.execute(new UpdateNodeDataCommand(storyboardId, {
                status: 'ready',
                aiSubjects,
              }));
              // Plan#29 T5/T6 + 2026-08-21: AI 主体幂等登记进剧管条目(剧管=分镜后置,锚定分镜节点)
              // Plan#33 A4/B3: autoExtractSubjects=false 时跳过自动提取(生成器参数「自动提取剧管」可关闭)
              if (aiSubjects && aiSubjects.length > 0 && autoExtractSubjects) {
                const sbNode = _store.getGraph().nodes.find((n: any) => n.id === storyboardId);
                if (sbNode) registerAiSubjectsToProduction(_store, q, sbNode, aiSubjects, epKey);
              }
              if (Array.isArray(failed) && failed.length > 0) {
                message.warning(i18n.t('editor.storyboardPartialFailed', { failed: failed.length, total: result?.blocks?.total ?? 0 }));
              }
            },
            onError: (error) => {
              console.error('生成分镜失败:', error);
              // 已取消的节点:不写 error 态(停止处理已恢复初始态)
              if (cancelledStoryboardsRef.current.has(storyboardId)) {
                cancelledStoryboardsRef.current.delete(storyboardId);
                return;
              }
              setEpData({ statusByEpisode: 'error' });
              q.execute(new UpdateNodeDataCommand(storyboardId, { status: 'error' }));
            },
            onClose: () => {
              nodeCtlMap.delete(epKey);
            },
          });
        })
        .catch((err: any) => {
          console.error('提交分镜任务失败:', err);
          setEpData({ statusByEpisode: 'error' });
          q.execute(new UpdateNodeDataCommand(storyboardId, { status: 'error' }));
          nodeCtlMap.delete(epKey);
        });
    };

    // FIX-6: 剧本加入资产库成功 → 打开资产库展示结果（数据刷新由 Modal 每次打开时强制重挂载完成）
    const unsubAssetSaved = nodeActionBus.on('script:assetSaved', () => {
      setAssetPickerOpen(true);
    });

    // 剧本 → 生成分镜:每次点击都新建一个全新分镜节点(之前的分镜节点是 AI 生成产物,不复用)
    // 范文态 → 生成"模板分镜"(标注 isSample);真实剧本 → 走 AI 生成
    const unsubGenStory = nodeActionBus.on('script:generateStoryboard', (event: { nodeId: string; mode?: 'new' | 'reuse' | 'template' | 'ai' }) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const scriptNode = graph.nodes.find((n: any) => n.id === event.nodeId);
      if (!scriptNode) return;

      // 新建分镜节点 + 连线(2026-08-22: 走布局契约 resolvePlacement, 默认右侧 + 垂直整理避让)
      const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sameTypeCount = graph.nodes.filter((n: any) => n.type === 'storyboard').length;
      const title = `分镜${sameTypeCount + 1}`;
      const sbPos = resolvePlacement({
        anchor: scriptNode,
        ext: state.extensions.get('storyboard'),
        existingNodes: graph.nodes,
      });
      q.execute(new AddNodeCommand({
        id,
        type: 'storyboard',
        position: sbPos,
        title,
        data: { title, status: 'idle' },
      }));
      q.execute(new AddEdgeCommand({
        id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        source: { nodeId: scriptNode.id, pinId: 'output' },
        target: { nodeId: id, pinId: 'input' },
      }));
      store.setSelection({ selectedNodeIds: new Set([id]), selectedEdgeIds: new Set() });

      // 范文态 → 生成"模板分镜"(标注范文示例; T3: 同步写入主体字典供主体列 kind 徽章展示)
      if (event.mode === 'template') {
        const patch: Partial<StoryboardNodeData> = {
          shots: buildTemplateShots(),
          status: 'ready',
          isSample: true,
          aiSubjects: SAMPLE_SUBJECTS,
        };
        q.execute(new UpdateNodeDataCommand(id, patch as Record<string, unknown>));
        return;
      }

      runAiStoryboard(store, q, scriptNode, id, undefined, true); // Plan#20 BUG修复: 直接生成默认创建主体(与选集 Modal 开关默认一致)
    });

    // Plan#33 B3/A4: 生成器(分镜模式)生成 → 复用 runAiStoryboard 链路
    // 参数: params.episodes(集数多选,默认全选) / autoExtractProductionManager(剧管提取,默认开) / useSubjectDictionary(主体字典,默认开)
    const unsubGenSb = nodeActionBus.on('generator:generateStoryboard', (event: { nodeId: string; params?: Record<string, unknown>; scriptEpisodes?: Array<{ id: string }> }) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const genNode = graph.nodes.find((n: any) => n.id === event.nodeId);
      if (!genNode) return;

      // 1. 定位生成器连入的剧本节点(剧本→生成器)
      const genInEdge = graph.edges.find((e: any) => {
        const tgt = typeof e.target === 'object' ? e.target?.nodeId : e.target;
        return tgt === event.nodeId && (typeof e.target === 'object' ? e.target?.pinId : undefined) === 'input';
      });
      const scriptNode = genInEdge
        ? graph.nodes.find((n: any) => n.id === (typeof genInEdge.source === 'object' ? genInEdge.source?.nodeId : genInEdge.source) && n.type === 'script')
        : undefined;
      if (!scriptNode) {
        message.warning(i18n.t('errors.SCRIPT_NOT_FOUND'));
        return;
      }
      const scriptData = (scriptNode.data ?? {}) as { episodes?: Array<{ id: string; content?: string; title?: string }> };
      const episodes = scriptData.episodes ?? [];

      // 2. 定位生成器 output 连的目标分镜节点
      const genOutEdge = graph.edges.find((e: any) => {
        const src = typeof e.source === 'object' ? e.source?.nodeId : e.source;
        return src === event.nodeId && (typeof e.source === 'object' ? e.source?.pinId : undefined) === 'output';
      });
      const sbNode = genOutEdge
        ? graph.nodes.find((n: any) => n.id === (typeof genOutEdge.target === 'object' ? genOutEdge.target?.nodeId : genOutEdge.target) && n.type === 'storyboard')
        : undefined;
      if (!sbNode) {
        message.warning('请先连接分镜节点到生成器');
        return;
      }

      // 3. 解析参数: 集数多选(默认全选) / 剧管提取(默认开) / 主体字典(默认开)
      const params = event.params ?? {};
      const autoExtract = params.autoExtractProductionManager !== false;
      const epIds = Array.isArray(params.episodes) && (params.episodes as unknown[]).length > 0
        ? (params.episodes as string[])
        : episodes.map((e) => e.id);
      if (epIds.length === 0) {
        message.warning('剧本暂无剧集内容，请先导入或编辑剧本');
        return;
      }

      // 4. 逐集生成(串行避免打爆)
      q.execute(new UpdateNodeDataCommand(sbNode.id, { sourceScriptId: scriptNode.id, activeEpisodeId: epIds[0]! }));
      epIds.forEach((epId) => {
        runAiStoryboard(store, q, scriptNode, sbNode.id, epId, true, autoExtract);
      });
    });

    // 统一"关联+选集+生成方式":剧本侧生成分镜 / 分镜侧关联剧本 共用。
    // payload: { scriptNodeId, targetNodeId?, episodeIds, autoGenerate }
    // - 无 targetNodeId:为每个选集新建独立分镜节点 + 连线(批量位置错开)
    // - 有 targetNodeId:连到现有分镜节点
    // - autoGenerate=true:对每个选集跑跑 runAiStoryboard;false:仅关联(写 sourceScriptId)
    const unsubAssociate = nodeActionBus.on('storyboard:associate', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const scriptNode = graph.nodes.find((n: any) => n.id === event.scriptNodeId && n.type === 'script');
      if (!scriptNode) {
        message.warning(i18n.t('errors.SCRIPT_NOT_FOUND'));
        return;
      }
      const epIds = Array.isArray(event.episodeIds) ? event.episodeIds : [];
      // 2026-08-22: 批量位置走布局契约(同列垂直错开 + 避让, 修复 batchPosY 24px 重叠问题)
      const batchPosY = (i: number) => resolvePlacement({
        anchor: scriptNode,
        ext: state.extensions.get('storyboard'),
        existingNodes: graph.nodes,
        index: i,
      });

      if (event.targetNodeId) {
        // 已有分镜节点:断开旧的剧本连线 → 建立新连线 + 写 sourceScriptId
        const sbNode = graph.nodes.find((n: any) => n.id === event.targetNodeId && n.type === 'storyboard');
        if (!sbNode) return;
        const sbData = (sbNode?.data ?? {}) as StoryboardNodeData;
        const hasExistingShots =
          (Array.isArray(sbData.shots) && sbData.shots.length > 0) ||
          (sbData.shotsByEpisode && Object.values(sbData.shotsByEpisode).some((arr: unknown) => Array.isArray(arr) && arr.length > 0));
        const switchingScript = (sbData.sourceScriptId ?? null) !== event.scriptNodeId;

        const tgtNodeId = event.targetNodeId!;
        const doAssociate = () => {
          // 断开当前分镜连到其他剧本的旧连线(切换关联时避免残留错误连接)
          const oldEdges = graph.edges.filter((e: any) =>
            e.target?.nodeId === tgtNodeId && e.source?.pinId === 'output' && e.source?.nodeId !== event.scriptNodeId);
          for (const oe of oldEdges) {
            q.execute(new RemoveEdgeCommand(oe.id));
          }
          const existing = graph.edges.some((e: any) =>
            e.target?.nodeId === tgtNodeId && e.source?.nodeId === event.scriptNodeId && e.source?.pinId === 'output');
          if (!existing) {
            q.execute(new AddEdgeCommand({
              id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              source: { nodeId: event.scriptNodeId, pinId: 'output' },
              target: { nodeId: tgtNodeId, pinId: 'input' },
            }));
          }
          q.execute(new UpdateNodeDataCommand(tgtNodeId, { sourceScriptId: event.scriptNodeId, activeEpisodeId: (epIds[0] ?? ((sbNode?.data as any)?.activeEpisodeId as string | undefined) ?? '') }));
          if (event.autoGenerate && epIds.length > 0) {
            // 批量立即生成:为每个选集生成(限流交给调用侧,这里串行避免打爆)
            const first = epIds[0]!;
            q.execute(new UpdateNodeDataCommand(tgtNodeId, { activeEpisodeId: first }));
            runAiStoryboard(store, q, scriptNode, tgtNodeId, first, event.createSubjects);
            for (let i = 1; i < epIds.length; i++) {
              runAiStoryboard(store, q, scriptNode, tgtNodeId, epIds[i]!, false); // 后续集不再重复创建主体
            }
          }
          message.success('已关联剧本');
        };

        // 已有编辑数据且切换到新剧本,且为"立即生成":询问是否覆盖原有内容
        if (hasExistingShots && switchingScript && event.autoGenerate) {
          modal.confirm({
            title: '关联新剧本',
            content: '当前分镜已有镜头数据，关联新剧本并立即生成会覆盖原有内容，是否继续？',
            okText: '覆盖并关联',
            cancelText: '取消',
            centered: true,
            onOk: doAssociate,
          });
          return;
        }
        doAssociate();
        return;
      }

      // 新建分镜节点(剧本侧批量):每个选集一个节点, 位置走布局契约(同列垂直错开)
      epIds.forEach((epId: string, i: number) => {
        const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`;
        const sameTypeCount = graph.nodes.filter((n: any) => n.type === 'storyboard').length;
        const title = `分镜${sameTypeCount + i + 1}`;
        const pos = batchPosY(i);
        q.execute(new AddNodeCommand({
          id,
          type: 'storyboard',
          position: pos,
          title,
          data: { title, status: 'idle', sourceScriptId: event.scriptNodeId, activeEpisodeId: epId },
        }));
        q.execute(new AddEdgeCommand({
          id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}`,
          source: { nodeId: event.scriptNodeId, pinId: 'output' },
          target: { nodeId: id, pinId: 'input' },
        }));
        if (event.autoGenerate) {
          runAiStoryboard(store, q, scriptNode, id, epId, event.createSubjects);
        }
      });
      store.setSelection({ selectedNodeIds: new Set(), selectedEdgeIds: new Set() });
    });

    // 剧本转为真实内容:清除关联分镜的"范文示例"标记
    const unsubRealized = nodeActionBus.on('script:realized', (event: { nodeId: string }) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const linkedStoryboardIds = graph.edges
        .filter((e: any) => e.source?.nodeId === event.nodeId && e.source?.pinId === 'output')
        .map((e: any) => e.target?.nodeId)
        .filter((targetId: string) => graph.nodes.some((n: any) => n.id === targetId && n.type === 'storyboard'));
      for (const sbId of linkedStoryboardIds) {
        const sb = graph.nodes.find((n: any) => n.id === sbId);
        if ((sb?.data as any)?.isSample) {
          q.execute(new UpdateNodeDataCommand(sbId, { isSample: false }));
        }
      }
    });

    // 分镜"重试":校验剧本连线后重新生成当前集(若连线已断开则提示无剧本关联)
    const unsubRetryStory = nodeActionBus.on('storyboard:retryGenerate', (event: { nodeId: string }) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const edge = graph.edges.find((e: any) => e.target?.nodeId === event.nodeId && e.source?.pinId === 'output');
      const scriptNode = edge ? graph.nodes.find((n: any) => n.id === edge.source?.nodeId && n.type === 'script') : undefined;
      if (!scriptNode) {
        message.warning(i18n.t('errors.NOT_FOUND'));
        return;
      }
      const sb = graph.nodes.find((n: any) => n.id === event.nodeId);
      const activeEp = ((sb?.data as any)?.activeEpisodeId as string | undefined);
      runAiStoryboard(store, q, scriptNode, event.nodeId, activeEp, true); // Plan#20 BUG修复: 重试默认创建主体
    });

    // 分镜"切换集/重新生成指定集":校验剧本连线后生成指定集(未生成集切换时触发)
    const unsubRegenEp = nodeActionBus.on('storyboard:regenerateEpisode', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const edge = graph.edges.find((e: any) => e.target?.nodeId === event.nodeId && e.source?.pinId === 'output');
      const scriptNode = edge ? graph.nodes.find((n: any) => n.id === edge.source?.nodeId && n.type === 'script') : undefined;
      if (!scriptNode) {
        message.warning(i18n.t('errors.NOT_FOUND'));
        return;
      }
      runAiStoryboard(store, q, scriptNode, event.nodeId, event.episodeId, true); // Plan#20 BUG修复: 切集重生成默认创建主体
    });

    // 空分镜节点"关联剧本":建立 剧本.output → 分镜.input 连线(不触发生成)
    const unsubLinkStory = nodeActionBus.on('storyboard:linkScript', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const scriptNode = graph.nodes.find((n: any) => n.id === event.scriptNodeId && n.type === 'script');
      if (!scriptNode) {
        message.warning(i18n.t('errors.SCRIPT_NOT_FOUND'));
        return;
      }
      const sbNode = graph.nodes.find((n: any) => n.id === event.nodeId && n.type === 'storyboard');
      if (!sbNode) return;
      // 已存在同源连线则跳过
      const existing = graph.edges.some((e: any) =>
        e.target?.nodeId === event.nodeId && e.source?.nodeId === event.scriptNodeId && e.source?.pinId === 'output');
      if (existing) {
        message.info(i18n.t('editor.scriptAlreadyLinked'));
        return;
      }
      q.execute(new AddEdgeCommand({
        id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        source: { nodeId: event.scriptNodeId, pinId: 'output' },
        target: { nodeId: event.nodeId, pinId: 'input' },
      }));
      message.success(i18n.t('editor.scriptLinked'));
    });

    // 分镜"放弃生成":清除当前集 error 状态,恢复为可手动编辑的空态
    const unsubAbandonStory = nodeActionBus.on('storyboard:abandon', (event: { nodeId: string }) => {
      const q = refs.commandQueue;
      if (!q) return;
      const graph = q.getState();
      const sb = graph.nodes.find((n: any) => n.id === event.nodeId);
      const stEp = ((sb?.data as any)?.statusByEpisode as Record<string, unknown> | undefined) ?? {};
      const activeEp = ((sb?.data as any)?.activeEpisodeId as string | undefined);
      if (activeEp && activeEp in stEp) {
        q.execute(new UpdateNodeDataCommand(event.nodeId, { statusByEpisode: { ...stEp, [activeEp]: 'ready' } }));
      } else {
        q.execute(new UpdateNodeDataCommand(event.nodeId, { status: 'ready' }));
      }
    });

    // 2026-08-21 架构修正: 分镜胶囊菜单「剧管」入口——仅分镜时主动生成/关联剧管(分镜后置工序)
    // 从分镜节点 aiSubjects 幂等登记进关联剧管, 无识别主体时给出提示
    const unsubManageProduction = nodeActionBus.on('storyboard:manageProduction', (event: { nodeId: string }) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const sbNode = store.getGraph().nodes.find((n: any) => n.id === event.nodeId);
      if (!sbNode) return;
      const aiSubjects = Array.isArray((sbNode.data as any)?.aiSubjects) ? (sbNode.data as any).aiSubjects : [];
      if (aiSubjects.length === 0) {
        message.info(i18n.t('storyboard.noSubjectsToManage'));
        return;
      }
      const pmId = ensureProductionManager(store, q, sbNode);
      registerAiSubjectsToProduction(store, q, sbNode, aiSubjects);
      store.setSelection({ selectedNodeIds: new Set([pmId]), selectedEdgeIds: new Set() });
    });

    // Plan#20 T9: 删集级联清理——主体卡 episodeIds 过滤 + 分镜按集映射(shots/status/progress)删除 + activeEpisodeId 回退
    const unsubEpisodesDeleted = nodeActionBus.on('script:episodesDeleted', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const deleted = Array.isArray(event?.deletedIds) ? event.deletedIds : [];
      if (deleted.length === 0) return;
      const graph = store.getGraph();
      const cmds: Command[] = [];
      const deletedSet = new Set(deleted);
      for (const n of graph.nodes) {
        if (n.type === 'storyboard') {
          const d = (n.data ?? {}) as { shotsByEpisode?: Record<string, unknown>; statusByEpisode?: Record<string, unknown>; progressByEpisode?: Record<string, unknown>; activeEpisodeId?: string };
          const patch: Record<string, unknown> = {};
          const drop = <T,>(map: Record<string, T> | undefined): Record<string, T> => {
            const next: Record<string, T> = {};
            for (const [k, v] of Object.entries(map ?? {})) if (!deletedSet.has(k)) next[k] = v;
            return next;
          };
          if (d.shotsByEpisode) patch.shotsByEpisode = drop(d.shotsByEpisode);
          if (d.statusByEpisode) patch.statusByEpisode = drop(d.statusByEpisode);
          if (d.progressByEpisode) patch.progressByEpisode = drop(d.progressByEpisode);
          if (d.activeEpisodeId && deletedSet.has(d.activeEpisodeId)) {
            const remaining = Object.keys(patch.shotsByEpisode as Record<string, unknown>);
            patch.activeEpisodeId = remaining[0] ?? undefined;
          }
          if (Object.keys(patch).length > 0) cmds.push(new UpdateNodeDataCommand(n.id, patch));
        }
      }
      if (cmds.length > 0) q.execute(new BatchCommand(cmds, 'cascade-episode-delete'));
    });

    // ==== NodeGenerateDock 参考素材落地(吸附面板上传/断线 → 画布节点连线) ====
    // nodeDock:addReferenceNode: 面板上传素材 → 创建资源节点(宿主左侧) + 资源.output → 宿主.input 连线
    const unsubAddRef = nodeActionBus.on('nodeDock:addReferenceNode', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const host = store.getGraph().nodes.find((n: any) => n.id === event.nodeId);
      if (!host) return;
      const payload: AssetNodePayload = event.kind === 'text'
        ? { kind: 'text', content: event.content ?? '', title: event.title }
        : event.kind === 'image'
          ? { kind: 'image', dataUrl: event.content ?? '', title: event.title, storageKey: event.storageKey, width: event.width, height: event.height }
          : event.kind === 'video'
            ? { kind: 'video', url: event.content ?? '', title: event.title, storageKey: event.storageKey, width: event.width, height: event.height }
            : { kind: 'audio', url: event.content ?? '', title: event.title, storageKey: event.storageKey };
      void createAssetNode(payload, { x: host.position.x - 100, y: host.position.y }).then((node) => {
        if (!node) return;
        q.execute(new AddNodeCommand(node));
        const sourcePin = NODE_OUTPUT_PIN[node.type] ?? 'output';
        const targetPin = NODE_INPUT_PIN[host.type] ?? 'input';
        q.execute(new AddEdgeCommand({
          id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: { nodeId: node.id, pinId: sourcePin },
          target: { nodeId: event.nodeId, pinId: targetPin },
        }));
      });
    });

    // nodeDock:removeConnection: 面板删除参考素材 → 移除对应连线
    const unsubRemoveRef = nodeActionBus.on('nodeDock:removeConnection', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const edge = store.getGraph().edges.find((e: any) => e.target?.nodeId === event.nodeId && e.source?.nodeId === event.sourceNodeId);
      if (edge) q.execute(new RemoveEdgeCommand(edge.id));
    });

    return () => {
      unsubRetry();
      unsubReplay();
      unsubCancel();
      unsubGenStory();
      unsubAssetSaved();
      unsubGenSb();
      unsubAssociate();
      unsubRealized();
      unsubRetryStory();
      unsubRegenEp();
      unsubLinkStory();
      unsubAbandonStory();
      unsubManageProduction();
      unsubEpisodesDeleted();
      unsubStopGen();
      unsubAddRef();
      unsubRemoveRef();
    };
  }, [refs.store, handlePromptGenerate, handlePromptStop, handleReplayGeneration, message]);

  // saveAsset:将图片/视频/音频节点内容保存到素材库
  const handleSaveNodeAsset = useCallback(async (node: NodeRecord) => {
    const input = assetInputFromNode(node);
    if (!input) return;
    try {
      await addAssetToStore(input);
      // 保存后弹出素材面板,让用户看到存储结果(反馈)
      setAssetPickerOpen(true);
    } catch (err) {
      console.error('saveAsset failed:', err);
    }
  }, [addAssetToStore]);

  // reversePrompt:创建文本节点 + 连线图片→文本 + 调用AI反推
  const handleReversePrompt = useCallback(async (node: NodeRecord) => {
    if (!refs.commandQueue || !refs.store) return;
    const content = (node.data as { content?: string } | null)?.content ?? '';
    if (!content) return;

    // 创建文本节点(loading 状态),位置走布局契约(右侧 + 避让)
    const textNodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const textPos = resolvePlacement({
      anchor: node,
      size: { width: 280, height: 120 },
      existingNodes: refs.store.getGraph().nodes,
    });
    const textNode: NodeRecord = {
      id: textNodeId,
      type: 'text',
      position: textPos,
      size: { width: 280, height: 120 },
      data: { text: t('imageEditor.reversePromptLoading'), status: 'loading' },
    };
    refs.commandQueue.execute(new AddNodeCommand(textNode));

    // 连线:图片节点 → 文本节点(参考关系)
    refs.commandQueue.execute(
      new AddEdgeCommand({
        id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        source: { nodeId: node.id, pinId: 'image' },
        target: { nodeId: textNodeId, pinId: 'input' },
      }),
    );

    // 选中文本节点
    refs.store.setSelection({ selectedNodeIds: new Set([textNodeId]), selectedEdgeIds: new Set() });

    // 异步调用AI反推
    const provider = refs.aiProvider;
    if (!provider) {
      refs.commandQueue.execute(
        new UpdateNodeDataCommand(textNodeId, { text: t('imageEditor.reversePromptFailed'), status: 'error' }),
      );
      return;
    }

    try {
      // 将 content 转为 dataUrl(AI referenceImages 需要 base64 或公网URL,blob URL 需转换)
      const dataUrl = await contentToDataUrl(content);
      const result = await provider.generateText({
        prompt: IMAGE_PROMPT_REVERSE_PRESET,
        model: 'gpt-4o',
        referenceImages: [dataUrl],
      });
      refs.commandQueue.execute(
        new UpdateNodeDataCommand(textNodeId, { text: result, status: 'success' }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      refs.commandQueue.execute(
        new UpdateNodeDataCommand(textNodeId, { text: `${t('imageEditor.reversePromptFailed')}: ${msg}`, status: 'error' }),
      );
    }
  }, [refs.commandQueue, refs.store, refs.aiProvider, t]);

  // 组内成员排列/对齐/分布 — 子组视为整体
  const applyLayoutToGroupMembers = useCallback(
    (
      groupId: string,
      op: 'arrange' | 'align' | 'distribute' | 'unify',
      mode: string,
    ): void => {
      if (!refs.groupPlugin || !refs.commandQueue || !refs.store) return;
      const scene = refs.store.getGraph().nodes;
      const children = getChildren(scene, groupId);
      if (children.length < 2) return;

      // 构建 LayoutNode[]:子组用 getGroupBounds(整体),叶子用 position+size
      const layoutNodes: LayoutNode[] = children.map((child: any) => {
        const ext = state.extensions.get(child.type);
        const baseMeta = {
          type: child.type,
          defaultSize: ext?.defaultSize,
          lockAspectRatio: ext?.lockAspectRatio,
          resizable: ext?.resizable,
        };
        if (child.type === 'group') {
          const b = getGroupBounds(scene, child.id, getNodeSize);
          return {
            id: child.id,
            ...baseMeta,
            x: b?.x ?? child.position.x,
            y: b?.y ?? child.position.y,
            width: b?.width ?? 0,
            height: b?.height ?? 0,
          };
        }
        const size = resolveNodeSize(child, ext);
        return {
          id: child.id,
          ...baseMeta,
          x: child.position.x,
          y: child.position.y,
          width: size.width,
          height: size.height,
        };
      });

      // 统一尺寸:仅叶子参与(子组不可直接 resize);特化外观节点豁免尺寸计算
      if (op === 'unify') {
        const leafChildren = children.filter(
          (c: any) => c.type !== 'group' && !state.extensions.get(c.type)?.specialAppearance,
        );
        if (leafChildren.length < 2) return;
        const leafLayout = layoutNodes.filter((ln) =>
          leafChildren.some((c: any) => c.id === ln.id),
        );
        const sizes = unifyNodeSizes(leafLayout, mode as UnifySizeMode);
        const cmds = leafChildren
          .filter((c: any) => sizes.has(c.id))
          .map((c: any) => {
            const newSize = sizes.get(c.id)!;
            const oldSize = c.size ?? { width: 200, height: 80 };
            return new ResizeNodeCommand(
              c.id,
              { x: c.position.x, y: c.position.y, width: oldSize.width, height: oldSize.height },
              { x: newSize.x, y: newSize.y, width: newSize.width, height: newSize.height },
            );
          });
        if (cmds.length > 0) {
          refs.commandQueue.execute(new BatchCommand(cmds, 'group-unify-size'));
        }
        return;
      }

      // 排列/对齐/分布:计算新位置
      let positions: Map<string, { x: number; y: number }>;
      if (op === 'arrange') {
        let edges: { source: string; target: string }[] | undefined;
        if (mode === 'auto' || mode === 'tree' || mode === 'dagre') {
          const graph = refs.store.getGraph();
          const childIdSet = new Set(children.map((c: any) => c.id));
          edges = graph.edges
            .filter((e: any) => childIdSet.has(e.source.nodeId) && childIdSet.has(e.target.nodeId))
            .map((e: any) => ({ source: e.source.nodeId, target: e.target.nodeId }));
        }
        positions = arrangeNodes(layoutNodes, mode as ArrangeMode, edges);
      } else if (op === 'align') {
        positions = alignNodes(layoutNodes, mode as AlignMode);
      } else {
        positions = distributeNodes(layoutNodes, mode as DistributeMode);
      }
      if (positions.size === 0) return;

      // 应用位置:叶子用 MoveNodeCommand,子组用 MoveGroupCommand(平移整体)
      const cmds: Command[] = [];
      for (const child of children) {
        const newPos = positions.get(child.id);
        if (!newPos) continue;
        if (child.type === 'group') {
          const b = getGroupBounds(scene, child.id, getNodeSize);
          if (!b) continue;
          const dx = newPos.x - b.x;
          const dy = newPos.y - b.y;
          if (dx === 0 && dy === 0) continue;
          cmds.push(new MoveGroupCommand(child.id, dx, dy));
        } else {
          const delta = { x: newPos.x - child.position.x, y: newPos.y - child.position.y };
          if (delta.x === 0 && delta.y === 0) continue;
          cmds.push(new MoveNodeCommand(child.id, delta));
        }
      }
      if (cmds.length > 0) {
        refs.commandQueue.execute(new BatchCommand(cmds, `group-${op}`));
      }
    },
    [refs.groupPlugin, refs.commandQueue, refs.store, getNodeSize, state.extensions],
  );

  // 统一排列/对齐/分布/尺寸回调
  const handleArrange = useCallback(
    (mode: ArrangeMode): void => {
      if (state.selectedNodeId && state.selectedHasGroup && !state.isMixedSelection && state.selectedCount === 1) {
        applyLayoutToGroupMembers(state.selectedNodeId, 'arrange', mode);
      } else {
        refs.layoutController?.arrangeSelection(mode);
      }
    },
    [state.selectedNodeId, state.selectedHasGroup, state.isMixedSelection, state.selectedCount, refs.layoutController, applyLayoutToGroupMembers],
  );
  const handleAlign = useCallback(
    (mode: AlignMode): void => {
      if (state.selectedNodeId && state.selectedHasGroup && !state.isMixedSelection && state.selectedCount === 1) {
        applyLayoutToGroupMembers(state.selectedNodeId, 'align', mode);
      } else {
        refs.layoutController?.alignSelection(mode);
      }
    },
    [state.selectedNodeId, state.selectedHasGroup, state.isMixedSelection, state.selectedCount, refs.layoutController, applyLayoutToGroupMembers],
  );
  const handleDistribute = useCallback(
    (mode: DistributeMode): void => {
      if (state.selectedNodeId && state.selectedHasGroup && !state.isMixedSelection && state.selectedCount === 1) {
        applyLayoutToGroupMembers(state.selectedNodeId, 'distribute', mode);
      } else {
        refs.layoutController?.distributeSelection(mode);
      }
    },
    [state.selectedNodeId, state.selectedHasGroup, state.isMixedSelection, state.selectedCount, refs.layoutController, applyLayoutToGroupMembers],
  );
  const handleUnifySizes = useCallback(
    (mode: UnifySizeMode): void => {
      if (state.selectedNodeId && state.selectedHasGroup && !state.isMixedSelection && state.selectedCount === 1) {
        applyLayoutToGroupMembers(state.selectedNodeId, 'unify', mode);
      } else {
        refs.layoutController?.unifySelectionSizes(mode);
      }
    },
    [state.selectedNodeId, state.selectedHasGroup, state.isMixedSelection, state.selectedCount, refs.layoutController, applyLayoutToGroupMembers],
  );

  // 移出组(胶囊工具栏显式入口):单选且有父组时把选中节点/子组提升到祖父组或根级
  const handleMoveOutGroup = useCallback((): void => {
    if (!state.selectedNodeId) return;
    refs.groupPlugin?.getController().moveOutOfGroup([state.selectedNodeId]);
  }, [state.selectedNodeId, refs.groupPlugin]);

  // replace 文件选择回调
  const handleReplaceFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const nodeId = replaceNodeId;
    // 重置 input value 允许重复选择同一文件
    e.target.value = '';
    setReplaceNodeId(null);
    if (!file || !nodeId || !refs.commandQueue || !refs.store) return;
    try {
      const graph = refs.store.getGraph();
      const node = graph.nodes.find((n: NodeRecord) => n.id === nodeId);
      if (!node) return;
      // 图片类型走统一替换 API(保持比例 + 命令队列,读节点扩展尺寸契约)
      if (file.type.startsWith('image/')) {
        await replaceNodeImage(refs.commandQueue, node, file, { ext: state.extensions.get(node.type) });
      } else if (file.type.startsWith('video/')) {
        // 视频:命令化替换(保宽调高读扩展契约,支持撤销/重做)
        await replaceNodeVideo(refs.commandQueue, node, file, { ext: state.extensions.get(node.type) });
      } else if (file.type.startsWith('audio/')) {
        // 音频:命令化替换(气泡尺寸固定,仅 data 落盘)
        await replaceNodeAudio(refs.commandQueue, node, file);
      }
    } catch (err) {
      console.error('replace failed:', err);
    }
  }, [replaceNodeId, refs.commandQueue, refs.store]);

  // ToolContext: 注入给 ToolsDock 的工具集
  const toolContext = useMemo<ToolContext | null>(() => {
    if (!refs.commandQueue || !state.editor) return null;
    return {
      commandQueue: refs.commandQueue,
      eventBus: state.editor.core.eventBus,
      getSelectedNodeIds: () => state.editor?.store.getSelection().selectedNodeIds ?? new Set(),
      // 征集#9 E1:惰性读取视口/容器尺寸,供新建堆叠按用户视觉中心定位(不加入依赖,避免高频重建)
      getViewport: () => refs.store?.getViewport() ?? { x: 0, y: 0, k: 1 },
      getContainerSize: () => {
        const el = containerRef.current;
        return el
          ? { width: el.clientWidth, height: el.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight };
      },
      openEditor: (node: NodeRecord) => {
        // 文本/配置节点编辑器(图片节点由 openImageDialog 处理)
        if (node.type !== 'image') {
          // 文本/配置节点:通过 data.__editing 标记触发节点内编辑模式
          state.editor?.store.updateNodeData(node.id, { __editing: true });
        }
      },
      openImageDialog: (node: NodeRecord, type: string) => {
        if (type === 'saveAsset') {
          // 保存到素材库:将节点图片内容转为素材
          void handleSaveNodeAsset(node);
          return;
        }
        if (type === 'reversePrompt') {
          // 反推提示词:创建文本节点(暂无 AI 反推,用原 prompt 作为占位)
          handleReversePrompt(node);
          return;
        }
        if (type === 'replace') {
          // 替换图片/视频/音频:根据节点类型设置 accept,触发文件选择
          setReplaceNodeId(node.id);
          if (node.type === 'video') {
            setReplaceAccept('video/*');
          } else if (node.type === 'audio') {
            setReplaceAccept('audio/*');
          } else {
            setReplaceAccept('image/*');
          }
          replaceInputRef.current?.click();
          return;
        }
        // 对话框类型:设置 imageDialog 状态,由 ImageDialogRenderer 渲染
        setImageDialog({ node, type });
      },
    };
  }, [refs.commandQueue, state.editor, handleSaveNodeAsset, handleReversePrompt]);

  // 多选堆叠(征集#9 E2 拍板):右键菜单与胶囊工具栏共用入口;
  // 落点优先用户视觉中心(视口中心,选择集即将删除故整体忽略),回退选择集右上外侧 120px;
  // 不可堆叠节点跳过式处理(执行可堆叠子集 + 未收纳列表提示)
  const handleStackSelected = useCallback(() => {
    const g = refs.store?.getGraph();
    const selectedIds = refs.store?.getSelection().selectedNodeIds;
    if (!g || !selectedIds || selectedIds.size < 2) return;
    const isNodeStackable = (n: NodeRecord): boolean => {
      if (n.type === 'group') return false;
      const ext = state.extensions.get(n.type);
      return Boolean(ext?.capabilities?.stackable);
    };
    const sn = g.nodes.filter((n) => selectedIds.has(n.id));
    const spawn =
      toolContext?.getViewport && toolContext.getContainerSize
        ? resolveStackSpawnPosition(toolContext, { ignoreNodeIds: selectedIds })
        : null;
    const result = stackSelectedNodes(
      spawn ?? { x: computeNodesBounds(sn).maxX + 120, y: computeNodesBounds(sn).minY },
      sn,
      { edges: g.edges },
      isNodeStackable,
    );
    if (!result) return;
    refs.commandQueue?.execute(result.command);
    // 合并堆叠后缩放聚焦(征集#9 验收):聚焦系数 0.8(比基准 0.82 更小 → 节点周边留白更大);
    // 顺带验证 focusOnNode 新开放的 paddingRatio 接口(此前硬编码 0.82 无扩展点)
    const container = toolContext?.getContainerSize ? toolContext.getContainerSize() : null;
    const mergedNode = refs.store?.getNode(result.stackNodeId);
    if (refs.store?.focusOnNode && container) {
      refs.store.focusOnNode(
        result.stackNodeId,
        container,
        mergedNode?.size?.width,
        mergedNode?.size?.height,
        400,
        51,
        0.8,
      );
    }
    if (result.skippedCount > 0) {
      // 跳过透明度增强:列出未收纳节点标题(至多 3 个)
      const skippedTitles = result.skippedIds
        .map((id) => g.nodes.find((n) => n.id === id)?.title)
        .filter((t): t is string => !!t);
      const skipDetail =
        skippedTitles.length > 0
          ? `（未收纳：${skippedTitles.slice(0, 3).join('、')}${skippedTitles.length > 3 ? ' 等' : ''}）`
          : '';
      message.info(
        t('nodes.stackSelectedResult', { collected: result.collectedCount, skipped: result.skippedCount }) + skipDetail,
      );
    } else {
      message.success(t('nodes.stackSelectedDone', { count: result.collectedCount }));
    }
  }, [refs, state.extensions, toolContext, t, message]);

  // 节点扩展访问器
  const getExtension = useCallback(
    (nodeId: string): NodeTypeExtension | undefined => {
      if (!state.editor) return undefined;
      const graph = state.editor.store.getGraph();
      const node = graph.nodes.find((n: any) => n.id === nodeId);
      if (!node) return undefined;
      // 预览组(type='group' 但不在 graph 中)回退到 group 扩展(若存在)
      if (nodeId === PREVIEW_GROUP_ID) return undefined;
      return state.extensions.get(node.type);
    },
    [state.editor, state.extensions],
  );

  // 组节点专用工具访问器
  const getGroupTools = useCallback(
    (node: NodeRecord, _ctx: ToolContext): ToolDefinition[] => {
      if (!refs.groupPlugin) return [];
      const ctrl = refs.groupPlugin.getController();
      const isPreview = node.id === PREVIEW_GROUP_ID || ctrl.isPreviewing();

      if (isPreview) {
        // 预览组:仅保留成组确认按钮(一步到位);取消预览走 Esc(用户拍板:移除 X 按钮,预览态无解组/取消概念)
        const mode = ctrl.getPreviewGroupMode();
        return [
          {
            id: 'confirm',
            label: mode === 'version-folder' ? t('groupTools.versionFolderTitle') : t('toolbar.group'),
            title: mode === 'version-folder' ? t('groupTools.versionFolderTitle') : t('groupTools.confirmTitle'),
            icon: createElement(EDITOR_ICONS.group, { size: 14 }),
            group: '预览',
            run: () => ctrl.confirmPreview(t('groupTools.defaultGroupName')),
          },
        ];
      }

      // 正式组工具
      const bgColor = node.backgroundColor ?? '';
      const radius = node.borderRadius;
      const opacity = node.opacity;

      return [
        {
          id: 'rename',
          label: t('groupTools.renameLabel'),
          title: t('groupTools.renameTitle'),
          icon: createElement(EDITOR_ICONS.edit, { size: 14 }),
          group: '组操作',
          run: (n: any) => {
            // 重命名前聚焦组 bounds(含空组回退,用户能看到正在重命名的组对象)
            const store = refs.store;
            if (store) {
              const bounds = getGroupBoundsWithEmptyFallback(store.getGraph().nodes, n.id, getNodeSize);
              if (bounds) store.focusOnBounds(bounds, state.containerSize, 400, 51);
            }
            onRenameGroup(n.id);
          },
        },
        {
          id: 'ungroup',
          label: t('groupTools.ungroupLabel'),
          title: t('groupTools.ungroupTitle'),
          icon: createElement(EDITOR_ICONS.ungroup, { size: 14 }),
          group: '组操作',
          run: (n: any) => ctrl.ungroup([n.id]),
        },
        {
          id: 'style',
          label: t('groupTools.styleLabel'),
          title: t('groupTools.styleTitle'),
          icon: createElement(EDITOR_ICONS.style, { size: 14 }),
          group: '组操作',
          run: (n: any) => {
            setGroupStyleDialog({ groupId: n.id, currentBgColor: bgColor || undefined, currentOpacity: opacity, currentRadius: radius });
          },
        },
      ];
    },
    [refs.groupPlugin, onRenameGroup, t, refs.store, state.containerSize, getNodeSize],
  );

  // 胶囊工具栏锚点: 计算全部选中节点/组的包围盒
  const getAnchorBounds = useCallback(
    (): { x: number; y: number; width: number; height: number } | null => {
      if (!refs.store) return null;
      const scene = refs.store.getGraph().nodes;
      const ids = [...refs.store.getSelection().selectedNodeIds];
      if (ids.length === 0) return null;
      // 拖拽瞬态偏移(P0-2):拖动中节点 position 不更新,锚点需并入 dragOffsets 才能跟手
      // 同一拖拽集偏移一致,取首个命中选中节点的偏移叠加到整包围盒
      let dragDx = 0;
      let dragDy = 0;
      const offsets = refs.store.getDragOffsets();
      if (offsets.size > 0) {
        for (const id of ids) {
          const off = offsets.get(id);
          if (off) {
            dragDx = off.dx;
            dragDy = off.dy;
            break;
          }
        }
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const id of ids) {
        const node = scene.find((n: any) => n.id === id);
        if (!node) continue;
        if (node.type === 'group') {
          // 含空组回退(避免胶囊锚点落到组 position 0,0 世界原点)
          const b = getGroupBoundsWithEmptyFallback(scene, id, getNodeSize);
          if (!b) continue;
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.width);
          maxY = Math.max(maxY, b.y + b.height);
        } else {
          const size = getNodeSize(node);
          const px = node.position.x ?? 0;
          const py = node.position.y ?? 0;
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px + size.width);
          maxY = Math.max(maxY, py + size.height);
        }
      }
      if (!Number.isFinite(minX)) return null;
      return { x: minX + dragDx, y: minY + dragDy, width: maxX - minX, height: maxY - minY };
    },
    [refs.store, refs.groupPlugin, getNodeSize],
  );

  const minimapNodeFilter = (n: NodeRecord) => n.type !== 'group';

  return {
    // 计算值
    pinDefaults,
    groupDefaultsValue,
    nodeDefaultsValue,
    selectedConfigMode,
    isPromptRunning,
    forceShowPins,
    connectionHoverNodeId,
    hoveredNodeId,
    getNodeSize,
    previewGroupNode,
    toolContext,
    minimapNodeFilter,
    nodeAbortControllersRef,
    nodeFailureCountRef,

    // Plan#29 T7: 主体散落卡体系已移除(改为统筹节点);保留字段避免 editor-page 挂载点引用报错
    subjectModals: null,

    // 回调函数
    handleCutEdge,
    handleCanvasContextMenu,
    handleNodeCreateMenuSelect,
    handlePromptChange,
    handleNodeConfigChange,
    handlePromptGenerate,
    handlePromptStop,
    handleSaveNodeAsset,
    handleReversePrompt,
    applyLayoutToGroupMembers,
    handleArrange,
    handleAlign,
    handleDistribute,
    handleUnifySizes,
    handleMoveOutGroup,
    handleStackSelected,
    handleReplaceFileChange,
    getExtension,
    getGroupTools,
    getAnchorBounds,
  };
}