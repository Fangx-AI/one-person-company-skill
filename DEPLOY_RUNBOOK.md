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

### 必填的账号系统密钥

```bash
# 生成一个 64 位 16 进制随机串，写入 .env
SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "USER_SESSION_SECRET=$SECRET" >> .env
```

**警告**：`USER_SESSION_SECRET` 一旦上线**不要再改**，否则所有用户登录态
会立即失效，需要重新短信验证。如果丢了，你只能重新生成一个，并通知用户重登。

### 必填的 Aliyun 短信

```env
SMS_PROVIDER=aliyun
ALIYUN_ACCESS_KEY_ID=LTAIxxxxxxxxxxxxxxxx
ALIYUN_ACCESS_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx
ALIYUN_SMS_SIGN_NAME=方智云创                # 阿里云审核通过的签名
ALIYUN_SMS_TEMPLATE_CODE=SMS_xxxxxxxx        # 已审核通过的模板编号
```

如果不配置 `SMS_PROVIDER` 或 `ALIYUN_*` 任何一项缺失，服务器会退回 mock 模式：
**验证码会以明文出现在 `/api/auth/send-code` 的响应 body 里**。生产环境
绝对不能允许这种情况，`npm run preflight:prod` 会拦住缺配置的启动。

### 数据库初始化

第一次部署或换机器：

```bash
npm run db:init
```

每次部署：服务进程启动时会自动跑 `db/auto-migrate.js`，缺表/缺列幂等补齐，
不需要手工。也可以提前 dry-run 看一下：

```bash
npm run db:migrate          # dry-run，只打印
npm run db:migrate:apply    # 真跑（会先备份）
```

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

本机冒烟（按推荐顺序跑一遍）：

```bash
npm run smoke:chat        # /api/chat 走通
npm run auth:smoke        # 短信发送 / 验证码 / 登录 / 登出（mock 模式才能跑）
npm run persist:smoke     # 聊天落库 + claim
npm run northstar:smoke   # 北极星目标 + dashboard
```

> `auth:smoke` 只能在 `SMS_PROVIDER=mock` 下跑，因为它要从响应里读 devCode。
> 生产环境不能临时切到 mock，所以这条只在 staging 或 dev 跑。
> 真要在生产验证短信，最直接的办法是用真手机号走一遍登录页面。

完整端到端 30 个断言（建议在 staging 跑）：

```bash
# 启动一个隔离 dev server，参数见脚本顶部注释
$env:E2E_BASE='http://localhost:3033'
node scripts/e2e-full-flow.js
# 或者
npm run test:e2e
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
- **登录走通**：手机号 → 收到真短信 → 6 位验证码 → 进入"我的路径"
- **持久化走通**：登录前聊一条 → 登录 → 在右上角"我的路径"里能看到那条对话
- **AI 记忆走通**：登录后再聊一条 → 退出账号 → 重登 → AI 还能模糊记得你之前说过什么

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
- **`./data/app.db` —— 用户和对话全在这里**

一次最简单的配置备份方式：

```bash
cp .env ".env.backup.$(date +%Y%m%d-%H%M%S)"
sudo cp /etc/nginx/sites-available/default "/etc/nginx/sites-available/default.backup.$(date +%Y%m%d-%H%M%S)"
```

### 数据库自动备份（必做）

仓库里的 `scripts/backup-db.js` 用 SQLite 的 `.backup()` API 做热备份，
然后 gzip + 轮转。挂一条 cron：

```bash
( crontab -l 2>/dev/null; \
  echo "0 */4 * * * cd /root/skill_The_book_of_Elon && /usr/bin/node scripts/backup-db.js >> /var/log/boe-backup.log 2>&1" \
) | crontab -
crontab -l
```

每 4 小时一次，备份文件落到 `./data/backups/app-<ISO timestamp>.db.gz`，
默认保留最近若干份（看脚本里的 `RETAIN_COUNT`）。建议同时把 `./data/backups/`
目录定期 rsync 到一个异地（比如 OSS 或者另一台机器）。

如果你要改代码 / 升级，建议先留一个旧版本目录：

```bash
cp -r /root/skill_The_book_of_Elon "/root/skill_The_book_of_Elon.backup.$(date +%Y%m%d-%H%M%S)"
```

如果更新后出问题，最快的回滚方式就是：

1. 停掉当前进程：`pm2 stop book-of-elon`
2. 切回上一份备份目录
3. 如果数据有损坏，从 `./data/backups/` 拿一份 `.db.gz` 解压回 `./data/app.db`
4. 重新 `pm2 start ecosystem.config.js` 或 `pm2 reload book-of-elon`
5. 再做一次 `/health` 和 `/ready` 检查

## 11.5 一键部署脚本

仓库内 `scripts/deploy.sh` 已经把以下步骤串好：

1. 预检环境（node / pm2 版本、磁盘）
2. 部署前 DB 备份
3. `git pull --ff-only`
4. `npm ci`
5. 迁移 dry-run
6. 迁移 apply
7. `pm2 reload book-of-elon --update-env`
8. 健康检查 + 烟测

服务器上：

```bash
cd /root/skill_The_book_of_Elon
chmod +x scripts/deploy.sh
bash scripts/deploy.sh
```

## 12. 当前架构边界

这套 runbook 适合当前的一台服务器单实例上线。

如果后面要放量到多实例，需要先补：

- 共享缓存
- 共享限流
- 更明确的日志平台与告警接入
