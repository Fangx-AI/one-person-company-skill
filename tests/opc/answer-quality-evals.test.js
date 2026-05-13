#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { validateAnswerQualityEvals } = require("../../scripts/opc/validate-answer-quality-evals");

function testAnswerQualityEvalsAreUsable() {
  const root = path.resolve(__dirname, "..", "..");
  const result = validateAnswerQualityEvals({ root, minScenarios: 13, minGoldAnswers: 13 });

  assert.deepStrictEqual(result.errors, []);
  assert(result.counts.scenarios >= 13);
  assert(result.counts.goldAnswers >= 13);
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

function testValidatorRejectsGoldAnswerWithoutCompetitorPaymentAndBoundary() {
  const root = fs.mkdtempSync(path.join(require("os").tmpdir(), "opc-quality-eval-"));
  const base = path.join(root, "knowledge", "evals", "answer-quality");
  fs.mkdirSync(base, { recursive: true });
  const scenario = {
    id: "weak_gold",
    user_message: "我想做一个 markdown 转 html 的产品",
    intent: "judge product",
    stage: "idea",
    must_include: [
      "business_judgment",
      "case_or_pattern",
      "competitor_layering",
      "payment_mechanism",
      "evidence_boundary",
      "china_reality_or_constraint",
      "next_action",
      "stop_loss",
    ],
    must_avoid: ["先做MVP"],
    scoring_focus: [
      "competitor_layering",
      "payment_mechanism",
      "evidence_boundary",
    ],
    pass_bar: "回答必须包含直接竞品、收费机制和证据边界，不能只说这是功能不是生意；还要给出具体用户数量、价格和停损线。",
  };
  fs.writeFileSync(path.join(base, "scenarios.jsonl"), `${JSON.stringify(scenario)}\n`, "utf8");
  fs.writeFileSync(
    path.join(base, "gold-answers.jsonl"),
    `${JSON.stringify({
      scenario_id: "weak_gold",
      answer: "这个方向可以做，但要找到目标用户并持续优化体验。建议先访谈用户，看看他们是否愿意使用。",
      why_it_works: ["This intentionally weak answer should fail."],
    })}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(base, "rubric.json"),
    JSON.stringify({ items: [{ id: "x", label: "x", points: 1, pass: "x" }] }),
    "utf8",
  );

  const result = validateAnswerQualityEvals({ root, minScenarios: 1, minGoldAnswers: 1 });

  assert(result.errors.some((error) => error.includes("competitor_layering")));
  assert(result.errors.some((error) => error.includes("payment_mechanism")));
  assert(result.errors.some((error) => error.includes("evidence_boundary")));
  assert(result.errors.some((error) => error.includes("numeric_action")));
}

testAnswerQualityEvalsAreUsable();
testValidatorRejectsGenericScenario();
testValidatorRejectsGoldAnswerWithoutCompetitorPaymentAndBoundary();
console.log("answer quality eval tests passed");
