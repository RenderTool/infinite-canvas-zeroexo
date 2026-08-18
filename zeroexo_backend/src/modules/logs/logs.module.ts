/**
 * LogsModule - 后台日志模块
 *
 * 装配 LogsService + LogsController。
 * 全局 HTTP 日志拦截器(LoggingInterceptor)通过 APP_INTERCEPTOR 在此注册,
 * 自动捕获所有请求并写入日志。
 */

import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LogsService } from './logs.service';
import { LogsController } from './logs.controller';
import { LoggingInterceptor } from '../../common/interceptors/logging.interceptor';

@Module({
  controllers: [LogsController],
  providers: [
    LogsService,
    // 注册全局 HTTP 日志拦截器(自动捕获所有请求)
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
  exports: [LogsService],
})
export class LogsModule {}
