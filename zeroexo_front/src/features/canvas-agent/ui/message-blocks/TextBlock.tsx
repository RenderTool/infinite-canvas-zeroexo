/**
 * TextBlock - 文本消息
 *
 * - 用户消息：右对齐气泡（R3 FIX-1：携带 attachments 时渲染附件图标卡片，忠实还原）
 * - Agent 消息：Markdown 渲染（列表/加粗/代码等格式不再回退纯文本，R2 返工）
 * - Agent 正文含 `<question-form>` artifact 时（Plan#36 P0-2）：
 *   解析并内联渲染表单（FormBlock），前后文本照常 Markdown 展示
 */

import ReactMarkdown from 'react-markdown';
import { useState, Fragment, type CSSProperties } from 'react';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';
import type { AttachmentCard, CanvasAgentMessage } from '../types.js';
import { executeCanvasOp } from '../canvas-op-bridge.js';
import { parseAllQuestionForms } from './form-utils.js';
import { FormBlock } from './FormBlock.js';
import { mdComponents } from './MarkdownBlock.js';
import { linkifyNodeIds } from './node-ref.js';

export interface TextBlockProps {
  message: CanvasAgentMessage;
}

const agentTextStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13.5,
  lineHeight: 1.7,
  color: 'var(--agent-text)',
  wordBreak: 'break-word',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** R3：附件卡片列表（图标 + 名称 + 大小 + 截断徽标 + 可展开预览；assetId 落库后可点击跳转资产库） */
function AttachmentCards({ cards }: { cards: AttachmentCard[] }): React.ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);
  // R3-A2: 已落库附件点击整卡 → 打开资产库定位（桥接层未注入时静默）
  const handleOpenAsset = (a: AttachmentCard) => {
    if (!a.assetId) return;
    void executeCanvasOp({ op: 'open_assets', args: {} });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      {cards.map((a, i) => {
        const key = `${a.name}_${i}`;
        const open = openId === key;
        const clickable = Boolean(a.assetId);
        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div
              onClick={() => handleOpenAsset(a)}
              title={clickable ? '点击前往资产库查看' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px',
                borderRadius: 7,
                background: 'rgba(0,0,0,0.12)',
                fontSize: 11.5,
                color: 'var(--agent-text)',
                cursor: clickable ? 'pointer' : 'default',
              }}
            >
              <FileText size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {a.name}
                {a.truncated && a.totalChars ? ` · ${a.totalChars} 字 · 已折叠` : ''}
              </span>
              <span style={{ opacity: 0.65, flexShrink: 0 }}>{formatSize(a.size)}</span>
              {(a.isText || a.preview) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenId(open ? null : key);
                  }}
                  title={open ? '收起预览' : '展开预览'}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'inline-flex',
                    flexShrink: 0,
                  }}
                >
                  {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
            </div>
            {open && a.preview && (
              <div
                style={{
                  maxHeight: 120,
                  overflowY: 'auto',
                  padding: '6px 8px',
                  borderRadius: 7,
                  background: 'rgba(0,0,0,0.08)',
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: 'inherit',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {a.preview}
                {(a.truncated || (a.preview.length >= 500 && a.totalChars && a.totalChars > a.preview.length)) && '…'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TextBlock({ message }: TextBlockProps): React.ReactElement {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div
        style={{
          maxWidth: '85%',
          background: 'var(--agent-user-bubble)',
          color: 'var(--agent-text)',
          padding: '10px 14px',
          borderRadius: '14px 14px 4px 14px',
          fontSize: 13.5,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {message.text}
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentCards cards={message.attachments} />
        )}
      </div>
    );
  }

  // Plan#42 0.5：裸节点 id → @引用芯片（可点击定位），后续解析均基于预处理后文本
  const agentText = linkifyNodeIds(message.text ?? '');

  // 内联澄清表单：解析正文中的所有 <question-form> 块
  const forms = parseAllQuestionForms(agentText);
  if (forms.length > 0) {
    return (
      <div style={agentTextStyle}>
        {/* 第一个表单之前的文本 */}
        {forms[0]!.before && (
          <ReactMarkdown components={mdComponents as never}>{forms[0]!.before}</ReactMarkdown>
        )}
        {forms.map((f, i) => {
          const prevEnd = i === 0 ? 0 : forms[i - 1]!.startIndex + forms[i - 1]!.rawLength;
          const gapText = agentText.slice(prevEnd, f.startIndex);
          return (
            <Fragment key={i}>
              {gapText && (
                <ReactMarkdown components={mdComponents as never}>{gapText}</ReactMarkdown>
              )}
              <FormBlock form={f.form} answered={!!message.answered} restoredAnswer={message.restoredAnswer} />
            </Fragment>
          );
        })}
        {/* 最后一个表单之后的文本 */}
        {forms[forms.length - 1]!.after && (
          <ReactMarkdown components={mdComponents as never}>{forms[forms.length - 1]!.after}</ReactMarkdown>
        )}
      </div>
    );
  }

  return (
    <div style={agentTextStyle}>
      <ReactMarkdown components={mdComponents as never}>{agentText}</ReactMarkdown>
    </div>
  );
}
