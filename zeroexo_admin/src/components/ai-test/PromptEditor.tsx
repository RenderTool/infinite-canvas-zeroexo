/**
 * PromptEditor - 提示词输入编辑器
 *
 * 基于 contentEditable 实现的内联提示词输入框，支持：
 *   1. 普通 Multi-line 文本输入
 *   2. @ 提及参考图，将参考图作为 badge 内联插入
 *   3. badge 删除（点击 × 或在 backspace 时移除整段）
 *   4. 历史/重试恢复时重建带 badge 的内容
 *
 * 实现要点（参考 chat-input-react）：
 *   - 通过 ref 直接操作 DOM 控制光标与选区，避免 React 重渲染导致光标闪烁
 *   - 使用 useMemo 隔离 contentEditable 的 JSX，仅在 disabled 变化时重建
 *   - mention 弹层显隐通过 ref 操作 style.display，不依赖 React state
 *
 * 对外通过 forwardRef + useImperativeHandle 暴露命令式 API：
 *   - insertReference(refId): 通过 @ 选择参考图后插入 badge
 *   - syncDOM(text, refs): 全量同步 DOM，重建带 badge 的内容（用于重置/历史/重试）
 *   - downgradeReferenceToText(ref): 将指定参考图对应的 badge 降级为纯文本
 *   - getPlainText(): 提取输入框纯文本（badge span 转换为 @name）
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Typography, Button, Space, Spin } from 'antd';
import { Copy, Sparkles } from 'lucide-react';
import type { ReferenceImage } from './types';

const { Text } = Typography;

/** 暴露给父组件的命令式 API */
export interface PromptEditorHandle {
  /** 通过 @ 选择参考图后，插入 badge 到当前光标位置（增量操作） */
  insertReference: (refId: string) => void;
  /**
   * 全量同步 contentEditable DOM 到指定状态：将 prompt 文本中的 @name 替换为 badge HTML。
   * 用于重置、历史加载、重试等需要重建完整内容的场景。
   */
  syncDOM: (
    text: string,
    refs: { id: string; url: string; name: string }[],
  ) => void;
  /** @deprecated 已重命名为 syncDOM，保留别名兼容旧调用 */
  restorePrompt: (
    text: string,
    refs: { id: string; url: string; name: string }[],
  ) => void;
  /** 将指定参考图对应的 badge 降级为纯文本 @name（增量操作，用于参考图删除），返回更新后的纯文本 */
  downgradeReferenceToText: (ref: {
    url: string;
    name: string;
  }) => string | null;
  /** 提取输入框纯文本（badge span 转换为 @name），编辑器未挂载时返回 null */
  getPlainText: () => string | null;
}

export interface PromptEditorProps {
  /** 提示词文本（受控） */
  value: string;
  /** 提示词变化回调 */
  onChange: (value: string) => void;
  /** 当前参考图列表（用于 @ 提及过滤） */
  referenceImages: ReferenceImage[];
  /** 是否禁用（生成中） */
  disabled: boolean;
  /** 参考图功能是否启用（影响 placeholder 与 mention 弹层） */
  isReferenceEnabled: boolean;
  /** 提示词最大长度（用于字数统计） */
  maxPromptLength?: number;
  /** 已清理的提示词长度（trim 并合并空白后） */
  cleanedPromptLength: number;
  /** 是否超出最大长度 */
  isPromptExceeded: boolean;
  /** 复制按钮回调 */
  onCopy: () => void;
  /** 是否正在生成 */
  generating?: boolean;
  /** 生成按钮回调 */
  onGenerate?: () => void;
  /** 是否可生成（渠道/模型已选） */
  canGenerate?: boolean;
}

/**
 * 转义 HTML 特殊字符，防止用户输入（提示词文本 / 参考图名称 / URL）注入可执行标签
 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

/**
 * 生成参考图 badge 的 HTML 字符串
 * 与原始实现保持一致：contenteditable=false、内联样式、img + @name + × 删除按钮
 * 安全：url/name 均经 escapeHtml 转义，避免存储型 XSS
 */
function buildBadgeHtml(ref: { url: string; name: string }): string {
  return (
    `<span contenteditable="false" style="display:inline-flex;align-items:center;gap:2px;padding:1px 4px 1px 2px;border-radius:4px;border:1px solid #d9d9d9;background:#e6f4ff;font-size:12px;line-height:20px;vertical-align:middle;color:#1677ff;user-select:all;">` +
    `<img src="${escapeHtml(ref.url)}" alt="" style="width:18px;height:18px;border-radius:2px;object-fit:cover;vertical-align:middle;" />` +
    `@${escapeHtml(ref.name)}` +
    `<span style="cursor:pointer;color:#999;margin-left:2px;font-size:14px;line-height:1;user-select:none;" onclick="this.parentElement.remove()">×</span>` +
    `</span> `
  );
}

/** 提示词输入编辑器 */
const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(
  function PromptEditor(
    {
      value,
      onChange,
      referenceImages,
      disabled,
      isReferenceEnabled,
      maxPromptLength,
      cleanedPromptLength,
      isPromptExceeded,
      onCopy,
      generating,
      onGenerate,
      canGenerate,
    },
    ref,
  ) {
    const promptInputRef = useRef<HTMLDivElement>(null);
    const mentionPopupRef = useRef<HTMLDivElement>(null);
    const [mentionFilter, setMentionFilter] = useState('');
    // ref 缓存，避免 contentEditable 输入时频繁 setState 导致光标闪烁
    const promptTextRef = useRef('');
    const mentionOpenRef = useRef(false);
    const mentionFilterRef = useRef('');

    // ref 追踪最新的 props/state，供 onChange 回调与命令式 API 使用（避免闭包过期）
    const referenceImagesRef = useRef(referenceImages);
    referenceImagesRef.current = referenceImages;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // 光标保持在最后
    const keepCursorEnd = useCallback((isReturn: boolean) => {
      const curEditor = promptInputRef.current;
      if (window.getSelection && curEditor) {
        curEditor.focus();
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(curEditor);
          sel.collapseToEnd();
        }
        if (isReturn) return sel;
      }
      return undefined;
    }, []);

    // 删除 @ 内容之前的原始文本
    const removeOverrageContent = useCallback(
      (editor: HTMLDivElement, atStr: string) => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        // 查找包含 @ 的文本节点并删除
        for (let i = 0; i < editor.childNodes.length; i++) {
          const curEle = editor.childNodes[i];
          if (curEle.nodeName === '#text') {
            const textNode = curEle as Text;
            const nodeValue = textNode.nodeValue || '';
            // 如果有搜索文本，删除 @xxx；否则只删除 @
            const toDelete = atStr ? `@${atStr}` : '@';
            const atIdx = nodeValue.lastIndexOf(toDelete);
            if (atIdx !== -1) {
              textNode.deleteData(atIdx, toDelete.length);
              break;
            }
          }
        }
      },
      [],
    );

    // 插入内容（参考 chat-input-react）
    const insertContent = useCallback(
      (html: string | HTMLElement, atStr?: string) => {
        let sel: Selection | null = null;
        let range: Range | null = null;
        const curEditor = promptInputRef.current;
        if (window.getSelection && curEditor) {
          sel = window.getSelection();
          if (sel && sel.rangeCount) range = sel.getRangeAt(0);
          if (!range) {
            range = keepCursorEnd(true)?.getRangeAt(0) ?? null;
          } else {
            const contentRange = document.createRange();
            contentRange.selectNode(curEditor);
            const compareStart = range?.compareBoundaryPoints(Range.START_TO_START, contentRange);
            const compareEnd = range?.compareBoundaryPoints(Range.END_TO_END, contentRange);
            const compare = compareStart !== -1 && compareEnd !== 1;
            if (!compare) range = keepCursorEnd(true)?.getRangeAt(0) ?? null;
          }
          if (!range || !sel) return;
          // 先删除 @xxx 文本（atStr 可能为空串，此时只删除 @）
          removeOverrageContent(curEditor, atStr || '');
          const input = range.createContextualFragment(
            typeof html === 'string' ? html : html.outerHTML,
          );
          const lastNode = input.lastChild;
          range.insertNode(input);
          if (lastNode) {
            range = range.cloneRange();
            range.setStartAfter(lastNode);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          // 同步 prompt state，确保 placeholder 等依赖 prompt 的 UI 正确更新
          const newText = curEditor.innerText || '';
          promptTextRef.current = newText;
          onChangeRef.current(newText);
        }
      },
      [keepCursorEnd, removeOverrageContent],
    );

    /** 通过 @ 选择参考图后，插入 badge 到当前光标位置 */
    const insertReference = useCallback(
      (refId: string) => {
        const target = referenceImagesRef.current.find((r) => r.id === refId);
        if (!target) return;
        mentionOpenRef.current = false;
        if (mentionPopupRef.current) mentionPopupRef.current.style.display = 'none';
        mentionFilterRef.current = '';
        setMentionFilter('');
        insertContent(buildBadgeHtml(target), mentionFilterRef.current);
      },
      [insertContent],
    );

    /** 全量同步 contentEditable 内容：将 prompt 文本中的 @name 替换为 badge HTML */
    const syncDOM = useCallback(
      (
        text: string,
        refs: { id: string; url: string; name: string }[],
      ) => {
        const el = promptInputRef.current;
        if (!el) return;
        if (!refs.length) {
          el.innerText = text;
          promptTextRef.current = text;
          return;
        }
        // 按 name 从长到短排序，避免短名被长名前缀匹配（如 "图1" 在 "图10" 之前匹配）
        const sorted = [...refs].sort((a, b) => b.name.length - a.name.length);
        // 先整体转义用户文本，防止 <img src=x onerror=...> 等输入注入可执行 HTML（存储型 XSS）
        let html = escapeHtml(text);
        for (const r of sorted) {
          const badge = buildBadgeHtml(r);
          // 避免重复替换（用标记替换后再回头替换已替换的）
          // 文本已转义，此处需按转义后的名称匹配
          html = html.split(`@${escapeHtml(r.name)}`).join(badge);
        }
        el.innerHTML = html;
        promptTextRef.current = text;
        // 光标移至末尾
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      },
      [],
    );

    /** 将指定参考图对应的 badge 降级为纯文本 @name，返回更新后的纯文本 */
    const downgradeReferenceToText = useCallback(
      (target: { url: string; name: string }): string | null => {
        const el = promptInputRef.current;
        if (!el) return null;
        const badges = el.querySelectorAll('span[style*="background:#e6f4ff"]');
        badges.forEach((badge) => {
          const img = badge.querySelector('img');
          if (img && (img as HTMLImageElement).src === target.url) {
            const textNode = document.createTextNode(`@${target.name} `);
            badge.parentNode?.replaceChild(textNode, badge);
          }
        });
        const newText = el.innerText || '';
        promptTextRef.current = newText;
        onChangeRef.current(newText);
        return newText;
      },
      [],
    );

    /** 提取输入框纯文本（badge span 转换为 @name） */
    const getPlainText = useCallback((): string | null => {
      const el = promptInputRef.current;
      if (!el) return null;
      // 遍历 DOM，将 badge span 转换为纯文本 @name
      let text = '';
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const span = node as HTMLSpanElement;
          if (
            span.style.background === 'rgb(230, 244, 255)' ||
            span.getAttribute('style')?.includes('background:#e6f4ff')
          ) {
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
        restorePrompt: syncDOM, // 废弃别名，保持向后兼容
        downgradeReferenceToText,
        getPlainText,
      }),
      [insertReference, syncDOM, downgradeReferenceToText, getPlainText],
    );

    // ref 缓存 contentEditable 所需最新 state，避免 re-render 时 React 触碰 editable DOM 导致选区丢失
    const ceStateRef = useRef({
      referenceImages,
      setPrompt: onChange,
      setMentionFilter,
    });
    ceStateRef.current = {
      referenceImages,
      setPrompt: onChange,
      setMentionFilter,
    };

    // useMemo 隔离 contentEditable 的 JSX，仅 disabled 变化时重建，防止父组件重渲染时触碰 DOM
    const contentEditableEl = useMemo(
      () => (
        <div
          ref={promptInputRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={(e: React.FormEvent<HTMLDivElement>) => {
            const inputE = e.nativeEvent as InputEvent;
            const sel = window.getSelection() as Selection;
            const inputEle = e.target as HTMLDivElement;
            const s = ceStateRef.current;
            // 更新 prompt 状态（仅在文本变化时）
            const text = inputEle.innerText || '';
            if (text !== promptTextRef.current) {
              promptTextRef.current = text;
              s.setPrompt(text);
            }
            if (s.referenceImages.length === 0) {
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
            if (sel && sel.rangeCount > 0) {
              range = sel.getRangeAt(0);
            }
            for (let i = 0; i < inputEle.childNodes.length; i++) {
              const curEle = inputEle.childNodes[i];
              if (curEle.nodeName === '#text' && (curEle as Text).nodeValue?.includes('@')) {
                const textNode = curEle as Text;
                const nodeValue = textNode.nodeValue;
                if (!nodeValue?.includes('@')) continue;
                const endOffset =
                  range && curEle.contains(range.commonAncestorContainer)
                    ? range.endOffset
                    : textNode.length;
                const splitArr = nodeValue.substring(0, endOffset).split('@');
                searchStr = splitArr[splitArr.length - 1];
              }
            }
            // 仅在 filter 变化时更新
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
                const filtered = s.referenceImages.filter((r) =>
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
                if (previousNode && previousNode.nodeName === 'SPAN') {
                  previousNode.remove();
                  return;
                }
              }
              const filtered = s.referenceImages.filter((r) =>
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
            fontSize: 'inherit',
            lineHeight: 'inherit',
            padding: 0,
            color: 'inherit',
            fontFamily: 'inherit',
            whiteSpace: 'inherit',
            wordBreak: 'inherit',
            minHeight: 60,
            width: '100%',
          }}
        />
      ),
      [disabled],
    );

    const filteredMentions = referenceImages.filter((r) =>
      r.name.toLowerCase().includes(mentionFilter.toLowerCase()),
    );

    return (
      <div style={{ flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4,
          }}
        >
          <Text type="secondary" style={{ fontSize: 12 }}>
            提示词
          </Text>
          <Space size={4}>
            <Button
              size="small"
              type="text"
              icon={<Copy size={12} />}
              onClick={onCopy}
              disabled={!value}
            >
              复制
            </Button>
          </Space>
        </div>
        <div style={{ position: 'relative' }}>
          {/* 提示词输入框 — contentEditable 实现内联 badge（参考 chat-input-react） */}
          <div
            style={{
              position: 'relative',
              padding: '6px 10px',
              paddingBottom: 40,
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              background: '#fff',
              cursor: 'text',
              transition: 'border-color 0.2s',
              minHeight: 72,
              maxHeight: 160,
              overflowY: 'auto',
              fontSize: 13,
              lineHeight: '20px',
              fontFamily: 'inherit',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#333',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#4096ff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#d9d9d9';
            }}
          >
            {/* contentEditable placeholder */}
            <div
              style={{
                position: 'absolute',
                top: 6,
                left: 10,
                color: '#999',
                fontSize: 13,
                lineHeight: '20px',
                fontFamily: 'inherit',
                pointerEvents: 'none',
                userSelect: 'none',
                display: value ? 'none' : 'block',
              }}
            >
              {referenceImages.length === 0
                ? '描述画面主体、风格、构图、光线和用途...'
                : '输入 @ 引用参考图...'}
            </div>
            {contentEditableEl}
            {/* 提示词字数统计 — 绘制在输入框右上角，始终显示 */}
            <div
              style={{
                position: 'absolute',
                top: 4,
                right: 8,
                fontSize: 11,
                lineHeight: '18px',
                color: isPromptExceeded ? '#ff4d4f' : '#8c8c8c',
                background: 'rgba(255,255,255,0.85)',
                padding: '0 4px',
                borderRadius: 3,
                userSelect: 'none',
                pointerEvents: 'none',
                zIndex: 2,
              }}
            >
              {cleanedPromptLength}
              {maxPromptLength != null && maxPromptLength > 0
                ? isPromptExceeded
                  ? `↑/${maxPromptLength}`
                  : `/${maxPromptLength}`
                : ''}
            </div>
            {/* 生成按钮 — 绘制在输入框右下角 */}
            {onGenerate && (
              <Button
                type="primary"
                icon={generating ? <Spin size="small" /> : <Sparkles size={14} />}
                onClick={onGenerate}
                loading={generating}
                disabled={generating || !canGenerate || !value.trim() || isPromptExceeded}
                style={{
                  position: 'absolute',
                  right: 8,
                  bottom: 8,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  lineHeight: '32px',
                  zIndex: 2,
                }}
              >
                {generating ? '生成中...' : '生成'}
              </Button>
            )}
          </div>
          {/* @ 提及弹出菜单 — 使用 ref 控制显隐，避免 re-render 导致光标闪烁 */}
          {isReferenceEnabled && (
            <div
              ref={mentionPopupRef}
              style={{
                display: 'none',
                position: 'absolute',
                bottom: '100%',
                left: 8,
                right: 8,
                background: '#fff',
                border: '1px solid #e8e8e8',
                borderRadius: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                maxHeight: 180,
                overflowY: 'auto',
                zIndex: 100,
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
                    e.currentTarget.style.background = '#f0f7ff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <img
                    src={refItem.url}
                    alt={refItem.name}
                    style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover' }}
                  />
                  <span>{refItem.name}</span>
                  {referenceImages.length > 1 && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      拖拽排序
                    </Text>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  },
);

export default PromptEditor;
