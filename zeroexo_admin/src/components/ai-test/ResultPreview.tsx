/**
 * ResultPreview - 图像生成结果预览区域
 *
 * 展示三种状态：
 *   1. 生成中：Spin 加载动画
 *   2. 空状态：ImagePlus 占位图标 + 引导文案
 *   3. 结果展示：Image.PreviewGroup 多图预览
 */
import { Spin, Image, Typography } from 'antd';
import { ImagePlus } from 'lucide-react';
import type { ResultImage } from './types';

const { Text } = Typography;

export interface ResultPreviewProps {
  /** 是否正在生成 */
  generating: boolean;
  /** 结果图片列表 */
  results: ResultImage[];
  /** 下载回调（保留以备扩展使用） */
  onDownload?: (result: ResultImage, index: number) => void;
}

/** 生成结果预览区域 */
export default function ResultPreview({ generating, results }: ResultPreviewProps) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid #f0f0f0',
        borderRadius: 4,
        background: '#fafafa',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {generating && results.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: '#8c8c8c',
          }}
        >
          <Spin size="large" />
          <Text type="secondary" style={{ fontSize: 13 }}>
            正在生成图像...
          </Text>
        </div>
      ) : results.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#bfbfbf',
          }}
        >
          <ImagePlus size={48} strokeWidth={1.5} style={{ marginBottom: 12, opacity: 0.3 }} />
          <Text type="secondary" style={{ fontSize: 13 }}>
            选择渠道和模型后，输入提示词生成图像
          </Text>
        </div>
      ) : (
        <Image.PreviewGroup>
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'auto',
              padding: 8,
            }}
          >
            {results.map((result, index) => (
              <div
                key={result.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  maxWidth: '100%',
                }}
              >
                <Image
                  src={result.url}
                  alt={`生成结果 ${index + 1}`}
                  style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 480px)', borderRadius: 4, objectFit: 'contain' }}
                  preview={{ mask: null }}
                />
              </div>
            ))}
          </div>
        </Image.PreviewGroup>
      )}
    </div>
  );
}
