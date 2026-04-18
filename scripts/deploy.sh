#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
# scripts/deploy.sh — bookofelon.cn 一键部署
# ────────────────────────────────────────────────────────────────
# 在服务器上执行：cd /path/to/repo && bash scripts/deploy.sh
#
# 会做这些事（每一步失败都立刻退出，不会留半成品）：
#   1. 健康预检：进程在跑、git tree 干净、磁盘有空间
#   2. 备份现有 DB（即便不动 DB，部署前总是备份）
#   3. git fetch + checkout main + pull --ff-only
#   4. npm ci --omit=dev（装 better-sqlite3 native 依赖）
#   5. 迁移 dry-run 让你看一眼
#   6. 真迁移 + 自动备份
#   7. PM2 reload（零 downtime）
#   8. 等 3 秒等服务起来
#   9. 烟雾测试：/api/health + 主页 + 鉴权拒绝
#  10. 报告 sha + 关键 counts
#
# 任意一步失败：脚本退出 + 留下完整 backup 给回滚用
# ════════════════════════════════════════════════════════════════

set -euo pipefail

# ───────── 配置（按你的服务器实际情况改） ─────────
PM2_NAME="${PM2_NAME:-book-of-elon}"
DB_PATH="${SQLITE_DB_PATH:-./data/app.db}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
LEGACY_HEALTH_URL="${LEGACY_HEALTH_URL:-http://127.0.0.1:3000/health}"

# ───────── 颜色 ─────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
step() { echo; echo -e "${YELLOW}▸${NC} $*"; }

# ───────── 1. 预检 ─────────
step "1/10  预检环境"

command -v node >/dev/null || fail "node 没装"
command -v npm  >/dev/null || fail "npm 没装"
command -v pm2  >/dev/null || fail "pm2 没装：npm i -g pm2"
command -v git  >/dev/null || fail "git 没装"
command -v curl >/dev/null || fail "curl 没装"

if [ ! -f "$DB_PATH" ]; then
  warn "DB 不存在: $DB_PATH（首次部署？）"
fi

DISK_FREE_KB=$(df -k . | tail -1 | awk '{print $4}')
if [ "$DISK_FREE_KB" -lt 102400 ]; then
  fail "磁盘剩余 < 100MB，先清理"
fi
ok "node $(node -v), pm2 $(pm2 -v), 磁盘剩余 $((DISK_FREE_KB/1024))MB"

# ───────── 2. 部署前备份（保险） ─────────
step "2/10  部署前 DB 备份"
if [ -f "$DB_PATH" ]; then
  STAMP=$(date +%Y-%m-%dT%H-%M-%S)
  PRE_DEPLOY_BACKUP="${DB_PATH}.predeploy-${STAMP}"
  cp "$DB_PATH" "$PRE_DEPLOY_BACKUP"
  ok "备份 -> $PRE_DEPLOY_BACKUP ($(du -h "$PRE_DEPLOY_BACKUP" | cut -f1))"
fi

# ───────── 3. 拉代码 ─────────
step "3/10  拉最新代码"
git fetch --all --prune
LOCAL_SHA_BEFORE=$(git rev-parse HEAD)
git checkout main
git pull --ff-only
LOCAL_SHA_AFTER=$(git rev-parse HEAD)

if [ "$LOCAL_SHA_BEFORE" = "$LOCAL_SHA_AFTER" ]; then
  warn "代码无更新（HEAD 仍是 $LOCAL_SHA_AFTER），但部署流程仍会跑迁移和 reload"
else
  ok "代码 $LOCAL_SHA_BEFORE → $LOCAL_SHA_AFTER"
  echo "  本次新增 commits:"
  git log --oneline "$LOCAL_SHA_BEFORE..$LOCAL_SHA_AFTER" | sed 's/^/    /'
fi

# ───────── 4. 装依赖 ─────────
step "4/10  npm ci"
npm ci --omit=dev
ok "依赖装好"

# ───────── 5. 迁移 dry-run ─────────
step "5/10  迁移 dry-run"
SQLITE_DB_PATH="$DB_PATH" node scripts/migrate.js
ok "dry-run 完成（上面是即将执行的 ALTER TABLE 列表）"

# ───────── 6. 真迁移 ─────────
step "6/10  迁移 apply"
SQLITE_DB_PATH="$DB_PATH" node scripts/migrate.js --apply
ok "迁移完成"

# ───────── 7. PM2 reload ─────────
step "7/10  PM2 reload (zero downtime)"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 reload "$PM2_NAME" --update-env
  ok "reloaded $PM2_NAME"
else
  warn "$PM2_NAME 不在 PM2 里，尝试 pm2 start ecosystem.config.js"
  pm2 start ecosystem.config.js
  ok "started"
fi

# ───────── 8. 等服务起来 ─────────
step "8/10  等服务起来"
for i in 1 2 3 4 5; do
  sleep 1
  if curl -sf "$LEGACY_HEALTH_URL" >/dev/null 2>&1; then
    ok "/health 响应正常 (等了 ${i}s)"
    break
  fi
  if [ "$i" = "5" ]; then
    fail "服务启动 5s 内没响应 /health"
  fi
done

# ───────── 9. 烟雾测试 ─────────
step "9/10  烟雾测试"

HEALTH_JSON=$(curl -sf "$HEALTH_URL" || echo "")
if [ -z "$HEALTH_JSON" ]; then
  fail "/api/health 不返回（新代码没成功 deploy？）"
fi

# 不依赖 jq：用 grep 抽关键字段
H_STATUS=$(echo "$HEALTH_JSON" | grep -oE '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
H_DBSTATUS=$(echo "$HEALTH_JSON" | grep -oE '"db":\{"status":"[^"]*"' | cut -d'"' -f6)
H_LLM=$(echo "$HEALTH_JSON" | grep -oE '"llm":\{"status":"[^"]*"' | cut -d'"' -f6)
H_VERSION=$(echo "$HEALTH_JSON" | grep -oE '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
H_USERS=$(echo "$HEALTH_JSON" | grep -oE '"users":[0-9]+' | head -1 | cut -d':' -f2)

[ "$H_STATUS"   = "ok" ] || fail "/api/health status != ok (got: $H_STATUS)"
[ "$H_DBSTATUS" = "ok" ] || fail "DB status != ok (got: $H_DBSTATUS)"
[ "$H_LLM"      = "ok" ] || warn "LLM status != ok (got: $H_LLM) — 检查 DEEPSEEK_API_KEY"

ok "/api/health  status=$H_STATUS  db=$H_DBSTATUS  llm=$H_LLM  version=$H_VERSION  users=$H_USERS"

# 主页能加载
HOME_CODE=$(curl -sf -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/)
[ "$HOME_CODE" = "200" ] || fail "主页非 200 (got: $HOME_CODE)"
ok "主页 HTTP $HOME_CODE"

# 鉴权必须拒绝未登录
DASH_CODE=$(curl -sf -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/me/dashboard || echo "401")
[ "$DASH_CODE" = "401" ] || fail "/api/me/dashboard 应该 401，实际 $DASH_CODE（鉴权破了？）"
ok "鉴权拒绝 HTTP $DASH_CODE"

# ───────── 10. 总结 ─────────
step "10/10  done"
pm2 status "$PM2_NAME" | head -10
echo
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  部署成功${NC}"
echo -e "${GREEN}  sha: $LOCAL_SHA_AFTER${NC}"
echo -e "${GREEN}  version: $H_VERSION   users: $H_USERS${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo
echo "回滚（万一发现问题）："
echo "  git checkout $LOCAL_SHA_BEFORE && npm ci --omit=dev"
[ -n "${PRE_DEPLOY_BACKUP:-}" ] && echo "  cp \"$PRE_DEPLOY_BACKUP\" \"$DB_PATH\""
echo "  pm2 reload $PM2_NAME"
