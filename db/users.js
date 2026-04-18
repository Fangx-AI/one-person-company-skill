const { getDb } = require("./database");

function findByPhone(phone) {
  return getDb()
    .prepare("SELECT * FROM users WHERE phone = ?")
    .get(phone);
}

function findById(userId) {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

function createUser(phone, displayName = null) {
  const now = Date.now();
  const result = getDb()
    .prepare(
      `INSERT INTO users(phone, display_name, created_at, last_seen_at, total_chat_turns)
       VALUES(?, ?, ?, ?, 0)`
    )
    .run(phone, displayName, now, now);
  return findById(result.lastInsertRowid);
}

function findOrCreateByPhone(phone, displayName = null) {
  const existing = findByPhone(phone);
  if (existing) {
    touchLastSeen(existing.id);
    return existing;
  }
  return createUser(phone, displayName);
}

function touchLastSeen(userId) {
  getDb()
    .prepare("UPDATE users SET last_seen_at = ? WHERE id = ?")
    .run(Date.now(), userId);
}

function incrementChatTurns(userId, delta = 1) {
  getDb()
    .prepare(
      "UPDATE users SET total_chat_turns = total_chat_turns + ?, last_seen_at = ? WHERE id = ?"
    )
    .run(delta, Date.now(), userId);
}

function updateDisplayName(userId, displayName) {
  getDb()
    .prepare("UPDATE users SET display_name = ? WHERE id = ?")
    .run(displayName, userId);
  return findById(userId);
}

module.exports = {
  findByPhone,
  findById,
  createUser,
  findOrCreateByPhone,
  touchLastSeen,
  incrementChatTurns,
  updateDisplayName,
};
