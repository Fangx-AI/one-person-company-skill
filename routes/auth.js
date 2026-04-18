const session = require("../auth/session");
const smsSender = require("../auth/sms-sender");
const sms = require("../db/sms");
const users = require("../db/users");
const goals = require("../db/goals");
const sessions = require("../db/sessions");

const PHONE_REGEX = /^1[3-9]\d{9}$/;

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
      getClientIp,
      isSecureRequest,
      parseCookies,
      anonSessionCookieName,
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
  parseCookies,
  anonSessionCookieName,
}) {
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

  let claimedSessions = 0;
  try {
    const cookies = parseCookies(request.headers.cookie || "");
    const anonSessionId = cookies[anonSessionCookieName];
    if (anonSessionId) {
      claimedSessions = sessions.claimAnonSessions(user.id, anonSessionId);
    }
  } catch {
    /* ignore claim failures */
  }

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
