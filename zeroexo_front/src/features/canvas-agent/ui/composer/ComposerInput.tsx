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
import { getSimulator } from '../simulation/simulator.js';
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

    // 尝试匹配模拟器流程
    const sim = getSimulator();
    if (sim.run(text)) {
      // 模拟器已处理
      return;
    }
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
    <div
      style={{
        display: 'flex',
        alignItems: 'end',
        gap: 8,
        padding: '10px 14px',
        borderTop: '1px solid #111a2e',
        background: 'rgba(10,12,20,0.9)',
        backdropFilter: 'blur(8px)',
        flexShrink: 0,
      }}
    >
      {/* 引用徽标 */}
      {references.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap',
            marginBottom: 4,
            width: '100%',
          }}
        >
          <ReferenceChip references={references} />
        </div>
      )}

      <div style={{ position: 'relative', flex: 1 }}>
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Message VideoForge Agent…  (Enter to send)"
          rows={1}
          className="agent-composer-textarea"
          style={{
            width: '100%',
            background: '#0d1220',
            border: '1.5px solid #1e293b',
            borderRadius: 11,
            padding: '10px 13px',
            color: '#f1f5f9',
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
            resize: 'none',
            minHeight: 42,
            maxHeight: 120,
            lineHeight: 1.5,
            boxSizing: 'border-box',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = '#6366f1';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = '#1e293b';
          }}
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

      <button
        type="button"
        onClick={handleSend}
        disabled={!inputText.trim() || isGenerating}
        className="agent-composer-send"
        style={{
          width: 42,
          height: 42,
          borderRadius: 11,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          border: 'none',
          cursor: inputText.trim() && !isGenerating ? 'pointer' : 'not-allowed',
          background: 'linear-gradient(135deg, #6366f1, #a855f7)',
          opacity: inputText.trim() && !isGenerating ? 1 : 0.4,
          transition: 'opacity 0.15s',
          flexShrink: 0,
          padding: 0,
        }}
        title="Send"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>
        </svg>
      </button>
    </div>
  );
}