#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { validateCaseIntelligence } = require("../../scripts/opc/validate-case-intelligence");

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8"
  );
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opc-case-intel-"));
  const base = path.join(root, "knowledge", "cases");

  writeJsonl(path.join(base, "source-map.jsonl"), [
    {
      id: "src_test_case_site",
      name: "Test Case Site",
      url: "https://example.com/cases",
      platform: "case_directory",
      language: "en",
      priority: 1,
      access: "public_web",
      collection_method: "manual_seed",
      allowed_use: "metadata_summary_and_structured_facts",
      risk_level: "low",
      notes: "Fixture source for validator tests.",
    },
  ]);

  writeJsonl(path.join(base, "raw", "raw-cases.jsonl"), [
    {
      id: "raw_test_001",
      source_id: "src_test_case_site",
      url: "https://example.com/cases/one",
      title: "One-person analytics template",
      captured_at: "2026-05-11",
      language: "en",
      raw_signal:
        "Solo founder sells analytics templates to small SaaS founders through content and affiliates.",
      evidence_type: "article",
      rights_note: "Only metadata and short summary stored.",
    },
  ]);

  writeJsonl(path.join(base, "normalized", "normalized-cases.jsonl"), [
    {
      id: "case_test_001",
      raw_ids: ["raw_test_001"],
      name: "One-person analytics template",
      founder_type: "solo_founder",
      geography: ["global"],
      target_user: ["small_saas_founder"],
      product_form: ["template"],
      route: ["content_to_paid_template"],
      acquisition: ["content", "affiliate"],
      delivery: ["download"],
      pricing: ["one_time"],
      evidence_urls: ["https://example.com/cases/one"],
      summary:
        "A solo founder packages analytics know-how into a paid template and uses content plus affiliates for distribution.",
      commercial_path:
        "Start with public content, convert to a lightweight paid template, then expand into a repeatable operating kit.",
      risks: ["low_retention", "copycat"],
      confidence: "medium",
      date_checked: "2026-05-11",
    },
  ]);

  writeJsonl(path.join(base, "gold", "gold-cases.jsonl"), [
    {
      id: "gold_test_001",
      case_id: "case_test_001",
      score: 82,
      why_gold:
        "Clear solo-founder route, specific buyer, visible acquisition path, and concrete monetization structure.",
      reusable_lessons: [
        "Package a painful workflow into a narrow template.",
        "Use public teaching content as the trust channel.",
      ],
      applicable_to: ["b2b_template", "solo_consultant_productization"],
      warning_flags: ["Template markets become commoditized without distribution depth."],
    },
  ]);

  return root;
}

function testValidFixturePasses() {
  const root = createFixture();
  const result = validateCaseIntelligence({
    root,
    minSources: 1,
    minRaw: 1,
    minNormalized: 1,
    minGold: 1,
  });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.counts, {
    sources: 1,
    rawCases: 1,
    normalizedCases: 1,
    goldCases: 1,
  });
}

function testMissingRawReferenceFails() {
  const root = createFixture();
  writeJsonl(
    path.join(root, "knowledge", "cases", "normalized", "normalized-cases.jsonl"),
    [
      {
        id: "case_broken_001",
        raw_ids: ["raw_missing_001"],
        name: "Broken case",
        founder_type: "solo_founder",
        geography: ["cn"],
        target_user: ["solo_founder"],
        product_form: ["service"],
        route: ["manual_service"],
        acquisition: ["private_traffic"],
        delivery: ["manual_delivery"],
        pricing: ["one_time"],
        evidence_urls: ["https://example.com/missing"],
        summary: "Broken fixture should fail because raw_ids does not exist.",
        commercial_path: "No valid path because the evidence reference is broken.",
        risks: ["weak_evidence"],
        confidence: "low",
        date_checked: "2026-05-11",
      },
    ]
  );

  const result = validateCaseIntelligence({
    root,
    minSources: 1,
    minRaw: 1,
    minNormalized: 1,
    minGold: 1,
  });
  assert.strictEqual(result.ok, false);
  assert(
    result.errors.some((error) => error.includes("raw_missing_001")),
    "expected missing raw id error"
  );
}

testValidFixturePasses();
testMissingRawReferenceFails();
console.log("case-intelligence-validator tests passed");
