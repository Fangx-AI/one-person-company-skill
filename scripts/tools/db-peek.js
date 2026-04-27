const { getDb } = require("../../db/database");
const db = getDb();

console.log("=== 最近 facts (top 6) ===");
db.prepare("SELECT user_id, kind, text, created_at FROM facts ORDER BY created_at DESC LIMIT 6")
  .all()
  .forEach((f) => console.log(`  u${f.user_id} [${f.kind}] ${f.text.slice(0, 70)}`));

console.log("\n=== 最近用户消息 (top 6) ===");
db.prepare(
  "SELECT session_id, substr(content,1,90) as txt, created_at FROM messages WHERE role='user' ORDER BY created_at DESC LIMIT 6"
)
  .all()
  .forEach((m) => console.log(`  s${m.session_id}: ${m.txt}`));

console.log("\n=== 当前北极星 (is_current=1) ===");
db.prepare("SELECT user_id, north_star FROM goals WHERE is_current = 1 ORDER BY created_at DESC")
  .all()
  .forEach((g) => console.log(`  u${g.user_id}: ${g.north_star.slice(0, 100)}`));

console.log("\n=== 用户最后一次活动 ===");
db.prepare(
  "SELECT id, phone, last_seen_at, total_chat_turns FROM users ORDER BY last_seen_at DESC LIMIT 5"
)
  .all()
  .forEach((u) => {
    const last = new Date(u.last_seen_at).toISOString().slice(0, 19);
    console.log(`  u${u.id} ${u.phone} chat_turns=${u.total_chat_turns} last=${last}`);
  });
