/**
 * UploadBlock - 对话内上传卡（Plan#36 R2-5 request_upload 协议）
 *
 * Agent 需要用户提供素材/文档时在对话内直接弹出（不让用户去画布建节点）：
 * - 拖拽/点击选文件；文本类做编码探测（UTF-8 严格 → GB18030 回落，经验 #31）
 * - 完成后自动回执（文件名/大小/内容摘要）恢复挂起的 Agent 循环
 * - 历史回看渲染为只读文件卡（不可重复上传）
 */

import { useCallback, useRef, useState } from 'react';
import { UploadCloud, CheckCircle2 } from 'lucide-react';
import type { CanvasAgentMessage } from '../types.js';
import { sendAnswer } from '../session/agent-session.js';
import { useCanvasAgentStore } from '../store.js';

/** 编码探测读取（经验 #31：严格 UTF-8 优先 + GB18030 回落，禁止裸 readAsText） */
async function readTextWithEncodingDetect(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gb18030').decode(buf);
  }
}

function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return /\.(txt|md|markdown)$/i.test(file.name);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadBlock(props: { message: CanvasAgentMessage }): React.ReactElement {
  const { message } = props;
  const upload = message.upload;
  const updateMessage = useCanvasAgentStore((s) => s.updateMessage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!upload || upload.status === 'done' || upload.status === 'uploading') return;
      updateMessage(message.id, { upload: { ...upload, status: 'uploading', fileName: file.name, fileSize: file.size } });
      try {
        let receipt: string;
        if (isTextFile(file)) {
          const text = await readTextWithEncodingDetect(file);
          const preview = text.slice(0, 200).replace(/\s+/g, ' ');
          receipt = `[用户上传文件] ${file.name}（${formatSize(file.size)}，约 ${text.length} 字）内容摘要: ${preview}`;
        } else {
          receipt = `[用户上传文件] ${file.name}（${formatSize(file.size)}，二进制文件，请按需处理）`;
        }
        updateMessage(message.id, { upload: { ...upload, status: 'done', fileName: file.name, fileSize: file.size } });
        void sendAnswer(receipt);
      } catch {
        updateMessage(message.id, { upload: { ...upload, status: 'pending' } });
      }
    },
    [message.id, upload, updateMessage],
  );

  if (!upload) return <></>;

  // 已完成（含历史回看）：只读文件卡
  if (upload.status === 'done') {
    return (
      <div
        style={{
          width: '100%',
          margin: '6px 0',
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--agent-surface)',
          border: '1px solid var(--agent-border)',
          borderRadius: 10,
        }}
      >
        <CheckCircle2 size={16} color="#4ade80" style={{ flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--agent-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {upload.fileName ?? '已上传文件'}
          </div>
          {upload.fileSize != null && (
            <div style={{ fontSize: 11, color: 'var(--agent-muted)' }}>{formatSize(upload.fileSize)} · 已提交给 Agent</div>
          )}
        </div>
      </div>
    );
  }

  const busy = upload.status === 'uploading';

  return (
    <div style={{ width: '100%', margin: '6px 0', animation: 'agentFadeUp 0.35s ease' }}>
      {upload.guideText && (
        <div style={{ fontSize: 12.5, color: 'var(--agent-text)', lineHeight: 1.6, marginBottom: 6 }}>
          {upload.guideText}
        </div>
      )}
      <div
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !busy) void handleFile(file);
        }}
        style={{
          padding: '18px 14px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          background: dragOver ? 'var(--agent-accent-soft)' : 'var(--agent-surface)',
          border: `1.5px dashed ${dragOver ? 'var(--agent-accent)' : 'var(--agent-border)'}`,
          borderRadius: 10,
          cursor: busy ? 'default' : 'pointer',
          transition: 'all 0.15s',
        }}
      >
        <UploadCloud size={20} color={dragOver ? 'var(--agent-accent)' : 'var(--agent-muted)'} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--agent-text)' }}>
          {busy ? '读取中…' : '点击或拖拽文件到此处上传'}
        </span>
        {upload.accept && (
          <span style={{ fontSize: 11, color: 'var(--agent-muted)' }}>支持：{upload.accept}</span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={upload.accept}
        multiple={upload.multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
