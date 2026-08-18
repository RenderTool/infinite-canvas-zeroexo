# Session Lock Service 废弃策略

## 废弃原因

会话锁（session-lock-service）已被 Yjs + Hocuspocus 实时协作方案完全替代。

### 对比

| 特性 | 会话锁（已废弃） | Yjs（当前方案） |
|------|----------------|----------------|
| 多标签页 | 互斥独占，后开的踢先开的 | CRDT 自动合并，多标签页共存 |
| 同步机制 | HTTP heartbeat（10s 轮询） | WebSocket 长连接，实时推送 |
| 冲突处理 | 弹窗强制刷新，清本地再拉云 | CRDT 就地合并，无冲突 |
| 离线兜底 | 后端 TTL 90s 自动释放 | WebSocket 断线重连后自动合并 |
| 标签页恢复 | `validateCurrentSession()` 检测 | 自动重连 Yjs 文档 |

### 废弃影响

- 后端 `POST/PUT/DELETE /projects/:id/session/...` 端点已移除
- 后端 `RedisService.setSessionLock/getSessionLock/refreshSessionLock/deleteSessionLock` 方法已移除
- 前端 `session-lock-service.ts` 所有导出函数已失效
- `sessionTakenOverRef` 不再需要（Yjs 允许多标签页共存）
- 不再需要 `broadcastSessionTakenOver` 事件

## 文件保留说明

`session-lock-service.ts` 保留在 deprecated 目录中作为参考，不再被任何代码引用。