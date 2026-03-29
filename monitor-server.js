const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const projectRoot = __dirname;
const env = loadEnvFile(path.join(projectRoot, ".env"));

const MONITOR_HOST = readStringEnv("MONITOR_HOST", "127.0.0.1");
const MONITOR_PORT = readNumberEnv("MONITOR_PORT", 3201, 1, 65535);
const MONITOR_TARGET_HOST = readStringEnv("MONITOR_TARGET_HOST", "127.0.0.1");
const MONITOR_TARGET_PORT = readNumberEnv("MONITOR_TARGET_PORT", 3000, 1, 65535);
const MONITOR_TARGET_APP = readStringEnv("MONITOR_TARGET_APP", "book-of-elon");
const MONITOR_USERNAME = readStringEnv("MONITOR_USERNAME", "");
const MONITOR_PASSWORD = readStringEnv("MONITOR_PASSWORD", "");
const PM2_HOME = readStringEnv("PM2_HOME", path.join(os.homedir(), ".pm2"));
const LOG_TAIL_BYTES = 320000;
const MAX_RECENT_EVENTS = 24;
const REFRESH_INTERVAL_MS = 5000;
const MONITOR_AUTH_CONFIG = validateMonitorAuthConfig();

if (!MONITOR_AUTH_CONFIG.ok) {
  console.error(
    JSON.stringify({
      type: "event",
      level: "error",
      event: "monitor_startup_validation_failed",
      time: new Date().toISOString(),
      details: MONITOR_AUTH_CONFIG.message,
    })
  );
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  try {
    if (!isAuthorized(request)) {
      response.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="Book of Elon Monitor"',
        ...buildMonitorHeaders(),
      });
      response.end("Authentication required.");
      return;
    }

    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (requestUrl.pathname === "/api/summary") {
      const snapshot = await collectSnapshot();
      return sendJson(response, 200, snapshot);
    }

    if (requestUrl.pathname === "/health") {
      return sendJson(response, 200, {
        status: "ok",
        targetApp: MONITOR_TARGET_APP,
        generatedAt: new Date().toISOString(),
      });
    }

    if (requestUrl.pathname !== "/") {
      return sendJson(response, 404, { error: "not_found" });
    }

    return sendHtml(response, buildDashboardHtml());
  } catch (error) {
    return sendJson(response, 500, {
      error: "monitor_error",
      details: safeSlice(error.stack || error.message, 500),
    });
  }
});

server.listen(MONITOR_PORT, MONITOR_HOST, () => {
  console.log(
    JSON.stringify({
      type: "event",
      level: "info",
      event: "monitor_server_listening",
      time: new Date().toISOString(),
      host: MONITOR_HOST,
      port: MONITOR_PORT,
      targetHost: MONITOR_TARGET_HOST,
      targetPort: MONITOR_TARGET_PORT,
      targetApp: MONITOR_TARGET_APP,
      authEnabled: true,
    })
  );
});

async function collectSnapshot() {
  const [health, ready, processInfo, logResult] = await Promise.all([
    requestJson(`http://${MONITOR_TARGET_HOST}:${MONITOR_TARGET_PORT}/health`),
    requestJson(`http://${MONITOR_TARGET_HOST}:${MONITOR_TARGET_PORT}/ready`),
    readPm2ProcessInfo(),
    readRecentEvents(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    target: {
      app: MONITOR_TARGET_APP,
      host: MONITOR_TARGET_HOST,
      port: MONITOR_TARGET_PORT,
    },
    monitor: {
      host: MONITOR_HOST,
      port: MONITOR_PORT,
      authEnabled: true,
    },
    health,
    ready,
    process: processInfo,
    stats: buildStats(logResult.events),
    recentEvents: buildRecentEvents(logResult.events),
    sources: logResult.sources,
  };
}

function requestJson(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 2500 }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        try {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            body: raw ? JSON.parse(raw) : null,
          });
        } catch (error) {
          resolve({
            ok: false,
            statusCode: response.statusCode,
            body: null,
            error: `invalid_json: ${error.message}`,
          });
        }
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("timeout"));
    });

    request.on("error", (error) => {
      resolve({
        ok: false,
        statusCode: 0,
        body: null,
        error: error.message,
      });
    });
  });
}

function readPm2ProcessInfo() {
  return new Promise((resolve) => {
    readPm2AppEntry().then((result) => {
      if (!result.ok) {
        resolve({
          ok: false,
          error: result.error,
        });
        return;
      }

      const app = result.app;
      const monit = app.monit || {};
      const pm2Env = app.pm2_env || {};
      resolve({
        ok: true,
        name: app.name,
        pid: pm2Env.pm_pid || 0,
        status: pm2Env.status || "unknown",
        restarts: Number(pm2Env.restart_time || 0),
        cpu: Number(monit.cpu || 0),
        memoryMb: Number(((monit.memory || 0) / 1024 / 1024).toFixed(1)),
        uptimeMs: pm2Env.pm_uptime ? Math.max(0, Date.now() - Number(pm2Env.pm_uptime)) : 0,
      });
    });
  });
}

async function readRecentEvents() {
  const pm2Entry = await readPm2AppEntry();
  const pm2Env = pm2Entry.ok ? pm2Entry.app.pm2_env || {} : {};
  const sources = {
    outLog: pm2Env.pm_out_log_path || path.join(PM2_HOME, "logs", `${MONITOR_TARGET_APP}-out-0.log`),
    errorLog: pm2Env.pm_err_log_path || path.join(PM2_HOME, "logs", `${MONITOR_TARGET_APP}-error-0.log`),
  };

  const [outEvents, errorEvents] = await Promise.all([
    readLogEventsFromFile(sources.outLog),
    readLogEventsFromFile(sources.errorLog),
  ]);

  const events = [...outEvents, ...errorEvents]
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.time || 0) - Date.parse(left.time || 0));

  return {
    events,
    sources,
  };
}

async function readLogEventsFromFile(filePath) {
  try {
    const stats = await fs.promises.stat(filePath);
    const start = Math.max(0, stats.size - LOG_TAIL_BYTES);
    const handle = await fs.promises.open(filePath, "r");

    try {
      const buffer = Buffer.alloc(stats.size - start);
      await handle.read(buffer, 0, buffer.length, start);
      const content = buffer.toString("utf8");
      return content
        .split(/\r?\n/)
        .map(parseLogEventLine)
        .filter(Boolean);
    } finally {
      await handle.close();
    }
  } catch (error) {
    return [
      {
        type: "event",
        level: "warning",
        event: "monitor_log_unavailable",
        time: new Date().toISOString(),
        details: `${path.basename(filePath)}: ${error.message}`,
      },
    ];
  }
}

function parseLogEventLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;

  const jsonStart = trimmed.indexOf("{");
  if (jsonStart === -1) return null;

  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart));
    if (!parsed || parsed.type !== "event") return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function buildStats(events) {
  const now = Date.now();
  const last5m = events.filter((event) => isEventWithinWindow(event, now, 5 * 60 * 1000));
  const requestEvents = last5m.filter((event) => event.event === "request_completed");

  return {
    windowMinutes: 5,
    totalRequests: requestEvents.length,
    apiChatRequests: requestEvents.filter((event) => event.route === "api_chat").length,
    deepseekReplies: requestEvents.filter((event) => event.provider === "DeepSeek").length,
    fallbackReplies: requestEvents.filter((event) => event.provider === "local-fallback").length,
    securityRejected: last5m.filter((event) => event.event === "chat_request_rejected").length,
    rateLimited: requestEvents.filter((event) => event.statusCode === 429).length,
    serverErrors: requestEvents.filter((event) => Number(event.statusCode) >= 500).length,
    slowRequests: requestEvents.filter((event) => event.slowRequest === true).length,
    uniqueClientIps: new Set(requestEvents.map((event) => event.clientIp).filter(Boolean)).size,
    degradedResponses: requestEvents.filter((event) => event.degraded === true).length,
  };
}

function buildRecentEvents(events) {
  return events
    .filter((event) => isInterestingEvent(event))
    .slice(0, MAX_RECENT_EVENTS)
    .map((event) => ({
      time: event.time || "",
      level: event.level || "info",
      event: event.event || "unknown",
      summary: summarizeEvent(event),
      route: event.route || "",
      statusCode: event.statusCode || "",
      requestId: event.requestId || "",
    }));
}

function isInterestingEvent(event) {
  if (!event) return false;
  if (event.event !== "request_completed") return true;
  return Number(event.statusCode) >= 400 || event.degraded === true || event.slowRequest === true;
}

function summarizeEvent(event) {
  if (event.event === "request_completed") {
    return [
      event.method || "",
      event.path || "",
      `status ${event.statusCode || ""}`,
      event.provider ? `provider ${event.provider}` : "",
      event.error ? `error ${event.error}` : "",
      event.slowRequest ? "slow" : "",
    ]
      .filter(Boolean)
      .join(" | ");
  }

  if (event.event === "chat_request_rejected") {
    return `reason ${event.reason || "unknown"} | ip ${event.clientIp || "-"}`;
  }

  if (event.event === "upstream_request_failed") {
    return `code ${event.code || "unknown"} | ${safeSlice(event.details || "", 120)}`;
  }

  return safeSlice(
    [
      event.message || "",
      event.details || "",
      event.reason ? `reason ${event.reason}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
    160
  );
}

function isEventWithinWindow(event, now, windowMs) {
  const timestamp = Date.parse(event.time || "");
  return Number.isFinite(timestamp) && now - timestamp <= windowMs;
}

function isAuthorized(request) {
  const header = String(request.headers.authorization || "");
  if (!header.startsWith("Basic ")) {
    return false;
  }

  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) return false;

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);
    return username === MONITOR_USERNAME && password === MONITOR_PASSWORD;
  } catch (error) {
    return false;
  }
}

function sendHtml(response, html) {
  response.writeHead(200, {
    ...buildMonitorHeaders(),
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(html);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...buildMonitorHeaders(),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function buildMonitorHeaders() {
  return {
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function buildDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Book of Elon Monitor</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #09101a;
      --panel: #101a28;
      --panel-soft: #162235;
      --border: rgba(170, 194, 255, 0.14);
      --text: #f5f7ff;
      --soft: rgba(233, 239, 255, 0.72);
      --ok: #54d18f;
      --warn: #ffb65c;
      --danger: #ff7d87;
      --accent: #a9c4ff;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: Inter, "Noto Sans SC", system-ui, sans-serif;
      background: linear-gradient(180deg, #07101a 0%, #0b1320 100%);
      color: var(--text);
    }
    .shell { max-width: 1200px; margin: 0 auto; }
    .topbar, .grid, .events { display: grid; gap: 16px; }
    .topbar { grid-template-columns: 2fr 1fr; margin-bottom: 16px; }
    .grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-bottom: 16px; }
    .panel {
      background: rgba(16, 26, 40, 0.92);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.24);
    }
    .title { margin: 0 0 8px; font-size: 28px; }
    .subtitle, .meta, .mini { color: var(--soft); margin: 0; line-height: 1.6; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border-radius: 999px;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      font-size: 14px;
    }
    .dot { width: 10px; height: 10px; border-radius: 999px; background: var(--soft); }
    .dot.ok { background: var(--ok); }
    .dot.warn { background: var(--warn); }
    .dot.danger { background: var(--danger); }
    .metric-value { font-size: 34px; font-weight: 800; margin: 8px 0 4px; }
    .metric-label { color: var(--soft); font-size: 14px; }
    .events { grid-template-columns: 1fr 1fr; }
    .event-list { display: grid; gap: 10px; margin-top: 12px; }
    .event-item {
      border-radius: 14px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .event-head { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--soft); }
    .event-body { margin-top: 6px; line-height: 1.55; font-size: 14px; word-break: break-word; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    @media (max-width: 860px) {
      body { padding: 16px; }
      .topbar, .events { grid-template-columns: 1fr; }
      .title { font-size: 24px; }
      .metric-value { font-size: 28px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="topbar">
      <div class="panel">
        <h1 class="title">Book of Elon 监控后台</h1>
        <p class="subtitle">独立监控页，不影响主站聊天逻辑。自动每 ${Math.round(REFRESH_INTERVAL_MS / 1000)} 秒刷新一次。</p>
        <p class="meta" id="meta-line">正在加载监控数据...</p>
      </div>
      <div class="panel">
        <div class="badge"><span class="dot" id="status-dot"></span><span id="status-text">检查中</span></div>
        <p class="meta" style="margin-top: 12px;" id="status-extra">等待服务状态...</p>
      </div>
    </section>

    <section class="grid" id="metrics-grid"></section>

    <section class="events">
      <div class="panel">
        <h2 style="margin: 0;">最近关键事件</h2>
        <div class="event-list" id="recent-events"></div>
      </div>
      <div class="panel">
        <h2 style="margin: 0;">当前服务摘要</h2>
        <div class="event-list" id="service-summary"></div>
      </div>
    </section>
  </div>

  <script>
    const metricsGrid = document.getElementById("metrics-grid");
    const recentEvents = document.getElementById("recent-events");
    const serviceSummary = document.getElementById("service-summary");
    const metaLine = document.getElementById("meta-line");
    const statusDot = document.getElementById("status-dot");
    const statusText = document.getElementById("status-text");
    const statusExtra = document.getElementById("status-extra");

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function formatDuration(ms) {
      if (!ms) return "0s";
      if (ms < 60000) return Math.round(ms / 1000) + "s";
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      return minutes + "m " + seconds + "s";
    }

    function buildMetricCard(label, value, hint) {
      return '<article class="panel">' +
        '<div class="metric-label">' + escapeHtml(label) + '</div>' +
        '<div class="metric-value">' + escapeHtml(value) + '</div>' +
        '<div class="mini">' + escapeHtml(hint) + '</div>' +
        '</article>';
    }

    function buildEventItem(title, body, meta) {
      return '<article class="event-item">' +
        '<div class="event-head"><span>' + escapeHtml(title) + '</span><span>' + escapeHtml(meta) + '</span></div>' +
        '<div class="event-body">' + escapeHtml(body) + '</div>' +
        '</article>';
    }

    function renderSnapshot(snapshot) {
      const stats = snapshot.stats || {};
      const ready = snapshot.ready || {};
      const health = snapshot.health || {};
      const processInfo = snapshot.process || {};
      const healthOk = health.ok && health.body && health.body.status === "ok";
      const readyOk = ready.ok && ready.body && ready.body.ready === true;
      const degraded = Boolean(ready.body && ready.body.degraded);
      const statusLevel = !healthOk || !readyOk ? "danger" : degraded ? "warn" : "ok";
      const statusLabel = !healthOk || !readyOk ? "服务异常" : degraded ? "降级运行中" : "运行正常";

      statusDot.className = 'dot ' + statusLevel;
      statusText.textContent = statusLabel;
      statusExtra.textContent =
        'PM2: ' + (processInfo.status || 'unknown') +
        ' | CPU ' + (processInfo.cpu || 0) + '%' +
        ' | 内存 ' + (processInfo.memoryMb || 0) + ' MB';

      metaLine.textContent =
        '目标 ' + snapshot.target.app + ' @ ' + snapshot.target.host + ':' + snapshot.target.port +
        ' | 最近更新 ' + new Date(snapshot.generatedAt).toLocaleString();

      metricsGrid.innerHTML = [
        buildMetricCard('近 5 分钟总请求', stats.totalRequests || 0, '全部 request_completed'),
        buildMetricCard('聊天请求', stats.apiChatRequests || 0, 'route = api_chat'),
        buildMetricCard('DeepSeek 正常回复', stats.deepseekReplies || 0, 'provider = DeepSeek'),
        buildMetricCard('本地降级回复', stats.fallbackReplies || 0, 'provider = local-fallback'),
        buildMetricCard('429 限流', stats.rateLimited || 0, '近 5 分钟'),
        buildMetricCard('403 安全拦截', stats.securityRejected || 0, 'chat_request_rejected'),
        buildMetricCard('慢请求', stats.slowRequests || 0, 'slowRequest = true'),
        buildMetricCard('最近活跃 IP', stats.uniqueClientIps || 0, '近 5 分钟估算'),
      ].join('');

      const recent = Array.isArray(snapshot.recentEvents) ? snapshot.recentEvents : [];
      recentEvents.innerHTML = recent.length
        ? recent.map((event) => buildEventItem(event.event, event.summary, new Date(event.time).toLocaleTimeString())).join('')
        : buildEventItem('暂无关键事件', '最近日志里没有需要特别注意的异常或慢请求。', '');

      const summaryItems = [
        buildEventItem('健康检查 /health', health.ok ? '正常返回' : '请求失败', 'status ' + (health.statusCode || 0)),
        buildEventItem('就绪检查 /ready', readyOk ? 'ready=true' : 'ready 异常', 'status ' + (ready.statusCode || 0)),
        buildEventItem('降级状态', degraded ? '当前存在降级或熔断' : '当前未降级', ready.body ? JSON.stringify({
          degraded: ready.body.degraded,
          llmEnabled: ready.body.llmEnabled,
          circuitOpen: ready.body.circuitOpen
        }) : ''),
        buildEventItem('PM2 进程', processInfo.ok === false ? (processInfo.error || '无法读取 PM2') : '进程在线', processInfo.ok === false ? '' : '重启 ' + (processInfo.restarts || 0) + ' 次，运行 ' + formatDuration(processInfo.uptimeMs || 0)),
        buildEventItem('日志来源', 'out: ' + snapshot.sources.outLog, 'error: ' + snapshot.sources.errorLog),
      ];
      serviceSummary.innerHTML = summaryItems.join('');
    }

    async function refresh() {
      try {
        const response = await fetch('/api/summary', { cache: 'no-store' });
        const snapshot = await response.json();
        renderSnapshot(snapshot);
      } catch (error) {
        statusDot.className = 'dot danger';
        statusText.textContent = '监控拉取失败';
        statusExtra.textContent = error.message;
      }
    }

    refresh();
    setInterval(refresh, ${REFRESH_INTERVAL_MS});
  </script>
</body>
</html>`;
}

function readStringEnv(key, fallback) {
  return String(process.env[key] || env[key] || fallback).trim();
}

function validateMonitorAuthConfig() {
  if (!MONITOR_USERNAME || !MONITOR_PASSWORD) {
    return {
      ok: false,
      message: "MONITOR_USERNAME and MONITOR_PASSWORD are required before starting the monitor service.",
    };
  }

  if (looksLikePlaceholderValue(MONITOR_USERNAME) || looksLikePlaceholderValue(MONITOR_PASSWORD)) {
    return {
      ok: false,
      message: "Replace MONITOR_USERNAME and MONITOR_PASSWORD placeholders before starting the monitor service.",
    };
  }

  return {
    ok: true,
    message: "Monitor auth config looks valid.",
  };
}

function readPm2AppEntry() {
  return new Promise((resolve) => {
    execFile("pm2", ["jlist"], { windowsHide: true, timeout: 3000 }, (error, stdout) => {
      if (error) {
        resolve({
          ok: false,
          error: error.message,
        });
        return;
      }

      try {
        const list = JSON.parse(stdout);
        const app = Array.isArray(list) ? list.find((item) => item?.name === MONITOR_TARGET_APP) : null;
        if (!app) {
          resolve({
            ok: false,
            error: `pm2_app_not_found:${MONITOR_TARGET_APP}`,
          });
          return;
        }

        resolve({
          ok: true,
          app,
        });
      } catch (parseError) {
        resolve({
          ok: false,
          error: `pm2_parse_failed:${parseError.message}`,
        });
      }
    });
  });
}

function readNumberEnv(key, fallback, min, max) {
  const raw = process.env[key] || env[key];
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const entries = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"|"$/g, "");
    entries[key] = value;
  }
  return entries;
}

function safeSlice(text, maxLength) {
  return String(text || "").slice(0, maxLength);
}

function looksLikePlaceholderValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized.includes("replace_with") ||
    normalized.includes("your_monitor") ||
    normalized.includes("changeme")
  );
}
