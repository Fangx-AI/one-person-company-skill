#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { importCaseCandidates } = require("../../scripts/opc/import-case-candidates");
const { matchProductIdea } = require("../../scripts/opc/match-product-idea");

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opc-case-import-"));
  const base = path.join(root, "knowledge", "cases");

  writeJsonl(path.join(base, "source-map.jsonl"), [
    {
      id: "src_public_product_pages",
      name: "Public Product Pages",
      url: "https://example.com",
      platform: "public_web",
      language: "mixed",
      priority: 2,
      access: "public_web",
      collection_method: "manual_seed_then_adapter",
      allowed_use: "metadata_summary_and_structured_facts",
      risk_level: "medium",
      notes: "Fixture source.",
    },
  ]);
  writeJsonl(path.join(base, "raw", "raw-cases.jsonl"), [
    {
      id: "raw_existing_case",
      source_id: "src_public_product_pages",
      url: "https://example.com/existing",
      title: "Existing Case",
      captured_at: "2026-05-11",
      language: "en",
      raw_signal: "Existing fixture raw signal.",
      evidence_type: "product_page",
      rights_note: "Only metadata, short summary, and structured facts are stored.",
    },
  ]);
  writeJsonl(path.join(base, "normalized", "normalized-cases.jsonl"), [
    {
      id: "case_existing_case",
      raw_ids: ["raw_existing_case"],
      name: "Existing Case",
      founder_type: "solo_founder",
      geography: ["global"],
      target_user: ["founders"],
      product_form: ["case_library"],
      route: ["case_intelligence_product"],
      acquisition: ["seo"],
      delivery: ["website"],
      pricing: ["subscription"],
      evidence_urls: ["https://example.com/existing"],
      summary: "Existing fixture case.",
      commercial_path: "Existing commercial path.",
      risks: ["case_facts_age_quickly"],
      confidence: "medium",
      date_checked: "2026-05-11",
    },
  ]);
  writeJsonl(path.join(base, "gold", "gold-cases.jsonl"), []);

  return root;
}

function candidate(overrides = {}) {
  return {
    id: "ai_headshot_local",
    source_id: "src_public_product_pages",
    url: "https://example.com/ai-headshot",
    title: "AI Headshot Local",
    language: "en",
    raw_signal: "AI headshot tool for professionals and small teams.",
    name: "AI Headshot Local",
    founder_type: "solo_founder",
    geography: ["global"],
    target_user: ["professionals", "small_teams"],
    product_form: ["ai_image_service", "professional_photo_tool"],
    route: ["ai_outcome_product", "clear_willingness_to_pay"],
    acquisition: ["seo"],
    delivery: ["web_app"],
    pricing: ["one_time_purchase"],
    summary: "A professional AI headshot product for individuals and teams.",
    commercial_path: "Sell finished professional photos against the offline alternative cost.",
    risks: ["output_quality_variance"],
    confidence: "medium",
    ...overrides,
  };
}

function testImportsCandidateIntoRawAndNormalizedCases() {
  const root = createFixture();
  const input = path.join(root, "candidates.jsonl");
  writeJsonl(input, [candidate()]);

  const result = importCaseCandidates({ root, input });
  const rawRows = readJsonl(path.join(root, "knowledge", "cases", "raw", "raw-cases.jsonl"));
  const normalizedRows = readJsonl(path.join(root, "knowledge", "cases", "normalized", "normalized-cases.jsonl"));

  assert.deepStrictEqual(result, { imported: 1, skipped: 0, errors: [] });
  assert(rawRows.some((row) => row.id === "raw_ai_headshot_local"));
  assert(normalizedRows.some((row) => row.id === "case_ai_headshot_local"));
}

function testRejectsDuplicateEvidenceUrl() {
  const root = createFixture();
  const input = path.join(root, "candidates.jsonl");
  writeJsonl(input, [candidate({ id: "duplicate_url", url: "https://example.com/existing" })]);

  const result = importCaseCandidates({ root, input, allowSkip: true });

  assert.strictEqual(result.imported, 0);
  assert.strictEqual(result.skipped, 1);
  assert(result.errors[0].includes("duplicate evidence URL"));
}

function testRejectsMissingRequiredFields() {
  const root = createFixture();
  const input = path.join(root, "candidates.jsonl");
  const row = candidate();
  delete row.summary;
  writeJsonl(input, [row]);

  const result = importCaseCandidates({ root, input, allowSkip: true });

  assert.strictEqual(result.imported, 0);
  assert.strictEqual(result.skipped, 1);
  assert(result.errors[0].includes("missing required field"));
}

function testImportedCaseIsSearchable() {
  const root = createFixture();
  const input = path.join(root, "candidates.jsonl");
  writeJsonl(input, [candidate()]);

  importCaseCandidates({ root, input });
  const result = matchProductIdea({
    root,
    idea: "AI headshot product for professionals",
    limit: 3,
  });

  assert(result.similarCases.some((row) => row.id === "case_ai_headshot_local"));
}

testImportsCandidateIntoRawAndNormalizedCases();
testRejectsDuplicateEvidenceUrl();
testRejectsMissingRequiredFields();
testImportedCaseIsSearchable();
console.log("case importer tests passed");
