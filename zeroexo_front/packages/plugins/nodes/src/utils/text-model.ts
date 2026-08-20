/**
 * text 节点编辑模型(Plan#12)
 *
 * text 是最后一个未命令化的节点:编辑内容此前每键直改 updateNode(不可撤销)。
 * 本模型提供合并提交语义——编辑期草稿在视图本地,退出编辑时一次性构造命令,
 * 一次编辑 = 一个撤销点,避免高频输入撑爆撤销栈。
 *
 * 纯函数,零 React 依赖。视图只消费命令,与 generator-model / media-replace-model 同一套 MVVM 协议。
 */

import { UpdateNodeDataCommand } from '@zeroexo/core';

/** 文本内容是否发生变化(编辑提交判定:无变化不产生命令) */
export function isTextContentDirty(original: string, next: string): boolean {
  return next !== original;
}

/** 构造文本内容更新命令(退出编辑时调用,一次编辑一个撤销点) */
export function buildTextContentCommand(nodeId: string, content: string): UpdateNodeDataCommand {
  return new UpdateNodeDataCommand(nodeId, { content });
}
