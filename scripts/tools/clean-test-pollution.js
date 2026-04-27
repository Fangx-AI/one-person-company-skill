// 清掉集成测试遗留的脏数据。判定标准：
// 1. phone 以 1391 / 1381 / 1391 开头的「连号」假号（13914679657 / 13916760982 / 13816761032 / 13814679723）
// 2. 用户从未真实聊过（total_chat_turns = 0），且不是当前活跃用户 u6
// 这些都是 scripts/integration-memory.js 跑出来的影子用户。
//
// 加 --dry-run 默认，必须 --apply 才真删。

const { getDb } = require("../../db/database");

const DRY = !process.argv.includes("--apply");
const KNOWN_TEST_PHONES = [
  "13914679657",
  "13916760982",
  "13816761032",
  "13814679723",
];

const db = getDb();

// 严格策略：只删已知测试手机号，不动其他任何用户。
// u1/u2/u3 即便 chat_turns=0 也保留，可能是早期真实测试账号。
const target = db
  .prepare(
    `SELECT id, phone, total_chat_turns FROM users
     WHERE phone IN (${KNOWN_TEST_PHONES.map(() => "?").join(",")})`
  )
  .all(...KNOWN_TEST_PHONES);

if (!target.length) {
  console.log("nothing to clean. all good.");
  process.exit(0);
}

console.log(`${DRY ? "[DRY-RUN]" : "[APPLY]"} 将删除 ${target.length} 个用户:`);
for (const u of target) {
  console.log(`  u${u.id}  ${u.phone}  chat_turns=${u.total_chat_turns}`);
}

if (DRY) {
  console.log("\n要真删，加 --apply 重跑。");
  process.exit(0);
}

const txn = db.transaction((users) => {
  const ids = users.map((u) => u.id);
  const ph = ids.map(() => "?").join(",");
  const factsDeleted = db.prepare(`DELETE FROM facts WHERE user_id IN (${ph})`).run(...ids).changes;
  const goalsDeleted = db.prepare(`DELETE FROM goals WHERE user_id IN (${ph})`).run(...ids).changes;
  const msgDeleted = db
    .prepare(
      `DELETE FROM messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id IN (${ph}))`
    )
    .run(...ids).changes;
  const sessDeleted = db
    .prepare(`DELETE FROM chat_sessions WHERE user_id IN (${ph})`)
    .run(...ids).changes;
  const usersDeleted = db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...ids).changes;
  console.log(
    `cleaned: facts=${factsDeleted} goals=${goalsDeleted} messages=${msgDeleted} sessions=${sessDeleted} users=${usersDeleted}`
  );
});
txn(target);
console.log("done.");
