# 公共提示词共享迁移导入指南

## 概述

ZeroExo 公共提示词库是独立于用户个人提示词的共享资源，对所有用户（包括未登录用户）可见。本指南介绍如何将第三方提示词库迁移导入到 ZeroExo 系统中。

### 数据存储说明

- **提示词文本内容**（title、content 等）存储在 **PostgreSQL 数据库**的 `PublicPrompt` 表中
- **预览图片**（如果有）存储在 **文件存储服务**中，路径以 `resources/public/` 开头

> 注意：`resources/public/` 是文件存储服务中的 key 路径前缀，不是本地文件系统目录。在本地开发模式下（使用本地文件驱动），实际存储路径为 `storage/resources/public/...`，其中 `storage/` 是存储根目录（由 `STORAGE_ROOT` 环境变量控制，默认 `storage/`）。

## 数据结构

### 数据库表：`PublicPrompt`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `String` | 自动生成 | 主键 UUID |
| `title` | `String` | ✅ | 提示词标题（中文） |
| `content` | `String` | ✅ | 提示词内容 |
| `category` | `String` | ✅ | 分类：`role` \| `scene` \| `style` \| `shot` \| `other` |
| `tags` | `String[]` | - | 标签列表 |
| `source` | `String` | - | 来源：`image-prompt-library` \| `manual`，默认 `manual` |
| `sourceId` | `String` | - | 原始 ID（来自原始项目） |
| `clusterName` | `String` | - | 原始聚类名称 |
| `sourceName` | `String` | - | 来源项目名称（如 `5000-Good-Prompts`） |
| `sourceUrl` | `String` | - | 原文链接 |
| `license` | `String` | - | 许可证：`CC0` \| `CC BY 4.0` \| `MIT` |
| `images` | `Json` | - | 预览图信息数组 `[{storageKey, width, height, alt}]` |
| `demoTitles` | `Json` | - | 多语言标题 `{ en, zh_hans, zh_hant }` |
| `createdAt` | `DateTime` | 自动生成 | 创建时间 |
| `updatedAt` | `DateTime` | 自动生成 | 更新时间 |

### 分类规范

建议使用以下分类：

| 分类 | 说明 |
|------|------|
| `role` | 角色/人物/主体 |
| `scene` | 场景/环境/背景 |
| `style` | 风格/流派/艺术类型 |
| `shot` | 构图/运镜/镜头类型 |
| `other` | 其他 |

## 导入方式

### 方式一：通过 Admin API 批量导入（推荐）

ZeroExo 后端提供了批量导入 API：

```
POST /api/admin/public-prompts/import
Authorization: Bearer <admin_jwt_token>
Content-Type: application/json
```

**请求体格式：**

```json
{
  "items": [
    {
      "title": "赛博朋克风格城市夜景",
      "content": "cyberpunk cityscape at night, neon lights, raining, foggy atmosphere, detailed architecture, 8k, hyperrealistic",
      "category": "style",
      "tags": ["cyberpunk", "night", "city", "neon"],
      "source": "image-prompt-library",
      "sourceName": "My-Prompt-Collection",
      "sourceUrl": "https://github.com/your-username/your-repo",
      "license": "CC0",
      "demoTitles": {
        "en": "Cyberpunk City Night",
        "ja": "サイバーパンク都市の夜"
      },
      "images": [
        {
          "storageKey": "resources/public/ab/abc123...",
          "width": 768,
          "height": 432,
          "alt": "赛博朋克城市夜景预览"
        }
      ]
    }
  ]
}
```

**响应示例：**

```json
{
  "imported": 100,
  "items": [...]
}
```

### 方式二：通过 seed 脚本导入

如果您需要将提示词作为项目初始数据，可以创建自定义 seed 脚本：

```javascript
// prisma/seed-my-prompts.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 提示词数据数组
const MY_PROMPTS = [
  {
    title: '...',
    content: '...',
    category: 'style',
    tags: ['...'],
    license: 'CC0',
    // ... 其他字段
  },
];

async function main() {
  console.log(`导入 ${MY_PROMPTS.length} 个提示词...\n`);

  for (const item of MY_PROMPTS) {
    await prisma.publicPrompt.create({
      data: {
        title: item.title,
        content: item.content,
        category: item.category,
        tags: item.tags || [],
        source: item.source || 'manual',
        sourceName: item.sourceName || null,
        sourceUrl: item.sourceUrl || null,
        license: item.license || null,
        demoTitles: item.demoTitles || {},
        images: item.images || [],
      },
    });
    console.log(`  [创建] ${item.title}`);
  }

  console.log('\n导入完成！');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('导入失败:', e);
  process.exit(1);
});
```

运行：

```bash
cd zeroexo_backend
node prisma/seed-my-prompts.js
```

## 图片上传与存储

### 重要概念：存储路径前缀

`resources/public/` 是文件在存储服务中的 **key 路径前缀**，在不同存储驱动下映射到不同位置：

| 存储驱动 | `resources/public/ab/abc.webp` 的实际位置 |
|----------|------------------------------------------|
| 本地文件 | `storage/resources/public/ab/abc.webp` |
| MinIO/S3 | 对应 bucket 中的 `resources/public/ab/abc.webp` 对象 |
| 阿里云 OSS | 对应 bucket 中的 `resources/public/ab/abc.webp` 对象 |

**本地开发中**，如果你没有上传过任何公共资源图片，`storage/resources/public/` 目录不会存在，这是正常的。

### 公共资源存储路径规则

ZeroExo 对公共资源和私有资源使用不同的存储路径：

| 资源类型 | 存储路径格式 |
|----------|--------------|
| 私有 | `resources/front/assets/{userId}/{hash前2位}/{hash}` |
| 公共 | `resources/public/{hash前2位}/{hash}` |

所有公共提示词的图片资源必须存储在 `resources/public/` 路径下，由系统用户（`00000000-0000-0000-0000-000000000000`）拥有。

### 图片处理要求

- 预览图尺寸：**768px 最大边长**（保持 16:9 比例约为 768x432）
- 图片质量：90%
- 格式：JPEG 或 WebP

### API 上传流程

1. 准备图片文件
2. 请求预签名 URL：

```
POST /api/admin/assets/presign
{
  "fileName": "preview.jpg",
  "fileSize": 123456,
  "isPublic": true
}
```

3. 上传到预签名 URL
4. 获得 `storageKey` 后填入 `images[].storageKey`
5. 调用批量导入 API

## 第三方提示词库迁移示例

### 从 image-prompt-library 迁移

如果您要迁移来自 [image-prompt-library](https://github.com/repo/image-prompt-library) 格式的数据：

```javascript
// 转换脚本示例
const fs = require('fs');

const input = JSON.parse(fs.readFileSync('input.json', 'utf8'));
const output = input.map(item => ({
  title: item.name || item.title,
  content: item.prompt,
  category: mapCategory(item.category), // 映射到 ZeroExo 分类
  tags: item.tags || [],
  source: 'image-prompt-library',
  sourceId: String(item.id),
  clusterName: item.cluster,
  sourceName: 'image-prompt-library',
  sourceUrl: item.url,
  license: 'CC0', // 根据实际情况填写
  demoTitles: {
    en: item.name_en || item.name,
  },
}));

console.log(JSON.stringify({ items: output }, null, 2));
```

### 从 CSV 格式迁移

```javascript
const csv = require('csv-parser');
const fs = require('fs');
const results = [];

fs.createReadStream('prompts.csv')
  .pipe(csv())
  .on('data', (data) => results.push(data))
  .on('end', () => {
    const output = results.map(row => ({
      title: row.title,
      content: row.content,
      category: row.category || 'other',
      tags: row.tags ? row.tags.split(',').map(t => t.trim()) : [],
      source: 'csv-import',
      license: 'CC0',
    }));
    fs.writeFileSync('import.json', JSON.stringify({ items: output }, null, 2));
    console.log(`转换完成，共 ${output.length} 个提示词`);
  });
```

## 许可证说明

在导入第三方提示词时，请务必尊重原作者的许可证：

- **CC0**：公共领域，可以自由使用
- **CC BY 4.0**：需要署名原作者
- **MIT**：MIT 许可证，自由度较高
- 其他：请确认原项目授权后再导入

## 贡献提示词到 ZeroExo

如果您希望将您的提示词集合贡献给 ZeroExo 官方项目：

1. Fork 本仓库
2. 在 `prisma/seeds/` 目录下创建您的提示词 JSON 文件
3. 确保每个提示词包含必要字段（title, content, category）
4. 在您的 JSON 文件中填写正确的 `sourceName`、`sourceUrl` 和 `license`
5. 提交 Pull Request
6. 维护者审核后会合并并部署到官方实例

## 数据格式校验清单

导入前请检查：

- [ ] `title` 不为空
- [ ] `content` 不为空
- [ ] `category` 是允许的值之一（role/scene/style/shot/other）
- [ ] `tags` 是字符串数组
- [ ] `images` 如果有，每个项都有 `storageKey`
- [ ] `license` 使用标准值（CC0/CC BY 4.0/MIT）

## 常见问题

**Q: 导入后前端看不到新导入的提示词？**

A: 公共提示词前端会缓存分类统计，刷新页面或清除缓存即可。

**Q: 图片显示 404？**

A: 检查 `storageKey` 是否以 `resources/public/` 开头，确认文件已正确上传到存储服务。

**Q: 批量导入有数量限制吗？**

A: API 没有硬性限制，但建议单次导入不超过 1000 个提示词，避免超时。
