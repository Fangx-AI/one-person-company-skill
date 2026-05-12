#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { validateAnswerQualityEvals } = require("../../scripts/opc/validate-answer-quality-evals");

function testAnswerQualityEvalsAreUsable() {
  const root = path.resolve(__dirname, "..", "..");
  const result = validateAnswerQualityEvals({ root, minScenarios: 12, minGoldAnswers: 4 });

  assert.deepStrictEqual(result.errors, []);
  assert(result.counts.scenarios >= 12);
  assert(result.counts.goldAnswers >= 4);
  assert(result.counts.rubricItems >= 7);
}

function testValidatorRejectsGenericScenario() {
  const root = fs.mkdtempSync(path.join(require("os").tmpdir(), "opc-quality-eval-"));
  const base = path.join(root, "knowledge", "evals", "answer-quality");
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(
    path.join(base, "scenarios.jsonl"),
    JSON.stringify({
      id: "bad",
      user_message: "我想创业，怎么办？",
      intent: "generic",
      stage: "idea",
      must_include: ["next_action"],
      must_avoid: ["持续输出"],
      scoring_focus: ["expression_quality"],
      pass_bar: "回答必须具体说明下一步，但这里故意缺少商业判断、国内现实、案例支撑和停损条件，所以应该失败。",
    }) + "\n",
    "utf8",
  );
  fs.writeFileSync(path.join(base, "gold-answers.jsonl"), "", "utf8");
  fs.writeFileSync(
    path.join(base, "rubric.json"),
    JSON.stringify({ items: [{ id: "x", label: "x", points: 1, pass: "x" }] }),
    "utf8",
  );

  const result = validateAnswerQualityEvals({ root, minScenarios: 1, minGoldAnswers: 0 });

  assert(result.errors.some((error) => error.includes("must_include")));
  assert(result.errors.some((error) => error.includes("pass_bar")));
}

testAnswerQualityEvalsAreUsable();
testValidatorRejectsGenericScenario();
console.log("answer quality eval tests passed");
