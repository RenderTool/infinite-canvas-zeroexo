# 📋 开发经验规则库 — 使用说明

## 这是什么？
一个轻量级的 LLM 开发助手经验记忆系统。把踩过的坑记下来，下次 LLM 自动帮你规避。

## 目录结构
```
project-rules/
├── README.md           ← 你正在看的说明
├── 00-SUMMARY.md      ← ✅ 每次对话只发这个（~200 token）
├── css-layout.md      ← 命中 CSS 任务时追加发送
├── api-patterns.md    ← 命中 API 任务时追加发送
├── i18n.md            ← 命中 i18n 任务时追加发送
└── smtp.md            ← 命中 SMTP/邮件任务时追加发送
```

## 每次对话操作流程

```
第 1 步：复制 00-SUMMARY.md 全文 → 粘贴给 LLM
第 2 步：描述你的开发任务
第 3 步：LLM 会回复是否命中经验
   ├── 未命中 → 直接写代码（结束）
   └── 命中   → LLM 问你要不要看详情
第 4 步：回复「是」
第 5 步：打开对应文件，全文复制发给 LLM
第 6 步：LLM 检查冲突 + 给修正建议 → 再写代码
```

## 如何添加新经验

踩坑后告诉 LLM：
> 把这条经验加进规则库：
> - 领域：XXX
> - 触发场景：XXX
> - ❌ 错误写法：XXX
> - ✅ 正确写法：XXX
> - ⚠️ 边界情况：XXX

然后手动：
1. 在 `00-SUMMARY.md` 表格加一行
2. 新建对应的 details 文件（复制现有文件的格式）

## 配合 Cursor / Claude Code 使用（进阶）

| 工具 | 操作 |
|------|------|
| Cursor | 把 `00-SUMMARY.md` 内容放进 `.cursor/rules/` 下 `alwaysApply: true` 的 `.mdc` 文件 |
| Claude Code | 把 `00-SUMMARY.md` 内容放进项目根目录 `CLAUDE.md` |

配置后连 SUMMARY 都不用每次手动发，Agent 自动注入。

## Token 消耗参考

| 场景 | 消耗 |
|------|------|
| 仅发 SUMMARY + 任务描述（未命中） | ~300-700 token |
| 追加 1 个 details 文件（命中） | +300-500 token |
| 传统方式（全文粘贴 + 多轮调试） | 通常 3000-10000+ token |
| **预计节省** | **50%-80%** |
