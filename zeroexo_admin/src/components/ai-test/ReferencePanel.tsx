/**
 * ReferencePanel - 参考图面板
 *
 * 功能：
 *   1. 多图上传（点击 + 按钮，受 maxRefCount 限制）
 *   2. 拖拽排序（HTML5 drag & drop）
 *   3. 删除单张参考图
 *   4. 点击 @ 将参考图作为 badge 插入提示词输入框
 *
 * 注意：本组件仅负责 UI 与本地交互（file input、dragIndex），
 *      状态变更通过回调上抛给主组件（含 blob URL 回收、prompt 同步等副作用）。
 */
import { useRef } from 'react';
import { Typography, Tag, message } from 'antd';
import { Trash2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReferenceImage } from './types';

const { Text } = Typography;

/** 参考图上传大小限制：10MB */
const MAX_REF_IMAGE_SIZE = 10 * 1024 * 1024;
/** 格式化文件大小为可读字符串 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface ReferencePanelProps {
  /** 当前参考图列表 */
  referenceImages: ReferenceImage[];
  /** 参考图最大数量 */
  maxRefCount: number;
  /** 新增参考图（已转换好的 ReferenceImage[]） */
  onAdd: (images: ReferenceImage[]) => void;
  /** 删除指定 id 的参考图 */
  onRemove: (id: string) => void;
  /** 拖拽排序：从 from 移动到 to */
  onReorder: (from: number, to: number) => void;
  /** 将指定参考图作为 badge 插入提示词输入框 */
  onInsertToPrompt: (id: string) => void;
}

/** 参考图面板 */
export default function ReferencePanel({
  referenceImages,
  maxRefCount,
  onAdd,
  onRemove,
  onReorder,
  onInsertToPrompt,
}: ReferencePanelProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 拖拽起点索引（HTML5 drag 无 payload 时使用 ref 暂存）
  const dragIndexRef = useRef<number | null>(null);

  /** 处理文件上传：受 maxRefCount 限制 + 文件大小 10MB 限制 */
  const handleFileUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    // 文件大小校验（10MB 限制）
    const oversizedFiles: string[] = [];
    const validFiles: File[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_REF_IMAGE_SIZE) {
        oversizedFiles.push(`${file.name}(${formatFileSize(file.size)})`);
      } else {
        validFiles.push(file);
      }
    }
    if (oversizedFiles.length > 0) {
      message.warning(
        `${oversizedFiles.slice(0, 3).join('、')}${oversizedFiles.length > 3 ? ` 等${oversizedFiles.length}个文件` : ''} 超过 10MB 限制，已自动跳过`,
      );
    }
    if (validFiles.length === 0) return;

    const remaining = maxRefCount - referenceImages.length;
    if (remaining <= 0) {
      message.warning(t('ai.maxRefImages', { count: maxRefCount }));
      return;
    }
    if (validFiles.length > remaining) {
      message.warning(t('ai.maxRefImagesTruncated', { count: maxRefCount, remaining }));
    }
    const toAdd = validFiles.slice(0, remaining);
    const startIdx = referenceImages.length;
    const newRefs: ReferenceImage[] = toAdd.map((file, i) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: URL.createObjectURL(file),
      name: `图${startIdx + i + 1}`,
    }));
    onAdd(newRefs);
  };

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from === null || from === index) return;
    onReorder(from, index);
    dragIndexRef.current = index;
  };
  const handleDragEnd = () => {
    dragIndexRef.current = null;
  };

  return (
    <div style={{ flexShrink: 0 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        参考图
        {referenceImages.length > 0 && (
          <Tag color="blue" style={{ marginLeft: 6, fontSize: 10 }}>
            {referenceImages.length}/{maxRefCount}
          </Tag>
        )}
      </Text>
      <div
        style={{
          display: 'flex',
          gap: 8,
          minHeight: 60,
          padding: 4,
          border: '1px dashed #d9d9d9',
          borderRadius: 4,
          overflowX: 'auto',
          background: '#fafafa',
        }}
      >
        {referenceImages.map((ref, idx) => {
          return (
            <div
              key={ref.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              style={{
                position: 'relative',
                width: 56,
                height: 56,
                flexShrink: 0,
                borderRadius: 4,
                overflow: 'hidden',
                border: '1px solid #e8e8e8',
                cursor: 'grab',
              }}
            >
              <img
                src={ref.url}
                alt={ref.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: 2,
                  bottom: 2,
                  background: 'rgba(0,0,0,0.6)',
                  color: 'white',
                  fontSize: 10,
                  padding: '1px 4px',
                  borderRadius: 2,
                  lineHeight: 1.4,
                }}
              >
                {ref.name}
              </span>
              <div
                style={{
                  position: 'absolute',
                  right: 2,
                  top: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(ref.id);
                  }}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 3,
                    background: 'rgba(0,0,0,0.6)',
                    color: '#ff4d4f',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                  title="删除"
                >
                  <Trash2 size={10} />
                </div>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onInsertToPrompt(ref.id);
                  }}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 3,
                    background: 'rgba(0,0,0,0.6)',
                    color: '#1677ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                  title="插入到输入框"
                >
                  @
                </div>
              </div>
            </div>
          );
        })}
        {referenceImages.length < maxRefCount && (
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: 56,
              height: 56,
              flexShrink: 0,
              borderRadius: 4,
              border: '1px dashed #d9d9d9',
              background: '#fafafa',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#bfbfbf',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#1677ff'; e.currentTarget.style.color = '#1677ff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#d9d9d9'; e.currentTarget.style.color = '#bfbfbf'; }}
          >
            <Plus size={24} strokeWidth={1.5} />
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          handleFileUpload(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
