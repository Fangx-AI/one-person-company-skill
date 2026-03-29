# Book of Elon

一个基于《The Book of Elon》的中文互动知识卡片与对话站点。

## 当前形态

- 前端：静态 HTML + CSS + 原生 JavaScript
- 服务端：`Node.js` 单进程服务
- 模型：通过 `/api/chat` 代理 `DeepSeek`
- 降级：模型不可用时自动退回本地知识回复

## 环境要求

- Node.js `>=20`

## 本地启动

1. 复制环境变量模板并填写：

```bash
copy .env.example .env
```

如果你是按正式上线环境准备，建议直接参考：

```bash
copy .env.production.example .env
```

2. 至少配置：

```env
DEEPSEEK_API_KEY=your_key
DEEPSEEK_MODEL=deepseek-chat
PORT=3000
```

3. 启动服务：

```bash
npm run dev
```

4. 打开：

`http://localhost:3000`

## 常用脚本

- `npm run dev`：本地启动服务
- `npm run start`：生产方式启动
- `npm run preflight`：按完整聊天模式做上线前自检
- `npm run preflight:degraded`：允许本地降级模式的自检
- `npm run preflight:prod`：按严格生产模式校验所有关键环境变量
- `npm run smoke:chat`：对 `/api/chat` 做一次冒烟请求
- `npm run test:reply`：运行本地回复校准脚本
- `npm run test:deepseek`：运行 DeepSeek 评测脚本
- `npm run start:monitor`：启动独立监控后台

## Docker 启动

构建镜像：

```bash
docker build -t book-of-elon .
```

运行容器：

```bash
docker run --rm -p 3000:3000 --env-file .env book-of-elon
```

说明：

- 镜像构建阶段会执行 `npm install --omit=dev`
- 即使当前依赖很轻，也建议继续保留这一步，避免后续依赖增长后 Docker 构建与本地运行不一致

## PM2 启动

如果你用 `PM2` 托管进程，可以直接使用仓库内的运行配置：

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

查看状态：

```bash
pm2 status
pm2 logs book-of-elon
```

如果你要启动独立监控后台：

```bash
pm2 start ecosystem.config.js --only book-of-elon-monitor
```

默认监听 `127.0.0.1:3201`，不影响主站 `3000` 端口。建议通过 SSH 隧道或单独加一层 Nginx Basic Auth 后再暴露给浏览器访问。
监控后台要求先配置 `MONITOR_USERNAME` 和 `MONITOR_PASSWORD`，否则会拒绝启动。

如果你已经执行过 `pm2 startup`，可以再运行启动命令中提示的那条 `sudo` 命令完成开机自启绑定。

## 健康检查

- `GET /health`
- `GET /ready`

## 独立监控后台

监控后台是单独的 Node 进程，不会改动主站聊天逻辑。它会读取：

- 主站 `/health`
- 主站 `/ready`
- `pm2 jlist`
- PM2 日志文件中的最近事件

默认地址：

```bash
http://127.0.0.1:3201
```

建议至少配置：

```env
MONITOR_USERNAME=your_monitor_user
MONITOR_PASSWORD=your_monitor_password
```

如果还是示例占位值，监控后台同样会拒绝启动。

如果你要从本地电脑访问服务器上的监控页，可以先做 SSH 端口转发：

```bash
ssh -L 3201:127.0.0.1:3201 root@your-server-ip
```

然后在本地浏览器打开：

```bash
http://127.0.0.1:3201
```

## 生产部署注意

- 页面必须通过 `server.js` 同源提供，才能正确注入 `/config.js`
- 如果没有 `DEEPSEEK_API_KEY`，聊天会自动退回本地知识模式
- 当前限流、缓存、熔断状态都在内存里，适合单实例起步，不适合直接多实例放量
- `server.js` 启动时会校验关键配置，发现明显错误会直接退出
- `PM2` 配置默认按单实例启动；如果后续要多实例，需要先补共享限流与共享缓存
- 正式绑定域名后，建议同时验证 `http -> https` 跳转、证书生效以及 `curl -I https://your-domain.com`
- `/api/chat` 现在要求同源页面提供的匿名会话 token；如果直接裸调接口或跨站调用，会被服务端拒绝
- 生产环境建议显式设置 `SESSION_TOKEN_SECRET`，否则匿名 token 会在每次服务重启后整体失效，用户需要刷新页面

更完整的上线检查步骤见 `DEPLOY_CHECKLIST.md`。
日志与告警建议见 `OBSERVABILITY.md`。
单机上线步骤见 `DEPLOY_RUNBOOK.md`。
