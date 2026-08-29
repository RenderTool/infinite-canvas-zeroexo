/**
 * CanvasV2Page — Three.js v2 画布引擎调研 demo（Plan#26）
 *
 * 直接套用现有画布壳（Layout + TopBar + LeftSideToolBar + 主题）作为框架，
 * 画布视口区域替换为 ThreeCanvasV2 引擎，验证复原效果。
 *
 * 调研项控制面板（右侧）：
 * - 投影模式：none / DirectionalLight / ContactShadows
 * - 节点数量 / 生成示例 / 组分配
 * - 3D 模式进入/退出（C 键返回）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Layout } from 'antd';
import * as THREE from 'three';
import { useTheme } from '@zeroexo/plugin-theme';
import { TopBar } from '@/features/top-bar/index.js';
import { LeftSideToolBar } from '@/features/left-side-toolbar/index.js';
import { ThreeCanvasV2, DEFAULT_STYLE, DEFAULT_EDGE_STYLE, DEFAULT_GROUP_STYLE } from './three-engine.js';
import type { V2StyleParams, EdgeStyleParams, GroupStyleParams } from './three-engine.js';
import { uploadImage } from '@zeroexo/plugin-persistence';
import { compressImageFile } from './image-compress.js';

export interface CanvasV2PageProps {
  onBack: () => void;
}

export function CanvasV2Page({ onBack }: CanvasV2PageProps): React.ReactElement {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ThreeCanvasV2 | null>(null);

  const [scale, setScale] = useState(1);
  const [style, setStyle] = useState<V2StyleParams>({ ...DEFAULT_STYLE }); // 视觉参数化（圆角/阴影/描边，shader uniform 驱动）
  const [edgeStyle, setEdgeStyleState] = useState<EdgeStyleParams>({ ...DEFAULT_EDGE_STYLE }); // 边线参数（线宽/辉光/曲线段数）
  const [groupStyle, setGroupStyleState] = useState<GroupStyleParams>({ ...DEFAULT_GROUP_STYLE }); // 组框参数（虚线距离场）
  const [fps, setFps] = useState(60);
  const [degradeLevel, setDegradeLevel] = useState(0);
  const [adaptive, setAdaptive] = useState(true);
  const [cullEnabled, setCullEnabled] = useState(true);
  const [is3D, setIs3D] = useState(false);
  const [nodeCount, setNodeCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [capsule, setCapsule] = useState<{ x: number; y: number } | null>(null); // 2D 胶囊菜单锚点（选中节点中心屏幕坐标）
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null); // 右键菜单（空白/节点）
  const [title, setTitle] = useState('V2 引擎调研画布');
  const [titleDraft, setTitleDraft] = useState('V2 引擎调研画布');
  const [titleEditing, setTitleEditing] = useState(false);
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [interactionMode, setInteractionMode] = useState<'select' | 'pan'>('select');

  // 引擎初始化
  useEffect(() => {
    if (!containerRef.current) return;
    const engine = new ThreeCanvasV2(containerRef.current);
    engineRef.current = engine;
    engine.onNodeClick = (id) => {
      setSelectedId(id);
      // 2D 胶囊菜单锚点跟随选中节点（组选中不显示，沿用原项目单选节点语义）
      if (id && !id.startsWith('组:')) {
        const p = engine.nodeScreenPos(id);
        setCapsule(p ?? null);
      } else {
        setCapsule(null);
      }
    };
    engine.onNodeMove = (id) => {
      // 拖动/组 Z 浮动时胶囊跟随选中节点
      if (engine.selected?.id === id) {
        const p = engine.nodeScreenPos(id);
        if (p) setCapsule(p);
      }
    };
    engine.onGroupClick = (gid) => setSelectedId(gid ? `组:${gid}` : null); // 组选中同步面板显示
    engine.onViewportChange = (vp) => setScale(vp.k);
    engine.on3DStateChange = (is3d) => setIs3D(is3d);
    engine.onPerfUpdate = (f, l) => { setFps(f); setDegradeLevel(l); }; // 性能面板（500ms 推送）
    engine.onDegradeChange = (l) => setDegradeLevel(l);
    // 初始示例：白卡片（阴影观感验证需白底 + 深色背景，与示例一致）+ 浅色变体
    const gidA = '组件 Alpha';
    const gidB = '组件 Beta';
    const colors = ['#ffffff', '#f0f0f0', '#e8ecf4', '#f5f5f5'];
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const w = 340;
      const h = [191, 340, 500][i % 3] ?? 240;
      ids.push(engine.addNode({
        x: (i - 1) * 440, y: 0, w, h,
        color: colors[i % (colors.length - 1)] ?? '#2d3748',
        groupId: i < 2 ? gidA : gidB,
        label: `节点 ${i + 1}`,
      }));
    }
    // 第四节点
    const id4 = engine.addNode({ x: 560, y: 340, w: 300, h: 200, color: colors[3], groupId: gidB, label: '节点 4' });
    // 连线（还原 EdgeLayer 风格：辉光底层 + 主线 + PIN 空心圆点）
    if (ids[0] && ids[2]) engine.addEdge(ids[0], ids[2]);
    if (ids[0] && ids[1]) engine.addEdge(ids[0], ids[1], { color: 0x95a5a6 });
    if (ids[1] && id4) engine.addEdge(ids[1], id4, { color: 0x95a5a6 });
    setNodeCount(4);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // 样式参数同步（uniform 更新，零重建；滑杆拖动也保持 60fps）
  const patchStyle = useCallback((patch: Partial<V2StyleParams>) => {
    setStyle((prev) => ({ ...prev, ...patch }));
    engineRef.current?.setStyle(patch);
  }, []);

  // 边线参数同步（LineMaterial 属性 + 曲线段数重建，零材质重建）
  const patchEdge = useCallback((patch: Partial<EdgeStyleParams>) => {
    setEdgeStyleState((prev) => ({ ...prev, ...patch }));
    engineRef.current?.setEdgeStyle(patch);
  }, []);

  // 组框参数同步（虚线距离场周期换算，屏幕像素恒定）
  const patchGroup = useCallback((patch: Partial<GroupStyleParams>) => {
    setGroupStyleState((prev) => ({ ...prev, ...patch }));
    engineRef.current?.setGroupStyle(patch);
  }, []);

  // 性能开关同步
  useEffect(() => {
    if (engineRef.current) engineRef.current.adaptiveDegrade = adaptive;
  }, [adaptive]);
  useEffect(() => {
    if (engineRef.current) engineRef.current.cullEnabled = cullEnabled;
  }, [cullEnabled]);

  // 阴影显隐同步（已并入样式参数面板，删除独立开关）

  // 缩放同步（LeftSideToolBar 的 scale 滑杆驱动引擎视口）
  const handleScaleChange = useCallback((k: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    const vp = engine.getViewport();
    engine.setViewport({ ...vp, k });
    setScale(k);
  }, []);

  const handleAddNodes = useCallback((count: number, grouped: boolean) => {
    const engine = engineRef.current;
    if (!engine) return;
    const vp = engine.getViewport();
    const gid = grouped ? `批量组 ${Date.now() % 1000}` : null;
    for (let i = 0; i < count; i++) {
      const aspect = [16 / 9, 1, 9 / 16, 4 / 3][Math.floor(Math.random() * 4)] ?? 1;
      const w = 340;
      const h = Math.round(w / aspect);
      engine.addNode({
        x: vp.x + (Math.random() - 0.5) * 900,
        y: vp.y + (Math.random() - 0.5) * 600,
        w, h,
        color: `hsl(${Math.floor(Math.random() * 360)}, 40%, ${82 + Math.floor(Math.random() * 12)}%)`,
        groupId: gid,
      });
    }
    setNodeCount((c) => c + count);
  }, []);

  const handleToggle3D = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    // POC：按钮可双向切换（动画进行中由引擎内部 camAnim 防重入）
    if (engine.isLayerMode) engine.exit3D();
    else engine.enter3D();
    // is3D 由 on3DStateChange 回调在动画完成后设置
  }, []);

  // C 键退出 3D 由引擎内部 keydown 统一处理（页面不再重复监听，避免双重触发）


  // 上传图片 → 克制压缩（画布绝不加载原图）→ 持久化 → 图片节点
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const engine = engineRef.current;
    const file = e.target.files?.[0];
    e.target.value = ''; // 重置，允许重复选同一文件
    if (!engine || !file) return;
    try {
      // 输入即压缩：长边 ≤ 2048 WebP 0.85（小图仅重编码剥离元数据）；原图仅下载/详情 modal 按需取
      const { blob, width, height } = await compressImageFile(file);
      // 压缩图入持久层（IndexedDB image_files 桶，URL 生命周期由存储内存缓存管理，勿 revoke）
      const uploaded = await uploadImage(blob);
      const tex = await loadTexture(uploaded.url);
      tex.anisotropy = 8; // GPU 原生采样优化：斜视清晰（超出 max 会被驱动 clamp）
      const vp = engine.getViewport();
      // 逻辑尺寸按压缩后图片比例（基准宽 340）；缩放质量由 GPU mipmap 天然保证
      const w = 340;
      const h = Math.max(40, Math.round(340 * (height / Math.max(1, width))));
      engine.addImageNode({
        x: vp.x + (Math.random() - 0.5) * 200,
        y: vp.y + (Math.random() - 0.5) * 200,
        w, h,
        texture: tex,
        label: file.name,
      });
      setNodeCount((c) => c + 1);
    } catch (err) {
      console.warn('[canvas-v2] 图片上传失败:', err);
    }
  }, []);

  const handleClear = useCallback(() => {
    engineRef.current?.clear();
    setNodeCount(0);
    setSelectedId(null);
  }, []);

  // 显式建组：选中节点 → 新组（组由用户显式创建，上传/批量节点不隐式建组）
  const handleCreateGroup = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !selectedId || selectedId.startsWith('组:')) return;
    const gid = `组 ${Date.now() % 10000}`;
    engine.setNodeGroup(selectedId, gid);
    setSelectedId(`组:${gid}`); // 面板同步显示组选中
  }, [selectedId]);

  const handleDeleteSelected = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !selectedId || selectedId.startsWith('组:')) return;
    engine.removeNode(selectedId);
    setSelectedId(null);
    setCapsule(null);
    setNodeCount((c) => Math.max(0, c - 1));
  }, [selectedId]);

  return (
    <Layout style={layoutStyle(theme.canvas.background)}>
      <div style={mainRowStyle}>
        <div style={mainColStyle}>
          <div style={headerStyle}>
            <TopBar
              title={title}
              titleDraft={titleDraft}
              isTitleEditing={titleEditing}
              onTitleDraftChange={setTitleDraft}
              onStartTitleEditing={() => { setTitleDraft(title); setTitleEditing(true); }}
              onFinishTitleEditing={() => { setTitle(titleDraft.trim() || title); setTitleEditing(false); }}
              onCancelTitleEditing={() => setTitleEditing(false)}
              agentOpen={false}
              onToggleAgent={() => undefined}
              gridStyle="dots"
              onGridStyleChange={() => undefined}
              onOpenSettings={() => undefined}
            />
          </div>
          <Layout.Content style={contentLayoutStyle}>
            <div style={flexContainerStyle}>
              {/* Three.js v2 画布视口（替代 DOM CanvasView） */}
              <div
                ref={containerRef}
                style={canvasAreaStyle}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const engine = engineRef.current;
                  const nodeId = engine ? engine.pickAt(e.clientX, e.clientY) : null;
                  setCtxMenu({ x: e.clientX, y: e.clientY, nodeId });
                }}
              >
                {/* 2D 胶囊菜单（沿用原项目 NodeCapsuleToolbar 磁贴样式：纯 icon 跟随选中节点） */}
                {capsule && selectedId && !selectedId.startsWith('组:') && (
                  <div style={capsuleStyle(capsule)}>
                    <button style={capsuleBtnStyle} title="删除节点" onClick={handleDeleteSelected}>🗑</button>
                    <button style={capsuleBtnStyle} title="加入新组" onClick={handleCreateGroup}>⛶</button>
                    <button style={capsuleBtnStyle} title={is3D ? '退出 3D' : '进入 3D'} onClick={handleToggle3D}>{is3D ? '⏻' : '🧊'}</button>
                  </div>
                )}
                {/* 右键菜单（空白：添加节点/3D/清空；节点：删除/建组） */}
                {ctxMenu && (
                  <div style={ctxMenuStyle(ctxMenu.x, ctxMenu.y)} onMouseLeave={() => setCtxMenu(null)}>
                    {ctxMenu.nodeId ? (
                      <>
                        <div style={ctxTitleStyle}>节点 {ctxMenu.nodeId}</div>
                        <button
                          style={ctxItemStyle}
                          onClick={() => {
                            const e = engineRef.current;
                            if (e && ctxMenu.nodeId) e.removeNode(ctxMenu.nodeId);
                            setSelectedId(null);
                            setCapsule(null);
                            setCtxMenu(null);
                            setNodeCount((c) => Math.max(0, c - 1));
                          }}
                        >🗑️ 删除节点</button>
                        <button
                          style={ctxItemStyle}
                          onClick={() => {
                            const engine = engineRef.current;
                            if (engine && ctxMenu.nodeId) {
                              const gid = `组 ${Date.now() % 10000}`;
                              engine.setNodeGroup(ctxMenu.nodeId, gid);
                              setSelectedId(`组:${gid}`);
                            }
                            setCapsule(null);
                            setCtxMenu(null);
                          }}
                        >⛶ 加入新组</button>
                      </>
                    ) : (
                      <>
                        <button style={ctxItemStyle} onClick={() => { handleAddNodes(1, false); setCtxMenu(null); }}>＋ 添加节点</button>
                        <button style={ctxItemStyle} onClick={() => { handleToggle3D(); setCtxMenu(null); }}>{is3D ? '🎚️ 退出 3D' : '🎚️ 进入 3D'}</button>
                        <button style={ctxItemStyle} onClick={() => { handleClear(); setCtxMenu(null); }}>🧹 清空画布</button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* 调研项控制面板（按类目折叠） */}
              <div style={panelStyle}>
                <div style={panelTitleStyle}>🧪 V2 引擎调研（Plan#26）</div>
                <button style={{ ...btnStyle, width: '100%', marginBottom: 8 }} onClick={onBack}>← 返回主页</button>

                <Section title="🎨 节点 / 卡片样式（CSS 1:1 · shader 驱动）">
                  <div style={subTitleStyle}>圆角（border-radius 四值，每角独立）</div>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>TL</span>
                    <input type="range" min={0} max={40} value={style.radiusTL} onChange={(e) => patchStyle({ radiusTL: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.radiusTL}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>TR</span>
                    <input type="range" min={0} max={40} value={style.radiusTR} onChange={(e) => patchStyle({ radiusTR: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.radiusTR}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>BR</span>
                    <input type="range" min={0} max={40} value={style.radiusBR} onChange={(e) => patchStyle({ radiusBR: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.radiusBR}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>BL</span>
                    <input type="range" min={0} max={40} value={style.radiusBL} onChange={(e) => patchStyle({ radiusBL: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.radiusBL}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>透明度</span>
                    <input type="range" min={0} max={1} step={0.05} value={style.opacity} onChange={(e) => patchStyle({ opacity: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.opacity.toFixed(2)}</span>
                  </label>
                  <div style={subTitleStyle}>外部投影 · 空闲（box-shadow 1:1）</div>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>偏移X</span>
                    <input type="range" min={-30} max={30} value={style.shadowOffsetX} onChange={(e) => patchStyle({ shadowOffsetX: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.shadowOffsetX}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>偏移Y</span>
                    <input type="range" min={-30} max={30} value={style.shadowOffsetY} onChange={(e) => patchStyle({ shadowOffsetY: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.shadowOffsetY}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>模糊</span>
                    <input type="range" min={0} max={40} value={style.shadowBlur} onChange={(e) => patchStyle({ shadowBlur: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.shadowBlur}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>扩散</span>
                    <input type="range" min={-10} max={20} value={style.shadowSpread} onChange={(e) => patchStyle({ shadowSpread: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.shadowSpread}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>浓度</span>
                    <input type="range" min={0} max={1} step={0.05} value={style.shadowOpacity} onChange={(e) => patchStyle({ shadowOpacity: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.shadowOpacity.toFixed(2)}</span>
                  </label>
                  <label style={radioRowStyle}>
                    影色 <input type="color" value={style.shadowColor} onChange={(e) => patchStyle({ shadowColor: e.target.value })} />
                  </label>
                  <div style={subTitleStyle}>外部投影 · hover（独立参数直接切换）</div>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>偏移X</span>
                    <input type="range" min={-30} max={30} value={style.hoverShadowOffsetX} onChange={(e) => patchStyle({ hoverShadowOffsetX: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.hoverShadowOffsetX}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>偏移Y</span>
                    <input type="range" min={-30} max={30} value={style.hoverShadowOffsetY} onChange={(e) => patchStyle({ hoverShadowOffsetY: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.hoverShadowOffsetY}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>模糊</span>
                    <input type="range" min={0} max={60} value={style.hoverShadowBlur} onChange={(e) => patchStyle({ hoverShadowBlur: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.hoverShadowBlur}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>扩散</span>
                    <input type="range" min={-10} max={20} value={style.hoverShadowSpread} onChange={(e) => patchStyle({ hoverShadowSpread: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.hoverShadowSpread}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>浓度</span>
                    <input type="range" min={0} max={1} step={0.05} value={style.hoverShadowOpacity} onChange={(e) => patchStyle({ hoverShadowOpacity: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.hoverShadowOpacity.toFixed(2)}</span>
                  </label>
                  <div style={subTitleStyle}>边线（CSS outline 语义：类型 / 颜色 / 粗细）</div>
                  <label style={radioRowStyle}>
                    类型
                    <select value={style.borderType} onChange={(e) => patchStyle({ borderType: Number(e.target.value) as 0 | 1 })}>
                      <option value={0}>实线</option>
                      <option value={1}>虚线</option>
                    </select>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>粗细</span>
                    <input type="range" min={0} max={8} step={0.5} value={style.borderWidth} onChange={(e) => patchStyle({ borderWidth: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{style.borderWidth}</span>
                  </label>
                  <label style={radioRowStyle}>
                    默认态 <input type="color" value={style.borderDefaultColor} onChange={(e) => patchStyle({ borderDefaultColor: e.target.value })} />
                  </label>
                  <label style={radioRowStyle}>
                    hover态 <input type="color" value={style.borderHoverColor} onChange={(e) => patchStyle({ borderHoverColor: e.target.value })} />
                  </label>
                  <label style={radioRowStyle}>
                    选中态 <input type="color" value={style.borderSelectedColor} onChange={(e) => patchStyle({ borderSelectedColor: e.target.value })} />
                  </label>
                  <div style={cssBoxStyle}>
                    {`border-radius: ${style.radiusTL}px ${style.radiusTR}px ${style.radiusBR}px ${style.radiusBL}px;
box-shadow: ${style.shadowOffsetX}px ${style.shadowOffsetY}px ${style.shadowBlur}px ${style.shadowSpread}px rgba(0,0,0,${style.shadowOpacity});
:hover { box-shadow: ${style.hoverShadowOffsetX}px ${style.hoverShadowOffsetY}px ${style.hoverShadowBlur}px ${style.hoverShadowSpread}px rgba(0,0,0,${style.hoverShadowOpacity}); }
outline: ${style.borderWidth}px ${style.borderType === 1 ? 'dashed' : 'solid'} ${style.borderDefaultColor};
:selected { outline-color: ${style.borderSelectedColor}; }
opacity: ${style.opacity};`}
                  </div>
                </Section>

                <Section title="🔗 连线（①粗细 ②颜色 ③辉光 ④段数 ⑤透明度）">
                  <label style={radioRowStyle}>
                    ② 颜色 <input type="color" value={edgeStyle.color} onChange={(e) => patchEdge({ color: e.target.value })} />
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>① 粗细</span>
                    <input type="range" min={0.5} max={6} step={0.5} value={edgeStyle.lineWidth} onChange={(e) => patchEdge({ lineWidth: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{edgeStyle.lineWidth}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>⑤ 透明</span>
                    <input type="range" min={0} max={1} step={0.05} value={edgeStyle.lineOpacity} onChange={(e) => patchEdge({ lineOpacity: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{edgeStyle.lineOpacity.toFixed(2)}</span>
                  </label>
                  <div style={subTitleStyle}>辉光（宽度方向边缘渐变，仅活跃态显示）</div>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>③ 辉光宽</span>
                    <input type="range" min={2} max={16} step={0.5} value={edgeStyle.glowWidth} onChange={(e) => patchEdge({ glowWidth: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{edgeStyle.glowWidth}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>辉光透</span>
                    <input type="range" min={0} max={1} step={0.05} value={edgeStyle.glowOpacity} onChange={(e) => patchEdge({ glowOpacity: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{edgeStyle.glowOpacity.toFixed(2)}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>④ 段数</span>
                    <input type="range" min={4} max={64} step={1} value={edgeStyle.segments} onChange={(e) => patchEdge({ segments: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{edgeStyle.segments}</span>
                  </label>
                  <div style={subTitleStyle}>活跃态（选中 / 悬停节点关联边）</div>
                  <label style={radioRowStyle}>
                    活跃色 <input type="color" value={edgeStyle.activeColor} onChange={(e) => patchEdge({ activeColor: e.target.value })} />
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>活跃宽</span>
                    <input type="range" min={1} max={5} step={0.5} value={edgeStyle.activeWidth} onChange={(e) => patchEdge({ activeWidth: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{edgeStyle.activeWidth}</span>
                  </label>
                  <div style={infoStyle}>活跃态 = 辉光层 + 主线静态虚线（16+80 屏幕像素恒定，去脉冲）</div>
                </Section>

                <Section title="🧩 组框（SDF 虚线距离场）">
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>虚线长</span>
                    <input type="range" min={2} max={20} step={1} value={groupStyle.dashPx} onChange={(e) => patchGroup({ dashPx: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{groupStyle.dashPx}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>间隔</span>
                    <input type="range" min={2} max={16} step={1} value={groupStyle.gapPx} onChange={(e) => patchGroup({ gapPx: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{groupStyle.gapPx}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>线宽</span>
                    <input type="range" min={0.5} max={4} step={0.5} value={groupStyle.lineWidth} onChange={(e) => patchGroup({ lineWidth: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{groupStyle.lineWidth}</span>
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>线透明</span>
                    <input type="range" min={0} max={1} step={0.05} value={groupStyle.lineOpacity} onChange={(e) => patchGroup({ lineOpacity: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{groupStyle.lineOpacity.toFixed(2)}</span>
                  </label>
                  <label style={radioRowStyle}>
                    轮廓色 <input type="color" value={groupStyle.lineColor} onChange={(e) => patchGroup({ lineColor: e.target.value })} />
                  </label>
                  <label style={radioRowStyle}>
                    选中色 <input type="color" value={groupStyle.selectColor} onChange={(e) => patchGroup({ selectColor: e.target.value })} />
                  </label>
                  <label style={sliderRowStyle}>
                    <span style={sliderLabelStyle}>背景透</span>
                    <input type="range" min={0} max={0.3} step={0.01} value={groupStyle.bgOpacity} onChange={(e) => patchGroup({ bgOpacity: Number(e.target.value) })} />
                    <span style={sliderValStyle}>{groupStyle.bgOpacity.toFixed(2)}</span>
                  </label>
                </Section>

                <Section title="📊 性能（自适应降级链）">
                  <div style={infoStyle}>FPS：{fps} · 降级 L{degradeLevel}（0=全效）</div>
                  <div style={hintStyle}>
                    {['全效（pixelRatio 原生）', 'L1 pixelRatio→1.5', 'L2 阴影关 + 段数减半', 'L3 pixelRatio→1 + 段数再减', 'L4 圆角归零'][degradeLevel] ?? ''}
                  </div>
                  <label style={radioRowStyle}>
                    <input type="checkbox" checked={adaptive} onChange={(e) => setAdaptive(e.target.checked)} />
                    自适应降级（连续 &lt;45fps 降级 / &gt;55fps 回升）
                  </label>
                  <label style={radioRowStyle}>
                    <input type="checkbox" checked={cullEnabled} onChange={(e) => setCullEnabled(e.target.checked)} />
                    屏幕外剔除（视口粗筛 → 实例 scale 0）
                  </label>
                  <div style={hintStyle}>空闲自动暂停渲染（非活跃 tick 关闭）</div>
                </Section>

                <Section title="⚙️ 节点 / 3D / 调研状态" defaultOpen={false}>
                  <div style={btnRowStyle}>
                    <button style={btnStyle} onClick={() => handleAddNodes(10, false)}>+10 散节点</button>
                    <button style={btnStyle} onClick={() => handleAddNodes(10, true)}>+10 成组</button>
                  </div>
                  <div style={btnRowStyle}>
                    <button style={btnStyle} onClick={() => handleAddNodes(100, false)}>+100</button>
                    <button style={btnStyle} onClick={() => handleAddNodes(1000, false)}>+1000</button>
                  </div>
                  <div style={btnRowStyle}>
                    <button
                      style={{ ...btnStyle, width: '100%' }}
                      disabled={!selectedId || selectedId.startsWith('组:')}
                      onClick={handleCreateGroup}
                    >
                      建组（选中节点 → 新组）
                    </button>
                  </div>
                  <div style={btnRowStyle}>
                    <button style={{ ...btnStyle, width: '100%' }} onClick={() => fileInputRef.current?.click()}>🖼️ 上传图片（克制压缩 ≤2048）</button>
                    <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
                  </div>
                  <div style={infoStyle}>节点数：{nodeCount} · 选中：{selectedId ?? '无'}</div>

                  <button style={{ ...btnStyle, width: '100%', marginTop: 8 }} onClick={handleToggle3D}>
                    {is3D ? '✅ 退出 3D（C）' : '🎚️ 进入 3D 层级模式'}
                  </button>
                  {is3D && (
                    <div style={hintStyle}>
                      W 平移 · R 缩放 · Q 空间切换<br />
                      E 旋转已禁用（待讨论）<br />
                      拖 Z 轴 = 整组深度前后移动<br />
                      左键空白 orbit · 中键平移焦点 · 滚轮远近
                    </div>
                  )}

                  <div style={infoStyle}>
                    ✅ SDF 圆角 / 阴影 / 描边三态<br />
                    ✅ 虚线 shader / 组框还原 / PIN 贝塞尔<br />
                    ✅ 曲线高斯辉光（中心亮边缘淡）<br />
                    ✅ 显式建组 / 图片节点克制压缩<br />
                    ⏳ 文本/表格快照（待调研）
                  </div>
                </Section>
              </div>

              {/* 左下工具栏（复用现有组件） */}
              {!is3D && (
                <LeftSideToolBar
                  scale={scale}
                  onScaleChange={handleScaleChange}
                  isMiniMapOpen={miniMapOpen}
                  onToggleMiniMap={() => setMiniMapOpen((v) => !v)}
                  onClear={handleClear}
                  interactionMode={interactionMode}
                  onToggleInteractionMode={() => setInteractionMode((m) => (m === 'select' ? 'pan' : 'select'))}
                  onAddNode={() => handleAddNodes(1, false)}
                />
              )}
            </div>
          </Layout.Content>
        </div>
      </div>
    </Layout>
  );
}

// ===== 工具 =====

/** 可折叠类目（面板参数分组，点击标题展开/收起） */
function Section({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={sectionHeaderStyle} onClick={() => setOpen(!open)}>
        <span style={{ display: 'inline-block', transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none', marginRight: 4, fontSize: 9 }}>▶</span>
        <span>{title}</span>
      </div>
      {open && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

/** TextureLoader Promise 化（加载失败可捕获，不静默） */
function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, resolve, undefined, reject);
  });
}

// ===== 样式（与 editor-page 画布壳一致）=====
function layoutStyle(bg: string): CSSProperties {
  // 同 editor-page R3: AppLayout Content(flex) 内必须显式撑满,否则收缩导致内容不贴右缘
  return { position: 'relative', height: '100%', width: '100%', flex: 1, overflow: 'hidden', background: bg };
}
const headerStyle: CSSProperties = { height: 54, background: 'transparent', padding: 0, lineHeight: '54px', position: 'relative', zIndex: 100 };
const contentLayoutStyle: CSSProperties = { position: 'relative', overflow: 'hidden' };
const flexContainerStyle: CSSProperties = { display: 'flex', width: '100%', height: '100%', overflow: 'hidden' };
const mainRowStyle: CSSProperties = { display: 'flex', flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' };
const mainColStyle: CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 };
const canvasAreaStyle: CSSProperties = { flex: 1, position: 'relative', minWidth: 0, overflow: 'hidden' };
// 右侧调研面板
const panelStyle: CSSProperties = {
  position: 'absolute', right: 16, top: 16, zIndex: 50,
  width: 232, padding: '12px 14px',
  maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', scrollbarWidth: 'thin',
  background: 'rgba(22,22,26,0.92)', backdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
  color: '#d8dce6', fontSize: 12, lineHeight: 1.7,
  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
};
const panelTitleStyle: CSSProperties = { fontWeight: 700, fontSize: 13, marginBottom: 8 };
const sectionHeaderStyle: CSSProperties = { fontWeight: 600, color: '#9ab0d8', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center' };
const radioRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' };
const btnRowStyle: CSSProperties = { display: 'flex', gap: 6, marginBottom: 6 };
const btnStyle: CSSProperties = {
  flex: 1, padding: '4px 8px', fontSize: 12, cursor: 'pointer',
  background: 'rgba(88,166,255,0.15)', color: '#9ecbff',
  border: '1px solid rgba(88,166,255,0.35)', borderRadius: 6,
};
const infoStyle: CSSProperties = { color: '#8a92a6', fontSize: 11 };
const hintStyle: CSSProperties = { color: '#8a92a6', fontSize: 11, marginTop: 4 };
// 参数化 GUI（滑杆行 + 等效 CSS 输出）
const sliderRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, margin: '3px 0' };
const sliderLabelStyle: CSSProperties = { flex: '0 0 46px', color: '#9ab0d8', fontSize: 11 };
const sliderValStyle: CSSProperties = { flex: '0 0 30px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: '#00c8ff' };
const cssBoxStyle: CSSProperties = {
  marginTop: 6, padding: '6px 8px', fontSize: 10, lineHeight: 1.6, fontFamily: 'monospace',
  whiteSpace: 'pre-wrap', color: '#a5e075', background: 'rgba(0,0,0,0.35)', borderRadius: 6,
};
const subTitleStyle: CSSProperties = { marginTop: 8, marginBottom: 2, fontWeight: 600, color: '#9ab0d8', fontSize: 11 };
// 2D 胶囊菜单（磁贴工具栏，沿用原项目 NodeCapsuleToolbar：跟随选中节点下方）
const capsuleStyle = (p: { x: number; y: number }): CSSProperties => ({
  position: 'absolute', left: p.x, top: p.y + 36, zIndex: 60,
  transform: 'translateX(-50%)',
  display: 'flex', gap: 2, padding: 3,
  background: 'rgba(22,22,26,0.95)', backdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
  boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
});
const capsuleBtnStyle: CSSProperties = {
  width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 13, cursor: 'pointer', border: 'none', borderRadius: 7, background: 'transparent',
  color: '#d8dce6',
};
// 右键菜单（空白/节点上下文）
const ctxMenuStyle = (x: number, y: number): CSSProperties => ({
  position: 'fixed', left: Math.min(x, window.innerWidth - 150), top: Math.min(y, window.innerHeight - 130),
  zIndex: 200, minWidth: 140, padding: 4,
  background: 'rgba(22,22,26,0.96)', backdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
});
const ctxTitleStyle: CSSProperties = {
  padding: '4px 10px', fontSize: 11, color: '#8a92a6',
  borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 4,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140,
};
const ctxItemStyle: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px', fontSize: 12,
  cursor: 'pointer', border: 'none', borderRadius: 6, background: 'transparent', color: '#d8dce6',
};
