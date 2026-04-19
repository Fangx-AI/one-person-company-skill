# Deploy Checklist

## 1. 环境准备

- 使用 Node.js `>=20`
- 已配置 `.env` 或等价的生产环境变量
- 如果目标是完整聊天体验，必须配置 `DEEPSEEK_API_KEY`
- **必须**配置 `USER_SESSION_SECRET`（账号系统签名密钥，64 位 hex）
- **必须**配置 `SESSION_TOKEN_SECRET`（匿名 chat token 签名）
- **必须**配置 `SMS_PROVIDER=aliyun` + `ALIYUN_ACCESS_KEY_ID` + `ALIYUN_ACCESS_KEY_SECRET` + `ALIYUN_SMS_SIGN_NAME` + `ALIYUN_SMS_TEMPLATE_CODE`，否则验证码会以明文返回

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
- 聊天落库失败时，响应里 `persistence_ok=false`，前端会弹一个橙色 toast

## 7.5 账号系统确认

- 用真手机号点"登录"，确认能在 30 秒内收到 6 位验证码（并且短信落款是审核通过的签名，不是 `<请填真签名>`）
- 输入验证码后能进入"我的路径"
- "我的路径"右上角能看到 totalChatTurns / sessions / facts
- **登录前聊的对话**应该能在登录后的 dashboard 里看到（`claimAnonSessions` 工作）
- 登出后再登入，DB 里的对话历史仍然在
- `/api/me/import-local-session` 应该返回 404（确认接口已撤回）

## 7.6 数据持久化确认

- `./data/app.db` 文件存在且有合理大小
- `./data/backups/` 里有最近的 `.db.gz`（确认 cron 在跑）
- `crontab -l` 里有 `node scripts/backup-db.js`
- `tail -f /var/log/boe-backup.log` 能看到正常输出，没有 `Error`

## 7.7 安全确认

- `.env` 不在 Git 历史里（`git log --all --full-history -- .env`）
- Aliyun AccessKey 是专用 RAM 子账号的，权限只有 SMS（最小权限原则）
- 如果有泄漏过的旧 AccessKey，已经在阿里云控制台**禁用并删除**（不只是禁用）
- `MONITOR_USERNAME` / `MONITOR_PASSWORD` 不是默认占位值

## 8. 上线前确认

- 已启用 HTTPS / 反向代理
- 已确认日志输出可被平台采集
- 已明确当前部署是单实例还是多实例
- 如果是多实例，知道当前限流/缓存仍是内存级，不是共享状态
- 已执行 `curl -I http://你的域名` 与 `curl -I https://你的域名`，确认 HTTPS 生效且跳转符合预期
- 已确认 `pm2 save` 与 `pm2 startup` 完成，服务器重启后服务可恢复
- 已确认有人或某个平台在实际查看 `pm2 logs` / 平台日志，而不只是理论上“可采集”

实际操作步骤可参考 `DEPLOY_RUNBOOK.md`。
