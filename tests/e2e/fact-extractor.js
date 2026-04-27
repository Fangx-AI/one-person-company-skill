// 单元测试 services/fact-extractor.js 的纯函数
const assert = require("assert");
const path = require("path");

const ext = require(path.join(__dirname, "..", "..", "services", "fact-extractor.js"));
const { parseExtractionResponse, isDuplicate, normaliseForDedup, shouldExtract, buildUserPrompt } = ext._internal;

let pass = 0;
let fail = 0;

function t(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    fail += 1;
  }
}

console.log("\n[fact-extractor unit tests]\n");

// parseExtractionResponse
t("parses valid JSON with 1 fact", () => {
  const out = parseExtractionResponse(
    JSON.stringify({
      facts: [{ kind: "intend", text: "我打算下周做出第一版 demo", confidence: 0.9 }],
    })
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, "intend");
  assert.strictEqual(out[0].confidence, 0.9);
});

t("rejects invalid kind", () => {
  const out = parseExtractionResponse(
    JSON.stringify({ facts: [{ kind: "not_real", text: "xxx", confidence: 0.9 }] })
  );
  assert.strictEqual(out.length, 0);
});

t("rejects too-short text", () => {
  const out = parseExtractionResponse(
    JSON.stringify({ facts: [{ kind: "intend", text: "abc", confidence: 0.9 }] })
  );
  assert.strictEqual(out.length, 0);
});

t("rejects low confidence", () => {
  const out = parseExtractionResponse(
    JSON.stringify({ facts: [{ kind: "intend", text: "我准备做点事情看看", confidence: 0.4 }] })
  );
  assert.strictEqual(out.length, 0);
});

t("caps at 3 facts", () => {
  const out = parseExtractionResponse(
    JSON.stringify({
      facts: [
        { kind: "intend", text: "我准备做事情一二三四五六", confidence: 0.9 },
        { kind: "blocker", text: "我卡在很多很多的细节上面了", confidence: 0.9 },
        { kind: "done", text: "我已经做完了第一版的设计图", confidence: 0.9 },
        { kind: "belief", text: "我相信先做出来再说是对的", confidence: 0.9 },
      ],
    })
  );
  assert.strictEqual(out.length, 3);
});

t("returns [] on garbage", () => {
  assert.deepStrictEqual(parseExtractionResponse("not json"), []);
  assert.deepStrictEqual(parseExtractionResponse(""), []);
  assert.deepStrictEqual(parseExtractionResponse(null), []);
});

// isDuplicate
t("flags exact duplicate", () => {
  const existing = [{ kind: "intend", text: "我打算下周做出第一版 demo" }];
  const candidate = { kind: "intend", text: "我打算下周做出第一版 demo" };
  assert.strictEqual(isDuplicate(candidate, existing), true);
});

t("flags substring overlap (long enough)", () => {
  const existing = [{ kind: "intend", text: "我打算下周做出第一版 demo 给朋友看" }];
  const candidate = { kind: "intend", text: "我打算下周做出第一版 demo" };
  assert.strictEqual(isDuplicate(candidate, existing), true);
});

t("does NOT flag different kinds", () => {
  const existing = [{ kind: "intend", text: "我打算下周做出第一版 demo" }];
  const candidate = { kind: "blocker", text: "我打算下周做出第一版 demo" };
  assert.strictEqual(isDuplicate(candidate, existing), false);
});

t("does NOT flag distinct facts", () => {
  const existing = [{ kind: "intend", text: "我打算下周做出第一版 demo" }];
  const candidate = { kind: "intend", text: "我准备先找 5 个用户聊天" };
  assert.strictEqual(isDuplicate(candidate, existing), false);
});

// shouldExtract
t("skips when no userId", () => {
  assert.strictEqual(shouldExtract({ userText: "想做的事很清楚明白也不长", userId: null }), false);
});

t("skips when text too short", () => {
  assert.strictEqual(shouldExtract({ userText: "好的", userId: 1 }), false);
});

t("allows valid input", () => {
  assert.strictEqual(
    shouldExtract({ userText: "我打算下周做出第一版 demo 然后给 5 个朋友看", userId: 999 }),
    true
  );
});

// buildUserPrompt
t("includes north star + existing facts", () => {
  const p = buildUserPrompt({
    userText: "我打算下周做完",
    assistantText: "做完之前先想清楚目标用户",
    northStar: "做出真正能帮个人创业者的工具",
    existingFacts: [{ kind: "blocker", text: "卡在不知道怎么定价" }],
  });
  assert.ok(p.includes("北极星目标"));
  assert.ok(p.includes("做出真正能帮个人创业者的工具"));
  assert.ok(p.includes("已经记录的事实"));
  assert.ok(p.includes("卡在不知道怎么定价"));
  assert.ok(p.includes("用户刚说"));
  assert.ok(p.includes("教练回应"));
});

console.log(`\n${pass} pass, ${fail} fail\n`);
process.exit(fail > 0 ? 1 : 0);
