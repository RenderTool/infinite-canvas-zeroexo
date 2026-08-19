# CSS 经验：flex + resize 冲突

## ❌ 错误写法
```css
.sidebar {
  flex: 1;
  resize: horizontal;
  overflow: hidden;
}
```
问题：flex:1 让元素尺寸由 flex 容器计算决定，resize 拖拽后浏览器下一帧会用 flex 计算结果覆盖手动调整的尺寸，拖拽无效或松手回弹。

## ✅ 正确写法
```css
.sidebar {
  flex: 1;
  min-width: 200px;
  max-width: 800px;
  resize: horizontal;
  overflow: hidden;
}
```
要点：必须设置 min-width/max-width 限定范围，让 resize 在这个范围内生效，不会被 flex 完全接管。

## ⚠️ 边界情况
- resize 只在 overflow 不为 visible 时生效（auto/hidden/scroll 均可）
- 如果是 flex-direction: column 下的垂直拖拽，用 resize: vertical + min-height/max-height
- CSS Grid 布局中用 grid-template-columns 配合 minmax() 是更好的替代方案
- 使用 `width` 而不是 `flex-basis` 配合 `resize` 时，某些浏览器（Safari）需要额外设置 `min-width: 0` 才能正确收缩
- ResizeObserver 可以监听 resize 变化并手动同步到 flex 容器，适合复杂场景
