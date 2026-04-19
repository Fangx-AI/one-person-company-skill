# Book of Elon

一个基于《The Book of Elon》的中文互动知识卡片与对话站点。

## 当前形态

- 前端：静态 HTML + CSS + 原生 JavaScript（极简 Perplexity 风格对话视图）
- 服务端：`Node.js` 单进程服务
- 模型：通过 `/api/chat` 代理 `DeepSeek`，回复风格为 Elon 强势版（`prompts/system-prompt-v2.md`）
- 降级：模型不可用时自动退回本地知识回复
- **账号系统**：手机号 + 阿里云短信验证码登录，无密码
- **持久化**：`SQLite` 存放用户、会话、消息、北极星目标、AI 抽取的关键事实
- **数据归户**：用户登录后，匿名期间聊的对话会自动 `claim` 到账号下（同浏览器）
- **跨会话记忆**：用户的"路径"（北极星目标 + 关键事实）会被注入到下一次对话的 system prompt

## 环境要求

- Node.js `>=20`
- 生产部署还需要：阿里云短信、域名、HTTPS、PM2、Nginx

## 本地启动

1. 复制环境变量模板并填写：

```bash
copy .env.example .env
```

如果你是按正式上线环境准备，建议直接参考：

```bash
copy .env.production.example .env
```

2. 至少配置（最小可跑）：

```env
DEEPSEEK_API_KEY=your_key
DEEPSEEK_MODEL=deepseek-chat
PORT=3000

# 账号系统签名密钥（必填）。生成方式：
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 一旦修改，所有线上用户的登录态会立即失效。
USER_SESSION_SECRET=64_hex_chars_or_more
```

> 不配置 Aliyun SMS 时，开发环境会自动走 mock：发送验证码后，验证码会
> 直接出现在 HTTP 响应的 `devCode` 字段里，方便本地登录调试。
> 生产环境必须配置 `SMS_PROVIDER=aliyun` + `ALIYUN_*` 一整套，详见
> `.env.example`。

3. 初始化数据库（第一次跑必须）：

```bash
npm run db:init
```

之后每次启动服务时会自动运行迁移（`db/auto-migrate.js`），新增的表/列会
被幂等补齐，不需要手动维护。

4. 启动服务：

```bash
npm run dev
```

5. 打开：

`http://localhost:3000`

## 常用脚本

### 启动 / 自检

- `npm run dev` / `npm run start`：本地启动服务
- `npm run preflight`：按完整聊天模式做上线前自检
- `npm run preflight:degraded`：允许本地降级模式的自检
- `npm run preflight:prod`：按严格生产模式校验所有关键环境变量
- `npm run start:monitor`：启动独立监控后台

### 回复质量

- `npm run smoke:chat`：对 `/api/chat` 做一次冒烟请求
- `npm run test:reply`：运行本地回复校准脚本
- `npm run test:deepseek`：运行 DeepSeek 评测脚本

### 数据库

- `npm run db:init`：首次初始化（创建 schema + 索引）
- `npm run db:smoke`：基础 CRUD 冒烟（用 `data/test.db`）
- `npm run db:migrate`：迁移 dry-run，打印将要执行的 ALTER TABLE
- `npm run db:migrate:apply`：实际跑一次迁移（部署脚本会自动调）
- `npm run db:backup`：手动跑一次备份（gzip + 轮转，留最近 N 份）

### 账号 / 持久化测试

- `npm run auth:smoke`：短信发送 / 验证码 / 登录 / 登出 全流程冒烟
- `npm run persist:smoke`：聊天消息原子落库 + claim 流程冒烟
- `npm run northstar:smoke`：北极星目标读写 + dashboard 冒烟
- `npm run test:e2e`：**端到端 30 个断言**，覆盖匿名 → 聊 → 登录 → claim → dashboard → logout → import 接口已撤回 → OTP 熵质量。  
  **跑法**：先开一个隔离 dev server（见 `scripts/e2e-full-flow.js` 顶部注释），再跑这条命令。

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

## 数据持久化与备份

- 默认 SQLite 文件 `./data/app.db`，可用 `SQLITE_DB_PATH` 覆盖
- WAL 模式（`db/database.js`），多读单写
- 启动时自动跑 `db/auto-migrate.js`：缺表/缺列会被幂等补齐，`fail-fast`，schema 不一致直接拒绝启动
- 聊天落库走 `db/sessions.js::appendTurn` —— 一个事务里写 user 消息、assistant 消息、`turn_count` 更新，杜绝半截写入
- 任何持久化失败都会在 `/api/chat` 响应里带 `persistence_ok=false` + `persistence_reason`，前端会弹一个橙色 toast 提醒用户

### 备份

- 手动一次：`npm run db:backup`
- 生产建议挂一条 cron，每 4 小时备一次（`scripts/backup-db.js` 自带轮转 + gzip）：

```cron
0 */4 * * * cd /root/skill_The_book_of_Elon && /usr/bin/node scripts/backup-db.js >> /var/log/boe-backup.log 2>&1
```

备份文件落在 `./data/backups/app-<ISO timestamp>.db.gz`。

## 生产部署注意

- 页面必须通过 `server.js` 同源提供，才能正确注入 `/config.js`
- 如果没有 `DEEPSEEK_API_KEY`，聊天会自动退回本地知识模式
- 当前限流、缓存、熔断状态都在内存里，适合单实例起步，不适合直接多实例放量
- `server.js` 启动时会校验关键配置，发现明显错误会直接退出
- `PM2` 配置默认按单实例启动；如果后续要多实例，需要先补共享限流与共享缓存
- 正式绑定域名后，建议同时验证 `http -> https` 跳转、证书生效以及 `curl -I https://your-domain.com`
- `/api/chat` 现在要求同源页面提供的匿名会话 token；如果直接裸调接口或跨站调用，会被服务端拒绝
- 生产环境**必须**显式设置 `USER_SESSION_SECRET`（账号系统 cookie 签名）和 `SESSION_TOKEN_SECRET`（匿名 chat token），任何一个被改/丢失都会让对应那批用户被踢
- 生产环境**必须**配置 Aliyun 短信，否则会走 mock，验证码会出现在 HTTP 响应里——这是漏出验证码的 P0 安全问题。`preflight:prod` 会拦住这种情况

更完整的上线检查步骤见 `DEPLOY_CHECKLIST.md`。
日志与告警建议见 `OBSERVABILITY.md`。
单机上线步骤见 `DEPLOY_RUNBOOK.md`。
未来 AI agent 接手项目时，先读 `CLAUDE.md`。
