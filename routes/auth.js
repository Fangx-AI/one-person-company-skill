const session = require("../auth/session");
const smsSender = require("../auth/sms-sender");
const sms = require("../db/sms");
const users = require("../db/users");
const goals = require("../db/goals");

const PHONE_REGEX = /^1[3-9]\d{9}$/;

// SECURITY (CSO LOW): verify-code 接口本身也加 IP 级 rate limit。
// sms.js 里只限制单个 code 5 次失败就锁，但攻击者可以频繁调 verify-code
// 制造日志噪声 / 让我们 DB 反复 SELECT。这里 in-memory 限频，每 IP 每 60s
// 最多 30 次 verify-code 尝试。重启后清零（可接受，不影响正确性）。
const VERIFY_IP_WINDOW_MS = 60_000;
const VERIFY_IP_MAX_PER_WINDOW = 30;
const verifyAttempts = new Map(); // ip -> { windowStart, count }

function checkVerifyIpRate(ip) {
  if (!ip || ip === "unknown") return { ok: true };
  const now = Date.now();
  const bucket = verifyAttempts.get(ip);
  if (!bucket || now - bucket.windowStart >= VERIFY_IP_WINDOW_MS) {
    verifyAttempts.set(ip, { windowStart: now, count: 1 });
    return { ok: true };
  }
  bucket.count += 1;
  if (bucket.count > VERIFY_IP_MAX_PER_WINDOW) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((VERIFY_IP_WINDOW_MS - (now - bucket.windowStart)) / 1000)
      ),
    };
  }
  return { ok: true };
}

// 防止内存无限增长：每 5 分钟清一次过期条目
setInterval(() => {
  const cutoff = Date.now() - VERIFY_IP_WINDOW_MS * 2;
  for (const [ip, bucket] of verifyAttempts.entries()) {
    if (bucket.windowStart < cutoff) verifyAttempts.delete(ip);
  }
}, 5 * 60 * 1000).unref();

async function handleAuthRequest({
  request,
  response,
  requestUrl,
  helpers,
}) {
  const { sendJson, readJsonBody, getClientIp, isSecureRequest, parseCookies, anonSessionCookieName } = helpers;
  const path = requestUrl.pathname;
  const method = request.method;

  if (path === "/api/auth/send-code" && method === "POST") {
    return handleSendCode({ request, response, sendJson, readJsonBody, getClientIp });
  }
  if (path === "/api/auth/verify-code" && method === "POST") {
    return handleVerifyCode({
      request,
      response,
      sendJson,
      readJsonBody,
      isSecureRequest,
      getClientIp,
    });
  }
  if (path === "/api/auth/me" && method === "GET") {
    return handleMe({ request, response, sendJson });
  }
  if (path === "/api/auth/logout" && method === "POST") {
    return handleLogout({ request, response, sendJson, isSecureRequest });
  }

  return sendJson(response, 404, { error: "auth_route_not_found" });
}

async function handleSendCode({ request, response, sendJson, readJsonBody, getClientIp }) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return sendJson(response, 400, { error: "invalid_json" });
  }

  const phone = String(body?.phone || "").trim();
  const ip = getClientIp(request) || "unknown";

  if (!PHONE_REGEX.test(phone)) {
    return sendJson(response, 400, { error: "invalid_phone" });
  }

  const throttleResult = sms.checkSendThrottle(phone, ip);
  if (!throttleResult.ok) {
    return sendJson(response, 429, {
      error: throttleResult.reason,
      retryAfterSeconds: throttleResult.retryAfterSeconds || 60,
    });
  }

  const { code } = sms.createCode(phone, ip);
  let sendResult;
  try {
    sendResult = await smsSender.sendVerificationCode(phone, code);
  } catch (err) {
    return sendJson(response, 502, {
      error: "sms_send_failed",
      message: err?.message?.slice(0, 200) || "unknown",
    });
  }

  sms.recordSent(phone, ip);

  const responseBody = {
    ok: true,
    expiresInSeconds: Math.floor(sms.CODE_TTL_MS / 1000),
    provider: sendResult.provider,
  };
  if (sendResult.provider === "mock") {
    responseBody.devCode = code;
    responseBody.devNotice = "SMS_PROVIDER not configured. Code returned for dev only.";
  }
  return sendJson(response, 200, responseBody);
}

async function handleVerifyCode({
  request,
  response,
  sendJson,
  readJsonBody,
  isSecureRequest,
  getClientIp,
}) {
  const ip = (getClientIp && getClientIp(request)) || "unknown";
  const ipCheck = checkVerifyIpRate(ip);
  if (!ipCheck.ok) {
    return sendJson(response, 429, {
      error: "too_many_verify_attempts",
      retryAfterSeconds: ipCheck.retryAfterSeconds,
    });
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return sendJson(response, 400, { error: "invalid_json" });
  }

  const phone = String(body?.phone || "").trim();
  const code = String(body?.code || "").trim();

  if (!PHONE_REGEX.test(phone)) {
    return sendJson(response, 400, { error: "invalid_phone" });
  }
  if (!/^\d{6}$/.test(code)) {
    return sendJson(response, 400, { error: "invalid_code_format" });
  }

  const verifyResult = sms.verifyCode(phone, code);
  if (!verifyResult.ok) {
    return sendJson(response, 400, { error: verifyResult.reason });
  }

  const user = users.findOrCreateByPhone(phone);
  users.touchLastSeen(user.id);

  // 产品决策：匿名期间聊的对话不归户给账号。这与行业惯例一致 —— ChatGPT /
  // Claude / Gemini 登录后都不会把游客时的对话同步到账号下。匿名 session 留
  // 在 DB 里按 anon_id 索引，永远不挂到 user_id 上，最终随 anon cookie 失效
  // 自然过期。db/sessions.js::claimAnonSessions 仍然保留为函数，但**不再被
  // 任何 HTTP 路径调用**。如果未来要做"游客一键导入"功能，需要先和产品确认。
  const claimedSessions = 0;

  const token = session.createUserToken(user.id);
  const setCookie = session.buildSetCookie(token, {
    secure: isSecureRequest(request),
  });

  const currentGoal = goals.getCurrent(user.id);

  return sendJson(
    response,
    200,
    {
      ok: true,
      user: {
        id: user.id,
        phone: user.phone,
        displayName: user.display_name,
        totalChatTurns: user.total_chat_turns,
      },
      hasNorthStar: Boolean(currentGoal),
      northStar: currentGoal ? currentGoal.north_star : null,
      claimedAnonSessions: claimedSessions,
    },
    { "Set-Cookie": setCookie }
  );
}

function handleMe({ request, response, sendJson }) {
  const token = session.extractTokenFromCookie(request.headers.cookie || "");
  const verified = token ? session.verifyUserToken(token) : null;

  if (!verified) {
    return sendJson(response, 200, { authenticated: false });
  }

  const user = users.findById(verified.userId);
  if (!user) {
    return sendJson(response, 200, { authenticated: false });
  }

  const currentGoal = goals.getCurrent(user.id);
  return sendJson(response, 200, {
    authenticated: true,
    user: {
      id: user.id,
      phone: user.phone,
      displayName: user.display_name,
      totalChatTurns: user.total_chat_turns,
    },
    hasNorthStar: Boolean(currentGoal),
    northStar: currentGoal ? currentGoal.north_star : null,
  });
}

function handleLogout({ request, response, sendJson, isSecureRequest }) {
  const clearCookie = session.buildClearCookie({ secure: isSecureRequest(request) });
  return sendJson(response, 200, { ok: true }, { "Set-Cookie": clearCookie });
}

module.exports = {
  handleAuthRequest,
  PHONE_REGEX,
};
