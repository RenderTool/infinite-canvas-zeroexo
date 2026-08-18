/**
 * OpenTelemetry 分布式追踪引导文件
 *
 * 必须在 main.ts 顶部最先 import(在任何 NestJS/Prisma/SDK 加载之前),
 * 这样 NodeSDK 才能在模块加载阶段自动埋点。
 *
 * 启用方式:
 *   1. 设置环境变量 OTEL_ENABLED=true
 *   2. 可选: 设置 OTEL_EXPORTER_OTLP_ENDPOINT 指向 OTLP 接收端(默认 http://localhost:4318/v1/traces)
 *
 * 关闭时(默认)整个文件几乎零开销,不会注册任何追踪上下文。
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: 'zeroexo-backend',
    [SemanticResourceAttributes.SERVICE_VERSION]:
      process.env.APP_VERSION ?? '0.1.0',
  }),
  traceExporter: new OTLPTraceExporter({
    // 默认指向本地 OTLP HTTP 接收器;生产环境通过环境变量覆盖
    url:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      'http://localhost:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

if (process.env.OTEL_ENABLED === 'true') {
  try {
    sdk.start();
    // eslint-disable-next-line no-console
    console.log('[OTel] OpenTelemetry tracing enabled');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[OTel] Failed to start tracing', err);
  }
}

// 进程退出时优雅关闭,避免丢失尚未导出的 span
process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log('[OTel] Tracing shut down (SIGTERM)');
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[OTel] Error during shutdown', err);
    });
});
