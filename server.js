const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const projectRoot = __dirname;
const env = loadEnvFile(path.join(projectRoot, ".env"));

for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const authRoutes = require("./routes/auth");
const meRoutes = require("./routes/me");
const userSession = require("./auth/session");
const smsSender = require("./auth/sms-sender");
const dbSessions = require("./db/sessions");
const dbUsers = require("./db/users");
const dbGoals = require("./db/goals");
const dbFacts = require("./db/facts");
const factExtractor = require("./services/fact-extractor");
const { getDb: getDatabase } = require("./db/database");
getDatabase();

// 启动期校验：生产环境若 SMS_PROVIDER 不是 aliyun 或 ALIYUN_* 不全，
// 这里就会抛错让 PM2 标记 errored，不会把 OTP-leak 的服务暴露出去。
// 顺便把启动时的 provider 模式打到日志里，便于运维确认。
const __smsProviderInfo = smsSender.assertProviderUsable();
if (__smsProviderInfo.production && __smsProviderInfo.provider !== "aliyun") {
  console.error("[boot] FATAL: production refused to start with SMS provider:", __smsProviderInfo.provider);
  process.exit(1);
}

const PORT = readNumberEnv("PORT", 3000, 1, 65535);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || env.DEEPSEEK_MODEL || "deepseek-chat";
const PROMPT_VERSION = (() => {
  const raw = String(process.env.PROMPT_VERSION || env.PROMPT_VERSION || "v2").toLowerCase();
  return raw === "v1" ? "v1" : "v2";
})();
const DEEPSEEK_MAX_TOKENS = readNumberEnv("DEEPSEEK_MAX_TOKENS", 700, 100, 2000);
const DEEPSEEK_TEMPERATURE = readNumberEnv("DEEPSEEK_TEMPERATURE", 0.7, 0, 2);
const UPSTREAM_TIMEOUT_MS = readNumberEnv("UPSTREAM_TIMEOUT_MS", 15000, 1000, 120000);
const CHAT_RATE_LIMIT_WINDOW_MS = readNumberEnv("CHAT_RATE_LIMIT_WINDOW_MS", 60000, 1000, 3600000);
const CHAT_RATE_LIMIT_MAX_REQUESTS = readNumberEnv("CHAT_RATE_LIMIT_MAX_REQUESTS", 8, 1, 1000);
const CHAT_BURST_WINDOW_MS = readNumberEnv("CHAT_BURST_WINDOW_MS", 10000, 1000, 600000);
const CHAT_BURST_MAX_REQUESTS = readNumberEnv("CHAT_BURST_MAX_REQUESTS", 3, 1, 1000);
const CHAT_CACHE_TTL_MS = readNumberEnv("CHAT_CACHE_TTL_MS", 120000, 0, 3600000);
const CHAT_CACHE_MAX_ENTRIES = readNumberEnv("CHAT_CACHE_MAX_ENTRIES", 300, 1, 5000);
const CIRCUIT_BREAKER_FAIL_THRESHOLD = readNumberEnv("CIRCUIT_BREAKER_FAIL_THRESHOLD", 5, 1, 100);
const CIRCUIT_BREAKER_COOLDOWN_MS = readNumberEnv("CIRCUIT_BREAKER_COOLDOWN_MS", 30000, 1000, 600000);
const SLOW_REQUEST_THRESHOLD_MS = readNumberEnv("SLOW_REQUEST_THRESHOLD_MS", 4000, 100, 120000);
const CLEANUP_INTERVAL_MS = 30000;
const CHAT_TOKEN_TTL_MS = readNumberEnv("CHAT_TOKEN_TTL_MS", 6 * 60 * 60 * 1000, 60000, 7 * 24 * 60 * 60 * 1000);
const ANALYTICS_ONLINE_WINDOW_MS = readNumberEnv("ANALYTICS_ONLINE_WINDOW_MS", 90000, 30000, 600000);
const ANALYTICS_HEARTBEAT_MIN_INTERVAL_MS = readNumberEnv(
  "ANALYTICS_HEARTBEAT_MIN_INTERVAL_MS",
  20000,
  5000,
  300000
);
const ANALYTICS_RETENTION_DAYS = readNumberEnv("ANALYTICS_RETENTION_DAYS", 30, 1, 180);
const ANALYTICS_FLUSH_INTERVAL_MS = 5000;
const SESSION_TOKEN_SECRET =
  process.env.SESSION_TOKEN_SECRET ||
  env.SESSION_TOKEN_SECRET ||
  crypto.randomBytes(32).toString("hex");
const CHAT_SESSION_COOKIE = "book_of_elon_sid";
const CHAT_TOKEN_HEADER = "x-book-of-elon-token";
const ANALYTICS_DATA_DIR = path.join(projectRoot, "data");
const ANALYTICS_DATA_FILE = path.join(ANALYTICS_DATA_DIR, "business-metrics.json");

const startupValidation = validateStartupConfig();
if (startupValidation.errors.length) {
  for (const message of startupValidation.errors) {
    logEvent("error", "startup_validation_failed", { message });
  }
  process.exit(1);
}

for (const message of startupValidation.warnings) {
  logEvent("warning", "startup_validation_warning", { message });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

// 静态资源安全策略：精确路径白名单。
// 之前 serveStaticFile 只校验路径不逃出 projectRoot，但 projectRoot 内部
// 就有 .env / data/app.db / server.js / package.json / CLAUDE.md 等敏感
// 文件，全部都能被任意人 GET 下来。
//
// 我们只服务客户端真正需要的资源。新增前端文件时，必须把它的路径加进来，
// 否则上线就 404。这个"明确报错胜过悄悄泄漏"的取舍是有意的。
const STATIC_FILE_ALLOW = new Set([
  "/index.html",
  "/styles.css",
  "/app.js",
  "/auth-ui.js",
  "/card-data.js",
  "/knowledge-base.js",
  "/model-client.js",
  "/reply-engine.js",
]);

const rateLimitStore = new Map();
const responseCache = new Map();
const circuitState = {
  consecutiveFailures: 0,
  openedAt: 0,
};
const analyticsState = loadAnalyticsState();
let lastCleanupAt = 0;
let analyticsFlushTimer = null;
let analyticsFlushInFlight = false;

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  const requestId = createRequestId();
  const clientIp = getClientIp(request);

  response.__meta = {
    requestId,
    clientIp,
    route: "unknown",
    provider: "none",
    cacheHit: false,
    cacheEligible: false,
    cacheReason: "",
    degraded: false,
  };
  response.__request = request;

  response.on("finish", () => {
    logRequest({
      request,
      response,
      startedAt,
    });
  });

  try {
    cleanupExpiredEntries();

    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/health") {
      response.__meta.route = "health";
      return sendJson(response, 200, {
        status: "ok",
        uptime_seconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        requestId,
      });
    }

    if (requestUrl.pathname === "/ready") {
      response.__meta.route = "ready";
      return sendJson(response, 200, {
        ready: true,
        degraded: !DEEPSEEK_API_KEY || isCircuitOpen(),
        llmEnabled: Boolean(DEEPSEEK_API_KEY),
        circuitOpen: isCircuitOpen(),
        requestId,
      });
    }

    if (requestUrl.pathname === "/api/health") {
      response.__meta.route = "api_health";
      return sendJson(response, 200, buildDeepHealth({ requestId }));
    }

    if (requestUrl.pathname === "/config.js") {
      response.__meta.route = "config";
      const sessionId = getOrCreateAnonymousSessionId(request);
      recordAnalyticsVisit(sessionId, request, requestUrl.pathname);
      return sendJavaScript(response, buildRuntimeConfigScript(sessionId), {
        "Set-Cookie": buildSessionCookie(request, sessionId),
      });
    }

    if (requestUrl.pathname === "/api/analytics") {
      response.__meta.route = "api_analytics";
      return handleAnalyticsEventRequest(request, response);
    }

    if (requestUrl.pathname === "/api/chat") {
      response.__meta.route = "api_chat";
      return handleChatRequest(request, response);
    }

    if (requestUrl.pathname.startsWith("/api/auth/")) {
      response.__meta.route = `api_auth_${requestUrl.pathname.slice("/api/auth/".length)}`;
      return authRoutes.handleAuthRequest({
        request,
        response,
        requestUrl,
        helpers: {
          sendJson,
          readJsonBody,
          getClientIp,
          isSecureRequest,
          parseCookies,
          anonSessionCookieName: CHAT_SESSION_COOKIE,
        },
      });
    }

    if (requestUrl.pathname.startsWith("/api/me/")) {
      response.__meta.route = `api_me_${requestUrl.pathname.slice("/api/me/".length)}`;
      return meRoutes.handleMeRequest({
        request,
        response,
        requestUrl,
        helpers: { sendJson, readJsonBody },
      });
    }

    if (requestUrl.pathname === "/internal/analytics") {
      response.__meta.route = "internal_analytics";
      if (!isInternalMonitorRequest(request)) {
        response.__meta.error = "forbidden";
        return sendJson(response, 403, {
          error: "forbidden",
          requestId,
        });
      }
      return sendJson(response, 200, buildAnalyticsSummary());
    }

    response.__meta.route = "static";
    return serveStaticFile(requestUrl.pathname, response);
  } catch (error) {
    response.__meta.error = error.message || "server_error";
    logEvent("error", "server_request_unhandled_error", {
      requestId,
      path: request.url,
      details: safeSlice(error.stack || error.message, 600),
    });
    return sendJson(response, 500, {
      error: "server_error",
      requestId,
    });
  }
});

server.listen(PORT, () => {
  logEvent("info", "server_listening", {
    port: PORT,
    mode: DEEPSEEK_API_KEY ? "llm" : "degraded",
    deepseekModel: DEEPSEEK_MODEL,
    upstreamTimeoutMs: UPSTREAM_TIMEOUT_MS,
    rateLimitPerMinute: CHAT_RATE_LIMIT_MAX_REQUESTS,
    burstLimit: CHAT_BURST_MAX_REQUESTS,
    burstWindowSeconds: Math.round(CHAT_BURST_WINDOW_MS / 1000),
    cacheTtlMs: CHAT_CACHE_TTL_MS,
    cacheMaxEntries: CHAT_CACHE_MAX_ENTRIES,
    slowRequestThresholdMs: SLOW_REQUEST_THRESHOLD_MS,
  });
});

server.on("error", (error) => {
  logEvent("error", "server_failed_to_listen", {
    details: safeSlice(error.stack || error.message, 600),
  });
  process.exit(1);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const SESSION_REUSE_WINDOW_MS = 6 * 60 * 60 * 1000;

function getCurrentUserIdFromRequest(request) {
  try {
    const token = userSession.extractTokenFromCookie(request.headers.cookie || "");
    if (!token) return null;
    const verified = userSession.verifyUserToken(token);
    return verified ? verified.userId : null;
  } catch {
    return null;
  }
}

function getOrCreateActiveSession({ userId, anonSessionId, cardId }) {
  if (!userId && !anonSessionId) return null;

  const db = getDatabase();
  const now = Date.now();
  const cutoff = now - SESSION_REUSE_WINDOW_MS;

  let row = null;
  if (userId) {
    row = db
      .prepare(
        `SELECT * FROM chat_sessions
         WHERE user_id = ?
           AND ((? IS NULL AND card_id IS NULL) OR card_id = ?)
           AND last_active_at >= ?
         ORDER BY last_active_at DESC LIMIT 1`
      )
      .get(userId, cardId, cardId, cutoff);
  } else {
    row = db
      .prepare(
        `SELECT * FROM chat_sessions
         WHERE anon_session_id = ? AND user_id IS NULL
           AND ((? IS NULL AND card_id IS NULL) OR card_id = ?)
           AND last_active_at >= ?
         ORDER BY last_active_at DESC LIMIT 1`
      )
      .get(anonSessionId, cardId, cardId, cutoff);
  }
  if (row) return row;

  return dbSessions.createSession({
    userId: userId || null,
    anonSessionId: userId ? null : anonSessionId,
    cardId: cardId || null,
  });
}

function buildUserMemorySnapshot(userId) {
  if (!userId) return null;
  let northStar = null;
  let facts = [];
  try {
    const goal = dbGoals.getCurrent(userId);
    if (goal?.north_star) northStar = goal.north_star;
  } catch (err) {
    logEvent("warning", "memory_snapshot_goal_failed", {
      userId,
      details: safeSlice(err?.message || String(err), 200),
    });
  }
  try {
    facts = dbFacts.listTopFacts(userId, 8) || [];
  } catch (err) {
    logEvent("warning", "memory_snapshot_facts_failed", {
      userId,
      details: safeSlice(err?.message || String(err), 200),
    });
  }
  if (!northStar && (!facts || !facts.length)) return null;
  return {
    northStar: northStar ? safeSlice(northStar, 240) : null,
    facts: facts.slice(0, 8).map((f) => ({
      kind: String(f.kind || ""),
      text: safeSlice(f.text, 200),
    })),
  };
}

function attachUserMemoryToBody(request, body) {
  try {
    const userId = getCurrentUserIdFromRequest(request);
    if (!userId) return;
    const memory = buildUserMemorySnapshot(userId);
    if (!memory) return;
    if (!isPlainObject(body.context)) body.context = {};
    body.context.userMemory = memory;
  } catch (err) {
    logEvent("warning", "attach_user_memory_failed", {
      details: safeSlice(err?.message || String(err), 200),
    });
  }
}

function scheduleFactExtraction({
  userId,
  sessionId,
  userMessageId,
  userText,
  assistantText,
}) {
  if (!userId || !DEEPSEEK_API_KEY) return;
  setImmediate(() => {
    let northStarText = null;
    try {
      const goal = dbGoals.getCurrent(userId);
      if (goal) northStarText = goal.north_star;
    } catch (err) {
      logEvent("warning", "fact_extract_lookup_goal_failed", {
        userId,
        details: safeSlice(err?.message || String(err), 200),
      });
    }
    factExtractor
      .extractFactsFromTurn({
        userId,
        sessionId,
        userMessageId,
        userText,
        assistantText,
        northStar: northStarText,
        apiKey: DEEPSEEK_API_KEY,
        model: DEEPSEEK_MODEL,
        logger: logEvent,
      })
      .catch((err) => {
        logEvent("warning", "fact_extract_unhandled", {
          userId,
          details: safeSlice(err?.message || String(err), 240),
        });
      });
  });
}

// persistChatTurn — 把这一轮对话（user msg + assistant msg + 计数器）原子性
// 写入 SQLite。
//
// 返回值约定（被调用者必须用来决定要不要在 response 里带 persistence_ok=false）：
//   { ok: true,  reason: "stored" }      正常写入了
//   { ok: true,  reason: "no_session" }  匿名 cookie 缺失，连会话都建不出来 — 历史
//                                        上这就是"静默丢"的根，现在显式上报，
//                                        前端要在第二轮发现并给用户弹 toast
//   { ok: true,  reason: "empty" }       user 或 assistant 文本是空的，无须存
//   { ok: false, reason: "...err..." }   appendTurn 抛了异常，已经回滚
//
// 注意：fact extraction 和 user.total_chat_turns 是"派生数据"，写失败不影响主
// 体的"对话已存"语义，所以分开 try/catch、不影响 ok 判定。
function persistChatTurn({
  request,
  anonSessionId,
  body,
  replyText,
  provider,
  degraded,
}) {
  let effectiveAnonId = anonSessionId;
  if (!effectiveAnonId || effectiveAnonId === "local-dev") {
    const cookies = parseCookies(request.headers.cookie || "");
    effectiveAnonId = sanitizeSessionId(cookies[CHAT_SESSION_COOKIE]) || null;
  }
  if (!effectiveAnonId) {
    return { ok: true, reason: "no_session" };
  }

  const lastUserMessage = Array.isArray(body?.messages)
    ? [...body.messages].reverse().find((m) => m && m.role === "user")
    : null;
  if (!lastUserMessage || typeof lastUserMessage.content !== "string") {
    return { ok: true, reason: "empty" };
  }

  const userText = lastUserMessage.content.trim();
  const replyTextTrimmed = String(replyText || "").trim();
  if (!userText || !replyTextTrimmed) {
    return { ok: true, reason: "empty" };
  }

  const userId = getCurrentUserIdFromRequest(request);
  const cardId = body?.context?.activeCard?.id || null;

  let session;
  let turn;
  try {
    session = getOrCreateActiveSession({
      userId,
      anonSessionId: effectiveAnonId,
      cardId,
    });
    if (!session) {
      logEvent("warning", "chat_persistence_no_session", {
        anonSessionId: effectiveAnonId,
        userId,
      });
      return { ok: false, reason: "no_session_after_get_or_create" };
    }

    turn = dbSessions.appendTurn({
      sessionId: session.id,
      userContent: userText.slice(0, 4000),
      assistantContent: replyTextTrimmed.slice(0, 4000),
      assistantProvider: provider || null,
      assistantDegraded: Boolean(degraded),
    });
  } catch (err) {
    logEvent("error", "chat_persistence_failed", {
      anonSessionId: effectiveAnonId,
      userId: userId || null,
      sessionId: session ? session.id : null,
      details: safeSlice(err?.message || String(err), 300),
    });
    return {
      ok: false,
      reason: safeSlice(err?.code || err?.message || "persist_error", 80),
    };
  }

  if (userId) {
    try {
      dbUsers.incrementChatTurns(userId, 1);
    } catch (err) {
      logEvent("warning", "chat_turn_counter_failed", {
        userId,
        details: safeSlice(err?.message || String(err), 240),
      });
    }
    try {
      scheduleFactExtraction({
        userId,
        sessionId: session.id,
        userMessageId: turn.userMessage ? turn.userMessage.id : null,
        userText,
        assistantText: replyTextTrimmed,
      });
    } catch (err) {
      logEvent("warning", "fact_extract_schedule_failed", {
        userId,
        details: safeSlice(err?.message || String(err), 240),
      });
    }
  }

  return { ok: true, reason: "stored" };
}

async function handleChatRequest(request, response) {
  if (request.method !== "POST") {
    return sendJson(response, 405, {
      error: "method_not_allowed",
      requestId: response.__meta.requestId,
    });
  }

  const securityCheck = validateChatRequestSecurity(request);
  if (!securityCheck.ok) {
    response.__meta.error = securityCheck.reason;
    logEvent("warning", "chat_request_rejected", {
      requestId: response.__meta.requestId,
      reason: securityCheck.reason,
      clientIp: response.__meta.clientIp,
    });
    return sendJson(
      response,
      403,
      {
        error: securityCheck.reason,
        message: "当前请求未通过站内安全校验。",
        requestId: response.__meta.requestId,
      }
    );
  }

  const rateLimit = consumeRateLimit(response.__meta.clientIp);
  const rateLimitHeaders = buildRateLimitHeaders(rateLimit);

  if (!rateLimit.allowed) {
    response.__meta.error = "rate_limited";
    return sendJson(
      response,
      429,
      {
        error: "rate_limited",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        message: "请求太频繁了，请稍后再试。",
        requestId: response.__meta.requestId,
      },
      {
        ...rateLimitHeaders,
        "Retry-After": String(rateLimit.retryAfterSeconds),
      }
    );
  }

  let rawBody;
  try {
    rawBody = await readJsonBody(request);
  } catch (error) {
    response.__meta.error = error.message || "invalid_json";
    return sendJson(
      response,
      error.message === "request_too_large" ? 413 : 400,
      {
        error: error.message === "request_too_large" ? "request_too_large" : "invalid_json",
        requestId: response.__meta.requestId,
      },
      rateLimitHeaders
    );
  }

  const validation = validateChatBody(rawBody);
  if (!validation.ok) {
    response.__meta.error = "invalid_request";
    return sendJson(
      response,
      400,
      {
        error: "invalid_request",
        details: validation.errors,
        requestId: response.__meta.requestId,
      },
      rateLimitHeaders
    );
  }

  const body = validation.payload;
  attachUserMemoryToBody(request, body);
  const cachePolicy = getCachePolicy(body);
  response.__meta.cacheEligible = cachePolicy.eligible;
  response.__meta.cacheReason = cachePolicy.reason;
  const cacheKey = cachePolicy.eligible ? buildCacheKey(body, cachePolicy, securityCheck.sessionId) : "";
  const cachedReply = cachePolicy.eligible ? getCachedReply(cacheKey) : null;

  if (cachedReply) {
    response.__meta.provider = cachedReply.provider;
    response.__meta.cacheHit = true;
    recordAnalyticsChatTurn(securityCheck.sessionId, request, {
      provider: cachedReply.provider,
      degraded: false,
      cacheHit: true,
    });
    const persistRes = persistChatTurn({
      request,
      anonSessionId: securityCheck.sessionId,
      body,
      replyText: cachedReply.reply,
      provider: cachedReply.provider,
      degraded: false,
    });
    return sendJson(
      response,
      200,
      {
        ...cachedReply,
        cached: true,
        requestId: response.__meta.requestId,
        ...persistenceMeta(persistRes),
      },
      rateLimitHeaders
    );
  }

  if (!DEEPSEEK_API_KEY) {
    response.__meta.provider = "local-fallback";
    response.__meta.degraded = true;
    const fallbackReply = buildLocalFallbackReply(body, "missing_api_key");
    recordAnalyticsChatTurn(securityCheck.sessionId, request, {
      provider: "local-fallback",
      degraded: true,
      reason: "missing_api_key",
    });
    const persistRes = persistChatTurn({
      request,
      anonSessionId: securityCheck.sessionId,
      body,
      replyText: fallbackReply,
      provider: "local-fallback",
      degraded: true,
    });
    return sendJson(
      response,
      200,
      {
        reply: fallbackReply,
        provider: "local-fallback",
        model: "local-knowledge",
        degraded: true,
        reason: "missing_api_key",
        requestId: response.__meta.requestId,
        ...persistenceMeta(persistRes),
      },
      rateLimitHeaders
    );
  }

  if (isCircuitOpen()) {
    response.__meta.provider = "local-fallback";
    response.__meta.degraded = true;
    response.__meta.error = "circuit_open";
    const fallbackReply = buildLocalFallbackReply(body, "circuit_open");
    recordAnalyticsChatTurn(securityCheck.sessionId, request, {
      provider: "local-fallback",
      degraded: true,
      reason: "circuit_open",
    });
    const persistRes = persistChatTurn({
      request,
      anonSessionId: securityCheck.sessionId,
      body,
      replyText: fallbackReply,
      provider: "local-fallback",
      degraded: true,
    });
    return sendJson(
      response,
      200,
      {
        reply: fallbackReply,
        provider: "local-fallback",
        model: "local-knowledge",
        degraded: true,
        reason: "circuit_open",
        requestId: response.__meta.requestId,
        ...persistenceMeta(persistRes),
      },
      rateLimitHeaders
    );
  }

  try {
    const upstreamResult = await requestDeepSeek(body);
    markUpstreamSuccess();
    if (cachePolicy.eligible) {
      setCachedReply(cacheKey, upstreamResult);
    }
    response.__meta.provider = upstreamResult.provider;
    recordAnalyticsChatTurn(securityCheck.sessionId, request, {
      provider: upstreamResult.provider,
      degraded: false,
      cacheHit: false,
    });
    const persistRes = persistChatTurn({
      request,
      anonSessionId: securityCheck.sessionId,
      body,
      replyText: upstreamResult.reply,
      provider: upstreamResult.provider,
      degraded: false,
    });

    return sendJson(
      response,
      200,
      {
        ...upstreamResult,
        cached: false,
        degraded: false,
        requestId: response.__meta.requestId,
        ...persistenceMeta(persistRes),
      },
      rateLimitHeaders
    );
  } catch (error) {
    markUpstreamFailure(error);
    response.__meta.provider = "local-fallback";
    response.__meta.degraded = true;
    response.__meta.error = error.code || error.message || "upstream_failed";
    logEvent("error", "upstream_request_failed", {
      requestId: response.__meta.requestId,
      code: error.code || "upstream_failed",
      details: error.details || safeSlice(error.message, 300),
    });
    const fallbackReply = buildLocalFallbackReply(body, error.code || "upstream_unavailable");
    recordAnalyticsChatTurn(securityCheck.sessionId, request, {
      provider: "local-fallback",
      degraded: true,
      reason: error.code || "upstream_unavailable",
    });
    const persistRes = persistChatTurn({
      request,
      anonSessionId: securityCheck.sessionId,
      body,
      replyText: fallbackReply,
      provider: "local-fallback",
      degraded: true,
    });

    return sendJson(
      response,
      200,
      {
        reply: fallbackReply,
        provider: "local-fallback",
        model: "local-knowledge",
        degraded: true,
        reason: error.code || "upstream_unavailable",
        requestId: response.__meta.requestId,
        ...persistenceMeta(persistRes),
      },
      rateLimitHeaders
    );
  }
}

// persistenceMeta — 把 persistChatTurn 的返回值转成 response 多余的 keys。
// 只有真正失败（DB 异常、appendTurn 抛错）才会带 persistence_ok=false 上去，
// 让前端在用户面前 toast。匿名 cookie 缺失等"还能聊但不会落库"的场景不报错，
// 因为那是设计层面的取舍——访客模式本来就不存。
function persistenceMeta(result) {
  if (!result || result.ok === true) return {};
  return {
    persistence_ok: false,
    persistence_reason: result.reason || "unknown",
  };
}

function buildUpstreamMessages(body) {
  const systemPrompt = String(body.systemPrompt || "").trim();
  const contextBlock = buildContextBlock(body.context || {});
  const history = Array.isArray(body.messages) ? body.messages : [];

  return [
    {
      role: "system",
      content: [systemPrompt, contextBlock].filter(Boolean).join("\n\n"),
    },
    ...history
      .filter((message) => message && (message.role === "user" || message.role === "assistant"))
      .map((message) => ({
        role: message.role,
        content: String(message.content || "").slice(0, 6000),
      })),
  ];
}

function buildContextBlock(context) {
  const sections = [];

  if (context.userMemory) {
    const lines = ["关于用户（这位你已经聊过的人，请把它当成持续关系来回应，不要每次像第一次见）"];
    if (context.userMemory.northStar) {
      lines.push(`北极星目标：${context.userMemory.northStar}`);
    }
    if (Array.isArray(context.userMemory.facts) && context.userMemory.facts.length) {
      const kindLabel = {
        intend: "在打算",
        blocker: "卡在",
        deadline: "时间锚",
        done: "已经做了",
        belief: "相信",
      };
      lines.push("你已经知道关于他的事：");
      for (const fact of context.userMemory.facts) {
        const label = kindLabel[fact.kind] || fact.kind;
        lines.push(`  - [${label}] ${fact.text}`);
      }
      lines.push("使用建议：当用户的话与上面的事相关时，主动援引（「上次你说…」），让他感到你记得；不要罗列，只在关键处点名。");
    }
    sections.push(lines.join("\n"));
  }

  if (context.activeCard) {
    sections.push([
      "当前卡片",
      `中文标题：${context.activeCard.title_zh || ""}`,
      `英文主题：${context.activeCard.theme_en || ""}`,
      `中文摘要：${context.activeCard.summary_zh || ""}`,
      `知识点：${(context.activeCard.knowledge_points_zh || []).join(" / ")}`,
      `教练角度：${(context.activeCard.coaching_angles_zh || []).join(" / ")}`,
      `英文锚点：${(context.activeCard.source_excerpt_en || []).join(" / ")}`,
    ].join("\n"));
  }

  if (Array.isArray(context.suggestedCards) && context.suggestedCards.length) {
    sections.push([
      "候选卡片",
      ...context.suggestedCards.map((item, index) => `${index + 1}. ${item.title_zh} - ${item.hook_zh}`),
    ].join("\n"));
  }

  if (context.userContext) {
    sections.push([
      "用户处境信号",
      `情绪：${(context.userContext.emotions || []).join(" / ") || "无"}`,
      `场景：${(context.userContext.scenario || []).join(" / ") || "无"}`,
      `摘要：${context.userContext.snippet || "无"}`,
    ].join("\n"));
  }

  if (context.conversationMeta) {
    sections.push([
      "对话状态",
      `当前轮次风格：${context.conversationMeta.turnStyle || "opening"}`,
      `是否已有助手历史：${context.conversationMeta.hasAssistantHistory ? "是" : "否"}`,
      `粗略意图：${context.conversationMeta.detectedIntent || "default"}`,
    ].join("\n"));
  }

  if (context.chapterTitle) {
    sections.push(`更贴近的章节：${context.chapterTitle}`);
  }

  if (Array.isArray(context.knowledgeHits) && context.knowledgeHits.length) {
    sections.push([
      "检索到的书中材料",
      ...context.knowledgeHits.map((item, index) => {
        const prefix = item.chapterTitle ? `[${item.type} / ${item.chapterTitle}]` : `[${item.type}]`;
        return `${index + 1}. ${prefix} ${item.text}`;
      }),
    ].join("\n"));
  }

  if (Array.isArray(context.productRules) && context.productRules.length) {
    sections.push([
      "回答规则",
      ...context.productRules.map((item, index) => `${index + 1}. ${item}`),
    ].join("\n"));
  }

  return sections.join("\n\n");
}

const COMPRESSIBLE_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".svg"]);

function isStaticPathAllowed(normalizedPath) {
  // 路径在白名单里就放行，否则一律 404。
  // 把 path.normalize 的结果也校验一遍，挡 /data/../server.js 这种穿越后
  // 才落到允许名单里的情况。
  if (STATIC_FILE_ALLOW.has(normalizedPath)) {
    const collapsed = path.posix.normalize(normalizedPath);
    if (collapsed === normalizedPath) return { ok: true };
    return { ok: false, reason: "normalized_mismatch" };
  }
  return { ok: false, reason: "not_in_allowlist" };
}

async function serveStaticFile(requestPath, response) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;

  const allowCheck = isStaticPathAllowed(normalizedPath);
  if (!allowCheck.ok) {
    return sendJson(response, 404, { error: "not_found" });
  }

  const safePath = path.normalize(normalizedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(projectRoot, safePath);

  if (!filePath.startsWith(projectRoot)) {
    return sendJson(response, 403, { error: "forbidden" });
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (error) {
    return sendJson(response, 404, { error: "not_found" });
  }

  if (stat.isDirectory()) {
    return sendJson(response, 404, { error: "not_found" });
  }

  const ext = path.extname(filePath).toLowerCase();
  const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
  const ifNoneMatch = response.__request.headers["if-none-match"];

  if (ifNoneMatch && ifNoneMatch === etag) {
    response.writeHead(304);
    response.end();
    return;
  }

  const headers = {
    ...buildSecurityHeaders(response.__request),
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600",
    ETag: etag,
  };

  const acceptEncoding = String(response.__request.headers["accept-encoding"] || "");
  const shouldCompress = COMPRESSIBLE_EXTENSIONS.has(ext) && stat.size > 1024;

  if (shouldCompress && acceptEncoding.includes("gzip")) {
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
    response.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(zlib.createGzip({ level: 6 })).pipe(response);
    return;
  }

  response.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(response);
}

function buildRuntimeConfigScript(sessionId) {
  return `window.BOOK_OF_ELON_RUNTIME_CONFIG = ${JSON.stringify({
    provider: "deepseek",
    providerLabel: "DeepSeek",
    model: DEEPSEEK_MODEL,
    llmEnabled: Boolean(DEEPSEEK_API_KEY),
    chatEndpoint: "/api/chat",
    analyticsEndpoint: "/api/analytics",
    analyticsHeartbeatMs: Math.max(30000, ANALYTICS_HEARTBEAT_MIN_INTERVAL_MS * 2),
    requestTimeoutMs: UPSTREAM_TIMEOUT_MS,
    chatSessionToken: createChatSessionToken(sessionId),
    promptVersion: PROMPT_VERSION,
  })};`;
}

function sendJavaScript(response, source, extraHeaders = {}) {
  response.writeHead(200, {
    ...buildSecurityHeaders(response.__request),
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(source);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let settled = false;

    request.on("data", (chunk) => {
      if (settled) return;
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        settled = true;
        request.destroy();
        reject(new Error("request_too_large"));
      }
    });

    request.on("end", () => {
      if (settled) return;
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function validateChatBody(body) {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      errors: ["请求体必须是 JSON 对象。"],
    };
  }

  const sanitizedMessages = sanitizeMessages(body.messages);
  const latestUserText = extractLatestUserText(sanitizedMessages) || safeSlice(body.userText, 2000).trim();

  if (!latestUserText) {
    return {
      ok: false,
      errors: ["至少需要一条用户消息。"],
    };
  }

  if (!sanitizedMessages.length) {
    sanitizedMessages.push({
      role: "user",
      content: latestUserText,
    });
  }

  return {
    ok: true,
    payload: {
      model: DEEPSEEK_MODEL,
      systemPrompt: safeSlice(body.systemPrompt, 4000).trim(),
      messages: sanitizedMessages,
      context: sanitizeContext(body.context),
    },
  };
}

async function handleAnalyticsEventRequest(request, response) {
  if (request.method !== "POST") {
    return sendJson(response, 405, {
      error: "method_not_allowed",
      requestId: response.__meta.requestId,
    });
  }

  let rawBody;
  try {
    rawBody = await readJsonBody(request);
  } catch (error) {
    response.__meta.error = error.message || "invalid_json";
    return sendJson(response, 400, {
      error: "invalid_json",
      requestId: response.__meta.requestId,
    });
  }

  const securityCheck = validateChatRequestSecurity(request, rawBody?.token);
  if (!securityCheck.ok) {
    response.__meta.error = securityCheck.reason;
    return sendJson(response, 403, {
      error: securityCheck.reason,
      requestId: response.__meta.requestId,
    });
  }

  const eventType = String(rawBody?.type || "").trim();
  if (eventType !== "heartbeat" && eventType !== "leave") {
    response.__meta.error = "invalid_event_type";
    return sendJson(response, 400, {
      error: "invalid_event_type",
      requestId: response.__meta.requestId,
    });
  }

  const accepted = recordAnalyticsActivity(securityCheck.sessionId, request, eventType, {
    pagePath: safeSlice(rawBody?.pagePath || "/", 120),
    source: "frontend_beacon",
  });

  return sendJson(response, 202, {
    ok: true,
    accepted,
    throttled: !accepted,
    requestId: response.__meta.requestId,
  });
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .slice(-10)
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .map((message) => ({
      role: message.role,
      content: safeSlice(message.content, 2500).trim(),
    }))
    .filter((message) => message.content);
}

function sanitizeContext(context) {
  const safeContext = isPlainObject(context) ? context : {};
  const safeActiveCard = isPlainObject(safeContext.activeCard) ? safeContext.activeCard : {};
  const safeUserContext = isPlainObject(safeContext.userContext) ? safeContext.userContext : {};
  const safeConversationMeta = isPlainObject(safeContext.conversationMeta) ? safeContext.conversationMeta : {};

  return {
    activeCard: safeActiveCard.id || safeActiveCard.title_zh
      ? {
          id: safeSlice(safeActiveCard.id, 80),
          title_zh: safeSlice(safeActiveCard.title_zh, 80),
          theme_en: safeSlice(safeActiveCard.theme_en, 120),
          summary_zh: safeSlice(safeActiveCard.summary_zh, 200),
          knowledge_points_zh: sanitizeStringArray(safeActiveCard.knowledge_points_zh, 3, 80),
          coaching_angles_zh: sanitizeStringArray(safeActiveCard.coaching_angles_zh, 3, 80),
          source_excerpt_en: sanitizeStringArray(safeActiveCard.source_excerpt_en, 3, 160),
        }
      : null,
    suggestedCards: sanitizeObjectArray(safeContext.suggestedCards, 3).map((item) => ({
      id: safeSlice(item.id, 80),
      title_zh: safeSlice(item.title_zh, 80),
      hook_zh: safeSlice(item.hook_zh, 120),
    })),
    userContext: {
      emotions: sanitizeStringArray(safeUserContext.emotions, 3, 30),
      scenario: sanitizeStringArray(safeUserContext.scenario, 3, 40),
      snippet: safeSlice(safeUserContext.snippet, 160),
    },
    conversationMeta: {
      hasAssistantHistory: Boolean(safeConversationMeta.hasAssistantHistory),
      turnStyle: safeSlice(safeConversationMeta.turnStyle, 30),
      detectedIntent: safeSlice(safeConversationMeta.detectedIntent, 30),
    },
    chapterTitle: safeSlice(safeContext.chapterTitle, 120),
    knowledgeHits: sanitizeObjectArray(safeContext.knowledgeHits, 6).map((item) => ({
      type: safeSlice(item.type, 40),
      text: safeSlice(item.text, 260),
      chapterTitle: safeSlice(item.chapterTitle, 120),
      cardId: safeSlice(item.cardId, 80),
    })),
    productRules: sanitizeStringArray(safeContext.productRules, 12, 180),
  };
}

async function requestDeepSeek(body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        temperature: DEEPSEEK_TEMPERATURE,
        max_tokens: DEEPSEEK_MAX_TOKENS,
        messages: buildUpstreamMessages(body),
      }),
    });

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      throw createAppError("upstream_http_error", {
        upstreamStatus: upstreamResponse.status,
        details: safeSlice(errorText, 400),
      });
    }

    const data = await upstreamResponse.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      throw createAppError("empty_upstream_reply");
    }

    return {
      reply,
      provider: "DeepSeek",
      model: DEEPSEEK_MODEL,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw createAppError("upstream_timeout");
    }
    if (error.code) {
      throw error;
    }
    throw createAppError("upstream_fetch_failed", {
      details: safeSlice(error.message, 200),
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildLocalFallbackReply(body, reason) {
  const userText = extractLatestUserText(body.messages);
  const context = body.context || {};
  const activeCard = context.activeCard || null;
  const firstKnowledgeHit = Array.isArray(context.knowledgeHits) ? context.knowledgeHits.find((item) => item && item.text) : null;
  const emotions = Array.isArray(context.userContext?.emotions) ? context.userContext.emotions.filter(Boolean) : [];
  const paragraphs = [];

  paragraphs.push(getFallbackIntro(reason));

  if (emotions.length) {
    paragraphs.push(`你这句里比较明显的拉扯，是在 ${emotions.slice(0, 2).join(" 和 ")} 之间。`);
  } else if (userText) {
    paragraphs.push("我先不把它说成大道理，先贴着你眼前这件事来拆。");
  }

  if (activeCard?.title_zh) {
    paragraphs.push(`如果先围绕 ${activeCard.title_zh} 这个主题来看，关键不是马上得到一个完美答案，而是先把真正卡住你的那一层说清楚。`);
  }

  if (activeCard?.summary_zh) {
    paragraphs.push(activeCard.summary_zh);
  } else if (firstKnowledgeHit?.text) {
    paragraphs.push(`书里有一段很贴近你现在的问题：${firstKnowledgeHit.text}`);
  }

  paragraphs.push(buildFallbackClose(activeCard, userText));

  return paragraphs.filter(Boolean).join("\n\n");
}

function getFallbackIntro(reason) {
  if (reason === "circuit_open") {
    return "当前对话请求有点密，我先用本地知识模式继续陪你拆，不让你空等。";
  }
  if (reason === "upstream_timeout") {
    return "模型刚刚响应有点慢，我先给你一个基于书里内容的快速回答。";
  }
  if (reason === "missing_api_key") {
    return "我先按本地知识模式陪你往下拆。";
  }
  return "现在对话通道有点挤，我先给你一个基于书里内容的快速回答。";
}

function buildFallbackClose(activeCard, userText) {
  if (activeCard?.title_zh) {
    return `你下一句可以直接告诉我：围绕 ${activeCard.title_zh}，你现在最卡的是害怕失败、外界评价，还是第一步怎么开始。`;
  }

  if (userText) {
    return "你下一句可以直接补最现实的一层处境，我继续按这本书的思路帮你往下拆。";
  }

  return "你可以直接告诉我你现在最现实的处境，我继续帮你往下拆。";
}

function consumeRateLimit(clientIp) {
  const now = Date.now();
  const bucket = rateLimitStore.get(clientIp) || {
    minuteWindowStartedAt: now,
    minuteCount: 0,
    burstWindowStartedAt: now,
    burstCount: 0,
  };

  if (now - bucket.minuteWindowStartedAt >= CHAT_RATE_LIMIT_WINDOW_MS) {
    bucket.minuteWindowStartedAt = now;
    bucket.minuteCount = 0;
  }

  if (now - bucket.burstWindowStartedAt >= CHAT_BURST_WINDOW_MS) {
    bucket.burstWindowStartedAt = now;
    bucket.burstCount = 0;
  }

  const minuteExceeded = bucket.minuteCount >= CHAT_RATE_LIMIT_MAX_REQUESTS;
  const burstExceeded = bucket.burstCount >= CHAT_BURST_MAX_REQUESTS;

  if (minuteExceeded || burstExceeded) {
    const minuteResetInMs = bucket.minuteWindowStartedAt + CHAT_RATE_LIMIT_WINDOW_MS - now;
    const burstResetInMs = bucket.burstWindowStartedAt + CHAT_BURST_WINDOW_MS - now;
    const waitMs = Math.max(minuteExceeded ? minuteResetInMs : 0, burstExceeded ? burstResetInMs : 0);

    rateLimitStore.set(clientIp, bucket);
    return {
      allowed: false,
      limit: CHAT_RATE_LIMIT_MAX_REQUESTS,
      remaining: 0,
      resetAt: now + waitMs,
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
    };
  }

  bucket.minuteCount += 1;
  bucket.burstCount += 1;
  rateLimitStore.set(clientIp, bucket);

  return {
    allowed: true,
    limit: CHAT_RATE_LIMIT_MAX_REQUESTS,
    remaining: Math.max(0, CHAT_RATE_LIMIT_MAX_REQUESTS - bucket.minuteCount),
    resetAt: bucket.minuteWindowStartedAt + CHAT_RATE_LIMIT_WINDOW_MS,
    retryAfterSeconds: 0,
  };
}

function buildRateLimitHeaders(rateLimit) {
  return {
    "X-RateLimit-Limit": String(rateLimit.limit),
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)),
  };
}

function getCachePolicy(body) {
  if (!CHAT_CACHE_TTL_MS) {
    return { eligible: false, reason: "cache_disabled" };
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const userMessages = messages.filter((message) => message.role === "user");
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const latestUserText = normalizeCacheText(extractLatestUserText(messages));
  const detectedIntent = normalizeCacheText(body.context?.conversationMeta?.detectedIntent || "");
  const activeCardId = normalizeCacheText(body.context?.activeCard?.id || "");

  if (!activeCardId) {
    return { eligible: false, reason: "no_active_card" };
  }

  if (assistantMessages.length || userMessages.length !== 1 || messages.length !== 1) {
    return { eligible: false, reason: "multi_turn" };
  }

  if (!latestUserText || latestUserText.length < 4 || latestUserText.length > 80) {
    return { eligible: false, reason: "text_length" };
  }

  if (!["source", "meaning", "related"].includes(detectedIntent)) {
    return { eligible: false, reason: "dynamic_intent" };
  }

  if (hasHighPersonalizationSignals(latestUserText)) {
    return { eligible: false, reason: "personalized_prompt" };
  }

  return {
    eligible: true,
    reason: "safe_first_turn_knowledge",
    normalizedUserText: latestUserText,
    detectedIntent,
    activeCardId,
  };
}

function buildCacheKey(body, cachePolicy, sessionId) {
  return JSON.stringify({
    sessionId,
    model: body.model,
    systemPrompt: normalizeCacheText(body.systemPrompt),
    activeCardId: cachePolicy.activeCardId,
    detectedIntent: cachePolicy.detectedIntent,
    userText: cachePolicy.normalizedUserText,
  });
}

function getCachedReply(cacheKey) {
  if (!CHAT_CACHE_TTL_MS) return null;

  const cached = responseCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
}

function setCachedReply(cacheKey, payload) {
  if (!CHAT_CACHE_TTL_MS) return;

  cleanupExpiredCacheEntries();
  if (responseCache.has(cacheKey)) {
    responseCache.delete(cacheKey);
  }
  responseCache.set(cacheKey, {
    expiresAt: Date.now() + CHAT_CACHE_TTL_MS,
    payload,
  });
  trimCacheEntries();
}

function isCircuitOpen() {
  if (!circuitState.openedAt) return false;
  if (Date.now() - circuitState.openedAt >= CIRCUIT_BREAKER_COOLDOWN_MS) {
    circuitState.openedAt = 0;
    circuitState.consecutiveFailures = 0;
    return false;
  }
  return true;
}

function markUpstreamSuccess() {
  circuitState.consecutiveFailures = 0;
  circuitState.openedAt = 0;
}

// Deep health: ping DB + LLM 状态 + version + 表行数。
// 给 uptime 监控、`/land-and-deploy` canary、运维排查使用。
// 永远返回 HTTP 200，但内部 status 可能是 "ok" / "degraded" / "down"，
// 外部监控应当读 body.status，不只是 HTTP code。
function buildDeepHealth({ requestId }) {
  const startedAtMs = Date.now();
  let dbStatus = "ok";
  let dbLatencyMs = 0;
  let counts = null;
  let dbError = null;

  try {
    const db = getDatabase();
    const tDb = Date.now();
    const ping = db.prepare("SELECT 1 AS ok").get();
    dbLatencyMs = Date.now() - tDb;
    if (!ping || ping.ok !== 1) throw new Error("db_ping_unexpected");
    counts = {
      users: db.prepare("SELECT COUNT(*) AS c FROM users").get().c,
      chat_sessions: db.prepare("SELECT COUNT(*) AS c FROM chat_sessions").get().c,
      messages: db.prepare("SELECT COUNT(*) AS c FROM messages").get().c,
      facts: db.prepare("SELECT COUNT(*) AS c FROM facts").get().c,
      goals: db.prepare("SELECT COUNT(*) AS c FROM goals").get().c,
    };
  } catch (err) {
    dbStatus = "down";
    dbError = String(err?.message || err).slice(0, 200);
  }

  const llmEnabled = Boolean(DEEPSEEK_API_KEY);
  const circuitOpen = isCircuitOpen();
  const llmStatus = !llmEnabled ? "disabled" : circuitOpen ? "circuit_open" : "ok";
  const overall = dbStatus === "down" ? "down" : circuitOpen ? "degraded" : "ok";
  const memoryMb = Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;

  let version = "unknown";
  try {
    version = require("./package.json").version || "unknown";
  } catch (_) {
    /* ignore */
  }

  return {
    status: overall,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    version,
    promptVersion: PROMPT_VERSION,
    model: llmEnabled ? DEEPSEEK_MODEL : null,
    db: {
      status: dbStatus,
      latency_ms: dbLatencyMs,
      counts,
      error: dbError,
    },
    llm: {
      status: llmStatus,
      enabled: llmEnabled,
      circuit_open: circuitOpen,
      consecutive_failures: circuitState.consecutiveFailures,
    },
    process: {
      pid: process.pid,
      heap_mb: memoryMb,
      node: process.version,
    },
    check_duration_ms: Date.now() - startedAtMs,
    requestId,
  };
}

function markUpstreamFailure(error) {
  if (!shouldCountFailureForCircuit(error)) {
    return;
  }

  circuitState.consecutiveFailures += 1;
  if (circuitState.consecutiveFailures >= CIRCUIT_BREAKER_FAIL_THRESHOLD) {
    circuitState.openedAt = Date.now();
  }
}

function cleanupExpiredEntries() {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
    return;
  }
  lastCleanupAt = now;

  cleanupExpiredCacheEntries(now);

  for (const [key, value] of rateLimitStore.entries()) {
    if (
      now - value.minuteWindowStartedAt > CHAT_RATE_LIMIT_WINDOW_MS * 2 &&
      now - value.burstWindowStartedAt > CHAT_BURST_WINDOW_MS * 2
    ) {
      rateLimitStore.delete(key);
    }
  }

  pruneAnalyticsState(now);
}

function cleanupExpiredCacheEntries(now = Date.now()) {
  for (const [key, value] of responseCache.entries()) {
    if (value.expiresAt <= now) {
      responseCache.delete(key);
    }
  }
}

function trimCacheEntries() {
  if (!CHAT_CACHE_TTL_MS || responseCache.size <= CHAT_CACHE_MAX_ENTRIES) {
    return;
  }

  while (responseCache.size > CHAT_CACHE_MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (!oldestKey) break;
    responseCache.delete(oldestKey);
  }
}

function logRequest({ request, response, startedAt }) {
  const durationMs = Date.now() - startedAt;
  const meta = response.__meta || {};
  logEvent("info", "request_completed", {
    method: request.method,
    path: request.url,
    statusCode: response.statusCode,
    durationMs,
    route: meta.route,
    requestId: meta.requestId,
    clientIp: meta.clientIp,
    provider: meta.provider,
    cacheHit: meta.cacheHit,
    cacheEligible: meta.cacheEligible,
    cacheReason: meta.cacheReason || "",
    degraded: meta.degraded,
    error: meta.error || "",
    slowRequest: durationMs >= SLOW_REQUEST_THRESHOLD_MS,
  });
}

function shutdown() {
  logEvent("info", "server_shutdown_requested");
  flushAnalyticsStateSync();
  server.close(() => process.exit(0));
}

function logEvent(level, event, payload = {}) {
  const record = {
    type: "event",
    level,
    event,
    time: new Date().toISOString(),
    ...payload,
  };

  const line = JSON.stringify(record);
  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warning") {
    console.warn(line);
    return;
  }

  console.log(line);
}

function createAppError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function createRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrCreateAnonymousSessionId(request) {
  const cookies = parseCookies(request?.headers?.cookie || "");
  const existingSessionId = sanitizeSessionId(cookies[CHAT_SESSION_COOKIE]);
  if (existingSessionId) {
    return existingSessionId;
  }
  return crypto.randomBytes(18).toString("hex");
}

function buildSessionCookie(request, sessionId) {
  const parts = [
    `${CHAT_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(60, Math.floor(CHAT_TOKEN_TTL_MS / 1000))}`,
  ];

  if (isSecureRequest(request)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function createChatSessionToken(sessionId) {
  const expiresAt = Date.now() + CHAT_TOKEN_TTL_MS;
  const payload = `${sessionId}.${expiresAt}`;
  const signature = crypto.createHmac("sha256", SESSION_TOKEN_SECRET).update(payload).digest("base64url");
  return `${expiresAt}.${signature}`;
}

function validateChatRequestSecurity(request, tokenOverride = "") {
  if (isLocalDevelopmentBypass(request)) {
    return {
      ok: true,
      reason: "local_bypass",
      sessionId: "local-dev",
    };
  }

  const expectedHost = normalizeHost(request.headers.host || "");
  if (!expectedHost) {
    return { ok: false, reason: "missing_host" };
  }

  if (!hasAllowedRequestOrigin(request, expectedHost)) {
    return { ok: false, reason: "invalid_origin" };
  }

  const cookies = parseCookies(request.headers.cookie || "");
  const sessionId = sanitizeSessionId(cookies[CHAT_SESSION_COOKIE]);
  if (!sessionId) {
    return { ok: false, reason: "missing_session" };
  }

  const token =
    typeof tokenOverride === "string" && tokenOverride.trim()
      ? tokenOverride.trim()
      : typeof request.headers[CHAT_TOKEN_HEADER] === "string"
        ? request.headers[CHAT_TOKEN_HEADER].trim()
        : "";
  if (!token) {
    return { ok: false, reason: "missing_chat_token" };
  }

  if (!isValidChatSessionToken(token, sessionId)) {
    return { ok: false, reason: "invalid_chat_token" };
  }

  return {
    ok: true,
    reason: "ok",
    sessionId,
  };
}

function isLocalDevelopmentBypass(request) {
  const host = normalizeHost(request.headers.host || "");
  const remoteAddress = normalizeIp(request.socket?.remoteAddress || "");
  return (host.startsWith("localhost:") || host.startsWith("127.0.0.1:")) && isTrustedProxy(remoteAddress);
}

function hasAllowedRequestOrigin(request, expectedHost) {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin.trim() : "";
  if (origin) {
    return doesUrlMatchHost(origin, expectedHost);
  }

  const referer = typeof request.headers.referer === "string" ? request.headers.referer.trim() : "";
  if (referer) {
    return doesUrlMatchHost(referer, expectedHost);
  }

  return false;
}

function doesUrlMatchHost(value, expectedHost) {
  try {
    const url = new URL(value);
    return normalizeHost(url.host) === expectedHost;
  } catch (error) {
    return false;
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of String(cookieHeader || "").split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (error) {
      cookies[key] = value;
    }
  }
  return cookies;
}

function sanitizeSessionId(sessionId) {
  return /^[a-f0-9]{36}$/i.test(String(sessionId || "")) ? String(sessionId) : "";
}

function isValidChatSessionToken(token, sessionId) {
  const tokenParts = String(token || "").split(".");
  if (tokenParts.length !== 2) return false;

  const [expiresAtRaw, signature] = tokenParts;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return false;
  }

  const payload = `${sessionId}.${expiresAt}`;
  const expectedSignature = crypto.createHmac("sha256", SESSION_TOKEN_SECRET).update(payload).digest("base64url");
  return safeCompare(signature, expectedSignature);
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeHost(host) {
  return String(host || "").trim().toLowerCase();
}

function isSecureRequest(request) {
  return request.headers["x-forwarded-proto"] === "https";
}

function getClientIp(request) {
  const remoteAddress = normalizeIp(request.socket?.remoteAddress || "");
  const realIp = request.headers["x-real-ip"];
  const forwardedFor = request.headers["x-forwarded-for"];

  if (isTrustedProxy(remoteAddress)) {
    if (typeof realIp === "string" && realIp.trim()) {
      return normalizeIp(realIp.trim());
    }

    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
      return normalizeIp(forwardedFor.split(",")[0].trim());
    }
  }

  return remoteAddress || "unknown";
}

function shouldCountFailureForCircuit(error) {
  if (!error?.code) return true;

  if (error.code === "upstream_http_error") {
    const upstreamStatus = Number(error.details?.upstreamStatus || 0);
    if (upstreamStatus && upstreamStatus < 500 && upstreamStatus !== 408) {
      return false;
    }
  }

  return true;
}

function normalizeIp(ip) {
  if (!ip) return "";
  if (ip.startsWith("::ffff:")) {
    return ip.slice(7);
  }
  return ip;
}

function isInternalMonitorRequest(request) {
  const remoteAddress = normalizeIp(request.socket?.remoteAddress || "");
  const forwardedFor = String(request.headers["x-forwarded-for"] || "").trim();
  return isTrustedProxy(remoteAddress) && !forwardedFor;
}

function isTrustedProxy(ip) {
  return ip === "127.0.0.1" || ip === "::1";
}

function extractLatestUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return "";
}

function normalizeCacheText(text) {
  return safeSlice(text, 300)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasHighPersonalizationSignals(text) {
  return /怎么办|怎么做|我现在|我该|适合我|该不该|值不值得|害怕|焦虑|难受|纠结|家里|父母|朋友|工作|辞职|创业|失败/.test(text);
}

function sanitizeObjectArray(value, maxItems) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).filter(isPlainObject);
}

function sanitizeStringArray(value, maxItems, maxItemLength) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => safeSlice(item, maxItemLength).trim())
    .filter(Boolean);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function validateStartupConfig() {
  const errors = [];
  const warnings = [];

  validateNumberSetting(errors, "PORT", 1, 65535);
  validateNumberSetting(errors, "DEEPSEEK_MAX_TOKENS", 100, 2000);
  validateNumberSetting(errors, "DEEPSEEK_TEMPERATURE", 0, 2);
  validateNumberSetting(errors, "UPSTREAM_TIMEOUT_MS", 1000, 120000);
  validateNumberSetting(errors, "CHAT_RATE_LIMIT_WINDOW_MS", 1000, 3600000);
  validateNumberSetting(errors, "CHAT_RATE_LIMIT_MAX_REQUESTS", 1, 1000);
  validateNumberSetting(errors, "CHAT_BURST_WINDOW_MS", 1000, 600000);
  validateNumberSetting(errors, "CHAT_BURST_MAX_REQUESTS", 1, 1000);
  validateNumberSetting(errors, "CHAT_CACHE_TTL_MS", 0, 3600000);
  validateNumberSetting(errors, "CHAT_CACHE_MAX_ENTRIES", 1, 5000);
  validateNumberSetting(errors, "CIRCUIT_BREAKER_FAIL_THRESHOLD", 1, 100);
  validateNumberSetting(errors, "CIRCUIT_BREAKER_COOLDOWN_MS", 1000, 600000);
  validateNumberSetting(errors, "SLOW_REQUEST_THRESHOLD_MS", 100, 120000);
  validateNumberSetting(errors, "ANALYTICS_ONLINE_WINDOW_MS", 30000, 600000);
  validateNumberSetting(errors, "ANALYTICS_HEARTBEAT_MIN_INTERVAL_MS", 5000, 300000);
  validateNumberSetting(errors, "ANALYTICS_RETENTION_DAYS", 1, 180);

  if (!fs.existsSync(path.join(projectRoot, ".env")) && !process.env.DEEPSEEK_API_KEY) {
    warnings.push(".env file is missing and no process-level DEEPSEEK_API_KEY was provided.");
  }

  if (!DEEPSEEK_API_KEY) {
    warnings.push("DEEPSEEK_API_KEY is missing. Chat requests will run in degraded local knowledge mode.");
  }

  if (!process.env.SESSION_TOKEN_SECRET && !env.SESSION_TOKEN_SECRET) {
    warnings.push("SESSION_TOKEN_SECRET is not set. Anonymous chat tokens will rotate on every server restart.");
  }

  if (CHAT_BURST_WINDOW_MS > CHAT_RATE_LIMIT_WINDOW_MS) {
    errors.push("CHAT_BURST_WINDOW_MS cannot be greater than CHAT_RATE_LIMIT_WINDOW_MS.");
  }

  if (CHAT_BURST_MAX_REQUESTS > CHAT_RATE_LIMIT_MAX_REQUESTS) {
    warnings.push("CHAT_BURST_MAX_REQUESTS is greater than CHAT_RATE_LIMIT_MAX_REQUESTS. Burst protection may be ineffective.");
  }

  return {
    errors,
    warnings,
  };
}

function validateNumberSetting(errors, key, min, max) {
  const raw = process.env[key] || env[key];
  if (raw === undefined || raw === "") return;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    errors.push(`${key} must be a number between ${min} and ${max}. Received: ${raw}`);
  }
}

function readNumberEnv(key, fallback, min, max) {
  const raw = process.env[key] || env[key];
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function safeSlice(text, maxLength) {
  return String(text || "").slice(0, maxLength);
}

function buildSecurityHeaders(request) {
  const headers = {
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    ].join("; "),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };

  if (isSecureRequest(request)) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    ...buildSecurityHeaders(response.__request),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function loadAnalyticsState() {
  const fallback = {
    version: 1,
    updatedAt: new Date().toISOString(),
    days: {},
  };

  try {
    if (!fs.existsSync(ANALYTICS_DATA_FILE)) {
      return fallback;
    }

    const parsed = JSON.parse(fs.readFileSync(ANALYTICS_DATA_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.days !== "object") {
      return fallback;
    }

    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : fallback.updatedAt,
      days: parsed.days,
    };
  } catch (error) {
    logEvent("warning", "analytics_state_load_failed", {
      details: safeSlice(error.message, 240),
    });
    return fallback;
  }
}

function getAnalyticsDayKey(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function createEmptyAnalyticsDay(dayKey) {
  return {
    dayKey,
    sessions: {},
    totals: {
      visits: 0,
      chatUsers: 0,
      chatTurns: 0,
      deepseekReplies: 0,
      fallbackReplies: 0,
      degradedReplies: 0,
    },
  };
}

function ensureAnalyticsDay(dayKey = getAnalyticsDayKey()) {
  if (!analyticsState.days[dayKey]) {
    analyticsState.days[dayKey] = createEmptyAnalyticsDay(dayKey);
  }
  return analyticsState.days[dayKey];
}

function ensureAnalyticsSession(day, sessionId, now) {
  if (!day.sessions[sessionId]) {
    day.sessions[sessionId] = {
      sessionId,
      firstSeenAt: now,
      lastSeenAt: now,
      hasVisited: false,
      hasChatted: false,
      chatTurns: 0,
      lastPagePath: "/",
      lastHeartbeatRecordedAt: 0,
    };
  }
  return day.sessions[sessionId];
}

function recordAnalyticsVisit(sessionId, request, pagePath = "/") {
  return recordAnalyticsActivity(sessionId, request, "visit", {
    pagePath,
    source: "config_bootstrap",
  });
}

function recordAnalyticsChatTurn(sessionId, request, details = {}) {
  const accepted = recordAnalyticsActivity(sessionId, request, "chat_turn", {
    pagePath: "/api/chat",
    source: "chat_response",
  });
  if (!accepted) return false;

  const day = ensureAnalyticsDay();
  const session = ensureAnalyticsSession(day, sessionId, Date.now());
  day.totals.chatTurns += 1;
  session.chatTurns += 1;

  if (!session.hasChatted) {
    session.hasChatted = true;
    day.totals.chatUsers += 1;
  }

  if (details.provider === "local-fallback") {
    day.totals.fallbackReplies += 1;
  } else {
    day.totals.deepseekReplies += 1;
  }

  if (details.degraded) {
    day.totals.degradedReplies += 1;
  }

  markAnalyticsDirty();
  return true;
}

function recordAnalyticsActivity(sessionId, request, eventType, details = {}) {
  const now = Date.now();
  const day = ensureAnalyticsDay();
  const session = ensureAnalyticsSession(day, sessionId, now);

  if (
    eventType === "heartbeat" &&
    session.lastHeartbeatRecordedAt &&
    now - session.lastHeartbeatRecordedAt < ANALYTICS_HEARTBEAT_MIN_INTERVAL_MS
  ) {
    return false;
  }

  if (!session.hasVisited) {
    session.hasVisited = true;
    day.totals.visits += 1;
  }

  session.lastSeenAt = now;
  session.lastEventType = eventType;
  session.lastPagePath = details.pagePath || session.lastPagePath || "/";
  session.lastIp = getClientIp(request);
  session.lastUserAgent = safeSlice(request.headers["user-agent"] || "", 180);

  if (eventType === "heartbeat") {
    session.lastHeartbeatRecordedAt = now;
  }

  markAnalyticsDirty();
  return true;
}

function buildAnalyticsSummary() {
  const now = Date.now();
  pruneAnalyticsState(now);

  const dayKey = getAnalyticsDayKey(now);
  const day = ensureAnalyticsDay(dayKey);
  const sessions = Object.values(day.sessions || {});
  const totalDurationMs = sessions.reduce((sum, session) => sum + getAnalyticsSessionDurationMs(session), 0);
  const currentOnlineUsers = countCurrentOnlineUsers(now);

  return {
    ok: true,
    dayKey,
    generatedAt: new Date(now).toISOString(),
    today: {
      visitors: Number(day.totals.visits || 0),
      chatUsers: Number(day.totals.chatUsers || 0),
      chatTurns: Number(day.totals.chatTurns || 0),
      averageSessionDurationMs: sessions.length ? Math.round(totalDurationMs / sessions.length) : 0,
      totalSessionDurationMs: totalDurationMs,
      currentOnlineUsers,
      deepseekReplies: Number(day.totals.deepseekReplies || 0),
      fallbackReplies: Number(day.totals.fallbackReplies || 0),
      degradedReplies: Number(day.totals.degradedReplies || 0),
      trackedSessions: sessions.length,
    },
    config: {
      onlineWindowMs: ANALYTICS_ONLINE_WINDOW_MS,
      heartbeatMinIntervalMs: ANALYTICS_HEARTBEAT_MIN_INTERVAL_MS,
    },
  };
}

function countCurrentOnlineUsers(now = Date.now()) {
  let total = 0;
  for (const day of Object.values(analyticsState.days || {})) {
    for (const session of Object.values(day.sessions || {})) {
      if (session && now - Number(session.lastSeenAt || 0) <= ANALYTICS_ONLINE_WINDOW_MS) {
        total += 1;
      }
    }
  }
  return total;
}

function getAnalyticsSessionDurationMs(session) {
  const firstSeenAt = Number(session?.firstSeenAt || 0);
  const lastSeenAt = Number(session?.lastSeenAt || firstSeenAt);
  if (!firstSeenAt || !lastSeenAt) return 0;
  return Math.min(Math.max(0, lastSeenAt - firstSeenAt), 12 * 60 * 60 * 1000);
}

function pruneAnalyticsState(now = Date.now()) {
  const retentionThreshold = now - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let mutated = false;

  for (const [dayKey, day] of Object.entries(analyticsState.days || {})) {
    const dayTimestamp = Date.parse(`${dayKey}T00:00:00+08:00`);
    if (Number.isFinite(dayTimestamp) && dayTimestamp < retentionThreshold) {
      delete analyticsState.days[dayKey];
      mutated = true;
      continue;
    }

    for (const session of Object.values(day.sessions || {})) {
      if (!session.lastSeenAt) {
        session.lastSeenAt = session.firstSeenAt || now;
        mutated = true;
      }
    }
  }

  if (mutated) {
    markAnalyticsDirty();
  }
}

function markAnalyticsDirty() {
  analyticsState.updatedAt = new Date().toISOString();
  scheduleAnalyticsFlush();
}

function scheduleAnalyticsFlush() {
  if (analyticsFlushTimer) return;
  analyticsFlushTimer = setTimeout(() => {
    analyticsFlushTimer = null;
    flushAnalyticsState();
  }, ANALYTICS_FLUSH_INTERVAL_MS);
}

function flushAnalyticsState() {
  if (analyticsFlushInFlight) {
    scheduleAnalyticsFlush();
    return;
  }

  analyticsFlushInFlight = true;
  const snapshot = JSON.stringify(analyticsState);

  fs.promises
    .mkdir(ANALYTICS_DATA_DIR, { recursive: true })
    .then(() => fs.promises.writeFile(ANALYTICS_DATA_FILE, snapshot, "utf8"))
    .catch((error) => {
      logEvent("warning", "analytics_state_flush_failed", {
        details: safeSlice(error.message, 240),
      });
    })
    .finally(() => {
      analyticsFlushInFlight = false;
    });
}

function flushAnalyticsStateSync() {
  try {
    fs.mkdirSync(ANALYTICS_DATA_DIR, { recursive: true });
    fs.writeFileSync(ANALYTICS_DATA_FILE, JSON.stringify(analyticsState), "utf8");
  } catch (error) {
    logEvent("warning", "analytics_state_flush_failed", {
      details: safeSlice(error.message, 240),
    });
  }
}
