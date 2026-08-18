# ToolsDock 节点策略表

## 一、样式规范

| 项目 | 规范 |
|------|------|
| 图标尺寸 | 统一 16px(cloneElement 覆盖 lucide-react 的 size 属性) |
| 文字长度 | 聚合按钮 + 菜单项: <= 4 字;节点自身工具: 用映射表补全 |
| 布局 | 图标 + 文字水平排列,按钮高度 32px,圆角 6px |
| 容器 | 透明无背景无边框 |

## 二、多语言规范(IMPORTANT)

ToolsDock 内所有可见文本(节点工具 label、聚合按钮 label、菜单项 label、默认回退文字)必须通过 `react-i18next` 的 `t()` 函数获取,禁止硬编码中文字符串。

i18n key 分布:
- 节点工具 label 映射: `toolsDock.*`(如 `toolsDock.bgColor`、`toolsDock.crop`)
- 聚合按钮: 复用 `toolbar.group/arrange/unify/layer`
- 排列菜单: 复用 `arrange.*` + 新增 `toolsDock.grid/horizontal/vertical`(短文字)
- 对齐菜单: 复用 `align.*`
- 分布菜单: 复用 `distribute.*`
- 尺寸菜单: 新增 `toolsDock.unifyWidth/unifyHeight/unifyBoth`(短文字)
- 层级菜单: 复用 `sort.bringToFront/sendToBack/moveUp/moveDown`
- 公共: `common.confirm/cancel`、`toolbar.rename/ungroup/delete/duplicate`
- 默认回退: `toolsDock.tool`

## 三、聚合按钮设计

| 聚合按钮 | 图标 | 文字(i18n) | 弹出内容 |
|---------|------|------|---------|
| 成组 | Group | toolbar.group | 成组 / 解组 |
| 排列 | LayoutGrid | toolbar.arrange | 网格/横排/竖排 + 对齐6项 + 分布2项 |
| 尺寸 | Scaling | toolbar.unify | 等宽/等高/统一尺寸 |
| 层级 | Layers | toolbar.layer | 置顶/置底/上移/下移 |

## 四、聚合按钮显示条件

| 选区状态 | 节点/组工具 | 成组 | 排列 | 尺寸 | 层级 |
|---------|-----------|------|------|------|------|
| 空选区(count=0) | - | - | - | - | - |
| 预览组态 | 确认/取消 | - | - | - | - |
| 单选节点 | 节点工具 | - | - | - | 显示 |
| 单选组 | 组工具 | - | - | - | 显示 |
| 多选全节点(>=2) | - | 显示 | 显示 | 显示 | 显示 |
| 多选全组(>=2) | - | 显示 | 显示 | 显示 | 显示 |
| 多选混合(节点+组) | - | 显示 | 显示 | 显示 | -(冲突) |

### 预览组态特殊说明(BUG FIX)

预览组触发时,原选中节点(>=2)仍保留在 selection 中,因此 `selectedCount >= 2`、`isMultiSelect = true`。若按常规逻辑 `showNodeTools = hasNodeTools && !isMultiSelect`,则预览组时 confirm/cancel 工具不会显示,同时所有聚合按钮因 `isPreview=true` 也不显示,导致 ToolsDock 完全空白。

**修复**:预览组态时强制显示节点工具,忽略 `isMultiSelect`:
```
showNodeTools = hasNodeTools && (isPreview || !isMultiSelect)
```

## 五、聚合菜单内容

### 1. 成组聚合

| 子项 | 图标 | 文字(i18n) | 可用条件 |
|------|------|------|---------|
| 成组 | Group | toolbar.group | count >= 2 |
| 解组 | LayoutPanelLeft | toolbar.ungroup | hasGroup |

不可用子项隐藏(不显示禁用态)。

### 2. 排列聚合

| 子项 | 图标 | 文字(i18n) | 可用条件 |
|------|------|------|---------|
| 网格 | LayoutGrid | toolsDock.grid | count >= 2 |
| 横排 | Rows | toolsDock.horizontal | count >= 2 |
| 竖排 | Columns | toolsDock.vertical | count >= 2 |
| -- 分隔线 -- | | | |
| 左对齐 | AlignStartHorizontal | align.left | count >= 2 |
| 水平居中 | AlignCenterHorizontal | align.hCenter | count >= 2 |
| 右对齐 | AlignEndHorizontal | align.right | count >= 2 |
| -- 分隔线 -- | | | |
| 顶对齐 | AlignStartVertical | align.top | count >= 2 |
| 垂直居中 | AlignCenterVertical | align.vCenter | count >= 2 |
| 底对齐 | AlignEndVertical | align.bottom | count >= 2 |
| -- 分隔线 -- | | | |
| 水平等距 | MoveHorizontal | distribute.horizontal | count >= 3 |
| 垂直等距 | MoveVertical | distribute.vertical | count >= 3 |

### 3. 尺寸聚合

| 子项 | 图标 | 文字(i18n) | 可用条件 |
|------|------|------|---------|
| 等宽 | MoveHorizontal | toolsDock.unifyWidth | count >= 2 |
| 等高 | MoveVertical | toolsDock.unifyHeight | count >= 2 |
| 统一尺寸 | Maximize2 | toolsDock.unifyBoth | count >= 2 |

### 4. 层级聚合

| 子项 | 图标 | 文字(i18n) | 可用条件 |
|------|------|------|---------|
| 置顶 | ArrowUpToLine | sort.bringToFront | 适用时 |
| 置底 | ArrowDownToLine | sort.sendToBack | 适用时 |
| 上移 | ChevronUp | sort.moveUp | 适用时 |
| 下移 | ChevronDown | sort.moveDown | 适用时 |

## 六、层级聚合特殊情况分析

当前 `sortSelection` 限制:
- 只接收 `direction` 参数,从 store 读取选区
- 强制同父校验: 所有选中节点必须共享同一 parentId,否则直接返回 null
- 不自动展开组: 选中组只排序组节点本身,不会把组的后代拉出来一起排序

| 选区状态 | 层级聚合显示 | 当前支持 | 行为/问题 |
|---------|------------|---------|---------|
| 单选节点 | 显示 | 支持 | 调整自身 z-index |
| 单选组 | 显示 | 部分支持 | 当前只调整组自身;用户期望组+后代统一调整,需额外实现 |
| 多选全节点(同父) | 显示 | 支持 | 各节点调整 |
| 多选全节点(不同父) | 显示 | 不支持 | 同父校验失败,静默无效 |
| 多选全组(同父) | 显示 | 支持 | 各组自身调整 |
| 多选全组(不同父) | 显示 | 不支持 | 同父校验失败,静默无效 |
| 多选混合(节点+组) | 不显示 | 不支持 | 选中的节点可能是某组的后代,语义冲突 |
| 预览组态 | 不显示 | 不支持 | 预览中不调整层级 |
| 空选区 | 不显示 | 不支持 | 无选中对象 |

### 组+后代统一调整方案(已选: 方案A)

在 editor 层面实现: 单选组时,获取组的所有后代 ID,临时将选区设为组+后代,调用 sortSelection,然后恢复原选区。

### 多选不同父处理(已选: 始终显示)

层级聚合始终显示,点击后如果同父校验失败则静默无效。

## 七、节点自身工具 label 映射表

对 ext.getTools()/getGroupTools() 返回的工具,label 为空或超限时使用 i18n 映射:

| 工具 ID | i18n key | 中文 |
|--------|---------|------|
| confirm | common.confirm | 确认 |
| cancel | common.cancel | 取消 |
| rename | toolbar.rename | 重命名 |
| ungroup | toolbar.ungroup | 解组 |
| bg-color | toolsDock.bgColor | 背景色 |
| radius | toolsDock.radius | 圆角 |
| delete | toolbar.delete | 删除 |
| copyPrompt | toolsDock.copyPrompt | 复制提示 |
| duplicate | toolbar.duplicate | 复制 |
| resize | toolsDock.resize | 锁比例 |
| maskEdit | toolsDock.maskEdit | 局部编辑 |
| crop | toolsDock.crop | 裁剪 |
| split | toolsDock.split | 切图 |
| upscale | toolsDock.upscale | 放大 |
| superResolve | toolsDock.superResolve | 超分 |
| angle | toolsDock.angle | 多角度 |
| download | toolsDock.download | 下载 |
| editImage | toolsDock.editImage | 编辑图片 |

未知 ID 且 label 为空时显示 `toolsDock.tool`("工具")作为默认文字。

## 八、布局

- 不再需要多列布局: 聚合按钮点击后弹出菜单,不占用横向空间
- 单列布局: 节点/组工具(单选时) + 聚合按钮(根据条件),垂直排列
- ToolsDock 宽度固定(如 120px),按钮全宽

## 九、弹出菜单实现

- 自研弹出菜单(非 Dropdown 组件,因聚合按钮需要受控 open 状态)
- 聚合按钮作为 trigger,点击切换 openMenu 状态
- 菜单定位: `position: absolute; left: 100%; top: 0`(向右弹出)
- 菜单项: icon + label,垂直排列
- 不可用项: 隐藏(不显示禁用态)
- 点击外部关闭: pointerdown 事件监听
