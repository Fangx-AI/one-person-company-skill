# Runbook · 静态资源 404 / 前端白屏（static 404）

| | |
|---|---|
| **首次记录** | 2026-04-27 |
| **触发场景** | 用户报"页面打开是白屏 / 卡片不显示 / AI 回答质量明显下降"，但 `/api/health` 是绿的 |
| **当前防护** | `tests/smoke/static-security.js`（CI 集成）+ Wave 3 R-18 GitHub Actions |

---

## 0. 这个 runbook 为什么存在（R-23 的故事）

2026-04-27 发现 `web/book-source.js`（361KB 的书源）在生产 `HTTP/1.1 404 Not Found`。
原因：Phase C-1 把前端搬到 `web/` 时，server.js 的 `STATIC_FILE_ALLOW` 白名单**没有**这条目。
前端 fetch 失败后走本地降级，**用户感知是"AI 不够懂书了"——不是白屏，是悄悄烂掉**。

教训：白名单制 + 静默降级 = 必须用 smoke 测试兜底，肉眼看页面没用。

---

## 0.1 一句话决策树

```
用户报问题 → 浏览器 F12 看 Network
  ├ 大量 404           → §3 STATIC_FILE_ALLOW 缺漏
  ├ 200 但 body 空     → §4 nginx / cdn 缓存坏
  ├ 一切 200 但白屏    → §5 JS 报错（看 Console）
  └ 资源都 200 但慢    → §6 性能（不在本 runbook）
```

---

## 1. 现象判定

任一项进本 runbook：

- 用户报"白屏 / 卡片不出来 / 一直加载"
- 浏览器 F12 Network 看到任何 4xx 5xx 静态请求
- `npm run static:smoke`（`SMOKE_BASE` 指生产）失败
- CI 的 integration-smoke job 红
- AI 回答质量"突然变差"（书源加载失败的间接信号）

---

## 2. 30 秒诊断

```bash
ssh root@8.210.245.109 && sudo -i
cd /root/skill_The_book_of_Elon

# A. 直连 node 看核心资源
for p in /index.html /styles.css /app.js /cards.json /book-source.json \
         /knowledge-base.js /model-client.js /reply-engine.js /auth-ui.js; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code} %{size_download}b" "http://127.0.0.1:3000$p")
  echo "$p → $STATUS"
done
# 期望：每行都是 200 + 几 KB-几百 KB

# B. 通过 nginx 看（如果有）
for p in /index.html /cards.json /book-source.json; do
  STATUS=$(curl -sI "https://thebookofelon.com$p" 2>/dev/null | head -1)
  echo "$p → $STATUS"
done

# C. 跑 smoke
SMOKE_BASE=http://127.0.0.1:3000 npm run static:smoke
```

---

## 3. 故障：STATIC_FILE_ALLOW 缺漏（最可能）

**症状**：直连 node 某些 URL 是 404。

**修复**：

```bash
# 1. 看 server.js 当前白名单
grep -A 30 'STATIC_FILE_ALLOW = new Set' server.js

# 2. 对比 web/ 目录的实际文件
ls web/*.{js,html,css,json} 2>/dev/null

# 3. 缺谁加谁。本地改 server.js + commit + push + reload
```

**code 修复（在本地 repo）**：

```javascript
// server.js  STATIC_FILE_ALLOW
const STATIC_FILE_ALLOW = new Set([
  "/index.html",
  "/styles.css",
  "/app.js",
  "/auth-ui.js",
  "/knowledge-base.js",
  "/model-client.js",
  "/reply-engine.js",
  "/cards.json",
  "/book-source.json",
  // ← 在这里加新文件
]);
```

提交：

```bash
git add server.js tests/smoke/static-security.js
git commit -m "fix(server): add /xxx to STATIC_FILE_ALLOW (R-23 类似漂移)"
git push
```

服务器：

```bash
git pull --ff-only
pm2 reload book-of-elon --update-env
SMOKE_BASE=http://127.0.0.1:3000 npm run static:smoke
```

---

## 4. 故障：nginx / cdn 缓存坏

**症状**：直连 node 200，但 nginx 返回 404 / 200 空 body / 旧 hash。

**修复**：

```bash
# A. nginx 缓存清空（如果开了 proxy_cache）
ls /var/cache/nginx/ 2>/dev/null
# rm -rf /var/cache/nginx/<zone>/*  # 视配置而定，谨慎

# B. nginx reload + 看错误日志
nginx -t && nginx -s reload
tail -50 /var/log/nginx/error.log

# C. 浏览器缓存：让用户 Ctrl+Shift+R / 隐身窗口
#    根因防御：每次资源改动 bump version 串（DATA_VERSION / ?v=YYYYMMDD-xx）
```

服务端版本串当前在 `web/index.html` 的 `<script src="...?v=20260427-c2">`，改前端 JS 后**必须** bump 这个 v 值。

---

## 5. 故障：JS 运行时错误（白屏但资源都 200）

**症状**：F12 Console 红字 / Uncaught 异常。

**诊断**：

```text
Uncaught ReferenceError: cards is not defined
  → app.js bootstrap 失败 / fetch cards.json 失败
  → 看 Network 是不是有 5xx / CORS

Uncaught TypeError: Cannot read properties of undefined ...
  → 数据 schema 漂移（cards.json 字段名变了但 reply-engine.js 没跟）

Uncaught SyntaxError: Unexpected token ...
  → 文件被 nginx 改坏（gzip 切断 / 编码错） → §4
```

**修复**：

1. F12 Console 截一张图（路径 / 行号）
2. 在本地浏览器复现（`node server.js` + 浏览器开 localhost:3000）
3. 复现得到 → 走 hotfix 流程（CONTRIBUTING §7）
4. 复现不到 → 看 nginx / 用户网络 / 浏览器版本

---

## 6. 性能问题（首屏 > 3 秒）

不在本 runbook，去看：
- `nginx.book-of-elon.conf.example` 是否启用了 gzip/brotli
- `book-source.json` 是 360KB，必须压缩传输（nginx `gzip_types application/json` 一定要开）
- chrome lighthouse 跑一遍

---

## 7. 防御演进

- [x] R-23 把 book-source.js 加进 STATIC_FILE_ALLOW（已修，2026-04-27）
- [x] R-04 把 book-source / card-data 转 JSON 资产（Phase C-2）
- [x] tests/smoke/static-security.js 全量覆盖白名单 + 拒绝列表
- [x] R-18 CI integration-smoke job 跑 static:smoke（每次 push 自动）
- [ ] 加 `/api/static-manifest` 端点暴露白名单 hash，前端在线诊断时用
- [ ] uptime 监控（UptimeRobot 等）每分钟探一次首页 + cards.json，404 即告警

---

## 8. 历史事件记录

| 日期 | 现象 | 根因 | 解决路径 | 影响时长 |
|---|---|---|---|---|
| 2026-04-27 | book-source.js 生产 404，AI 回答悄悄降级 | Phase C-1 漏配 STATIC_FILE_ALLOW | server.js 加白名单 + Phase C-2 转 JSON | 数小时（用户大概率没察觉） |
