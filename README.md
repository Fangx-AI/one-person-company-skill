# Book of Elon

中文互动 AI 教练站点。线上：[bookofelon.cn](https://bookofelon.cn)

| 入口 | 看什么 |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 系统拓扑 / 数据流 / 关键决策（**改东西前必读**） |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | 部署 / 烟测 / 回滚 / 备份 / 监控（**单一信源**） |
| [`docs/runbooks/`](docs/runbooks/) | 救火手册（cost spike / pm2 errored / 等） |
| [`docs/security/audits/`](docs/security/audits/) | CSO 安全审计 |
| [`docs/superpowers/audits/`](docs/superpowers/audits/) | 项目整体审计与改造路线 |
| [`CLAUDE.md`](CLAUDE.md) | 给未来 AI agent 的驾驶员手册 |

---

## 一句话定位

- 前端：静态 HTML + CSS + 原生 JS（极简 Perplexity 风格）
- 后端：Node.js 单进程（`server.js`），SQLite (`better-sqlite3`)，PM2 + Nginx
- 模型：DeepSeek 代理（`prompts/system-prompt-v2.md` 风格），失败自动本地降级
- 账号：手机号 + 阿里云短信 OTP，无密码，HMAC-SHA256 无状态 cookie
- 记忆：登录用户的"北极星目标 + 关键 facts"会被注入下一次对话的 system prompt
- 成本守门：三道闸（全站日 token / 单 IP / 匿名 session）+ 输入长度收紧

---

## 60 秒本地启动

```bash
# 1. Node ≥ 20
node -v

# 2. 装依赖（注意：用 npm ci，better-sqlite3 是 native 模块）
npm ci

# 3. 配置环境变量
cp .env.example .env
# 至少改：DEEPSEEK_API_KEY / USER_SESSION_SECRET / SESSION_TOKEN_SECRET
# 生成 secret：node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. 初始化数据库（首次必须）
npm run db:init

# 5. 启动
npm run dev

# 浏览器：http://localhost:3000
```

> 本地 SMS 默认走 mock：验证码会出现在 HTTP 响应的 `devCode` 字段，方便登录调试。
> 生产**必须**配 `SMS_PROVIDER=aliyun` 全套，否则 `preflight:prod` 会拒启动。

完整环境变量列表见 [`.env.example`](.env.example)；
完整部署流程见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

---

## 常用脚本

| 命令 | 用途 |
|---|---|
| `npm run dev` | 本地启动 |
| `npm run preflight:prod` | 生产环境完整性自检（部署前） |
| `npm run smoke:chat` | `/api/chat` 走通烟测 |
| `npm run cost:smoke` | 三道闸成本守门冒烟（30 个断言） |
| `npm run prompt:smoke` | system prompt 注入防护 |
| `npm run static:smoke` | 静态文件白名单生效 |
| `npm run auth:smoke` | 登录全流程（**仅 mock 模式**） |
| `npm run persist:smoke` | 聊天原子落库 + claim |
| `npm run northstar:smoke` | 北极星目标读写 + dashboard |
| `npm run test:e2e` | 30 个断言端到端（大改之后跑） |
| `npm run db:backup` | 手动备份一次（gzip + 轮转） |
| `npm run db:migrate` | 迁移 dry-run |

完整脚本说明见 `package.json` + [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §4（Smoke tests）。

---

## 健康检查

```bash
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
```

返回里关键字段：

```json
{
  "status": "ok",
  "db":   { "status": "ok", "counts": {...} },
  "llm":  { "status": "ok", "circuit_open": false },
  "cost": { "global": { "tokens_used": ..., "tokens_budget": 2000000 } }
}
```

详细告警建议见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §7（Monitoring）。

---

## 生产部署 30 秒摘要

```bash
ssh root@bookofelon.cn
cd /root/skill_The_book_of_Elon
bash scripts/ops/deploy.sh
```

完整流程（首次装机 / 例行发布 / 回滚 / 备份）见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。
救火（钱被烧 / DB 报错 / PM2 errored）见 [`docs/runbooks/`](docs/runbooks/)。

---

## 状态徽章

- Node.js `>=20`（生产跑 22.x）
- DB：SQLite WAL，单机
- 进程：PM2 单实例（`book-of-elon` + `book-of-elon-monitor`）
- 反代：Nginx + Let's Encrypt
- 监控：`/api/health` + 独立监控页（`monitor-server.js`，仅 127.0.0.1:3201）
- 备份：cron 每 4h 一次，gzip + 轮转

更详细的当前架构姿态见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
