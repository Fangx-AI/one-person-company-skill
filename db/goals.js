const { getDb } = require("./database");

function getCurrent(userId) {
  return getDb()
    .prepare(
      "SELECT * FROM goals WHERE user_id = ? AND is_current = 1 LIMIT 1"
    )
    .get(userId);
}

function listAll(userId) {
  return getDb()
    .prepare(
      `SELECT * FROM goals
       WHERE user_id = ?
       ORDER BY is_current DESC, created_at DESC`
    )
    .all(userId);
}

function setCurrent(userId, northStar) {
  const text = String(northStar || "").trim();
  if (!text) {
    throw new Error("north_star_required");
  }

  const db = getDb();
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE goals
       SET is_current = 0, archived_at = ?
       WHERE user_id = ? AND is_current = 1`
    ).run(now, userId);

    const result = db
      .prepare(
        `INSERT INTO goals(user_id, north_star, is_current, created_at)
         VALUES(?, ?, 1, ?)`
      )
      .run(userId, text, now);

    return result.lastInsertRowid;
  });

  const newId = tx();
  return db.prepare("SELECT * FROM goals WHERE id = ?").get(newId);
}

function archiveCurrent(userId) {
  getDb()
    .prepare(
      `UPDATE goals
       SET is_current = 0, archived_at = ?
       WHERE user_id = ? AND is_current = 1`
    )
    .run(Date.now(), userId);
}

module.exports = {
  getCurrent,
  listAll,
  setCurrent,
  archiveCurrent,
};
