const { getDb } = require("./database");

const VALID_KINDS = new Set(["intend", "blocker", "deadline", "done", "belief"]);

function findByIdForUser(factId, userId) {
  return getDb()
    .prepare("SELECT * FROM facts WHERE id = ? AND user_id = ?")
    .get(factId, userId);
}

function listForUser(userId, options = {}) {
  const includeArchived = Boolean(options.includeArchived);
  const limit = Number.isFinite(options.limit) ? options.limit : 50;

  const sql = includeArchived
    ? `SELECT * FROM facts
       WHERE user_id = ?
       ORDER BY pinned DESC, created_at DESC
       LIMIT ?`
    : `SELECT * FROM facts
       WHERE user_id = ? AND archived = 0
       ORDER BY pinned DESC, created_at DESC
       LIMIT ?`;

  return getDb().prepare(sql).all(userId, limit);
}

function listTopFacts(userId, limit = 8) {
  return getDb()
    .prepare(
      `SELECT * FROM facts
       WHERE user_id = ? AND archived = 0
       ORDER BY pinned DESC, created_at DESC
       LIMIT ?`
    )
    .all(userId, limit);
}

function listByKind(userId, kind, options = {}) {
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`invalid_fact_kind: ${kind}`);
  }
  const includeArchived = Boolean(options.includeArchived);

  const sql = includeArchived
    ? `SELECT * FROM facts WHERE user_id = ? AND kind = ? ORDER BY created_at DESC`
    : `SELECT * FROM facts WHERE user_id = ? AND kind = ? AND archived = 0 ORDER BY created_at DESC`;

  return getDb().prepare(sql).all(userId, kind);
}

function createFact({
  userId,
  kind,
  text,
  sourceSessionId = null,
  sourceMessageId = null,
  confidence = null,
}) {
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`invalid_fact_kind: ${kind}`);
  }
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("fact_text_required");
  }

  const now = Date.now();
  const result = getDb()
    .prepare(
      `INSERT INTO facts(
         user_id, kind, text,
         source_session_id, source_message_id,
         confidence, created_at, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      kind,
      trimmed,
      sourceSessionId,
      sourceMessageId,
      confidence,
      now,
      now
    );

  return getDb()
    .prepare("SELECT * FROM facts WHERE id = ?")
    .get(result.lastInsertRowid);
}

function updateText(factId, newText) {
  const trimmed = String(newText || "").trim();
  if (!trimmed) {
    throw new Error("fact_text_required");
  }
  getDb()
    .prepare("UPDATE facts SET text = ?, updated_at = ? WHERE id = ?")
    .run(trimmed, Date.now(), factId);
}

function setPinned(factId, pinned) {
  getDb()
    .prepare("UPDATE facts SET pinned = ?, updated_at = ? WHERE id = ?")
    .run(pinned ? 1 : 0, Date.now(), factId);
}

function archiveFact(factId) {
  getDb()
    .prepare("UPDATE facts SET archived = 1, updated_at = ? WHERE id = ?")
    .run(Date.now(), factId);
}

function unarchiveFact(factId) {
  getDb()
    .prepare("UPDATE facts SET archived = 0, updated_at = ? WHERE id = ?")
    .run(Date.now(), factId);
}

module.exports = {
  VALID_KINDS,
  findByIdForUser,
  listForUser,
  listTopFacts,
  listByKind,
  createFact,
  updateText,
  setPinned,
  archiveFact,
  unarchiveFact,
};
