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

module.exports = { handleMeRequest };
