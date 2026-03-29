# Deploy Runbook

这是一份适合当前项目的单机上线步骤，默认目标环境为：

- Linux 服务器
- Node.js `>=20`
- `PM2` 托管 Node 进程
- `Nginx` 做反向代理
- HTTPS 域名访问

## 1. 准备服务器

确认服务器已经安装：

- `git`
- `node`
- `npm`
- `pm2`
- `nginx`

如果没有 `pm2`：

```bash
npm install -g pm2
```

## 2. 拉取项目

```bash
git clone <your-repo-url> book-of-elon
cd book-of-elon
```

如果不是 Git 部署，至少确保服务器目录里包含：

- `server.js`
- `index.html`
- `styles.css`
- 所有前端脚本文件
- `package.json`
- `ecosystem.config.js`

## 3. 配置环境变量

建议以生产模板为起点：

```bash
cp .env.production.example .env
```

然后填写真实值，至少确认：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL`
- `PORT`
- 各类超时、限流、缓存参数

## 4. 上线前自检

严格生产模式自检：

```bash
npm run preflight:prod
```

本地回复校准：

```bash
npm run test:reply
```

## 5. 启动服务

使用 `PM2`：

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
pm2 status
```

如果 `pm2 startup` 输出了一条带 `sudo` 的命令，需要把那条命令也执行掉，开机自启才算真正完成。

查看日志：

```bash
pm2 logs book-of-elon
```

如果机器重启后需要手动恢复进程列表，可以执行：

```bash
pm2 resurrect
pm2 status
```

## 6. 健康检查

在服务器本机先检查：

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

期望：

- `/health` 返回 `status=ok`
- `/ready` 返回 `ready=true`
- 如果是完整聊天模式，`llmEnabled=true`

## 7. 配置 Nginx

仓库内已提供示例文件：

- `nginx.book-of-elon.conf.example`

把其中域名替换成你的真实域名后，放到 Nginx 配置目录，再 reload：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 8. HTTPS

如果你使用 `certbot`：

```bash
sudo certbot --nginx -d your-domain.com
```

证书签发后，建议立刻验证：

```bash
curl -I http://your-domain.com
curl -I https://your-domain.com
```

确认两件事：

- `https://` 可访问
- `http://` 是否按你的预期跳到 `https://`

## 9. 线上冒烟

本机冒烟：

```bash
npm run smoke:chat
```

浏览器联调：

- 首页可打开
- 卡片能进入详情
- 卡片详情摘要可见，对话进行中仍能看到简要卡片语境
- `starter_questions` 可点击
- 直接提问可返回回答
- 匿名续聊正常
- 主题库展开正常
- 异常时会显示轻量降级提示

## 10. 上线后观察

重点看：

- `pm2 logs book-of-elon`
- Nginx access/error log
- `OBSERVABILITY.md` 里定义的事件

重点关注：

- `server_failed_to_listen`
- `upstream_request_failed`
- `request_completed`
- `slowRequest=true`
- `degraded=true`

同时至少做一次“日志链路确认”：

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

然后确认 `pm2 logs book-of-elon` 或你的日志平台里确实出现了新的 `request_completed` 记录。

## 11. 备份与回滚

最低限度建议备份这些东西：

- 项目目录
- `.env`
- Nginx 站点配置
- 证书相关目录

一次最简单的备份方式：

```bash
cp .env ".env.backup.$(date +%Y%m%d-%H%M%S)"
sudo cp /etc/nginx/sites-available/default "/etc/nginx/sites-available/default.backup.$(date +%Y%m%d-%H%M%S)"
```

如果你准备更新代码，建议先留一个旧版本目录，例如：

```bash
cp -r /root/skill_The_book_of_Elon "/root/skill_The_book_of_Elon.backup.$(date +%Y%m%d-%H%M%S)"
```

如果更新后出问题，最快的回滚方式就是：

1. 停掉当前进程
2. 切回上一份备份目录
3. 重新 `pm2 start ecosystem.config.js`
4. 再做一次 `/health` 和 `/ready` 检查

## 12. 当前架构边界

这套 runbook 适合当前的一台服务器单实例上线。

如果后面要放量到多实例，需要先补：

- 共享缓存
- 共享限流
- 更明确的日志平台与告警接入
