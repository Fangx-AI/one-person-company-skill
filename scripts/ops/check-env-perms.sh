#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
# scripts/ops/check-env-perms.sh — Wave 3 R-03
# ────────────────────────────────────────────────────────────────
# 验证 .env 文件权限永远是 600，owner 是预期用户。
# cron 每天跑一次（凌晨 03:00）；发现不符直接修，并记 incident.log。
#
# 安装：
#   chmod +x scripts/ops/check-env-perms.sh
#   crontab -e 加：
#     0 3 * * * /root/skill_The_book_of_Elon/scripts/ops/check-env-perms.sh
# ════════════════════════════════════════════════════════════════

set -uo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/root/skill_The_book_of_Elon}"
ENV_FILE="$PROJECT_ROOT/.env"
LOG_DIR="${LOG_DIR:-/var/log/book-of-elon}"
EXPECTED_PERM="600"
EXPECTED_OWNER="${EXPECTED_OWNER:-root}"

mkdir -p "$LOG_DIR" 2>/dev/null || true
INCIDENT_LOG="$LOG_DIR/incident.log"
ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

if [ ! -f "$ENV_FILE" ]; then
  echo "[$(ts)] CHECK_ENV_PERMS .env 不存在: $ENV_FILE" >> "$INCIDENT_LOG"
  exit 0
fi

ACTUAL_PERM="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo unknown)"
ACTUAL_OWNER="$(stat -c '%U' "$ENV_FILE" 2>/dev/null || echo unknown)"

changed=0

if [ "$ACTUAL_PERM" != "$EXPECTED_PERM" ]; then
  echo "[$(ts)] CHECK_ENV_PERMS .env perm=${ACTUAL_PERM} expected=${EXPECTED_PERM} → chmod 600" \
    >> "$INCIDENT_LOG"
  chmod 600 "$ENV_FILE" || \
    echo "[$(ts)] CHECK_ENV_PERMS chmod FAILED" >> "$INCIDENT_LOG"
  changed=1
fi

if [ "$ACTUAL_OWNER" != "$EXPECTED_OWNER" ] && [ "$ACTUAL_OWNER" != "unknown" ]; then
  echo "[$(ts)] CHECK_ENV_PERMS .env owner=${ACTUAL_OWNER} expected=${EXPECTED_OWNER} (NOT auto-fixing)" \
    >> "$INCIDENT_LOG"
  changed=1
fi

if [ "$changed" = "0" ]; then
  # 全绿不写日志，cron 静默
  exit 0
fi

exit 0
