> **⚠️ ARCHIVED 2026-04-27 — see [docs/DEPLOYMENT.md §B](../DEPLOYMENT.md#b-observability-reference合自原-observabilitymd) instead.**
>
> 这份观测指南已被合并进 `docs/DEPLOYMENT.md` §B（Observability reference）。
> 保留仅供历史溯源。归档目录说明见 [archive/README.md](./README.md)。

---

# Observability Guide

## 当前日志形态

服务端现在会输出两类 JSON 日志：

- `type=event`
- `event=request_completed`

所有日志都适合直接接入日志平台或托管平台日志采集。

## 重点事件

### 启动类

- `startup_validation_failed`
- `startup_validation_warning`
- `server_listening`
- `server_failed_to_listen`
- `server_shutdown_requested`

### 请求类

- `request_completed`

重点字段：

- `statusCode`
- `durationMs`
- `slowRequest`
- `route`
- `provider`
- `cacheHit`
- `degraded`
- `error`

### 上游异常

- `upstream_request_failed`

### 兜底异常

- `server_request_unhandled_error`

### 安全拒绝

- `chat_request_rejected`

重点字段：

- `reason`
- `requestId`
- `clientIp`

## 建议告警规则

### P0

- 5 分钟内 `server_failed_to_listen` 出现
- 5 分钟内 `upstream_request_failed` 激增
- `/ready` 长时间返回 `degraded=true`
- 5 分钟内 `chat_request_rejected` 激增

### P1

- `request_completed` 中 `slowRequest=true` 比例持续升高
- `degraded=true` 比例持续升高
- `statusCode >= 500` 持续出现

## 建议观察指标

- 总请求量
- `/api/chat` 请求量
- `chat_request_rejected` 量
- 429 比例
- 5xx 比例
- `degraded` 比例
- `cacheHit` 比例
- 慢请求比例
- 上游失败码分布

## 最低落地方式

如果你暂时还没有正式日志平台，至少做到：

- 用 `pm2 logs book-of-elon` 持续看应用日志
- 同时观察 Nginx access/error log
- 明确谁在负责看这些日志，不要停留在“理论上能看到”

如果你已经接入云平台日志服务，至少确认：

- stdout 已被采集
- JSON 日志没有被截断或改写成纯文本
- 可以按 `event`、`requestId`、`statusCode`、`degraded` 过滤

## 上线后验证

上线当天建议主动打一轮最小验证流量：

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

然后确认日志里真的出现：

- `request_completed`
- 正确的 `route`
- 合理的 `statusCode`
- 对应的 `requestId`

如果你已经绑定域名和 HTTPS，再补一次：

```bash
curl -I http://your-domain.com
curl -I https://your-domain.com
```

确认访问链路、跳转和证书状态都能在日志或平台里被看到。

## 当前边界

- 日志仍输出到标准输出
- 没有内置外部告警平台
- 多实例时仍需结合平台日志聚合使用
