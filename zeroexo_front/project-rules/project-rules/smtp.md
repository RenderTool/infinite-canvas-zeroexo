# SMTP 经验：配置状态查询陷阱

## ❌ 错误写法
```ts
// 应用启动时立即读取 SMTP 配置
const transporter = nodemailer.createTransport({
  host: config.smtp.host,     // 如果 config 是异步加载的，这里可能是 undefined
  port: config.smtp.port,
});
```

## ✅ 正确写法
```ts
// 方案1：确保配置加载完成后再初始化
await config.load(); // 显式等待
const transporter = nodemailer.createTransport(config.smtp);

// 方案2：懒初始化（推荐）
let transporter: Transporter | null = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport(config.smtp);
  }
  return transporter;
}
```

## ⚠️ 边界情况
- 在 NestJS 中，ConfigService 是同步的，但如果配置来自 .env 文件且使用 @nestjs/config 的异步加载（如 TypeORM 配置），需要确认模块初始化顺序
- 测试环境中 SMTP 常被 mock，直接检查 `config.smtp.host` 可能得到空字符串而非 null，条件判断要用 `!config.smtp?.host` 而非 `config.smtp === null`
- Docker 环境中 SMTP 配置可能通过环境变量注入，容器启动顺序可能导致首次读取时环境变量尚未就绪
- OAuth2 认证方式（如 Gmail）需要定期刷新 access token，建议用 `nodemailer.createTransport` 的 `auth` 回调方式动态获取 token
- 连接池配置（`pool: true`）在高并发发送时可能导致连接耗尽，需要合理设置 `maxConnections` 和 `maxMessages`
