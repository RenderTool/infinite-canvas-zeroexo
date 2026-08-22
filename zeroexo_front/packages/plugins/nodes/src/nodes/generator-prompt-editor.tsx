/**
 * GeneratorPromptEditor - 生成器提示词编辑器
 *
 * 基于 contentEditable 实现的内联提示词输入框，支持：
 *   1. 普通多行文本输入
 *   2. @ 提及参考素材（图片/视频/文本/音频），将素材作为 badge 内联插入
 *   3. badge 删除（点击 × 或在 backspace 时移除整段）
 *   4. 支持视频缩略图
 *
 * 实现参考: PromptEditor.tsx
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

/** 参考素材类型 */
export interface ReferenceItem {
  id: string;
  type: 'image' | 'video' | 'text' | 'audio' | 'script' | 'storyboard' | 'generator';
  name: string;
  url?: string; // 缩略图URL（图片/视频）
  title?: string;
  /** 原始资产信息(生成时作为 API 资产源输入;缩略图 url 与原始内容分离) */
  asset?: { content?: string; storageKey?: string };
}

/** 暴露给父组件的命令式 API */
export interface GeneratorPromptEditorHandle {
  /** 通过 @ 选择素材后，插入 badge 到当前光标位置 */
  insertReference: (refId: string) => void;
  /** 全量同步 DOM：将文本中的 @name 替换为 badge HTML */
  syncDOM: (text: string, refs: { id: string; name: string; url?: string; type: string }[]) => void;
  /** 将指定素材对应的 badge 降级为纯文本 */
  downgradeReferenceToText: (ref: { id: string; name: string }) => string | null;
  /** 提取输入框纯文本（badge span 转换为 @name） */
  getPlainText: () => string | null;
}

export interface GeneratorPromptEditorProps {
  /** 提示词文本（受控） */
  value: string;
  /** 提示词变化回调 */
  onChange: (value: string) => void;
  /** 当前参考素材列表（用于 @ 提及过滤） */
  references: ReferenceItem[];
  /** 是否只读（非编辑态） */
  readOnly: boolean;
  /** placeholder 文本 */
  placeholder?: string;
  /** 最大长度 */
  maxLength?: number;
  /** 字数变化回调 */
  onLengthChange?: (length: number) => void;
  /** 主题色 */
  accentColor?: string;
  /** 文本颜色 */
  textColor?: string;
  /** 字体大小 */
  fontSize?: number;
  /** 行高 */
  lineHeight?: number;
  /** 最小高度 */
  minHeight?: number;
  /** @ 弹窗类型过滤(先按类型过滤,再做名称匹配;参考区展示不受影响) */
  mentionTypeFilter?: (ref: ReferenceItem) => boolean;
  /** @ 弹窗背景色/边框色(不传时按 textColor 亮度自动推断;明暗主题下应由宿主传入主题色) */
  popupBackground?: string;
  popupBorderColor?: string;
}

/**
 * 参考素材类型 → 类型文本色(与正文明显区分,加粗显示)
 * 颜色用于 badge 内 "@名称" 文本,而非图标(图标保持主题文字色)
 */
export const REF_TYPE_COLOR: Record<string, string> = {
  image: '#8b5cf6',
  video: '#f59e0b',
  audio: '#10b981',
  text: '#3b82f6',
  script: '#ec4899',
  storyboard: '#06b6d4',
  generator: '#f97316',
};

/**
 * 参考素材类型 → lucide 图标内联 SVG(24 视口,描边风格,随 currentColor)
 * 不用 emoji(项目规范禁止);有缩略图时优先缩略图,无缩略图时用此图标
 */
export const REF_TYPE_ICON_PATH: Record<string, string> = {
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  video: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  text: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  script: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  storyboard: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  generator: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
};

/** 生成 lucide 风格内联 SVG 图标 HTML */
function refTypeIconSvg(type: string, size: number): string {
  const path = REF_TYPE_ICON_PATH[type] ?? REF_TYPE_ICON_PATH.text!;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
    `style="flex-shrink:0;display:inline-block;vertical-align:middle;opacity:0.75;">${path}</svg>`
  );
}

/**
 * 生成参考素材 badge 的 HTML 字符串
 *
 * 视觉契约(用户反馈):
 * - 无底色/无边框,透明自然融入正文
 * - 有缩略图(图片/视频)用缩略图,无缩略图用 lucide 图标 —— 二者只取其一,不出现双图标
 * - "@名称" 文本按类型着色 + 加粗,与正文明显区分
 */
function buildBadgeHtml(ref: ReferenceItem): string {
  const hasThumb = !!ref.url && (ref.type === 'image' || ref.type === 'video');
  const typeColor = REF_TYPE_COLOR[ref.type] ?? '#3b82f6';
  const iconHtml = hasThumb
    ? `<img src="${ref.url}" alt="" style="width:15px;height:15px;border-radius:3px;object-fit:cover;vertical-align:middle;flex-shrink:0;" />`
    : refTypeIconSvg(ref.type, 13);
  return (
    `<span contenteditable="false" data-ref-id="${ref.id}" data-ref-type="${ref.type}" ` +
    `style="display:inline-flex;align-items:center;gap:3px;margin:0 2px 0 1px;padding:0 2px;border-radius:4px;font-size:12px;line-height:18px;vertical-align:middle;color:inherit;user-select:all;cursor:default;background:transparent;">` +
    iconHtml +
    `<span style="font-weight:700;color:${typeColor};white-space:nowrap;">@${ref.name}</span>` +
    `<span class="badge-delete" style="cursor:pointer;color:#999;margin-left:1px;user-select:none;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;transition:background 0.15s;background:transparent;" title="删除"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span>` +
    `</span>`
  );
}

/** 生成器提示词编辑器 */
const GeneratorPromptEditor = forwardRef<GeneratorPromptEditorHandle, GeneratorPromptEditorProps>(
  function GeneratorPromptEditor(
    {
      value,
      onChange,
      references,
      readOnly,
      placeholder,
      maxLength,
      onLengthChange,
      accentColor = '#1677ff',
      textColor = '#333',
      fontSize = 12,
      lineHeight: lh = 1.6,
      minHeight = 60,
      mentionTypeFilter,
      popupBackground,
      popupBorderColor,
    },
    ref,
  ) {
    const promptInputRef = useRef<HTMLDivElement>(null);
    const mentionPopupRef = useRef<HTMLDivElement>(null);
    const [mentionFilter, setMentionFilter] = useState('');

    // ref 缓存
    const promptTextRef = useRef('');
    const mentionOpenRef = useRef(false);
    const mentionFilterRef = useRef('');

    // ref 追踪最新的 props
    const referencesRef = useRef(references);
    referencesRef.current = references;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // 光标保持在最后
    const keepCursorEnd = useCallback((): Selection | undefined => {
      const curEditor = promptInputRef.current;
      if (window.getSelection && curEditor) {
        curEditor.focus();
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(curEditor);
          sel.collapseToEnd();
        }
        if (sel && sel.rangeCount > 0) return sel;
      }
      return undefined;
    }, []);

    // 删除 @ 内容之前的原始文本
    const removeMentionText = useCallback(
      (editor: HTMLDivElement, atStr: string) => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        for (let i = 0; i < editor.childNodes.length; i++) {
          const curEle = editor.childNodes[i];
          if (!curEle || curEle.nodeName !== '#text') continue;
          const textNode = curEle as Text;
          const nodeValue = textNode.nodeValue || '';
          const toDelete = atStr ? `@${atStr}` : '@';
          const atIdx = nodeValue.lastIndexOf(toDelete);
          if (atIdx !== -1) {
            textNode.deleteData(atIdx, toDelete.length);
            break;
          }
        }
      },
      [],
    );

    // 插入内容
    const insertContent = useCallback(
      (html: string, atStr?: string) => {
        let sel: Selection | null = null;
        let range: Range | null = null;
        const curEditor = promptInputRef.current;
        if (window.getSelection && curEditor) {
          sel = window.getSelection();
          if (sel && sel.rangeCount) range = sel.getRangeAt(0);
          if (!range) {
            range = keepCursorEnd()?.getRangeAt(0) ?? null;
          } else {
            const contentRange = document.createRange();
            contentRange.selectNode(curEditor);
            const compareStart = range?.compareBoundaryPoints(Range.START_TO_START, contentRange);
            const compareEnd = range?.compareBoundaryPoints(Range.END_TO_END, contentRange);
            const compare = compareStart !== -1 && compareEnd !== 1;
            if (!compare) range = keepCursorEnd()?.getRangeAt(0) ?? null;
          }
          if (!range || !sel) return;
          removeMentionText(curEditor, atStr || '');
          const input = range.createContextualFragment(html);
          const lastNode = input.lastChild;
          range.insertNode(input);
          if (lastNode) {
            range = range.cloneRange();
            range.setStartAfter(lastNode);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          const newText = curEditor.innerText || '';
          promptTextRef.current = newText;
          onChangeRef.current(newText);
          onLengthChange?.(newText.length);
        }
      },
      [keepCursorEnd, removeMentionText, onLengthChange],
    );

    /** 通过 @ 选择素材后，插入 badge */
    const insertReference = useCallback(
      (refId: string) => {
        const target = referencesRef.current.find((r) => r.id === refId);
        if (!target) return;
        // 先保存当前搜索词再清空:removeMentionText 需要整段删除 "@搜索词",
        // 若清空后传入,只会删 "@" 导致搜索词残留进正文(复现:选完 @ 失焦重开面板出现乱字/空行)
        const searchStr = mentionFilterRef.current;
        mentionOpenRef.current = false;
        if (mentionPopupRef.current) mentionPopupRef.current.style.display = 'none';
        mentionFilterRef.current = '';
        setMentionFilter('');
        insertContent(buildBadgeHtml(target), searchStr);
      },
      [insertContent],
    );

    /** 全量同步 contentEditable 内容 */
    const syncDOM = useCallback(
      (
        text: string,
        refs: { id: string; name: string; url?: string; type: string }[],
      ) => {
        const el = promptInputRef.current;
        if (!el) return;
        if (!refs.length) {
          el.innerText = text;
          promptTextRef.current = text;
          onLengthChange?.(text.length);
          return;
        }
        const sorted = [...refs].sort((a, b) => b.name.length - a.name.length);
        let html = text;
        for (const r of sorted) {
          const refItem = referencesRef.current.find((rr) => rr.id === r.id);
          const badgeData = refItem || { ...r, type: 'text' as const };
          const badge = buildBadgeHtml(badgeData);
          html = html.split(`@${r.name}`).join(badge);
        }
        el.innerHTML = html;
        promptTextRef.current = text;
        onLengthChange?.(text.length);
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      },
      [onLengthChange],
    );

    /** 将指定素材对应的 badge 降级为纯文本 */
    const downgradeReferenceToText = useCallback(
      (target: { id: string; name: string }): string | null => {
        const el = promptInputRef.current;
        if (!el) return null;
        const badges = el.querySelectorAll(`span[data-ref-id="${target.id}"]`);
        badges.forEach((badge) => {
          const textNode = document.createTextNode(`@${target.name} `);
          badge.parentNode?.replaceChild(textNode, badge);
        });
        const newText = el.innerText || '';
        promptTextRef.current = newText;
        onChangeRef.current(newText);
        onLengthChange?.(newText.length);
        return newText;
      },
      [onLengthChange],
    );

    /** 提取输入框纯文本 */
    const getPlainText = useCallback((): string | null => {
      const el = promptInputRef.current;
      if (!el) return null;
      let text = '';
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const span = node as HTMLSpanElement;
          const refId = span.getAttribute('data-ref-id');
          if (refId) {
            // badge span,递归收集文本(排除删除按钮 SVG/伪元素,保留 "@名称")
            const walkBadge = (n: Node) => {
              if (n.nodeType === Node.TEXT_NODE) {
                text += n.textContent;
              } else if (n.nodeType === Node.ELEMENT_NODE) {
                const el = n as HTMLElement;
                if (el.classList && el.classList.contains('badge-delete')) return;
                n.childNodes.forEach(walkBadge);
              }
            };
            span.childNodes.forEach(walkBadge);
          } else {
            node.childNodes.forEach(walk);
          }
        }
      };
      el.childNodes.forEach(walk);
      return text.trim();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        insertReference,
        syncDOM,
        downgradeReferenceToText,
        getPlainText,
      }),
      [insertReference, syncDOM, downgradeReferenceToText, getPlainText],
    );

    // 初始化内容
    useEffect(() => {
      if (promptTextRef.current !== value && !readOnly) {
        const el = promptInputRef.current;
        if (el) {
          el.innerText = value;
          promptTextRef.current = value;
        }
      }
    }, [value, readOnly]);

    // 挂载 / references 就绪后恢复 badge:重开面板时 value 仅以纯文本形态写入,
    // 需将文本中匹配到的 @name 重建为 badge,避免"下次点开回退成普通文本"。
    // 仅重建尚未以 badge(span[data-ref-id]) 存在的引用,编辑中 references 变化不干扰既有 badge。
    useEffect(() => {
      const el = promptInputRef.current;
      if (!el || readOnly) return;
      if (!references.length) return;
      const plain = el.innerText || '';
      if (!plain.includes('@')) return;
      const missing = references.filter(
        (r) =>
          plain.includes(`@${r.name}`) &&
          !el.querySelector(`span[data-ref-id="${r.id}"]`),
      );
      if (!missing.length) return;
      syncDOM(
        plain,
        missing.map((r) => ({ id: r.id, name: r.name, url: r.url, type: r.type })),
      );
    }, [references, readOnly, syncDOM]);

    // ref 缓存
    const ceStateRef = useRef({
      references,
      setPrompt: onChange,
      setMentionFilter,
    });
    ceStateRef.current = {
      references,
      setPrompt: onChange,
      setMentionFilter,
    };

    const handleBadgeClick = useCallback((e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const deleteBtn = target.closest('.badge-delete');
      if (deleteBtn) {
        const badge = deleteBtn.closest('[data-ref-id]');
        if (badge) {
          badge.remove();
          const el = promptInputRef.current;
          if (el) {
            const newText = el.innerText || '';
            promptTextRef.current = newText;
            onChangeRef.current(newText);
            onLengthChange?.(newText.length);
          }
        }
      }
    }, [onLengthChange]);

    // contentEditable JSX
    const contentEditableEl = useMemo(
      () => (
        <div
          ref={promptInputRef}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          onClick={handleBadgeClick}
          onInput={(e: React.FormEvent<HTMLDivElement>) => {
            if (readOnly) return;
            const inputE = e.nativeEvent as InputEvent;
            const inputEle = e.target as HTMLDivElement;
            const s = ceStateRef.current;
            const text = inputEle.innerText || '';
            if (text !== promptTextRef.current) {
              promptTextRef.current = text;
              s.setPrompt(text);
              onLengthChange?.(text.length);
            }
            if (s.references.length === 0) {
              if (mentionOpenRef.current) {
                mentionOpenRef.current = false;
                if (mentionPopupRef.current) mentionPopupRef.current.style.display = 'none';
              }
              return;
            }
            if (inputE.data !== null && !inputE.data.trim()) {
              if (mentionOpenRef.current) {
                mentionOpenRef.current = false;
                if (mentionPopupRef.current) mentionPopupRef.current.style.display = 'none';
              }
              return;
            }
            let searchStr = '';
            let range: Range | null = null;
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              range = sel.getRangeAt(0);
            }
            for (let i = 0; i < inputEle.childNodes.length; i++) {
              const curEle = inputEle.childNodes[i];
              if (!curEle || curEle.nodeName !== '#text' || !(curEle as Text).nodeValue?.includes('@')) continue;
              const textNode = curEle as Text;
              const nodeValue = textNode.nodeValue;
              if (!nodeValue?.includes('@')) continue;
              const endOffset =
                range && curEle.contains(range.commonAncestorContainer)
                  ? range.endOffset
                  : textNode.length;
              const splitArr = nodeValue.substring(0, endOffset).split('@');
              searchStr = splitArr[splitArr.length - 1] ?? '';
            }
            if (searchStr !== mentionFilterRef.current) {
              mentionFilterRef.current = searchStr;
              s.setMentionFilter(searchStr);
            }
            if (inputE.inputType === 'insertText' || inputE.inputType === 'insertCompositionText') {
              if (inputE.data === '@') {
                if (!mentionOpenRef.current) {
                  mentionOpenRef.current = true;
                  if (mentionPopupRef.current) mentionPopupRef.current.style.display = '';
                }
              } else {
                const filtered = s.references.filter((r) =>
                  r.name.toLowerCase().includes(searchStr.toLowerCase()),
                );
                const shouldOpen = !!searchStr && filtered.length > 0;
                if (shouldOpen !== mentionOpenRef.current) {
                  mentionOpenRef.current = shouldOpen;
                  if (mentionPopupRef.current)
                    mentionPopupRef.current.style.display = shouldOpen ? '' : 'none';
                }
              }
            } else if (inputE.inputType === 'deleteContentBackward') {
              if (range) {
                const previousNode = range.startContainer.childNodes[range.startOffset - 1];
                if (previousNode && previousNode.nodeType === Node.ELEMENT_NODE) {
                  const prevEl = previousNode as HTMLElement;
                  if (prevEl.hasAttribute('data-ref-id')) {
                    prevEl.remove();
                    const newText = inputEle.innerText || '';
                    promptTextRef.current = newText;
                    s.setPrompt(newText);
                    onLengthChange?.(newText.length);
                    return;
                  }
                }
              }
              const filtered = s.references.filter((r) =>
                r.name.toLowerCase().includes(searchStr.toLowerCase()),
              );
              const shouldOpen = !!searchStr && filtered.length > 0;
              if (shouldOpen !== mentionOpenRef.current) {
                mentionOpenRef.current = shouldOpen;
                if (mentionPopupRef.current)
                  mentionPopupRef.current.style.display = shouldOpen ? '' : 'none';
              }
            }
          }}
          onPaste={(e: React.ClipboardEvent<HTMLDivElement>) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            if (text) {
              document.execCommand('insertText', false, text);
            }
          }}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: fontSize,
            lineHeight: lh,
            padding: 0,
            color: textColor,
            fontFamily: 'inherit',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            minHeight: minHeight,
            width: '100%',
            cursor: readOnly ? 'default' : 'text',
          }}
        />
      ),
      [readOnly, fontSize, lh, textColor, minHeight, handleBadgeClick],
    );

    // 主题亮度判定(textColor 深 → 浅色主题 → 弹窗实心白;反之深色实心)
    // 宿主传入 popupBackground/popupBorderColor 时优先使用(暗色主题下 textColor 是亮色,
    // 亮度推断会误判为浅色主题导致白色弹窗,必须由宿主传真实主题色)
    const isLightTheme = useMemo(() => {
      const m = String(textColor).match(/^#?([0-9a-f]{6})$/i);
      if (!m) return true;
      const n = parseInt(m[1]!, 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return (r * 299 + g * 587 + b * 114) / 1000 > 140;
    }, [textColor]);
    const mentionBg = popupBackground ?? (isLightTheme ? '#ffffff' : '#26262b');
    const mentionBorder = popupBorderColor ?? (isLightTheme ? '#e2e2e7' : 'rgba(255,255,255,0.14)');

    const filteredMentions = useMemo(() => {
      if (maxLength && value.length >= maxLength) return [];
      return references.filter((r) =>
        (!mentionTypeFilter || mentionTypeFilter(r)) &&
        r.name.toLowerCase().includes(mentionFilter.toLowerCase()),
      );
    }, [references, mentionTypeFilter, mentionFilter, value.length, maxLength]);

    return (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
        }}
      >
        {/* contentEditable placeholder */}
        {!readOnly && !value && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              color: '#999',
              fontSize: fontSize,
              lineHeight: lh,
              fontFamily: 'inherit',
              pointerEvents: 'none',
              userSelect: 'none',
              display: 'block',
            }}
          >
            {placeholder || '输入提示词... (输入 @ 引用素材)'}
          </div>
        )}
        {contentEditableEl}

        {/* @ 提及弹出菜单 — 实心背景 + 缩略图/lucide 二选一 + 类型彩色加粗名称 */}
        {!readOnly && references.length > 0 && (
          <div
            ref={mentionPopupRef}
            style={{
              display: 'none',
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              background: mentionBg,
              border: `1px solid ${mentionBorder}`,
              borderRadius: 8,
              boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
              maxHeight: 200,
              overflowY: 'auto',
              zIndex: 1000,
              marginBottom: 6,
              color: textColor,
            }}
          >
            {filteredMentions.map((refItem) => (
              <div
                key={refItem.id}
                onClick={() => insertReference(refItem.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  cursor: 'pointer',
                  fontSize: 13,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = accentColor ? `${accentColor}18` : 'rgba(0,0,0,0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {refItem.url && (refItem.type === 'image' || refItem.type === 'video') ? (
                  <img
                    src={refItem.url}
                    alt={refItem.name}
                    style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : (
                  <span style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'inherit' }}>
                    <svg
                      viewBox="0 0 24 24"
                      width={14}
                      height={14}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ opacity: 0.8 }}
                      dangerouslySetInnerHTML={{ __html: REF_TYPE_ICON_PATH[refItem.type] ?? REF_TYPE_ICON_PATH.text! }}
                    />
                  </span>
                )}
                <span style={{ fontWeight: 700, color: REF_TYPE_COLOR[refItem.type] ?? '#3b82f6' }}>
                  {refItem.name}
                </span>
                <span style={{ color: textColor ? `${textColor}99` : '#999', fontSize: 11, marginLeft: 'auto', flexShrink: 0 }}>
                  {refItem.type === 'image' ? '图片' :
                   refItem.type === 'video' ? '视频' :
                   refItem.type === 'text' ? '文本' :
                   refItem.type === 'audio' ? '音频' :
                   refItem.type === 'script' ? '剧本' :
                   refItem.type === 'storyboard' ? '分镜' : '素材'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
);

export default GeneratorPromptEditor;
