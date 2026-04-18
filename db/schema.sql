-- ════════════════════════════════════════════════════════════════
-- The Book of Elon — Database Schema v1
-- ────────────────────────────────────────────────────────────────
-- 设计原则：
--   1. 所有时间戳用 INTEGER 存 Unix milliseconds（不用 SQLite TEXT 时间）
--   2. 软删（archived 字段），不真删
--   3. 所有外键开 ON DELETE CASCADE，删用户连带清理
--   4. 不引入 ORM，直接 better-sqlite3 写 SQL
-- ════════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;          -- 写入更快、并发读更好
PRAGMA synchronous = NORMAL;        -- WAL 下安全且更快
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 134217728;       -- 128MB mmap，加速读

-- ════════════════════════════════════════════════════════════════
-- users：核心用户表
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  phone             TEXT NOT NULL UNIQUE,
  display_name      TEXT,
  created_at        INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  total_chat_turns  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- ════════════════════════════════════════════════════════════════
-- goals：北极星目标历史（一个用户可多条，但 is_current=1 只能有 1 条）
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS goals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  north_star   TEXT NOT NULL,
  is_current   INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  archived_at  INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_goals_user_current
  ON goals(user_id, is_current);

-- ════════════════════════════════════════════════════════════════
-- facts：AI 自动抽取的"关于你的关键事实"
--   kind:
--     'intend'   — "我打算 ___"
--     'blocker'  — "我卡在 ___"
--     'deadline' — "我要在 X 月之前 ___"
--     'done'     — "我已经 ___"
--     'belief'   — "我认为 ___"（用户的关键判断）
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS facts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL,
  kind               TEXT NOT NULL CHECK(kind IN ('intend','blocker','deadline','done','belief')),
  text               TEXT NOT NULL,
  source_session_id  INTEGER,
  source_message_id  INTEGER,
  pinned             INTEGER NOT NULL DEFAULT 0,
  archived           INTEGER NOT NULL DEFAULT 0,
  confidence         REAL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_facts_user_active
  ON facts(user_id, archived, pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_facts_user_kind
  ON facts(user_id, kind, archived);

-- ════════════════════════════════════════════════════════════════
-- chat_sessions：对话会话
--   user_id 可空：未注册用户也能聊
--   anon_session_id：现在 server.js 用的匿名 session cookie，
--     用户注册时把这些 anon session 认领到 user_id 下
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER,
  anon_session_id  TEXT,
  card_id          TEXT,
  started_at       INTEGER NOT NULL,
  last_active_at   INTEGER NOT NULL,
  turn_count       INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_recent
  ON chat_sessions(user_id, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_anon
  ON chat_sessions(anon_session_id);

-- ════════════════════════════════════════════════════════════════
-- messages：对话消息
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL,
  role        TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content     TEXT NOT NULL,
  turn_index  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  provider    TEXT,
  degraded    INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER,
  FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_session
  ON messages(session_id, turn_index);

-- ════════════════════════════════════════════════════════════════
-- sms_codes：短信验证码（10 分钟过期）
--   code_hash 必须存哈希，不存明文
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sms_codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  phone        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  ip           TEXT,
  consumed_at  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sms_codes_phone_recent
  ON sms_codes(phone, created_at DESC);

-- ════════════════════════════════════════════════════════════════
-- sms_throttle：每日发送上限桶
--   按 (phone, day_key) 唯一，UPSERT 累加
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sms_throttle (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT NOT NULL,
  ip            TEXT NOT NULL,
  day_key       TEXT NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  last_sent_at  INTEGER NOT NULL,
  UNIQUE(phone, day_key)
);
CREATE INDEX IF NOT EXISTS idx_sms_throttle_ip_day
  ON sms_throttle(ip, day_key);

-- ════════════════════════════════════════════════════════════════
-- schema_meta：记录当前 schema 版本（未来 migrate 用）
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS schema_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

INSERT OR IGNORE INTO schema_meta(key, value, updated_at)
  VALUES ('schema_version', '1', strftime('%s','now') * 1000);
