# ════════════════════════════════════════════════════════════════
# Dockerfile — Book of Elon
# ────────────────────────────────────────────────────────────────
# 安全约束（CSO #4 HIGH 修复）：
#   1. 用 npm ci 锁版本，杜绝供应链漂移
#   2. 创建非 root 用户跑 node，最小权限
#   3. .dockerignore 同步排除 data/ backups/ *.db 等敏感文件
# ════════════════════════════════════════════════════════════════

FROM node:20-alpine

WORKDIR /app

# 先只拷依赖描述，最大化利用 layer cache。
# 必须用 npm ci（读 package-lock.json）而不是 npm install——后者每次构建
# 可能装到不同版本，被传递依赖供应链劫持时无法复现锁定的版本。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 创建专用非 root 用户。如果未来代码层出 RCE / LFI，攻击者拿到的是 boe，
# 不是 root，能做的破坏小一个数量级。
# 同时把 /app/data 提前建好并 chown，运行时 better-sqlite3 写库不会因
# 权限失败而崩。
RUN addgroup -S boe && adduser -S boe -G boe \
    && mkdir -p /app/data /app/data/backups \
    && chown -R boe:boe /app

# 用 --chown 把代码拷进去时直接归属 boe，避免后续 chmod 一遍
COPY --chown=boe:boe . .

USER boe

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# 健康检查：让 docker / k8s 知道容器是不是真的能服务
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
