// OpenTelemetry 追踪引导 - 必须在所有其它模块加载之前导入,
// 以便 NodeSDK 在 require 阶段完成自动埋点 hook。
import './observability/tracing';

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import { AppModule } from './app.module';
import { SyncService } from './modules/sync/sync.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

// BigInt 序列化(Prisma BigInt 字段需转字符串,否则 JSON.stringify 报错)
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (): string {
  return String(this);
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // 禁用默认 body parser,手动配置以支持大 payload(画布 graph 含 base64 图片)
    bodyParser: false,
  });
  // 全局路由前缀 /api(影响所有 NestJS 控制器路由)
  app.setGlobalPrefix('api');
  // 反向代理信任设置: 读取 TRUST_PROXY 控制信任层数(默认 1),
  // 使 req.ip / X-Forwarded-For 在反代部署下取到真实客户端 IP(IP 限流依赖真实地址)
  const trustProxyRaw = process.env.TRUST_PROXY ?? '1';
  const trustProxy = Number.isNaN(Number(trustProxyRaw)) ? 1 : Number(trustProxyRaw);
  app.set('trust proxy', trustProxy);
  // CORS - 允许前端跨域访问(CORS_ORIGINS 逗号分隔)
  const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5180,http://localhost:8080').split(',');
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // JSON body parser(限额 50MB,覆盖画布 graph 含 base64 图片的推送场景)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // 本地文件存储:对 /api/storage/put 启用 raw body 解析(接收任意 Content-Type 的二进制)
  // 限额 200MB,覆盖图片/音频/短视频等本地测试场景
  app.use(
    '/api/storage/put',
    express.raw({ type: '*/*', limit: '200mb' }),
  );

  // 全局验证管道(白名单过滤 + 自动类型转换)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // 全局异常过滤器
  app.useGlobalFilters(new AllExceptionsFilter());
  // 全局响应转换拦截器(统一 { data } 格式)
  app.useGlobalInterceptors(new TransformInterceptor());
  // Swagger 文档
  const config = new DocumentBuilder()
    .setTitle('ZeroExo API')
    .setDescription('ZeroExo 后端服务接口文档')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 3000;

  // 挂载 Yjs 实时同步（Hocuspocus 复用现有 HTTP server 的 upgrade 事件）
  const syncService = app.get(SyncService);
  syncService.attach(app.getHttpServer());

  await app.listen(port);
  Logger.log(`Server: http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Docs:   http://localhost:${port}/api/docs`, 'Bootstrap');

}

bootstrap();
