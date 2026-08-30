/**
 * ScriptStructuredEditor - 剧本结构化行编辑器（替换 Quill）
 *
 * 每一行是一个带类型的块：
 *  - 行首类型徽章（图标+文字，点击弹出类型下拉切换）
 *  - 场景块内含 INT./EXT. 下拉（自动带前缀）
 *  - 内容区为单行 input（Enter 新建同类型块，Backspace 空块删除）
 *
 * 触发菜单：在空块行首输入 `/` 或 `@` → 弹出选类型菜单（参照 Admin @-引用）。
 * 场景自动编号：可选开关，开启后按出现顺序渲染 1. 2. 3.…（派生显示，不写数据）。
 *
 * 数据以 HTML 序列化（value/onChange），兼容 ScriptReader / 分页 / Yjs 同步。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import i18next from 'i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import {
  MapPin, Activity, UserRound, MessageSquare, Quote, ArrowRightToLine,
  SeparatorHorizontal, X, Plus,
} from 'lucide-react';
import { SimpleSelect } from '@/shared/components/index.js';
import {
  SCRIPT_LINE_TYPE_ORDER, SCRIPT_LINE_DEFS, createScriptLine,
  serializeScriptLines, parseScriptHtml,
  type ScriptLine, type ScriptLineType, type SceneLocation,
} from './script-lines.js';

export interface ScriptStructuredEditorProps {
  value: string;
  onChange: (html: string) => void;
  accent: string;
  border: string;
  text: string;
  textMuted: string;
  isDark: boolean;
  /** 场景自动编号（拍摄稿风格） */
  sceneNumbers?: boolean;
  /** 是否显示类型标签(由胶囊工具栏的隐藏标签按钮控制) */
  showLabels?: boolean;
  /** 下拉菜单 z-index(全屏模式需要更高层级) */
  menuZIndex?: number;
  /** 可滚动模式:新段落按钮固定在底部不参与滚动 */
  scrollable?: boolean;
}

/** 类型图标映射 */
const TYPE_ICONS: Record<ScriptLineType, React.ReactElement> = {
  'scene-heading': <MapPin size={13} />,
  action: <Activity size={13} />,
  character: <UserRound size={13} />,
  dialogue: <MessageSquare size={13} />,
  parenthetical: <Quote size={13} />,
  transition: <ArrowRightToLine size={13} />,
  'page-break': <SeparatorHorizontal size={13} />,
};

export function ScriptStructuredEditor({
  value,
  onChange,
  accent,
  border,
  text,
  textMuted,
  isDark,
  sceneNumbers = false,
  showLabels = true,
  menuZIndex = 10000,
  scrollable = false,
}: ScriptStructuredEditorProps): React.ReactElement {
  const { theme } = useTheme();
  const [lines, setLines] = useState<ScriptLine[]>(() => parseScriptHtml(value));
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const inputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const savedScrollTopRef = useRef<number | null>(null);
  // 序列化签名，用于判断 value 是否来自外部（切换剧集/远端同步）
  const lastSigRef = useRef(serializeScriptLines(lines));
  // 本地编辑计数器：每次 onChange 回写 +1，value effect 消费 -1
  // 用计数器而非 boolean，避免快速输入时 flag 卡死
  const localEditCountRef = useRef(0);
  // 待刷新的序列化值(避免在 setLines 回调中调用 onChange 导致 setState during render)
  const pendingSigRef = useRef<string | null>(null);
  // 空态自动创建段落标记
  const didAutoCreateRef = useRef(false);
  // 稳定化 onChange 引用：避免父组件每次 episodes 更新导致 onChange 引用变化，
  // 从而触发 useEffect 依赖 onChange 的 effect 重新执行（覆盖用户最新输入）
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 内容变化 → 序列化回写（统一入口）
  const commit = useCallback((next: ScriptLine[]) => {
    setLines(next);
    const serialized = serializeScriptLines(next);
    lastSigRef.current = serialized;
    localEditCountRef.current += 1;
    onChangeRef.current(serialized);
  }, []);

  // 空态自动创建段落（去掉空行提示文案，默认空白时自动创建一个段落）
  // 必须在 commit 定义之后，避免 TDZ 错误
  useEffect(() => {
    if (lines.length === 0 && !didAutoCreateRef.current) {
      didAutoCreateRef.current = true;
      const nl = createScriptLine('action');
      commit([nl]);
    }
  }, [lines, commit]);

  const patchLine = useCallback((id: string, mutate: (l: ScriptLine) => ScriptLine) => {
    setLines((prev) => {
      const next = prev.map((l) => (l.id === id ? mutate(l) : l));
      const serialized = serializeScriptLines(next);
      lastSigRef.current = serialized;
      pendingSigRef.current = serialized;
      return next;
    });
  }, []);

  // 在渲染阶段外用 useEffect 刷新 pendingSigRef 中的序列化值到父组件
  useEffect(() => {
    if (pendingSigRef.current !== null) {
      const sig = pendingSigRef.current;
      pendingSigRef.current = null;
      localEditCountRef.current += 1;
      console.log('[ScriptStructuredEditor] calling onChange, sig length:', sig.length, 'localEditCount:', localEditCountRef.current);
      onChangeRef.current(sig);
    }
  }, [lines]);

  // 外部 value 变化（切剧集/远端同步）→ 仅在非本地编辑时重新解析
  // 本地编辑时：localEditCountRef > 0 跳过本次解析，消耗一次计数
  // 真正外部变化（远端同步/切换剧集）value 变化但 localEditCountRef 保持 0，正常解析
  useEffect(() => {
    if (localEditCountRef.current > 0) {
      localEditCountRef.current -= 1;
      return;
    }
    // 保存当前滚动位置
    if (scrollRef.current) {
      savedScrollTopRef.current = scrollRef.current.scrollTop;
    }
    const parsed = parseScriptHtml(value);
    const sig = serializeScriptLines(parsed);
    if (sig !== lastSigRef.current) {
      setLines(parsed);
      lastSigRef.current = sig;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // 外部 value 变化后恢复滚动位置
  useLayoutEffect(() => {
    if (savedScrollTopRef.current !== null && scrollRef.current) {
      scrollRef.current.scrollTop = savedScrollTopRef.current;
      savedScrollTopRef.current = null;
    }
  });

  // lines 变化时自动调整所有 textarea 高度（初始加载、切剧集、外部同步）
  useEffect(() => {
    requestAnimationFrame(() => {
      for (const line of lines) {
        const el = inputRefs.current[line.id];
        if (el) {
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }
      }
    });
  }, [lines]);

  const focusLine = useCallback((id: string) => {
    setFocusedId(id);
    requestAnimationFrame(() => {
      const el = inputRefs.current[id];
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  }, []);

  // 键盘：Enter 新建同类型块；Backspace 空块删除；/ 或 @ 空块触发类型菜单
  const handleLineKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>, line: ScriptLine) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const idx = lines.findIndex((l) => l.id === line.id);
      const nextType: ScriptLineType = line.type === 'scene-heading' ? 'action' : line.type;
      const newLine = createScriptLine(nextType);
      const next = [...lines];
      next.splice(idx + 1, 0, newLine);
      commit(next);
      requestAnimationFrame(() => {
        const el = inputRefs.current[newLine.id];
        if (el) el.focus();
      });
      return;
    }
    if (e.key === 'Backspace' && line.text === '' && lines.length > 1) {
      e.preventDefault();
      const idx = lines.findIndex((l) => l.id === line.id);
      const prevLine = lines[idx - 1];
      const next = lines.filter((l) => l.id !== line.id);
      commit(next);
      if (prevLine) {
        requestAnimationFrame(() => {
          const el = inputRefs.current[prevLine.id];
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        });
      }
      return;
    }
    if ((e.key === '/' || e.key === '@') && line.text === '') {
      e.preventDefault();
      setOpenMenuFor(line.id);
    }
  }, [lines, commit]);

  const applyTypeToLine = useCallback((id: string, type: ScriptLineType) => {
    setOpenMenuFor(null);
    patchLine(id, (l) => {
      const base = createScriptLine(type, l.text);
      return type === 'scene-heading'
        ? { ...base, location: l.location ?? 'interior' }
        : base;
    });
    requestAnimationFrame(() => {
      const el = inputRefs.current[id];
      if (el) el.focus();
    });
  }, [patchLine]);

  const insertTypeAtLine = useCallback((id: string, type: ScriptLineType) => {
    setOpenMenuFor(null);
    patchLine(id, () => createScriptLine(type));
    requestAnimationFrame(() => {
      const el = inputRefs.current[id];
      if (el) el.focus();
    });
  }, [patchLine]);

  const changeLocation = useCallback((id: string, loc: SceneLocation) => {
    patchLine(id, (l) => ({ ...l, location: loc }));
  }, [patchLine]);

  const deleteLine = useCallback((id: string) => {
    commit(lines.filter((l) => l.id !== id));
  }, [lines, commit]);

  // 在指定行下方插入同类型段落（正文段落间插入）
  const insertBelow = useCallback((id: string) => {
    const idx = lines.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const src = lines[idx]!;
    const nextType: ScriptLineType = src.type === 'scene-heading' ? 'action' : src.type;
    const nl = createScriptLine(nextType);
    const next = [...lines];
    next.splice(idx + 1, 0, nl);
    commit(next);
    focusLine(nl.id);
  }, [lines, commit, focusLine]);

  // 场景编号：按出现顺序派生
  const sceneNumbersMap = useMemo(() => {
    const map: Record<string, number> = {};
    let n = 0;
    for (const l of lines) {
      if (l.type === 'scene-heading') { n += 1; map[l.id] = n; }
    }
    return map;
  }, [lines]);

  const menuLine = openMenuFor ? lines.find((l) => l.id === openMenuFor) : undefined;
  const isTriggerMenu = menuLine !== undefined && menuLine.text === '';

  return (
    <div ref={scrollRef} style={{
      ...paperStyle(border, theme),
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* 内容区域（可滚动） */}
      <div style={{ flex: 1, overflowY: scrollable ? 'auto' : 'visible', minHeight: 0 }}>
        {lines.map((line) => {
          const isScene = line.type === 'scene-heading';
          const sceneNo = sceneNumbers ? sceneNumbersMap[line.id] : undefined;

          // 分页：渲染为分隔行（无输入框）
          if (line.type === 'page-break') {
            return (
              <div key={line.id} style={pageBreakRowStyle}>
                {showLabels ? (
                  <SimpleSelect
                    value={line.type}
                    minWidth={72}
                    height={24}
                    stopPropagation
                    fixed
                    zIndex={menuZIndex}
                    open={openMenuFor === line.id || undefined}
                    onOpenChange={(o) => setOpenMenuFor(o ? line.id : null)}
                    triggerFontFamily="'Courier New', Courier, monospace"
                    triggerFontWeight={700}
                    triggerColor={text}
                    triggerBorder={`${text}22`}
                    triggerBackground={isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'}
                    options={SCRIPT_LINE_TYPE_ORDER.map((t) => ({
                      value: t,
                      label: SCRIPT_LINE_DEFS[t].label,
                      icon: <span style={{ color: accent, display: 'inline-flex' }}>{TYPE_ICONS[t]}</span>,
                    }))}
                    onChange={(t) => applyTypeToLine(line.id, t)}
                  />
                ) : null}
                <div style={pageBreakLineStyle(border)} />
                <button
                  type="button"
                  title={i18next.t('scriptEditor.deletePageBreak')}
                  onClick={() => deleteLine(line.id)}
                  style={pageBreakDelStyle(textMuted)}
                >
                  <X size={12} />
                </button>
              </div>
            );
          }

          return (
            <div
              key={line.id}
              style={lineRowStyle}
              onMouseEnter={() => setHoveredId(line.id)}
              onMouseLeave={() => setHoveredId((h) => (h === line.id ? null : h))}
            >
              {/* 类型下拉(与 EXT 下拉同款样式;可隐藏) */}
              {showLabels ? (
              <SimpleSelect
                value={line.type}
                minWidth={72}
                height={24}
                stopPropagation
                fixed
                zIndex={menuZIndex}
                open={openMenuFor === line.id || undefined}
                onOpenChange={(o) => setOpenMenuFor(o ? line.id : null)}
                triggerFontFamily="'Courier New', Courier, monospace"
                triggerFontWeight={700}
                triggerColor={isScene ? accent : text}
                triggerBorder={isScene ? `${accent}44` : `${text}22`}
                triggerBackground={isScene ? (isDark ? '#3a352e' : '#fff') : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)')}
                options={SCRIPT_LINE_TYPE_ORDER.map((t) => ({
                  value: t,
                  label: SCRIPT_LINE_DEFS[t].label,
                  icon: <span style={{ color: accent, display: 'inline-flex' }}>{TYPE_ICONS[t]}</span>,
                }))}
                onChange={(t) => {
                  if (isTriggerMenu) insertTypeAtLine(line.id, t);
                  else applyTypeToLine(line.id, t);
                }}
              />
              ) : null}

              {/* 场景 INT/EXT 下拉 + 场景编号 */}
              {isScene ? (
                <>
                  {sceneNumbers && sceneNo !== undefined ? (
                    <span style={sceneNoBtnStyle(accent, isDark, !showLabels)}>{sceneNo}</span>
                  ) : null}
                  <SimpleSelect
                    value={line.location ?? 'interior'}
                    minWidth={56}
                    height={24}
                    stopPropagation
                    fixed
                    zIndex={menuZIndex}
                    triggerFontFamily="'Courier New', Courier, monospace"
                    triggerFontWeight={700}
                    triggerColor={accent}
                    triggerBorder={showLabels ? `${accent}44` : 'transparent'}
                    triggerBackground={showLabels ? (isDark ? '#3a352e' : '#fff') : 'transparent'}
                    options={[
                      { value: 'interior' as SceneLocation, label: i18next.t('scriptEditor.prefixInterior') },
                      { value: 'exterior' as SceneLocation, label: i18next.t('scriptEditor.prefixExterior') },
                    ]}
                    onChange={(v) => changeLocation(line.id, v)}
                  />
                </>
              ) : null}

              {/* 内容区（textarea 自动换行 + 自动高度） */}
              <textarea
                ref={(el) => {
                  inputRefs.current[line.id] = el;
                  if (el) {
                    el.style.height = 'auto';
                    el.style.height = `${el.scrollHeight}px`;
                  }
                }}
                value={line.text}
                onChange={(e) => patchLine(line.id, () => ({ ...line, text: e.target.value }))}
                onFocus={() => setFocusedId(line.id)}
                onBlur={() => { setFocusedId(null); setOpenMenuFor(null); }}
                onKeyDown={(e) => handleLineKeyDown(e, line)}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${el.scrollHeight}px`;
                }}
                placeholder={placeholderFor(line.type)}
                rows={1}
                style={inputStyle(text, isDark, line.type, focusedId === line.id, accent)}
              />
              {/* 行内操作：下方插入 / 删除（hover 或聚焦时显示） */}
              <div style={rowActionsStyle(hoveredId === line.id || focusedId === line.id)}>
                <button
                  type="button"
                  title={i18next.t('scriptEditor.insertBelow')}
                  onClick={() => insertBelow(line.id)}
                  style={rowActionBtnStyle(textMuted)}
                >
                  <Plus size={12} />
                </button>
                <button
                  type="button"
                  title={i18next.t('scriptEditor.deleteParagraph')}
                  disabled={lines.length <= 1}
                  onClick={() => deleteLine(line.id)}
                  style={rowActionBtnStyle(textMuted)}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          );
        })}

        {/* 字数统计 */}
        <div style={{
          display: 'flex', justifyContent: 'flex-start', alignItems: 'center',
          padding: '6px 4px 0', fontSize: 11, color: textMuted, userSelect: 'none',
        }}>
          {lines.reduce((sum, l) => sum + l.text.length, 0)} 字
        </div>
      </div>

      {/* 底部固定按钮（不参与滚动） */}
      <div style={{ flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => {
            const nl = createScriptLine('action');
            commit([...lines, nl]);
            focusLine(nl.id);
          }}
          style={addLineBtnStyle(border, text)}
        >
          + 新段落
        </button>
      </div>
    </div>
  );
}

// ===== 辅助 =====

function placeholderFor(type: ScriptLineType, t = i18next.t): string {
  switch (type) {
    case 'scene-heading': return t('scriptEditor.placeholderScene');
    case 'action': return t('scriptEditor.placeholderAction');
    case 'character': return t('scriptEditor.placeholderCharacter');
    case 'dialogue': return t('scriptEditor.placeholderDialogue');
    case 'parenthetical': return t('scriptEditor.placeholderParenthetical');
    case 'transition': return t('scriptEditor.placeholderTransition');
    default: return '';
  }
}

// ===== 样式 =====

const paperStyle = (_border: string, theme: ReturnType<typeof useTheme>['theme']): CSSProperties => ({
  flex: 1, overflowY: 'visible', padding: '24px 24px 40px',
  position: 'relative',
  borderRadius: 0,
  background: theme.toolbar.editorPaper,
  transition: 'background 0.3s ease',
});

const lineRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, marginLeft: -4,
};

/** 行内操作区：默认隐藏，hover/聚焦行时淡入 */
const rowActionsStyle = (visible: boolean): CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0,
  opacity: visible ? 1 : 0,
  transition: 'opacity 0.15s',
});

/** 行内操作按钮（插入/删除） */
const rowActionBtnStyle = (muted: string): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 20, border: 'none', borderRadius: 0,
  background: 'transparent', color: muted, cursor: 'pointer',
  flexShrink: 0, padding: 0,
  transition: 'background 0.12s, color 0.12s',
});

// ── 分页分隔行 ──
const pageBreakRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0',
};
const pageBreakLineStyle = (border: string): CSSProperties => ({
  flex: 1, height: 1, borderTop: `1px dashed ${border}`,
});
const pageBreakDelStyle = (muted: string): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 20, border: 'none', borderRadius: 0, background: 'transparent',
  color: muted, cursor: 'pointer', flexShrink: 0,
  transition: 'background 0.12s, color 0.12s',
});

const sceneNoBtnStyle = (accent: string, isDark: boolean, transparent = false): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  height: 24, minWidth: 24, padding: '0 6px', borderRadius: 0,
  border: 'none', cursor: 'default', flexShrink: 0,
  background: transparent ? 'transparent' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
  color: accent, fontSize: 12, fontWeight: 700,
  fontFamily: 'Courier New, Courier, monospace',
});

const inputStyle = (
  text: string, isDark: boolean, type: ScriptLineType, focused: boolean, accent: string,
): CSSProperties => {
  const base: CSSProperties = {
    flex: 1, minWidth: 0, minHeight: 28,
    border: focused ? `1px solid ${accent}66` : '1px solid transparent',
    borderRadius: 0, background: 'transparent', outline: 'none',
    color: text, fontSize: 13, fontFamily: 'Courier New, Courier, monospace',
    padding: '4px 6px', boxSizing: 'border-box',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    resize: 'none', overflow: 'hidden', lineHeight: 1.5,
  };
  if (type === 'character') { base.textAlign = 'center'; base.fontWeight = 700; base.color = isDark ? '#e07a5f' : '#b3392e'; }
  if (type === 'transition') { base.textAlign = 'right'; base.fontWeight = 600; }
  if (type === 'parenthetical') { base.fontStyle = 'italic'; }
  if (type === 'dialogue') { base.paddingLeft = 24; }
  if (type === 'scene-heading') { base.fontWeight = 700; }
  return base;
};

const addLineBtnStyle = (border: string, text: string): CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%',
  marginTop: 8, marginBottom: 0, height: 32,
  // 与右侧 antd Button 统一为 border-box，避免 1px border 导致实际高度变成 34
  boxSizing: 'border-box',
  border: `1px dashed ${border}`, borderRadius: 6,
  background: 'transparent', color: text, fontSize: 12, cursor: 'pointer',
  transition: 'background 0.12s',
});