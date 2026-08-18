/**
 * prompt-copy-feedback - 「复制提示词到我的提示词库」统一反馈
 *
 * 三个入口（资产库创建副本 / 公共提示词卡片生成同款 / 详情弹窗生成同款）
 * 属同一行为，统一提示「已复制到我的提示词库,点击查看」：
 * - 提示前强制失效共享缓存（TTL 30s），保证资产库列表能刷出新副本
 * - 「点击查看」为超链接样式，点击定位到资产库提示词分组并聚焦新副本
 *   （#/assets?group=prompt&focus=<id>，配合 GridView 的收纳动画 + 脉冲高亮）
 * - 复制瞬间采集当前弹窗矩形（stash），供资产库 ghost「缩放收纳」动画使用
 */

import type { MessageInstance } from 'antd/es/message/interface';
import { refreshSharedPrompts } from './shared-data-store.js';

/** accent 色在 DARK_THEME / LIGHT_THEME 中同为 #e94560（见 @zeroexo/shared），此处用常量 */
const ACCENT = '#e94560';

/** stash 有效期:超过该时长视为过期(用户未通过「点击查看」跳转),不再播放收纳动画 */
const STASH_TTL_MS = 8000;

interface StashRect {
  x: number;
  y: number;
  width: number;
  height: number;
  at: number;
}

/** 复制瞬间采集的源弹窗矩形(模块级,一次性消费) */
let stashRect: StashRect | null = null;

/** 采集当前最上层 antd Modal 的矩形作为收纳动画起点(复制发生时详情/新建弹窗必然在场) */
function captureModalRect(): void {
  const modals = document.querySelectorAll<HTMLElement>('.ant-modal-content');
  const top = modals[modals.length - 1];
  if (!top) {
    stashRect = null;
    return;
  }
  const rect = top.getBoundingClientRect();
  stashRect = { x: rect.left, y: rect.top, width: rect.width, height: rect.height, at: Date.now() };
}

/** 一次性消费源矩形;无有效 stash 时回退视口中央 640×420 虚拟矩形(仅焦点跳转链路会调用) */
export function consumeStashSourceRect(): { x: number; y: number; width: number; height: number } {
  if (stashRect && Date.now() - stashRect.at <= STASH_TTL_MS) {
    const { x, y, width, height } = stashRect;
    stashRect = null;
    return { x, y, width, height };
  }
  stashRect = null;
  const w = Math.min(640, window.innerWidth * 0.7);
  const h = 420;
  return { x: (window.innerWidth - w) / 2, y: Math.max(60, (window.innerHeight - h) / 2), width: w, height: h };
}

/** 统一提示「已复制到我的提示词库」，并支持点击跳转到资产库提示词分组聚焦新副本 */
export function notifyPromptCopied(antdMessage: MessageInstance, promptId?: string): void {
  // 采集源弹窗矩形(供 ghost 收纳动画使用)
  captureModalRect();
  // 强制失效共享缓存，确保跳转后资产库列表出现新副本
  void refreshSharedPrompts(true);
  const focusHash = promptId
    ? `#/assets?group=prompt&focus=${encodeURIComponent(promptId)}`
    : '#/assets?group=prompt';
  antdMessage.open({
    type: 'success',
    duration: 5,
    content: (
      <span>
        已复制到我的提示词库,
        <a
          onClick={(e) => {
            e.stopPropagation();
            window.location.hash = focusHash;
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.textDecoration = 'underline';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.textDecoration = 'none';
          }}
          style={{
            color: ACCENT,
            fontWeight: 600,
            cursor: 'pointer',
            textDecoration: 'none',
            transition: 'color 0.15s',
          }}
        >
          点击查看
        </a>
      </span>
    ),
  });
}
