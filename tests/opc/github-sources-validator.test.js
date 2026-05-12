#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { validateGithubSources } = require("../../scripts/opc/validate-github-sources");

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opc-github-sources-"));
  const base = path.join(root, "knowledge", "github-sources");

  writeJsonl(path.join(base, "source-map.jsonl"), [
    {
      id: "src_example_repo",
      repo: "owner/example",
      url: "https://github.com/owner/example",
      language: "zh-CN",
      category: "indie_builder_playbook",
      why_relevant: "Contains practical founder operating notes for solo products.",
      allowed_use: "metadata_summary_and_structured_signal_extraction",
      risk_level: "low",
    },
  ]);

  writeJsonl(path.join(base, "practice-signals.jsonl"), [
    {
      id: "sig_example_payment",
      source_id: "src_example_repo",
      signal_type: "payment",
      scenario: "solo founder needs first paid validation",
      practical_signal: "Use a manual payment path before investing in formal payment infrastructure.",
      business_implication: "The key uncertainty is willingness to pay, not payment automation.",
      china_adaptation: "In mainland China, start with WeChat or Alipay transfer before formal merchant setup.",
      risk_or_limit: "Manual payment does not prove scalable acquisition or low support burden.",
      evidence_url: "https://github.com/owner/example#payment",
      date_checked: "2026-05-12",
    },
  ]);

  return root;
}

function testValidFixturePasses() {
  const result = validateGithubSources({
    root: createFixture(),
    minSources: 1,
    minSignals: 1,
  });
  assert.deepStrictEqual(result.errors, []);
  assert.deepStrictEqual(result.counts, { sources: 1, signals: 1 });
}

function testCurrentKnowledgeBaseHasSeedGithubSignals() {
  const root = path.resolve(__dirname, "..", "..");
  const result = validateGithubSources({ root, minSources: 8, minSignals: 12 });
  assert.deepStrictEqual(result.errors, []);
  assert(result.counts.sources >= 8);
  assert(result.counts.signals >= 12);
}

function testRejectsShallowSignals() {
  const root = createFixture();
  const base = path.join(root, "knowledge", "github-sources");
  writeJsonl(path.join(base, "practice-signals.jsonl"), [
    {
      id: "sig_shallow",
      source_id: "src_example_repo",
      signal_type: "payment",
      scenario: "test",
      practical_signal: "charge money",
      business_implication: "paid",
      china_adaptation: "wechat",
      risk_or_limit: "risk",
      evidence_url: "https://github.com/owner/example#payment",
      date_checked: "2026-05-12",
    },
  ]);

  const result = validateGithubSources({ root, minSources: 1, minSignals: 1 });
  assert(result.errors.some((error) => error.includes("too shallow")));
}

testValidFixturePasses();
testCurrentKnowledgeBaseHasSeedGithubSignals();
testRejectsShallowSignals();

console.log("github sources validator tests passed");
