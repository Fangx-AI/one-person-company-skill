#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "smoke.db");
process.env.SQLITE_DB_PATH = TEST_DB_PATH;

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

const users = require("../../db/users");
const goals = require("../../db/goals");
const facts = require("../../db/facts");
const sessions = require("../../db/sessions");
const sms = require("../../db/sms");
const { closeDb } = require("../../db/database");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("  PASS:", msg);
}

function section(name) {
  console.log("");
  console.log("─".repeat(60));
  console.log(name);
  console.log("─".repeat(60));
}

function main() {
  section("1. Users");
  const u = users.findOrCreateByPhone("13800138000", "测试用户");
  assert(u.id > 0, "create user with phone");
  assert(u.phone === "13800138000", "phone stored correctly");
  assert(u.total_chat_turns === 0, "initial chat turns = 0");

  const u2 = users.findOrCreateByPhone("13800138000");
  assert(u2.id === u.id, "find existing user by phone");

  users.incrementChatTurns(u.id, 3);
  const u3 = users.findById(u.id);
  assert(u3.total_chat_turns === 3, "increment chat turns");

  section("2. Goals");
  const g1 = goals.setCurrent(u.id, "用 3 年做出一个让 100 万人改善生活的产品");
  assert(g1.id > 0, "set first north star");
  assert(g1.is_current === 1, "first goal is current");

  const g2 = goals.setCurrent(u.id, "用 5 年成为最了解中文创业者的 AI 产品");
  assert(g2.id !== g1.id, "second goal has different id");
  assert(g2.is_current === 1, "new goal is current");

  const current = goals.getCurrent(u.id);
  assert(current.id === g2.id, "getCurrent returns latest");

  const allGoals = goals.listAll(u.id);
  assert(allGoals.length === 2, "two goals in history");
  assert(allGoals[0].id === g2.id, "current goal first in list");

  section("3. Facts");
  const f1 = facts.createFact({
    userId: u.id,
    kind: "intend",
    text: "我打算 6 月前推出 MVP",
    confidence: 0.9,
  });
  const f2 = facts.createFact({
    userId: u.id,
    kind: "blocker",
    text: "我卡在不知道找谁来当第一批种子用户",
    confidence: 0.85,
  });
  const f3 = facts.createFact({
    userId: u.id,
    kind: "deadline",
    text: "我要在 5 月 1 号之前完成原型",
  });

  facts.setPinned(f1.id, true);

  const top = facts.listTopFacts(u.id);
  assert(top.length === 3, "list top facts");
  assert(top[0].id === f1.id, "pinned fact first");

  facts.archiveFact(f3.id);
  const active = facts.listForUser(u.id);
  assert(active.length === 2, "archived fact excluded");

  const blockers = facts.listByKind(u.id, "blocker");
  assert(blockers.length === 1, "list by kind=blocker");

  let threwOnInvalidKind = false;
  try {
    facts.createFact({ userId: u.id, kind: "garbage", text: "x" });
  } catch (e) {
    threwOnInvalidKind = true;
  }
  assert(threwOnInvalidKind, "reject invalid fact kind");

  section("4. Sessions + Messages");
  const s = sessions.createSession({
    userId: u.id,
    cardId: "feel-the-fear-do-it-anyway",
  });
  assert(s.id > 0, "create session");
  assert(s.turn_count === 0, "initial turn count = 0");

  const m1 = sessions.appendMessage({
    sessionId: s.id,
    role: "user",
    content: "我害怕做的事最后没意义",
  });
  assert(m1.turn_index === 0, "first message turn_index=0");

  const m2 = sessions.appendMessage({
    sessionId: s.id,
    role: "assistant",
    content: "'没意义'是借口。\n你怕的是做了之后没人鼓掌。",
    provider: "DeepSeek",
  });
  assert(m2.turn_index === 1, "second message turn_index=1");

  const refreshed = sessions.getById(s.id);
  assert(refreshed.turn_count === 2, "session turn_count incremented to 2");

  const recent = sessions.getRecentMessages(s.id);
  assert(recent.length === 2, "get recent messages");
  assert(recent[0].turn_index === 0, "messages in chronological order");
  assert(recent[1].provider === "DeepSeek", "provider stored on assistant msg");

  section("5. Anonymous session claim");
  const anonSession = sessions.createSession({
    anonSessionId: "anon-abc-123",
    cardId: "first-principles-thinking",
  });
  assert(anonSession.user_id === null, "anonymous session has no user");
  sessions.appendMessage({
    sessionId: anonSession.id,
    role: "user",
    content: "我应该辞职吗",
  });

  const claimed = sessions.claimAnonSessions(u.id, "anon-abc-123");
  assert(claimed === 1, "claim 1 anonymous session");

  const reclaimed = sessions.getById(anonSession.id);
  assert(reclaimed.user_id === u.id, "claimed session belongs to user");

  section("6. SMS codes");
  const phone = "13900139000";
  const ip = "127.0.0.1";

  const t1 = sms.checkSendThrottle(phone, ip);
  assert(t1.ok === true, "first send not throttled");

  const { code } = sms.createCode(phone, ip);
  sms.recordSent(phone, ip);
  assert(/^\d{6}$/.test(code), "6-digit code generated");

  const t2 = sms.checkSendThrottle(phone, ip);
  assert(t2.ok === false && t2.reason === "too_soon", "throttle within 60s");

  const wrongResult = sms.verifyCode(phone, "000000");
  assert(wrongResult.ok === false, "wrong code rejected");
  assert(wrongResult.reason === "wrong_code", "reason=wrong_code");

  const correctResult = sms.verifyCode(phone, code);
  assert(correctResult.ok === true, "correct code accepted");

  const reuseResult = sms.verifyCode(phone, code);
  assert(reuseResult.ok === false, "consumed code rejected on reuse");
  assert(reuseResult.reason === "no_active_code", "reason=no_active_code");

  section("7. Cleanup");
  closeDb();
  fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(TEST_DB_PATH + "-shm")) fs.unlinkSync(TEST_DB_PATH + "-shm");
  if (fs.existsSync(TEST_DB_PATH + "-wal")) fs.unlinkSync(TEST_DB_PATH + "-wal");

  console.log("");
  console.log("═".repeat(60));
  console.log("ALL SMOKE TESTS PASSED ✓");
  console.log("═".repeat(60));
}

main();
