/**
 * text-limits - 文本输入字数上限（防恶意超大文本拖垮协作同步）
 *
 * 背景（2026-08-22 安全问题）：文本输入无字数限制，恶意用户粘贴超大文本
 * 经 Yjs 协作同步（CRDT 合并 + 广播 + DB 落库）可拖垮服务器与其他客户端。
 *
 * 防御纵深：
 * 1. 前端输入层：粘贴/输入时钳制（SelfRichTextEditor / 各输入组件）
 * 2. 协作同步层：后端 sync.service RateLimitExtension 单条更新 1MB + 60 次/秒
 * 3. 超限行为：截断至上限 + 提示，不拒绝编辑
 */

/** 富文本节点单节点文本上限（5 万字符，任何合法创作场景足够） */
export const TEXT_MAX_LENGTH = 50_000;

/** 剧本内容上限（剧本长文本场景更大，10 万字符；UTF-8 下约 300KB，低于同步层 1MB） */
export const SCRIPT_MAX_LENGTH = 100_000;

/** 通用单行输入上限（节点标题/名称/备注等短字段） */
export const SHORT_TEXT_MAX_LENGTH = 500;
