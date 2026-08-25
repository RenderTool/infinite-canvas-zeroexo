# ai-generate 单元测试

无框架依赖的自测脚本，覆盖视频模板 DSL v2 的核心链路。

## 运行方式

```bash
# 方式一（推荐）：tsc 编译后运行（与项目 nest build 运行方式一致）
npx tsc
node dist/modules/ai-generate/tests/video-dsl.unit.js

# 方式二：ts-node 直接运行
# 注意：ts-node 在 Node 24 下无法解析项目内的 .js 后缀 import，若报
# "Cannot find module ... .js" 请改用方式一
npx ts-node src/modules/ai-generate/tests/video-dsl.unit.ts
```

## 覆盖范围（video-dsl.unit.ts，66 个断言）

| # | 测试组 | 覆盖点 |
|---|--------|--------|
| 1 | resolvePath | 点路径解析（含数组下标、嵌套、缺失路径、null/空入参） |
| 2 | kling-signer | JWT 三段式、HS256 签名向量、exp/nbf、认证头组装（bearer/header/alsoBearer/kling-hmac） |
| 3 | validateTemplateDefinition | 必填字段、纯参数模板放行、advanced 可选字段透传、内网/非 http(s) endpoint、task 子字段、auth.type、request.bodyStyle 校验 |
| 4 | executor content+task | Seedance 等价路径：content 数组构建、首尾帧 role、mode→task 翻译、轮询、下载 |
| 5 | executor flat+sync | OpenAI 兼容中转：参数平铺、素材数组字段、header 认证、同步解析 |
| 6 | executor 兜底 | 无 DSL 模板 → POST /videos/generations，b64_json 直接解码 |
| 7 | executor 失败态 | 轮询到 failed 状态抛错 |
| 8 | executor SSRF | endpoint / pollUrlTemplate 内网地址拒绝 |
| 9 | executor kling-hmac | Kling 官方直连：JWT 认证 + data.task_id 轮询 + 嵌套 resultPath |
| 10 | VolcengineAdapter | mode=video-edit → task=edit、强制 ratio=adaptive/duration=-1、reference_video role |

## 相关文件

- [video-executor.ts](../adapters/video-executor.ts) — 通用视频执行器（body 组装 / 认证 / 提交 / 轮询 / 下载）
- [resolve-path.ts](../adapters/resolve-path.ts) — 点路径解析器
- [kling-signer.ts](../adapters/kling-signer.ts) — AK/SK HMAC-SHA256 JWT 签名器
- [registry.service.ts](../templates/registry.service.ts) — 模板库 + validateTemplateDefinition 校验器
- [volcengine.adapter.ts](../adapters/volcengine.adapter.ts) — Seedance 适配器（mode→task 内联翻译）
