/**
 * ComposerInput - 输入区（Plan#36 R2 返工）
 *
 * - 多行 textarea（自动增高，Enter 发送，Shift+Enter 换行，字数上限防超上下文）
 * - @ 提及：MentionPopover 选中后插入 @标签 + 生成可移除的引用徽标
 * - 附件：列表化管理（上传按钮在操作行，附件条目在输入框上方）——
 *   文本不再灌入输入框；超长文件先给「可点击选项」确认（非弹窗），
 *   确认后折叠为附件条目（可预览/可移除），发送时以截断预览+分段提示拼入
 * - 渠道选择与附件按钮同排（渠道为提示词面板同款下拉）
 * - 生成中发送键切换为停止键
 */

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { App as AntdApp } from 'antd';
import { Paperclip, FileText, X, Eye } from 'lucide-react';
import { AiModelPicker } from '@/features/top-bar/components/ai-model-picker.js';
import { useCanvasAgentStore } from '../store.js';
import { sendMessage, stopGenerating } from '../session/agent-session.js';
import { resolveNodeThumb } from '../node-thumb.js';
import { ReferenceChip } from './ReferenceChip.js';
import { MentionPopover } from './MentionPopover.js';
import type { AttachmentCard, Reference } from '../types.js';
import { apiPost } from '@/services/api-client.js';
import { addAssets, updateAsset } from '@/features/asset-picker/asset-store.js';

/** 输入框字数上限（防超出上下文） */
const INPUT_MAX_CHARS = 8000;
/** 文本附件超过该字数 → 先弹「是否继续解析」确认（消耗大量 token 预警） */
const LARGE_TEXT_THRESHOLD = 20000;
/** 附件随消息发送时的预览截断长度（完整内容由后端分段工具处理） */
const ATTACH_PREVIEW_CHARS = 6000;
/** 附件卡片内联预览片段上限（落库防膨胀，卡片展开可见） */
const ATTACH_CARD_PREVIEW_CHARS = 500;

/** 附件条目（列表化，不再灌入输入框） */
interface AttachmentEntry {
  id: string;
  name: string;
  size: number;
  isText: boolean;
  /** 文本内容（截断存储，超长仅存预览 + 标记） */
  content?: string;
  totalChars?: number;
  truncated?: boolean;
}

/** 节点类型 → 引用 kind 映射 */
function mentionKind(type: string): Reference['kind'] {
  if (type === 'image') return 'image';
  if (type === 'video') return 'video';
  if (type === 'audio') return 'audio';
  return 'text';
}

/** 附件文本编码探测读取（经验 #31：严格 UTF-8 优先 + GB18030 回落） */
async function readAttachmentText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gb18030').decode(buf);
  }
}

function isTextAttachment(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return /\.(txt|md|markdown|json|csv)$/i.test(file.name);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ComposerInput(): React.ReactElement {
  const { message } = AntdApp.useApp();
  const inputText = useCanvasAgentStore((s) => s.inputText);
  const setInputText = useCanvasAgentStore((s) => s.setInputText);
  const references = useCanvasAgentStore((s) => s.references);
  const addReference = useCanvasAgentStore((s) => s.addReference);
  const removeReference = useCanvasAgentStore((s) => s.removeReference);
  const updateReference = useCanvasAgentStore((s) => s.updateReference);
  const clearReferences = useCanvasAgentStore((s) => s.clearReferences);
  const isGenerating = useCanvasAgentStore((s) => s.isGenerating);
  const addMessage = useCanvasAgentStore((s) => s.addMessage);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionPos, setMentionPos] = useState({ top: 0, left: 0 });
  // R2：附件列表（上传按钮下方/输入框上方，列表形式，可预览可移除）
  const [attachments, setAttachments] = useState<AttachmentEntry[]>([]);
  // R2：超长文本待确认项（可点击选项确认，非弹窗）
  const [pendingLarge, setPendingLarge] = useState<{ name: string; size: number; text: string } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  /** R3-A1：附件全文落库到资产库（text 资产存后端 text 字段，供 AI read_asset_content 按需读取）
   * 返回每个附件的云端 assetId（落库失败返回 undefined，降级为纯预览发送不阻断） */
  const persistAttachments = useCallback(async (list: AttachmentEntry[]): Promise<Array<{ entry: AttachmentEntry; assetId?: string }>> => {
    return Promise.all(list.map(async (a): Promise<{ entry: AttachmentEntry; assetId?: string }> => {
      if (!a.isText || !a.content) return { entry: a };
      let assetId: string | undefined;
      try {
        // 1. 云端直接创建（内容存 Asset.text，AI 立即可读）
        const cloud = await apiPost<{ id: string }>('/resources', {
          kind: 'text',
          filename: a.name,
          mimeType: 'text/plain',
          text: a.content,
        });
        assetId = cloud?.id;
        // 2. 本地资产库记录 + 回写 cloudId（防同步链路重复推送）
        const [localAsset] = await addAssets([{
          title: a.name,
          kind: 'text',
          bytes: a.content.length,
          mimeType: 'text/plain',
          data: { kind: 'text', content: a.content },
        }]);
        if (localAsset && assetId) {
          await updateAsset(localAsset.id, { cloudId: assetId });
        }
      } catch (err) {
        console.warn('[ComposerInput] 附件落库失败，以降级预览发送:', err);
      }
      return { entry: a, assetId };
    }));
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if ((!text && attachments.length === 0) || isGenerating) return;

    setInputText('');

    // R3-A1：先落库（全文），再构造消息与提示词
    const saved = await persistAttachments(attachments);
    const savedCount = saved.filter((s) => s.assetId).length;
    if (savedCount > 0) {
      message.success('素材已保存到我的资源，可前往「资产库」查看');
    }

    // R3 FIX-1：附件以卡片形式进气泡（不再是纯文本占位）；卡片预览截断防膨胀
    const cards: AttachmentCard[] = saved.map(({ entry: a, assetId }) => ({
      name: a.name,
      size: a.size,
      isText: a.isText,
      truncated: a.truncated,
      totalChars: a.totalChars,
      assetId,
      preview: a.content ? a.content.slice(0, ATTACH_CARD_PREVIEW_CHARS) : undefined,
    }));
    addMessage({
      id: `msg_user_${Date.now()}`,
      role: 'user',
      type: 'text',
      text: text || (cards.length > 0 ? '' : '[发送了附件]'),
      attachments: cards.length > 0 ? cards : undefined,
      timestamp: Date.now(),
    });

    // R2：@ 引用清单 + 附件清单拼入提示词（附件为截断预览 + 分段处理指引，不灌全文）
    // R3 FIX-2：头部追加 [附件清单:JSON] 结构化标记——LLM 可读、历史加载可还原附件卡
    // R3-A1：清单带 assetId，AI 可按档调 read_asset_content 分段读取
    let prompt = text;
    if (attachments.length > 0) {
      const manifest = {
        files: cards.map((c) => ({
          name: c.name,
          size: c.size,
          isText: c.isText,
          truncated: c.truncated,
          totalChars: c.totalChars,
          assetId: c.assetId,
        })),
      };
      prompt = `[附件清单:${JSON.stringify(manifest)}]\n${prompt}`;
    }
    if (references.length > 0) {
      prompt += `\n[用户 @ 引用的画布节点] ${references
        .map((r) => `${r.label}(id=${r.nodeId})`)
        .join('、')}`;
      clearReferences();
    }
    if (attachments.length > 0) {
      const parts = saved.map(({ entry: a, assetId }) => {
        if (a.isText && a.content) {
          const truncatedNote = a.truncated
            ? `\n（原文共 ${a.totalChars} 字，此处仅预览前 ${ATTACH_PREVIEW_CHARS} 字——完整内容必须走 read_asset_content 分段读取，assetId=${assetId ?? '同步中'}，禁止要求用户重新粘贴）`
            : '';
          return `[附件 ${a.name}（${formatSize(a.size)}）内容预览]\n${a.content.slice(0, ATTACH_PREVIEW_CHARS)}${truncatedNote}`;
        }
        return `[附件 ${a.name}（${formatSize(a.size)}，非文本文件，按需处理）]`;
      });
      prompt += `\n${parts.join('\n')}`;
      setAttachments([]);
    }

    void sendMessage(prompt);
  }, [inputText, attachments, isGenerating, references, setInputText, addMessage, clearReferences, persistAttachments, message]);

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
      // R2：字数上限防超上下文
      const next = el.value.length > INPUT_MAX_CHARS ? el.value.slice(0, INPUT_MAX_CHARS) : el.value;
      setInputText(next);
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';

      const cursorPos = el.selectionStart;
      const textBefore = next.slice(0, cursorPos);
      const atMatch = textBefore.match(/@([\w\u4e00-\u9fa5]*)$/);
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

  /** @ 选中：插入 @标签 + 引用徽标（可移除；媒体节点异步回填缩略图） */
  const handleMentionSelect = useCallback(
    (node: { id: string; title: string; type: string; storageKey?: string }) => {
      const label = node.title || node.id;
      const el = textareaRef.current;
      if (el) {
        const cursor = el.selectionStart ?? el.value.length;
        const before = el.value.slice(0, cursor).replace(/@[\w\u4e00-\u9fa5]*$/, `@${label} `);
        const after = el.value.slice(cursor);
        const next = before + after;
        setInputText(next);
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(before.length, before.length);
        });
      }
      addReference({ nodeId: node.id, label, kind: mentionKind(node.type) });
      // 媒体节点（图片/视频/音频）异步解析缩略图回填徽标；失败保持类型图标
      if (node.storageKey) {
        void resolveNodeThumb(node.storageKey, node.type).then((thumb) => {
          if (thumb) updateReference(node.id, { thumb });
        });
      }
      setMentionOpen(false);
    },
    [setInputText, addReference, updateReference],
  );

  /** R2：附件入列——文本不再灌输入框；超长先给确认选项 */
  const handleAttachFile = useCallback(async (file: File) => {
    const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    if (isTextAttachment(file)) {
      const text = await readAttachmentText(file);
      if (text.length > LARGE_TEXT_THRESHOLD) {
        // 超长 → 先确认（可点击选项，非弹窗），避免盲目消耗大量 token
        setPendingLarge({ name: file.name, size: file.size, text });
        return;
      }
      setAttachments((prev) => [
        ...prev,
        { id, name: file.name, size: file.size, isText: true, content: text, totalChars: text.length, truncated: false },
      ]);
      return;
    }
    setAttachments((prev) => [...prev, { id, name: file.name, size: file.size, isText: false }]);
  }, []);

  const confirmPendingLarge = useCallback(() => {
    if (!pendingLarge) return;
    setAttachments((prev) => [
      ...prev,
      {
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: pendingLarge.name,
        size: pendingLarge.size,
        isText: true,
        // R3-A1：全文留内存（落库用），发送时再截断预览；旧实现只存预览导致全文丢失
        content: pendingLarge.text,
        totalChars: pendingLarge.text.length,
        truncated: true,
      },
    ]);
    setPendingLarge(null);
  }, [pendingLarge]);

  const overLimit = inputText.length >= INPUT_MAX_CHARS;

  return (
    <div className="composer-bar">
      <div className="composer-shell">
        {/* R2：超长文本确认（可点击选项，非弹窗） */}
        {pendingLarge && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: 'var(--agent-surface-2)',
              fontSize: 12,
              color: 'var(--agent-text)',
              lineHeight: 1.6,
            }}
          >
            <div style={{ marginBottom: 6 }}>
              「{pendingLarge.name}」约 {pendingLarge.text.length} 字，完整解析将消耗大量 token。是否继续？
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={confirmPendingLarge}
                style={{
                  padding: '4px 12px',
                  border: 'none',
                  borderRadius: 6,
                  background: 'var(--agent-accent)',
                  color: '#fff',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                继续解析
              </button>
              <button
                type="button"
                onClick={() => setPendingLarge(null)}
                style={{
                  padding: '4px 12px',
                  border: 'none',
                  borderRadius: 6,
                  background: 'var(--agent-surface)',
                  color: 'var(--agent-muted)',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* @ 引用徽标（可移除） */}
        {references.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <ReferenceChip references={references} onRemove={removeReference} />
          </div>
        )}

        {/* R2：附件列表（列表形式，可预览/可移除） */}
        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {attachments.map((a) => (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 8px',
                  borderRadius: 7,
                  background: 'var(--agent-surface)',
                  fontSize: 11.5,
                  color: 'var(--agent-text)',
                }}
              >
                <FileText size={12} color="var(--agent-muted)" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.name}
                  {a.truncated && ` · ${a.totalChars} 字 · 已折叠为预览`}
                </span>
                <span style={{ color: 'var(--agent-muted)', flexShrink: 0 }}>{formatSize(a.size)}</span>
                {a.isText && (
                  <button
                    type="button"
                    onClick={() => setPreviewId(previewId === a.id ? null : a.id)}
                    title="预览"
                    style={{ border: 'none', background: 'transparent', color: 'var(--agent-muted)', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
                  >
                    <Eye size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  title="移除附件"
                  style={{ border: 'none', background: 'transparent', color: 'var(--agent-muted)', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {previewId && (() => {
              const a = attachments.find((x) => x.id === previewId);
              if (!a?.content) return null;
              return (
                <div
                  className="zx-thin-scroll"
                  style={{
                    maxHeight: 120,
                    overflowY: 'auto',
                    padding: '6px 8px',
                    borderRadius: 7,
                    background: 'var(--agent-surface-2)',
                    fontSize: 11,
                    lineHeight: 1.6,
                    color: 'var(--agent-muted)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {a.content.slice(0, 2000)}
                  {(a.content.length > 2000 || a.truncated) && '…'}
                </div>
              );
            })()}
          </div>
        )}

        <div style={{ position: 'relative' }}>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Message VideoForge Agent…（@ 可引用画布节点，Enter 发送）"
            rows={1}
            className="composer-input"
          />

          {/* @ 提及弹窗（向上弹出） */}
          {mentionOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 6,
              }}
            >
              <MentionPopover
                search={mentionSearch}
                position={mentionPos}
                onSelect={handleMentionSelect}
                onClose={() => setMentionOpen(false)}
              />
            </div>
          )}
        </div>

        <div className="composer-row">
          {/* 附件按钮 */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="composer-attach"
            title="添加附件"
          >
            <Paperclip size={14} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleAttachFile(f);
              e.target.value = '';
            }}
          />
          {/* 渠道选择（提示词面板同款下拉） */}
          <AiModelPicker />
          <div className="composer-spacer" />
          {/* R2：字数计数（防超上下文） */}
          <span
            style={{
              fontSize: 10.5,
              color: overLimit ? 'var(--agent-danger)' : 'var(--agent-muted)',
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
            }}
          >
            {inputText.length}/{INPUT_MAX_CHARS}
          </span>
          {/* 生成中停止 / 空闲发送 */}
          {isGenerating ? (
            <button
              type="button"
              onClick={() => stopGenerating()}
              className="composer-send composer-stop"
              title="停止生成"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!inputText.trim() && attachments.length === 0}
              className="composer-send"
              title="发送"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
