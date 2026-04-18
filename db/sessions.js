const { getDb } = require("./database");

function createSession({ userId = null, anonSessionId = null, cardId = null }) {
  const now = Date.now();
  const result = getDb()
    .prepare(
      `INSERT INTO chat_sessions(
         user_id, anon_session_id, card_id,
         started_at, last_active_at, turn_count
       ) VALUES(?, ?, ?, ?, ?, 0)`
    )
    .run(userId, anonSessionId, cardId, now, now);
  return getById(result.lastInsertRowid);
}

function getById(sessionId) {
  return getDb()
    .prepare("SELECT * FROM chat_sessions WHERE id = ?")
    .get(sessionId);
}

function listForUser(userId, limit = 30) {
  return getDb()
    .prepare(
      `SELECT * FROM chat_sessions
       WHERE user_id = ?
       ORDER BY last_active_at DESC
       LIMIT ?`
    )
    .all(userId, limit);
}

function appendMessage({
  sessionId,
  role,
  content,
  provider = null,
  degraded = false,
  tokenCount = null,
}) {
  const db = getDb();
  const now = Date.now();

  const tx = db.transaction(() => {
    const session = db
      .prepare("SELECT turn_count FROM chat_sessions WHERE id = ?")
      .get(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }

    const turnIndex = session.turn_count;

    const result = db
      .prepare(
        `INSERT INTO messages(
           session_id, role, content, turn_index,
           created_at, provider, degraded, token_count
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sessionId,
        role,
        content,
        turnIndex,
        now,
        provider,
        degraded ? 1 : 0,
        tokenCount
      );

    db.prepare(
      `UPDATE chat_sessions
       SET turn_count = turn_count + 1, last_active_at = ?
       WHERE id = ?`
    ).run(now, sessionId);

    return result.lastInsertRowid;
  });

  const messageId = tx();
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
}

function getRecentMessages(sessionId, limit = 20) {
  return getDb()
    .prepare(
      `SELECT * FROM messages
       WHERE session_id = ?
       ORDER BY turn_index DESC
       LIMIT ?`
    )
    .all(sessionId, limit)
    .reverse();
}

function claimAnonSessions(userId, anonSessionId) {
  if (!anonSessionId) return 0;
  const result = getDb()
    .prepare(
      `UPDATE chat_sessions
       SET user_id = ?
       WHERE anon_session_id = ? AND user_id IS NULL`
    )
    .run(userId, anonSessionId);
  return result.changes;
}

module.exports = {
  createSession,
  getById,
  listForUser,
  appendMessage,
  getRecentMessages,
  claimAnonSessions,
};
