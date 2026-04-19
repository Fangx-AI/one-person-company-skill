const session = require("../auth/session");
const users = require("../db/users");
const goals = require("../db/goals");
const facts = require("../db/facts");
const dbSessions = require("../db/sessions");

const NORTH_STAR_MIN = 4;
const NORTH_STAR_MAX = 200;

function requireAuth(request) {
  const token = session.extractTokenFromCookie(request.headers.cookie || "");
  if (!token) return null;
  const verified = session.verifyUserToken(token);
  if (!verified) return null;
  const user = users.findById(verified.userId);
  return user || null;
}

async function handleMeRequest({ request, response, requestUrl, helpers }) {
  const { sendJson, readJsonBody } = helpers;
  const path = requestUrl.pathname;
  const method = request.method;

  const user = requireAuth(request);
  if (!user) {
    return sendJson(response, 401, { error: "auth_required" });
  }

  if (path === "/api/me/north-star" && method === "POST") {
    return handleSetNorthStar({ request, response, sendJson, readJsonBody, user });
  }
  if (path === "/api/me/dashboard" && method === "GET") {
    return handleDashboard({ response, sendJson, user });
  }

  if (path === "/api/me/import-local-session" && method === "POST") {
    return handleImportLocalSession({
      request,
      response,
      sendJson,
      readJsonBody,
      user,
    });
  }

  const factPinMatch = path.match(/^\/api\/me\/facts\/(\d+)\/pin$/);
  if (factPinMatch && method === "POST") {
    return handleFactMutation({
      response,
      sendJson,
      user,
      factId: Number(factPinMatch[1]),
      action: "pin",
      readJsonBody,
      request,
    });
  }
  const factArchiveMatch = path.match(/^\/api\/me\/facts\/(\d+)\/archive$/);
  if (factArchiveMatch && method === "POST") {
    return handleFactMutation({
      response,
      sendJson,
      user,
      factId: Number(factArchiveMatch[1]),
      action: "archive",
      readJsonBody,
      request,
    });
  }

  return sendJson(response, 404, { error: "me_route_not_found" });
}

async function handleSetNorthStar({ request, response, sendJson, readJsonBody, user }) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return sendJson(response, 400, { error: "invalid_json" });
  }

  const northStar = String(body?.northStar || "").trim();
  if (northStar.length < NORTH_STAR_MIN) {
    return sendJson(response, 400, { error: "too_short", min: NORTH_STAR_MIN });
  }
  if (northStar.length > NORTH_STAR_MAX) {
    return sendJson(response, 400, { error: "too_long", max: NORTH_STAR_MAX });
  }

  const goal = goals.setCurrent(user.id, northStar);

  return sendJson(response, 200, {
    ok: true,
    goal: {
      id: goal.id,
      northStar: goal.north_star,
      setAt: goal.created_at,
    },
  });
}

function handleDashboard({ response, sendJson, user }) {
  const currentGoal = goals.getCurrent(user.id);
  const goalHistory = goals.listAll(user.id);
  const recentFacts = facts.listForUser(user.id, { limit: 20 });
  const recentSessions = dbSessions.listForUser(user.id, 10);

  return sendJson(response, 200, {
    user: {
      id: user.id,
      phone: user.phone,
      displayName: user.display_name,
      totalChatTurns: user.total_chat_turns,
      createdAt: user.created_at,
    },
    northStar: currentGoal
      ? {
          id: currentGoal.id,
          text: currentGoal.north_star,
          setAt: currentGoal.created_at,
        }
      : null,
    goalHistory: goalHistory.map((g) => ({
      id: g.id,
      text: g.north_star,
      setAt: g.created_at,
      archivedAt: g.archived_at,
      isCurrent: Boolean(g.is_current),
    })),
    facts: recentFacts.map((f) => ({
      id: f.id,
      kind: f.kind,
      text: f.text,
      pinned: Boolean(f.pinned),
      createdAt: f.created_at,
    })),
    sessions: recentSessions.map((s) => ({
      id: s.id,
      cardId: s.card_id,
      turnCount: s.turn_count,
      lastActiveAt: s.last_active_at,
    })),
  });
}

async function handleFactMutation({
  response,
  sendJson,
  user,
  factId,
  action,
  readJsonBody,
  request,
}) {
  if (!Number.isFinite(factId) || factId <= 0) {
    return sendJson(response, 400, { error: "invalid_fact_id" });
  }
  const fact = facts.findByIdForUser(factId, user.id);
  if (!fact) {
    return sendJson(response, 404, { error: "fact_not_found" });
  }

  let body = {};
  try {
    body = (await readJsonBody(request)) || {};
  } catch {
    body = {};
  }

  if (action === "pin") {
    const desired = body.pinned === undefined ? !fact.pinned : Boolean(body.pinned);
    facts.setPinned(factId, desired ? 1 : 0);
    return sendJson(response, 200, { ok: true, id: factId, pinned: desired });
  }

  if (action === "archive") {
    const desired = body.archived === undefined ? !fact.archived : Boolean(body.archived);
    if (desired) {
      facts.archiveFact(factId);
    } else {
      facts.unarchiveFact(factId);
    }
    return sendJson(response, 200, { ok: true, id: factId, archived: desired });
  }

  return sendJson(response, 400, { error: "unknown_action" });
}

// 把登录前用户在 localStorage 里囤的对话原样灌一条到 chat_sessions + messages，
// 让"昨天我聊过怎么没了"这种问题永远不再发生。
//
// 输入：{ chatMessages: [{role, text, ...}], cardId?: string|null, savedAt?: number }
// 限制：
//   - 一次最多 100 条消息（防 abuse / 大数据爆 SQLite）
//   - role 只允许 user/assistant
//   - text 截到 4000 字
//   - 同一用户已经有 ≥ 1 条 session 时不再重复导入（前端只在"刚登陆 + 还没存
//     过"时调用，但服务端额外加把锁——避免反复 POST 灌出几十条假历史）
//   - 真要重复导入用 ?force=1，未来给运维用
async function handleImportLocalSession({
  request,
  response,
  sendJson,
  readJsonBody,
  user,
}) {
  let body;
  try {
    body = (await readJsonBody(request)) || {};
  } catch {
    return sendJson(response, 400, { error: "invalid_json" });
  }

  const messages = Array.isArray(body.chatMessages) ? body.chatMessages : [];
  if (messages.length === 0) {
    return sendJson(response, 200, { ok: true, imported: 0, reason: "empty" });
  }
  if (messages.length > 100) {
    return sendJson(response, 400, {
      error: "too_many_messages",
      max: 100,
    });
  }

  const sanitized = messages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof (m.text || m.content) === "string"
    )
    .map((m) => ({
      role: m.role,
      content: String(m.text || m.content || "")
        .trim()
        .slice(0, 4000),
    }))
    .filter((m) => m.content.length > 0);

  if (sanitized.length === 0) {
    return sendJson(response, 200, { ok: true, imported: 0, reason: "empty" });
  }

  const force = String(request.url || "").includes("force=1");
  const existing = dbSessions.listForUser(user.id, 1);
  if (existing.length > 0 && !force) {
    return sendJson(response, 200, {
      ok: true,
      imported: 0,
      reason: "already_has_history",
    });
  }

  const cardId =
    typeof body.cardId === "string" && body.cardId.length < 100
      ? body.cardId
      : null;

  const newSession = dbSessions.createSession({
    userId: user.id,
    anonSessionId: null,
    cardId,
  });

  let importedCount = 0;
  for (const m of sanitized) {
    try {
      dbSessions.appendMessage({
        sessionId: newSession.id,
        role: m.role,
        content: m.content,
        provider: m.role === "assistant" ? "imported-localstorage" : null,
        degraded: false,
      });
      importedCount += 1;
    } catch {
      // 单条失败不阻塞剩下的——这是历史数据补救，best-effort
    }
  }

  return sendJson(response, 200, {
    ok: true,
    imported: importedCount,
    sessionId: newSession.id,
  });
}

module.exports = { handleMeRequest };
