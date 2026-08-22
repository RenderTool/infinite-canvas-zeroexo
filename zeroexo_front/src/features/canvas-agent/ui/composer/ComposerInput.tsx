/**
 * ComposerInput - 输入区
 *
 * 参考 tvc-agent (2).html 设计，100% 复刻样式：
 * - 多行 textarea（自动增高，Enter 发送，Shift+Enter 换行）
 * - @ 提及触发 MentionPopover
 * - 附加选区徽标（ReferenceChip）
 * - 默认策略 confirm_each，不显示策略选择器
 */

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { useCanvasAgentStore } from '../store.js';
import { sendMessage } from '../session/agent-session.js';
import { ReferenceChip } from './ReferenceChip.js';
import { MentionPopover } from './MentionPopover.js';

export function ComposerInput(): React.ReactElement {
  const inputText = useCanvasAgentStore((s) => s.inputText);
  const setInputText = useCanvasAgentStore((s) => s.setInputText);
  const references = useCanvasAgentStore((s) => s.references);
  const isGenerating = useCanvasAgentStore((s) => s.isGenerating);
  const addMessage = useCanvasAgentStore((s) => s.addMessage);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionPos, setMentionPos] = useState({ top: 0, left: 0 });

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || isGenerating) return;

    setInputText('');

    // 添加用户消息
    addMessage({
      id: `msg_user_${Date.now()}`,
      role: 'user',
      type: 'text',
      text,
      timestamp: Date.now(),
    });

    // 真连后端：提交 Agent 任务 + 订阅 SSE 事件流
    void sendMessage(text);
  }, [inputText, isGenerating, setInputText, addMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const el = e.target;
      setInputText(el.value);
      // 自动增高
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';

      // 检测 @ 触发提及
      const cursorPos = el.selectionStart;
      const textBefore = el.value.slice(0, cursorPos);
      const atMatch = textBefore.match(/@(\w*)$/);
      if (atMatch) {
        setMentionSearch(atMatch[1] ?? '');
        setMentionPos({
          top: -80,
          left: Math.min(atMatch[0].length * 8, 200),
        });
        setMentionOpen(true);
      } else {
        setMentionOpen(false);
      }
    },
    [setInputText],
  );

  return (
    <div className="composer-bar">
      <div className="composer-shell">
        {/* 引用徽标 */}
        {references.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <ReferenceChip references={references} />
          </div>
        )}

        <div style={{ position: 'relative' }}>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Message VideoForge Agent…  (Enter to send)"
            rows={1}
            className="composer-input"
          />

          {/* @ 提及弹窗 */}
          {mentionOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: mentionPos.left,
                marginBottom: 4,
              }}
            >
              <MentionPopover
                search={mentionSearch}
                position={mentionPos}
                onSelect={() => {
                  setMentionOpen(false);
                  textareaRef.current?.focus();
                }}
                onClose={() => setMentionOpen(false)}
              />
            </div>
          )}
        </div>

        <div className="composer-row">
          <div className="composer-spacer" />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim() || isGenerating}
            className="composer-send"
            title="Send"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}