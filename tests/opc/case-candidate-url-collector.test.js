#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const { collectCaseCandidateUrls } = require("../../scripts/opc/collect-case-candidates");

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opc-url-collect-"));
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
  writeJsonl(path.join(base, "candidates", "case-candidates.jsonl"), []);

  return root;
}

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/alpha") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html lang="en">
<head>
  <meta property="og:title" content="Alpha Founder Tool">
  <meta name="description" content="A concise metadata description for solo founder research.">
  <link rel="canonical" href="/alpha-canonical">
  <title>Fallback Alpha Title</title>
</head>
<body>SHOULD_NOT_COPY_BODY_TEXT from a long article.</body>
</html>`);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
      });
    });
  });
}

async function testCollectsMetadataOnlyCandidate() {
  const root = createFixture();
  const { server, baseUrl } = await startFixtureServer();

  try {
    const result = await collectCaseCandidateUrls({
      root,
      urls: [`${baseUrl}/alpha`],
      capturedAt: "2026-05-11",
    });
    const candidates = readJsonl(path.join(root, "knowledge", "cases", "candidates", "case-candidates.jsonl"));
    const rawRows = readJsonl(path.join(root, "knowledge", "cases", "raw", "raw-cases.jsonl"));
    const normalizedRows = readJsonl(path.join(root, "knowledge", "cases", "normalized", "normalized-cases.jsonl"));

    assert.deepStrictEqual(result, { collected: 1, skipped: 0, errors: [] });
    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0].title, "Alpha Founder Tool");
    assert.strictEqual(candidates[0].url, `${baseUrl}/alpha-canonical`);
    assert.strictEqual(candidates[0].source_id, "src_public_product_pages");
    assert.strictEqual(candidates[0].confidence, "low");
    assert(candidates[0].raw_signal.includes("A concise metadata description"));
    assert(!JSON.stringify(candidates[0]).includes("SHOULD_NOT_COPY_BODY_TEXT"));
    assert.strictEqual(rawRows.length, 1);
    assert.strictEqual(normalizedRows.length, 1);
  } finally {
    server.close();
  }
}

async function testSkipsDuplicateCandidateUrl() {
  const root = createFixture();
  const { server, baseUrl } = await startFixtureServer();

  try {
    await collectCaseCandidateUrls({ root, urls: [`${baseUrl}/alpha`], capturedAt: "2026-05-11" });
    const result = await collectCaseCandidateUrls({ root, urls: [`${baseUrl}/alpha`], capturedAt: "2026-05-11" });
    const candidates = readJsonl(path.join(root, "knowledge", "cases", "candidates", "case-candidates.jsonl"));

    assert.strictEqual(result.collected, 0);
    assert.strictEqual(result.skipped, 1);
    assert(result.errors[0].includes("duplicate candidate URL"));
    assert.strictEqual(candidates.length, 1);
  } finally {
    server.close();
  }
}

async function testDryRunDoesNotWriteCandidate() {
  const root = createFixture();
  const { server, baseUrl } = await startFixtureServer();

  try {
    const result = await collectCaseCandidateUrls({
      root,
      urls: [`${baseUrl}/alpha`],
      capturedAt: "2026-05-11",
      dryRun: true,
    });
    const candidates = readJsonl(path.join(root, "knowledge", "cases", "candidates", "case-candidates.jsonl"));

    assert.deepStrictEqual(result, { collected: 1, skipped: 0, errors: [] });
    assert.strictEqual(candidates.length, 0);
  } finally {
    server.close();
  }
}

(async () => {
  await testCollectsMetadataOnlyCandidate();
  await testSkipsDuplicateCandidateUrl();
  await testDryRunDoesNotWriteCandidate();
  console.log("case candidate URL collector tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
