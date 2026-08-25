/**
 * ImportTemplateModal - 模型模板导入弹窗（全站唯一导入入口）
 *
 * 模板库卡片（ModelTemplateLibrary）与参数配置弹窗（AiBrandSchemaModal）
 * 共用本组件，保证「导入模型模板」的交互与示例完全一致：
 *   - 统一标题、示例（DSL 完整模板 / 纯参数模板）、错误展示（后端校验字段级错误）
 *   - 导入成功 → POST /admin/model-templates → 回调 onImported(模板对象)
 *
 * 两处使用差异仅体现在 onImported 上：
 *   - 模板库：刷新列表
 *   - 参数配置弹窗：刷新预设下拉 + 回填参数
 */
import { useState } from 'react';
import { message } from 'antd';
import { apiPost, showApiError } from '@/services/api-client';
import TemplateEditor from './TemplateEditor';

export interface ImportTemplateModalProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 导入成功回调：返回导入的模板对象（含 id/name/modelType/parameters 等） */
  onImported?: (template: Record<string, any>) => void;
  /** 可选：预填 JSON（如把当前参数配置带过去作为新模板基础） */
  presetJson?: string;
}

/** 示例 1：Kling 官方直连（kling-hmac 签名 + 异步任务轮询） */
const KLING_EXAMPLE = {
  id: 'my-kling-v3',
  name: 'Kling 官方直连（示例）',
  protocol: 'openai',
  modelType: 'video',
  endpoint: '/api/v1/services/aigc/video-generation/video-synthesis',
  parameters: [
    {
      name: 'mode',
      type: 'enum',
      label: '生成模式',
      default: 'image-to-video-first-last-frame',
      values: ['image-to-video-first-last-frame', 'multi-modal-reference'],
      display: 'radio',
    },
    {
      name: 'duration',
      type: 'enum',
      label: '时长（秒）',
      default: 5,
      values: ['5', '10'],
      display: 'radio',
    },
    {
      name: 'size',
      type: 'enum',
      label: '视频尺寸',
      default: '720x1280',
      values: ['720x1280', '1080x1920', '1280x720', '1920x1080'],
      display: 'select',
    },
    { name: 'sound', type: 'boolean', label: '生成音频', default: true },
    { name: 'seed', type: 'number', label: '随机种子', default: 0, min: 0, max: 2147483647 },
    { name: 'referenceImagesEnabled', type: 'boolean', label: '参考图', default: true },
    { name: 'referenceVideosEnabled', type: 'boolean', label: '参考视频', default: false },
  ],
  channelConstraints: {
    paramMapping: {
      mode: 'mode',
      duration: 'duration',
      size: 'size',
      sound: 'sound',
      seed: 'seed',
      referenceImages: 'image',
      referenceVideos: 'video',
    },
    valueMapping: {
      mode: {
        'image-to-video-first-last-frame': 'image_to_video_first_last_frame',
        'multi-modal-reference': 'multi_modal_reference',
      },
    },
  },
  auth: { type: 'kling-hmac' },
  task: {
    submitIdPath: 'data.task_id',
    pollUrlTemplate: '/api/v1/services/aigc/video-generation/video-synthesis/{id}',
    statusPath: 'data.task_status',
    successValues: ['succeeded'],
    failureValues: ['failed'],
    resultPath: 'data.task_result.videos[0].url',
  },
  matchKeywords: ['my-kling'],
};

/** 示例 2：OpenAI 兼容中转（Bearer + 同步响应） */
const OPENAI_RELAY_EXAMPLE = {
  id: 'my-video-relay',
  name: 'OpenAI 兼容视频中转（示例）',
  protocol: 'openai',
  modelType: 'video',
  endpoint: '/v1/videos/generations',
  parameters: [
    {
      name: 'size',
      type: 'enum',
      label: '视频尺寸',
      default: '1024x1024',
      values: ['1024x1024', '1280x720', '720x1280'],
      display: 'select',
    },
    { name: 'duration', type: 'number', label: '时长（秒）', default: 5, min: 1, max: 30 },
    { name: 'referenceImagesEnabled', type: 'boolean', label: '参考图', default: true },
  ],
  channelConstraints: {
    paramMapping: {
      size: 'size',
      duration: 'duration',
      referenceImages: 'image',
    },
  },
  auth: { type: 'bearer' },
  sync: { resultPath: 'data[0].url' },
  matchKeywords: ['my-relay-video'],
};

/** 示例 3：纯参数模板（只配置参数，执行协议用默认） */
const PARAM_ONLY_EXAMPLE = {
  id: 'my-param-template',
  name: '纯参数模板（示例）',
  modelType: 'image',
  parameters: [
    { name: 'size', type: 'enum', label: '尺寸', default: '1024x1024', values: ['1024x1024', '2048x2048'], display: 'select' },
    { name: 'quality', type: 'enum', label: '画质', default: 'high', values: ['low', 'medium', 'high'], display: 'radio' },
  ],
  matchKeywords: ['my-param'],
};

export default function ImportTemplateModal({
  open,
  onClose,
  onImported,
  presetJson,
}: ImportTemplateModalProps) {
  const [templateJson, setTemplateJson] = useState('');

  return (
    <TemplateEditor
      open={open}
      onClose={() => {
        setTemplateJson('');
        onClose();
      }}
      onApply={async (json) => {
        const result = await apiPost<{ success: boolean; template: Record<string, any> }>(
          '/admin/model-templates',
          json,
        );
        const template = result?.template ?? json;
        message.success('模板导入成功，全站已生效');
        onImported?.(template);
        setTemplateJson('');
      }}
      onApplyError={(err) => {
        showApiError(err, '模板导入失败');
        return true;
      }}
      presetJson={presetJson || templateJson}
      title="导入模型模板"
      examples={[
        { title: 'Kling 官方直连（签名 + 轮询）', json: KLING_EXAMPLE },
        { title: 'OpenAI 兼容中转（Bearer + 同步）', json: OPENAI_RELAY_EXAMPLE },
        { title: '纯参数模板（只配置参数）', json: PARAM_ONLY_EXAMPLE },
      ]}
    />
  );
}
