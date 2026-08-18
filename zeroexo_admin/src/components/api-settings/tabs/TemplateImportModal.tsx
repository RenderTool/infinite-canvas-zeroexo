/**
 * TemplateImportModal - 模板导入弹窗
 *
 * 包装可复用的 TemplateEditor 组件，提供模板 JSON 的下载/上传/编辑/应用能力。
 *
 * 设计说明：
 * - TemplateEditor 内部已完成 JSON 解析与校验，通过 onApply 回调传出解析后的对象。
 * - 本组件按任务约定将解析结果序列化为 JSON 字符串后调用 onImport，
 *   由父组件负责字段过滤、回填表单与消息提示。
 * - presetJson 内部维持为空字符串，与原内联实现一致（外部从未注入非空预设）。
 * - importing prop 当前未直接作用于 TemplateEditor（其未暴露 loading 态），
 *   保留以兼容未来扩展。
 */
import { useState } from 'react';
import TemplateEditor from '../TemplateEditor';

export interface TemplateImportModalProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 导入回调：接收 JSON 字符串，由父组件解析并回填表单 */
  onImport: (json: string) => Promise<void>;
  /** 导入中标志（保留字段，当前 TemplateEditor 未暴露 loading 态） */
  importing: boolean;
}

export default function TemplateImportModal({
  open,
  onClose,
  onImport,
  importing,
}: TemplateImportModalProps) {
  // 预设 JSON 字符串，与原内联实现一致始终为空
  const [templateJson, setTemplateJson] = useState('');

  // importing 当前未直接驱动 UI，保留以便未来扩展
  void importing;

  return (
    <TemplateEditor
      open={open}
      onClose={() => {
        setTemplateJson('');
        onClose();
      }}
      onApply={(parsed) => {
        // TemplateEditor 已完成 JSON 解析；序列化为字符串后交给父组件处理
        // 异步触发，不阻塞弹窗关闭，与原内联 onApply 同步语义一致
        void Promise.resolve(onImport(JSON.stringify(parsed))).catch(() => {
          // 静默处理：原内联 onApply 不会抛出异常
        });
        setTemplateJson('');
      }}
      presetJson={templateJson}
      title="模板管理"
      exampleJson={{
        name: '我的品牌',
        baseUrl: 'https://api.example.com/v1',
        apiFormat: 'openai',
        capabilities: ['llm', 'image'],
      }}
    />
  );
}
