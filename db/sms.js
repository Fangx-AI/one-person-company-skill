const crypto = require("crypto");
const { getDb } = require("./database");

const CODE_TTL_MS = 10 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;
const DAILY_LIMIT_PER_PHONE = 10;
const DAILY_LIMIT_PER_IP = 30;
const MAX_VERIFY_ATTEMPTS = 5;

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function getDayKey(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function checkSendThrottle(phone, ip) {
  const db = getDb();
  const now = Date.now();
  const dayKey = getDayKey(now);

  const phoneRow = db
    .prepare(
      `SELECT count, last_sent_at FROM sms_throttle
       WHERE phone = ? AND day_key = ?`
    )
    .get(phone, dayKey);

  if (phoneRow) {
    if (phoneRow.count >= DAILY_LIMIT_PER_PHONE) {
      return { ok: false, reason: "phone_daily_limit" };
    }
    if (now - Number(phoneRow.last_sent_at) < MIN_INTERVAL_MS) {
      const waitMs = MIN_INTERVAL_MS - (now - Number(phoneRow.last_sent_at));
      return {
        ok: false,
        reason: "too_soon",
        retryAfterSeconds: Math.ceil(waitMs / 1000),
      };
    }
  }

  const ipCountRow = db
    .prepare(
      `SELECT COALESCE(SUM(count), 0) AS total
       FROM sms_throttle WHERE ip = ? AND day_key = ?`
    )
    .get(ip, dayKey);

  if ((ipCountRow?.total || 0) >= DAILY_LIMIT_PER_IP) {
    return { ok: false, reason: "ip_daily_limit" };
  }

  return { ok: true };
}

function recordSent(phone, ip) {
  const db = getDb();
  const now = Date.now();
  const dayKey = getDayKey(now);

  db.prepare(
    `INSERT INTO sms_throttle(phone, ip, day_key, count, last_sent_at)
     VALUES(?, ?, ?, 1, ?)
     ON CONFLICT(phone, day_key) DO UPDATE SET
       count = count + 1,
       last_sent_at = excluded.last_sent_at,
       ip = excluded.ip`
  ).run(phone, ip, dayKey, now);
}

function createCode(phone, ip) {
  const db = getDb();
  // 必须用 crypto.randomInt（CSPRNG），不要用 Math.random — 后者非密码学安全，
  // 极端情况下输出可被预测/逆推。这里的 6 位数字用作短信验证码，强度直接等同于
  // 你账号系统的强度，必须用密码学随机源生成。
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashCode(code);
  const now = Date.now();
  const expiresAt = now + CODE_TTL_MS;

  db.prepare(
    `INSERT INTO sms_codes(phone, code_hash, expires_at, attempts, ip, created_at)
     VALUES(?, ?, ?, 0, ?, ?)`
  ).run(phone, codeHash, expiresAt, ip, now);

  return { code, expiresAt };
}

function verifyCode(phone, code) {
  const db = getDb();
  const now = Date.now();

  const row = db
    .prepare(
      `SELECT * FROM sms_codes
       WHERE phone = ? AND consumed_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(phone, now);

  if (!row) {
    return { ok: false, reason: "no_active_code" };
  }

  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  // SECURITY (CSO LOW): hash 比较走 crypto.timingSafeEqual。
  // SHA256 的雪崩效应让纯字符串 === 实际泄漏的 timing 信号几乎为 0
  // （攻击者不能控制 hash 输出），但我们仍然走 timing-safe 路径，
  // 这是密码学比较的"始终走 const-time"卫生习惯，零成本。
  const expectedHash = hashCode(code);
  const expectedBuf = Buffer.from(expectedHash, "hex");
  let storedBuf;
  try {
    storedBuf = Buffer.from(String(row.code_hash || ""), "hex");
  } catch {
    storedBuf = Buffer.alloc(0);
  }
  const matches =
    expectedBuf.length === storedBuf.length &&
    expectedBuf.length > 0 &&
    crypto.timingSafeEqual(expectedBuf, storedBuf);

  db.prepare(
    "UPDATE sms_codes SET attempts = attempts + 1 WHERE id = ?"
  ).run(row.id);

  if (!matches) {
    return { ok: false, reason: "wrong_code" };
  }

  db.prepare(
    "UPDATE sms_codes SET consumed_at = ? WHERE id = ?"
  ).run(now, row.id);

  return { ok: true };
}

function cleanupExpired() {
  const db = getDb();
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  db.prepare("DELETE FROM sms_codes WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM sms_throttle WHERE last_sent_at < ?").run(cutoff);
}

module.exports = {
  CODE_TTL_MS,
  MIN_INTERVAL_MS,
  DAILY_LIMIT_PER_PHONE,
  DAILY_LIMIT_PER_IP,
  MAX_VERIFY_ATTEMPTS,
  checkSendThrottle,
  recordSent,
  createCode,
  verifyCode,
  cleanupExpired,
};
