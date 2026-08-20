/**
 * @zeroexo/plugin-keyboard
 * 键盘快捷键插件(纯机制,不含业务逻辑)
 *
 * 设计:
 * - 插件只提供"注册 + 查表分发"机制
 * - 具体快捷键(copy/paste/delete/undo/redo/group 等)由 app 或其他插件
 *   通过 registerShortcut 注册,实现机制/策略分离
 * - 分发顺序:逆序遍历(后注册优先),handler 返回 true 表示已处理(停止分发)
 * - 不阻塞 input/textarea/contenteditable(焦点在其中时跳过所有快捷键)
 *
 * API:
 * - registerShortcut(entry): () => void   注册一个快捷键,返回 cleanup 函数
 * - registerShortcuts(entries): () => void  批量注册,返回统一 cleanup
 * - unregisterShortcut(id): void           按 id 注销
 * - listShortcuts(): readonly ShortcutEntry[]  只读视图(用于 UI 文案标注)
 *
 * 依赖: 无(纯机制,不需要 commandQueue 或其他上下文)
 */

import type { Plugin, PluginContext } from '@zeroexo/core';

// ===== 类型 =====

/**
 * 快捷键展示元数据(Plan#23 A 模块:注册表自动映射)
 * - 快捷键页面/教育浮层按此派生,UI 不再手写副本
 * - 缺失 meta 或 descriptionKey 缺省 → UI 自动隐藏该条(内部机制键)
 */
export interface ShortcutMeta {
  /** 分类 id(快捷键页面分组,对应 shortcuts.category* i18n key;缺省归 'other') */
  category?: string;
  /** 操作说明 i18n key(shortcuts.* 命名空间;缺省则 UI 不展示该条) */
  descriptionKey?: string;
  /** 图标语义键(消费模块内 Map 解析,可选) */
  iconKey?: string;
  /** 是否在 UI 展示(默认 true;false = 内部机制变体,如 Shift+Delete 解组) */
  display?: boolean;
  /** 是否为教育浮层候选(默认 false;education 面板自动收集) */
  education?: boolean;
}

/**
 * 快捷键条目
 * - key: 键名(如 'Delete' / 'Escape' / 'g' / 'z'),支持多个(如 ['Delete', 'Backspace'])
 * - ctrlKey: 匹配 Ctrl 或 Cmd(macOS),默认 false
 * - shiftKey: 匹配 Shift,默认 false
 * - altKey: 匹配 Alt,默认 false
 * - handler: 返回 true 表示已处理(停止分发),false 表示未处理(继续查找下一个匹配)
 *
 * 分发顺序:逆序遍历(后注册优先)。app 应先注册基础快捷键(copy/paste 等),
 * 再注册特定插件的快捷键(group 等),使后者优先匹配。
 */
export interface ShortcutEntry {
  /** 唯一 id,用于 unregister(同 id 后注册覆盖先注册) */
  id: string;
  /** 键名(不区分大小写),支持多个 */
  key: string | string[];
  /** 要求 Ctrl/Cmd(默认 false) */
  ctrlKey?: boolean;
  /** 要求 Shift(默认 false) */
  shiftKey?: boolean;
  /** 要求 Alt(默认 false) */
  altKey?: boolean;
  /** 处理函数:返回 true 已处理(停止分发),false 未处理(继续匹配) */
  handler: (event: KeyboardEvent) => boolean;
  /** 展示元数据(可选;用于快捷键页面/教育浮层自动映射) */
  meta?: ShortcutMeta;
}

// ===== 目录派生(UI 消费:快捷键页面/教育浮层自动映射) =====

/** 目录条目:由注册表派生,UI 只消费此结构,禁止手写键帽副本 */
export interface ShortcutCatalogEntry {
  /** 注册 id */
  id: string;
  /** 键帽链(KeyCap 解析结果,如 ['Ctrl','Shift','G']) */
  caps: string[];
  /** 操作说明 i18n key */
  descriptionKey: string;
  /** 分类 id(对应 shortcuts.category* i18n key) */
  category: string;
  /** 图标语义键(可选) */
  iconKey?: string;
  /** 教育浮层候选标记 */
  education?: boolean;
}

/**
 * 键帽解析:修饰符(固定顺序 Ctrl→Shift→Alt)+ 主键
 * - 主键单字符字母大写显示(如 'g' → 'G'),其余原样(Delete/Escape/Enter/= 等)
 * - 多键取首(如 ['Delete','Backspace'] → 'Delete')
 */
export function toKeyCaps(
  entry: Pick<ShortcutEntry, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
): string[] {
  const caps: string[] = [];
  if (entry.ctrlKey) caps.push('Ctrl');
  if (entry.shiftKey) caps.push('Shift');
  if (entry.altKey) caps.push('Alt');
  const key = (Array.isArray(entry.key) ? entry.key[0] : entry.key) ?? '';
  caps.push(/^[a-zA-Z]$/.test(key) ? key.toUpperCase() : key);
  return caps;
}

/**
 * 聚合目录:由注册表派生 UI 展示条目(单一事实源 → 派生层)
 * - 过滤:无 meta / display:false / 无 descriptionKey(内部机制键不展示)
 * - 未安装插件 → 无对应条目(自动隐藏)
 * - extras:注册表外补充(如 interaction 插件内部监听的 V 键),需完整 meta
 */
export function getShortcutCatalog(
  shortcuts: readonly ShortcutEntry[],
  extras: readonly ShortcutEntry[] = [],
): ShortcutCatalogEntry[] {
  const out: ShortcutCatalogEntry[] = [];
  for (const entry of [...shortcuts, ...extras]) {
    const meta = entry.meta;
    if (!meta || meta.display === false || !meta.descriptionKey) continue;
    out.push({
      id: entry.id,
      caps: toKeyCaps(entry),
      descriptionKey: meta.descriptionKey,
      category: meta.category ?? 'other',
      iconKey: meta.iconKey,
      education: meta.education,
    });
  }
  return out;
}

// ===== 插件类 =====

export class KeyboardPlugin implements Plugin {
  id = 'keyboard';

  private active = false;
  private shortcuts: ShortcutEntry[] = [];
  /** id → shortcuts 数组索引(便于 O(1) 查找) */
  private idIndex = new Map<string, number>();

  install(_context: PluginContext): void {
    // 纯机制,无需上下文
  }

  /**
   * 注册一个快捷键。
   * 同 id 后注册覆盖先注册(自动注销旧的)。
   * @returns cleanup 函数,调用后注销该快捷键
   */
  registerShortcut(entry: ShortcutEntry): () => void {
    // 同 id 先注销(覆盖)
    this.unregisterShortcut(entry.id);
    const idx = this.shortcuts.length;
    this.shortcuts.push(entry);
    this.idIndex.set(entry.id, idx);
    return () => this.unregisterShortcut(entry.id);
  }

  /**
   * 批量注册快捷键。
   * @returns cleanup 函数,调用后注销本次注册的所有快捷键
   */
  registerShortcuts(entries: ShortcutEntry[]): () => void {
    const cleanups = entries.map((e) => this.registerShortcut(e));
    return () => cleanups.forEach((c) => c());
  }

  /** 按 id 注销快捷键 */
  unregisterShortcut(id: string): void {
    const idx = this.idIndex.get(id);
    if (idx === undefined) return;
    this.shortcuts.splice(idx, 1);
    this.idIndex.delete(id);
    // 重建索引(splice 后所有 > idx 的索引前移)
    this.idIndex.clear();
    this.shortcuts.forEach((e, i) => this.idIndex.set(e.id, i));
  }

  /** 列出所有已注册快捷键(只读视图,主要用于 UI 文案标注) */
  listShortcuts(): readonly ShortcutEntry[] {
    return this.shortcuts;
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    window.addEventListener('keydown', this.handleKeyDown, true);
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('keydown', this.handleKeyDown, true);
  }

  uninstall(): void {
    this.deactivate();
    this.shortcuts = [];
    this.idIndex.clear();
  }

  // ===== 内部方法 =====

  private handleKeyDown = (e: KeyboardEvent): void => {
    // 不阻塞 input/textarea/contenteditable
    if (isEditableTarget(e.target)) return;
    // 逆序遍历(后注册优先),第一个 handler 返回 true 即停止
    for (let i = this.shortcuts.length - 1; i >= 0; i--) {
      const entry = this.shortcuts[i];
      if (!entry) continue;
      if (!matches(entry, e)) continue;
      if (entry.handler(e)) {
        return; // 已处理
      }
      // 未处理,继续查找下一个匹配
    }
  };
}

// ===== 工具函数 =====

/** 判断目标是否为可编辑元素(input/textarea/contenteditable) */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target.isContentEditable) return true;
  return false;
}

/** 检查 entry 是否匹配当前 event(键名 + 修饰键完全匹配) */
function matches(entry: ShortcutEntry, e: KeyboardEvent): boolean {
  const keys = Array.isArray(entry.key) ? entry.key : [entry.key];
  const keyLower = e.key.toLowerCase();
  if (!keys.some((k) => k.toLowerCase() === keyLower)) return false;
  if ((entry.ctrlKey ?? false) !== (e.ctrlKey || e.metaKey)) return false;
  if ((entry.shiftKey ?? false) !== e.shiftKey) return false;
  if ((entry.altKey ?? false) !== e.altKey) return false;
  return true;
}
