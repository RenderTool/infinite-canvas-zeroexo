/**
 * VideoResultPreview - 视频生成结果预览区域
 *
 * 展示三种状态：
 *   1. 生成中：Spin 加载动画
 *   2. 空状态：Film 占位图标 + 引导文案
 *   3. 结果展示：HTML5 video 播放器
 */
import { Spin, Typography } from 'antd';
import { Film } from 'lucide-react';
import type { ResultVideo } from './types';

const { Text } = Typography;

export interface VideoResultPreviewProps {
  /** 是否正在生成 */
  generating: boolean;
  /** 结果视频列表 */
  results: ResultVideo[];
}

/** 视频生成结果预览区域 */
export default function VideoResultPreview({
  generating,
  results,
}: VideoResultPreviewProps) {
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
            正在生成视频...
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
          <Film size={48} strokeWidth={1.5} style={{ marginBottom: 12, opacity: 0.3 }} />
          <Text type="secondary" style={{ fontSize: 13 }}>
            选择渠道和模型后，输入提示词生成视频
          </Text>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto',
            padding: 16,
          }}
        >
          {results.map((result) => (
            <div
              key={result.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                maxWidth: '100%',
                gap: 8,
              }}
            >
              <video
                src={result.url}
                controls
                style={{
                  maxWidth: '100%',
                  maxHeight: 'calc(100vh - 480px)',
                  borderRadius: 4,
                  background: '#000',
                }}
              >
                您的浏览器不支持视频播放
              </video>
              {result.durationMs != null && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  时长: {(result.durationMs / 1000).toFixed(1)}秒
                </Text>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}