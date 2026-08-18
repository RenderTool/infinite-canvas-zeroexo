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
  /** 背景颜色 */
  backgroundColor?: string;
  /** 边框颜色 */
  borderColor?: string;
  /** 边框悬停颜色 */
  borderHoverColor?: string;
  /** 字体大小 */
  fontSize?: number;
  /** 行高 */
  lineHeight?: number;
  /** 最小高度 */
  minHeight?: number;
}

/**
 * 生成参考素材 badge 的 HTML 字符串
 */
function buildBadgeHtml(ref: ReferenceItem): string {
  const iconMap: Record<string, string> = {
    image: '🖼️',
    video: '🎬',
    text: '📝',
    audio: '🎵',
    script: '📜',
    storyboard: '🎨',
    generator: '⚡',
  };
  const icon = iconMap[ref.type] || '📎';

  if (ref.url && (ref.type === 'image' || ref.type === 'video')) {
    // 带缩略图的 badge（图片/视频）
    return (
      `<span contenteditable="false" data-ref-id="${ref.id}" data-ref-type="${ref.type}" ` +
      `style="display:inline-flex;align-items:center;gap:2px;padding:1px 4px 1px 2px;border-radius:4px;border:1px solid #d9d9d9;background:#e6f4ff;font-size:12px;line-height:18px;vertical-align:middle;color:#1677ff;user-select:all;cursor:default;">` +
      `<img src="${ref.url}" alt="" style="width:16px;height:16px;border-radius:2px;object-fit:cover;vertical-align:middle;" />` +
      `<span style="font-size:11px;opacity:0.7;">${icon}</span>` +
      `@${ref.name}` +
      `<span class="badge-delete" style="cursor:pointer;color:#999;margin-left:2px;font-size:12px;line-height:1;user-select:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:rgba(0,0,0,0.1);transition:background 0.15s;" title="删除">×</span>` +
      `</span> `
    );
  } else {
    // 纯文本 badge（其他类型）
    return (
      `<span contenteditable="false" data-ref-id="${ref.id}" data-ref-type="${ref.type}" ` +
      `style="display:inline-flex;align-items:center;gap:2px;padding:1px 4px;border-radius:4px;border:1px solid #d9d9d9;background:#e6f4ff;font-size:12px;line-height:18px;vertical-align:middle;color:#1677ff;user-select:all;cursor:default;">` +
      `<span style="font-size:12px;">${icon}</span>` +
      `@${ref.name}` +
      `<span class="badge-delete" style="cursor:pointer;color:#999;margin-left:2px;font-size:12px;line-height:1;user-select:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:rgba(0,0,0,0.1);transition:background 0.15s;" title="删除">×</span>` +
      `</span> `
    );
  }
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
      backgroundColor = 'transparent',
      borderColor = '#d9d9d9',
      fontSize = 12,
      lineHeight: lh = 1.6,
      minHeight = 60,
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
        mentionOpenRef.current = false;
        if (mentionPopupRef.current) mentionPopupRef.current.style.display = 'none';
        mentionFilterRef.current = '';
        setMentionFilter('');
        insertContent(buildBadgeHtml(target), mentionFilterRef.current);
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
            // badge span，提取内部文本（排除删除按钮）
            const children = Array.from(span.childNodes);
            for (const child of children) {
              if (child.nodeType === Node.TEXT_NODE) {
                text += child.textContent;
              }
            }
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

    const filteredMentions = useMemo(() => {
      if (maxLength && value.length >= maxLength) return [];
      return references.filter((r) =>
        r.name.toLowerCase().includes(mentionFilter.toLowerCase()),
      );
    }, [references, mentionFilter, value.length, maxLength]);

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

        {/* @ 提及弹出菜单 */}
        {!readOnly && references.length > 0 && (
          <div
            ref={mentionPopupRef}
            style={{
              display: 'none',
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              background: backgroundColor || '#fff',
              border: `1px solid ${borderColor || '#e0e0e0'}`,
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              maxHeight: 180,
              overflowY: 'auto',
              zIndex: 1000,
              marginBottom: 4,
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
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: 13,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = accentColor ? `${accentColor}15` : '#f0f7ff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {refItem.url && (refItem.type === 'image' || refItem.type === 'video') ? (
                  <img
                    src={refItem.url}
                    alt={refItem.name}
                    style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }}
                  />
                ) : (
                  <span style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: borderColor || '#f0f0f0', borderRadius: 4, fontSize: 12 }}>
                    {refItem.type === 'image' ? '🖼️' :
                     refItem.type === 'video' ? '🎬' :
                     refItem.type === 'text' ? '📝' :
                     refItem.type === 'audio' ? '🎵' : '📎'}
                  </span>
                )}
                <span style={{ color: textColor || '#333' }}>{refItem.name}</span>
                <span style={{ color: textColor ? `${textColor}99` : '#999', fontSize: 11 }}>
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
