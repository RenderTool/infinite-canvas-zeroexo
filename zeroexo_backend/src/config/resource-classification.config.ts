// ============================================================
// 资源分类配置 — 唯一事实源
//
// 所有前端 Tab / Filter / Column 均由本配置驱动，后端统一查询引擎
// 根据配置动态构造 where 条件。加新分类只需在此文件加一条记录。
//
// 前端通过 GET /api/admin/resource-classification 拉取此配置。
// ============================================================

/** 资源分类配置顶层结构 */
export interface ClassificationConfig {
  categories: ResourceCategory[]
}

/** 单个分类定义 */
export interface ResourceCategory {
  /** 分类标识，如 'material' | 'ai-generation' | 'project' | 'prompt' */
  key: string

  /** UI 展示信息 */
  display: {
    label: string
    icon: string
    emptyText: string
  }

  /** 数据查询策略 */
  query: ResourceQuery

  /** 列定义 */
  columns: ResourceColumn[]

  /** 子筛选选项 */
  filters?: ResourceFilter[]

  /** 结果后处理配置 */
  transform?: ResourceTransform
}

/** 查询策略 */
export interface ResourceQuery {
  /** 数据源标识 */
  source: 'asset' | 'project' | 'ai-generation' | 'prompt'

  /** 额外的固定 where 条件（后端动态构造时合并） */
  where?: Record<string, unknown>

  /** storageKey 前缀筛选（仅 asset source 有效） */
  storagePrefix?: string

  /** 是否忽略 category 字段筛选（asset source 有效，设为 true 时不传 category where） */
  ignoreCategory?: boolean
}

/** 列定义 */
export interface ResourceColumn {
  key: string
  title: string
  width?: number
  /** 渲染方式 */
  render?: 'image' | 'tag' | 'tags' | 'source-tag' | 'text' | 'date' | 'actions'
  /** 默认隐藏 */
  hidden?: boolean
}

/** 子筛选选项 */
export interface ResourceFilter {
  key: string
  label: string
  type: 'select'
  options: { value: string; label: string }[]
}

/** 结果后处理 */
export interface ResourceTransform {
  /** 是否根据 tags 计算 source 字段 */
  computeSource?: boolean
  /** 来源映射：{ tagValue: '显示名称' } */
  sourceMap?: Record<string, string>
  /** 默认来源（当没有匹配的 sourceMap 时） */
  defaultSource?: string
}

// ============================================================
// 实际配置
// ============================================================

export const RESOURCE_CLASSIFICATION_CONFIG: ClassificationConfig = {
  categories: [
    // ==================== 素材 ====================
    {
      key: 'material',
      display: {
        label: '素材',
        icon: 'FolderOpen',
        emptyText: '暂无素材记录',
      },
      query: {
        source: 'asset',
        storagePrefix: 'resources/front/assets/',
      },
      columns: [
        { key: 'preview', title: '预览', width: 80, render: 'image' },
        { key: 'filename', title: '文件名', width: 200 },
        { key: 'kind', title: '类型', width: 100, render: 'tag' },
        { key: 'size', title: '大小', width: 100 },
        { key: 'createdAt', title: '创建时间', width: 160, render: 'date' },
        { key: 'actions', title: '操作', width: 100, render: 'actions' },
      ],
      filters: [
        {
          key: 'kind',
          label: '类型',
          type: 'select',
          options: [
            { value: '', label: '全部' },
            { value: 'image', label: '图片' },
            { value: 'video', label: '视频' },
            { value: 'audio', label: '音频' },
            { value: 'text', label: '文本' },
          ],
        },
      ],
    },

    // ==================== AI 生成 ====================
    {
      key: 'ai-generation',
      display: {
        label: 'AI生成',
        icon: 'Sparkles',
        emptyText: '暂无 AI 生成记录',
      },
      query: {
        source: 'asset',
        storagePrefix: 'resources/admin/ai-gen/',
        ignoreCategory: true,
      },
      columns: [
        { key: 'preview', title: '预览', width: 80, render: 'image' },
        { key: 'filename', title: '文件名', width: 200 },
        { key: 'kind', title: '类型', width: 100, render: 'tag' },
        { key: 'source', title: '来源', width: 120, render: 'source-tag' },
        { key: 'size', title: '大小', width: 100 },
        { key: 'createdAt', title: '创建时间', width: 160, render: 'date' },
        { key: 'actions', title: '操作', width: 100, render: 'actions' },
      ],
      filters: [
        {
          key: 'kind',
          label: '类型',
          type: 'select',
          options: [
            { value: '', label: '全部' },
            { value: 'image', label: '图片' },
            { value: 'video', label: '视频' },
            { value: 'audio', label: '音频' },
            { value: 'text', label: '文本' },
          ],
        },
      ],
      transform: {
        computeSource: true,
        sourceMap: { devtest: '后台管理测试' },
        defaultSource: 'AI 生成',
      },
    },

    // ==================== 项目 ====================
    {
      key: 'project',
      display: {
        label: '项目',
        icon: 'Projector',
        emptyText: '暂无项目记录',
      },
      query: {
        source: 'project',
      },
      columns: [
        { key: 'title', title: '名称', width: 200 },
        { key: 'type', title: '类型', width: 100, render: 'tag' },
        { key: 'statusOrVersion', title: '状态/版本', width: 120 },
        { key: 'updatedAt', title: '更新时间', width: 160, render: 'date' },
        { key: 'actions', title: '操作', width: 100, render: 'actions' },
      ],
      filters: [
        {
          key: 'type',
          label: '项目类型',
          type: 'select',
          options: [
            { value: '', label: '全部' },
            { value: 'canvas', label: '画布' },
          ],
        },
      ],
    },

    // ==================== 提示词 ====================
    // 用户主动上传或从 AI 生成中录入的提示词（Prompt 表）
    {
      key: 'prompt',
      display: {
        label: '提示词',
        icon: 'MessageSquare',
        emptyText: '暂无提示词记录',
      },
      query: {
        source: 'prompt',
      },
      columns: [
        { key: 'images', title: '图片', width: 80, render: 'image' },
        { key: 'title', title: '标题', width: 200 },
        { key: 'category', title: '分类', width: 100, render: 'tag' },
        { key: 'tags', title: '标签', width: 160, render: 'tags' },
        { key: 'source', title: '来源', width: 80, render: 'tag' },
        { key: 'favorite', title: '收藏', width: 60 },
        { key: 'createdAt', title: '创建时间', width: 160, render: 'date' },
        { key: 'actions', title: '操作', width: 100, render: 'actions' },
      ],
      },
  ],
}
