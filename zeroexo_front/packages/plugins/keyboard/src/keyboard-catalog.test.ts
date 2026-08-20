/**
 * 快捷键目录派生契约测试（Plan#23 A1）
 *
 * 守护「注册表唯一事实源 → 派生层」契约:
 * - toKeyCaps: 修饰符固定顺序 + 主键规范化 + 多键取首
 * - getShortcutCatalog: display:false 过滤 / 无 descriptionKey 过滤 / extras 合并 / 缺省分类
 */
import { describe, expect, it } from 'vitest';
import { getShortcutCatalog, toKeyCaps, type ShortcutEntry } from './index.js';

const noop = (): boolean => true;

function entry(partial: Partial<ShortcutEntry> & { id: string; key: string | string[] }): ShortcutEntry {
  return { handler: noop, ...partial };
}

describe('toKeyCaps 键帽解析', () => {
  it('修饰符固定顺序 Ctrl→Shift→Alt + 主键大写', () => {
    expect(toKeyCaps({ key: 'g', ctrlKey: true, shiftKey: true })).toEqual(['Ctrl', 'Shift', 'G']);
    expect(toKeyCaps({ key: 'g', ctrlKey: true })).toEqual(['Ctrl', 'G']);
    expect(toKeyCaps({ key: 'z', ctrlKey: true })).toEqual(['Ctrl', 'Z']);
  });

  it('多键取首(Delete/Backspace → Delete)', () => {
    expect(toKeyCaps({ key: ['Delete', 'Backspace'] })).toEqual(['Delete']);
  });

  it('特殊键原样保留(Escape/Enter/Space/=)', () => {
    expect(toKeyCaps({ key: 'Escape' })).toEqual(['Escape']);
    expect(toKeyCaps({ key: 'Enter' })).toEqual(['Enter']);
    expect(toKeyCaps({ key: 'Space' })).toEqual(['Space']);
    expect(toKeyCaps({ key: '=', ctrlKey: true })).toEqual(['Ctrl', '=']);
  });

  it('无修饰符单字母 → 大写主键', () => {
    expect(toKeyCaps({ key: 'v' })).toEqual(['V']);
  });
});

describe('getShortcutCatalog 聚合目录', () => {
  const shortcuts: ShortcutEntry[] = [
    entry({ id: 'std:copy', key: 'c', ctrlKey: true, meta: { category: 'edit', descriptionKey: 'shortcuts.copy', education: true } }),
    entry({ id: 'std:delete', key: ['Delete', 'Backspace'], meta: { category: 'edit', descriptionKey: 'shortcuts.deleteNode' } }),
    // 内部机制变体:display:false 不展示
    entry({ id: 'group:delete-ungroup', key: ['Delete', 'Backspace'], shiftKey: true, meta: { display: false } }),
    // 无 descriptionKey 不展示
    entry({ id: 'ui:hidden', key: 'x', meta: { category: 'edit' } }),
    // 无 meta 不展示(纯机制键)
    entry({ id: 'ui:raw', key: 'y' }),
  ];

  it('过滤 display:false / 无 descriptionKey / 无 meta', () => {
    const catalog = getShortcutCatalog(shortcuts);
    expect(catalog.map((c) => c.id).sort()).toEqual(['std:copy', 'std:delete']);
  });

  it('caps 由注册键派生(非手写)', () => {
    const catalog = getShortcutCatalog(shortcuts);
    expect(catalog.find((c) => c.id === 'std:copy')?.caps).toEqual(['Ctrl', 'C']);
    expect(catalog.find((c) => c.id === 'std:delete')?.caps).toEqual(['Delete']);
  });

  it('education/iconKey/category 透传,缺省分类归 other', () => {
    const catalog = getShortcutCatalog(shortcuts);
    const copy = catalog.find((c) => c.id === 'std:copy');
    expect(copy?.education).toBe(true);
    expect(copy?.category).toBe('edit');
    const bare = getShortcutCatalog([entry({ id: 'x', key: 'q', meta: { descriptionKey: 'shortcuts.deselect' } })]);
    expect(bare[0]?.category).toBe('other');
  });

  it('extras 注册表外补充条目合并(如 interaction 内部监听的 V 键)', () => {
    const extra = entry({ id: 'ui:select-mode', key: 'v', meta: { category: 'canvas', descriptionKey: 'shortcuts.selectMode' } });
    const catalog = getShortcutCatalog(shortcuts, [extra]);
    const selectMode = catalog.find((c) => c.id === 'ui:select-mode');
    expect(selectMode?.caps).toEqual(['V']);
    expect(selectMode?.category).toBe('canvas');
  });

  it('空注册表 → 空目录(未安装插件自动隐藏)', () => {
    expect(getShortcutCatalog([])).toEqual([]);
  });
});
