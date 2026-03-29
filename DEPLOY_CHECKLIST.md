# Deploy Checklist

## 1. 环境准备

- 使用 Node.js `>=20`
- 已配置 `.env` 或等价的生产环境变量
- 如果目标是完整聊天体验，必须配置 `DEEPSEEK_API_KEY`
- 生产环境建议配置 `SESSION_TOKEN_SECRET`

## 2. 配置自检

完整模式：

```bash
npm run preflight
```

严格生产模式：

```bash
npm run preflight:prod
```

允许降级模式：

```bash
npm run preflight:degraded
```

## 3. 本地回归

```bash
npm run test:reply
```

如果服务已经启动，再跑一次聊天冒烟：

```bash
npm run smoke:chat
```

## 4. 启动服务

```bash
npm run start
```

或使用 Docker：

```bash
docker build -t book-of-elon .
docker run --rm -p 3000:3000 --env-file .env book-of-elon
```

如果使用 PM2：

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
pm2 status
```

如果 `pm2 startup` 输出了一条 `sudo` 命令，需要额外执行那条命令，才能真正完成开机自启绑定。

## 5. 健康检查

- 打开 `http://localhost:3000/health`
- 打开 `http://localhost:3000/ready`

期望：

- `/health` 返回 `status=ok`
- `/ready` 返回 `ready=true`
- 如果是完整聊天模式，`llmEnabled=true`
- 如果已挂 Nginx，再补一次 `curl http://127.0.0.1`，确认反向代理也通

## 6. 页面联调

- 首页能正常打开
- `最火的 6 张卡` 可点击
- `直接开始提问` 可发送消息
- 主题库展开正常
- `starter_questions` 可直接点击发问
- 匿名续聊入口按预期显示/隐藏

## 7. 聊天链路确认

- 正常情况下，对话可返回模型回复
- 异常情况下，会出现轻量降级提示，而不是技术模式切换标签
- `/config.js` 必须通过同源服务提供，不能只丢静态文件
- 直接跨站或裸调 `/api/chat` 会被服务端拒绝
- 浏览器长时间等待时不会无限转圈，超时后会回落到本地知识回复

## 8. 上线前确认

- 已启用 HTTPS / 反向代理
- 已确认日志输出可被平台采集
- 已明确当前部署是单实例还是多实例
- 如果是多实例，知道当前限流/缓存仍是内存级，不是共享状态
- 已执行 `curl -I http://你的域名` 与 `curl -I https://你的域名`，确认 HTTPS 生效且跳转符合预期
- 已确认 `pm2 save` 与 `pm2 startup` 完成，服务器重启后服务可恢复
- 已确认有人或某个平台在实际查看 `pm2 logs` / 平台日志，而不只是理论上“可采集”

实际操作步骤可参考 `DEPLOY_RUNBOOK.md`。
