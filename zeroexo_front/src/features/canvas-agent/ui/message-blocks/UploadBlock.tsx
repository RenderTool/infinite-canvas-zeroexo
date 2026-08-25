/**
 * UploadBlock - 对话内上传卡（Plan#36 R2-5 request_upload 协议，Plan#43 样式重做）
 *
 * Agent 需要用户提供素材/文档时在对话内直接弹出（不让用户去画布建节点）：
 * - 拖拽/点击选文件；文本类做编码探测（UTF-8 严格 → GB18030 回落，经验 #31）
 * - 完成后自动回执（文件名/大小/内容摘要）恢复挂起的 Agent 循环
 * - 历史回看渲染为只读文件卡（不可重复上传）
 *
 * Plan#43 样式重做：图标圆座 + 主副标题 + 浏览按钮感 + 拖拽高亮动效，
 * 对齐 Agent 面板投影风格（无边框卡片 + var(--agent-shadow)）。
 */

import { useCallback, useRef, useState } from 'react';
import { UploadCloud, CheckCircle2, FileText } from 'lucide-react';
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

  // ===== 已完成（含历史回看）：只读文件卡 =====
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
          boxShadow: 'var(--agent-shadow)',
          borderRadius: 10,
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'var(--agent-accent-soft)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <FileText size={14} color="var(--agent-accent)" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--agent-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {upload.fileName ?? '已上传文件'}
          </div>
          {upload.fileSize != null && (
            <div style={{ fontSize: 11, color: 'var(--agent-muted)' }}>{formatSize(upload.fileSize)}</div>
          )}
        </div>
        <CheckCircle2 size={15} color="#4ade80" style={{ flexShrink: 0 }} />
      </div>
    );
  }

  const busy = upload.status === 'uploading';

  // ===== 待上传：引导文案 + 上传区（图标圆座 + 主副标题 + 拖拽高亮） =====
  return (
    <div style={{ width: '100%', margin: '6px 0', animation: 'agentFadeUp 0.35s ease' }}>
      {upload.guideText && (
        <div style={{ fontSize: 12.5, color: 'var(--agent-text)', lineHeight: 1.6, marginBottom: 8 }}>
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
          padding: '20px 16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          background: dragOver ? 'var(--agent-accent-soft)' : 'var(--agent-surface)',
          boxShadow: dragOver
            ? 'var(--agent-shadow), inset 0 0 0 1.5px var(--agent-accent)'
            : 'var(--agent-shadow), inset 0 0 0 1px var(--agent-border)',
          borderRadius: 12,
          cursor: busy ? 'default' : 'pointer',
          transition: 'background 0.18s ease, box-shadow 0.18s ease',
        }}
      >
        {/* 图标圆座（拖拽/悬停时主题色高亮） */}
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: dragOver ? 'var(--agent-accent)' : 'var(--agent-surface-2)',
            transition: 'background 0.18s ease',
            flexShrink: 0,
          }}
        >
          <UploadCloud
            size={19}
            color={dragOver ? '#ffffff' : 'var(--agent-accent)'}
            className={busy ? 'agent-upload-float' : undefined}
          />
        </span>

        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--agent-text)' }}>
          {busy ? '正在读取文件…' : dragOver ? '松开即可上传' : '上传文件'}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--agent-muted)', textAlign: 'center', lineHeight: 1.5 }}>
          {busy
            ? '读完后会自动发送给 Agent'
            : upload.accept
              ? `拖拽到此处，或点击浏览（支持 ${upload.accept}）`
              : '拖拽到此处，或点击浏览文件'}
        </span>

        {/* 浏览按钮（视觉锚点，整卡皆可点击） */}
        {!busy && (
          <span
            style={{
              marginTop: 2,
              padding: '4px 14px',
              borderRadius: 999,
              border: '1px solid var(--agent-accent)',
              color: 'var(--agent-accent)',
              fontSize: 11.5,
              fontWeight: 600,
              userSelect: 'none',
            }}
          >
            浏览文件
          </span>
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
