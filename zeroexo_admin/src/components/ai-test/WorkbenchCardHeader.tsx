/**
 * WorkbenchCardHeader - 图像生成工作台 Card 标题栏
 *
 * 渲染 Card 的 title 区域，包含：
 *   1. 左侧：Wand2 图标 + 「图像生成」标题
 *   2. 右侧：当前模型 Tag（点击复制模型 ID）+ 「参考」「下载」快捷按钮（仅有结果时显示）
 *
 * 纯展示组件，所有数据与回调通过 props 上抛给父组件。
 */
import { Button, Tag, Tooltip, message } from 'antd';
import { Download, Wand2, Plus } from 'lucide-react';
import type { ModelOption, ResultImage } from './types';
import { getBrandIcon } from './image-workbench-utils';

export interface WorkbenchCardHeaderProps {
  /** 当前选中的模型 id */
  selectedModel: string | null;
  /** 模型选项列表（用于查找模型图标） */
  modelOptions: ModelOption[];
  /** 生成结果列表（仅 length > 0 时显示快捷按钮） */
  results: ResultImage[];
  /** 添加结果到参考图回调 */
  onAddToReferences: (result: ResultImage, index: number) => void;
  /** 下载结果回调 */
  onDownload: (result: ResultImage, index: number) => void;
}

/** 图像生成工作台 Card 标题栏 */
export default function WorkbenchCardHeader({
  selectedModel,
  modelOptions,
  results,
  onAddToReferences,
  onDownload,
}: WorkbenchCardHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Wand2 size={14} />
        <span style={{ fontSize: 13, fontWeight: 500 }}>图像生成</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {selectedModel &&
          (() => {
            const opt = modelOptions.find((o) => o.value === selectedModel);
            const Icon = opt ? getBrandIcon(opt.iconProvider) : null;
            return (
              <Tag
                color="blue"
                style={{
                  margin: 0,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard
                    .writeText(selectedModel)
                    .then(() => message.success('模型 ID 已复制'));
                }}
              >
                {Icon && <Icon size={12} />}
                {selectedModel}
              </Tag>
            );
          })()}
        {results.length > 0 && (
          <>
            <Tooltip title="添加到参考图">
              <Button
                size="small"
                icon={<Plus size={12} />}
                style={{ height: 22, fontSize: 11 }}
                onClick={() => onAddToReferences(results[0], 0)}
              >
                参考
              </Button>
            </Tooltip>
            <Tooltip title="下载图片">
              <Button
                size="small"
                icon={<Download size={12} />}
                style={{ height: 22, fontSize: 11 }}
                onClick={() => onDownload(results[0], 0)}
              >
                下载
              </Button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
