# 开发经验索引

你是我的开发助手。每次收到本文件后，请按以下流程执行：

1. 阅读下方表格，将本次需求与「触发场景」做关键词匹配
2. 若命中某行 → 告诉我「命中了 XXX 经验，需要我读取 details 文件确认冲突吗？」
3. 我回复「是」后，我会把对应文件的内容发给你
4. 你检查冲突 → 主动告知风险 + 修正建议 → 然后再写代码
5. 若未命中 → 直接开始开发，不要再问

| # | 领域 | 触发场景关键词 | 详情文件 |
|---|------|---------------|----------|
| 1 | SMTP 邮箱服务 | SMTP, nodemailer, 邮箱验证码, 邮件配置, enabled, 连通测试 | smtp.md |
| 2 | API 响应解析 | fetch, response.json, axios, Unexpected end of JSON, 接口请求 | api-patterns.md |
| 3 | 国际化 | i18n, t(), useTranslation, 翻译key, locale, passwordReset | i18n.md |
| 4 | CSS 布局/缩放 | flex, resize, 拖拽宽度, textarea高度, flexbox, overflow | css-layout.md |
| 5 | 节点画布坐标 | 节点缩放, PIN, 标题跳变, invK, nodeScale, viewport, transform | node-scaling.md |
| 6 | 交互性能优化 | 图片查看器, 卡顿, pan/zoom, will-change, RAF, mousemove频率 | interaction-perf.md |