# Changelog

## [0.1.0] - 2026-07-19

首次正式发布版本。ZeroExo Canvas 是一个可视化节点编辑器，提供无限画布、节点系统、连线、云同步等核心能力。

### Core
- 无限画布（pan / zoom），支持缩放 25% – 500%
- 节点系统：图片 / 视频 / 音频 / 文本 / 通用节点，可拖拽、缩放、分组、对齐
- 连线系统：贝塞尔曲线，支持选中流动特效（UE5 调试风格）、裁剪（剪刀）
- 视口剔除（Viewport Culling）：仅渲染视口内节点
- LOD 多级细节：满级 / 缩略图级 / 色块级，根据节点屏幕像素宽度自动切换
- 渐进式图片加载：根据视口缩放选择缩略图 / 预览图 / 原图
- 撤销 / 重做（History 插件）
- 多语言（zh / en / ja，react-i18next）
- 主题切换（亮 / 暗）

### Storage & Sync
- CAS（Content Addressable Storage）：基于 SHA-256 哈希去重，storageKey 格式 `resources/{ownerId}/{hash前2位}/{hash}.{ext}`
- 三层存储架构：`resources/`（CAS 媒体）/ `canvases/`（画布快照）/ `logs/`（每日日志）
- Reference counting：Resource 表跟踪引用计数，0 时软删除，7 天后 GC 清理
- 云同步：增量同步本地 ↔ 云端，冲突可视化（保留本地 / 云端）
- 后端资源上传：presign + PUT 直传 MinIO，元数据落库

### UI / UX
- 顶部工具栏：标题、撤销/重做、外观面板、文档、语言、设置、开发日志、Agent
- CanvasControls：左上角竖向控件（缩放、对齐、排列下拉等）
- 节点工具栏：选中节点浮现（复制、删除、替换图片等）
- 音频节点：波形可视化、播放控制、波形数据缓存
- 视频节点：非播放时以 img 替代 video，节省 GPU 解码
- 背景点阵：自适应缩放透明度，低于 25% 隐藏
- 开发日志弹窗：版本号 + 变更列表
