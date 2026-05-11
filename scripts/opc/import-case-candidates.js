#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REQUIRED_CANDIDATE_FIELDS = [
  "id",
  "source_id",
  "url",
  "title",
  "language",
  "raw_signal",
  "name",
  "founder_type",
  "geography",
  "target_user",
  "product_form",
  "route",
  "acquisition",
  "delivery",
  "pricing",
  "summary",
  "commercial_path",
  "risks",
  "confidence",
];

const ARRAY_FIELDS = [
  "geography",
  "target_user",
  "product_form",
  "route",
  "acquisition",
  "delivery",
  "pricing",
  "risks",
];

function casePaths(root) {
  const base = path.join(root, "knowledge", "cases");
  return {
    sources: path.join(base, "source-map.jsonl"),
    raw: path.join(base, "raw", "raw-cases.jsonl"),
    normalized: path.join(base, "normalized", "normalized-cases.jsonl"),
    candidates: path.join(base, "candidates", "case-candidates.jsonl"),
  };
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, number }) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${number} is not valid JSON: ${error.message}`);
      }
    });
}

function appendJsonl(filePath, rows) {
  if (rows.length === 0) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyText);
}

function validateCandidate(row, sourceIds) {
  const errors = [];

  for (const field of REQUIRED_CANDIDATE_FIELDS) {
    if (row[field] === undefined || row[field] === null || row[field] === "") {
      errors.push(`missing required field "${field}"`);
    }
  }

  for (const field of ARRAY_FIELDS) {
    if (!isNonEmptyArray(row[field])) errors.push(`field "${field}" must be a non-empty string array`);
  }

  if (row.source_id && !sourceIds.has(row.source_id)) {
    errors.push(`references missing source_id "${row.source_id}"`);
  }

  try {
    const url = new URL(row.url);
    if (!["http:", "https:"].includes(url.protocol)) errors.push("url must use http or https");
  } catch {
    errors.push("url is not a valid URL");
  }

  if (row.confidence && !["low", "medium", "high"].includes(row.confidence)) {
    errors.push("confidence must be low, medium, or high");
  }

  if (isNonEmptyText(row.raw_signal) && row.raw_signal.length > 600) {
    errors.push("raw_signal is too long; store a short signal, not copied content");
  }

  if (isNonEmptyText(row.summary) && row.summary.length > 700) {
    errors.push("summary is too long; keep summaries compact");
  }

  return errors;
}

function candidateToRows(row, capturedAt) {
  const rawId = `raw_${row.id}`;
  const caseId = `case_${row.id}`;
  return {
    raw: {
      id: rawId,
      source_id: row.source_id,
      url: row.url,
      title: row.title,
      captured_at: row.captured_at || capturedAt,
      language: row.language,
      raw_signal: row.raw_signal,
      evidence_type: row.evidence_type || "candidate_case",
      rights_note: row.rights_note || "Only metadata, short summary, and structured facts are stored.",
    },
    normalized: {
      id: caseId,
      raw_ids: [rawId],
      name: row.name,
      founder_type: row.founder_type,
      geography: row.geography,
      target_user: row.target_user,
      product_form: row.product_form,
      route: row.route,
      acquisition: row.acquisition,
      delivery: row.delivery,
      pricing: row.pricing,
      evidence_urls: [row.url],
      summary: row.summary,
      commercial_path: row.commercial_path,
      risks: row.risks,
      confidence: row.confidence,
      date_checked: row.date_checked || capturedAt,
    },
  };
}

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === "--allow-skip") options.allowSkip = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--input=")) options.input = arg.slice("--input=".length);
    else if (arg.startsWith("--root=")) options.root = arg.slice("--root=".length);
  }
  return options;
}

function importCaseCandidates(options = {}) {
  const root = options.root || path.resolve(__dirname, "..", "..");
  const paths = casePaths(root);
  const input = options.input || paths.candidates;
  const allowSkip = Boolean(options.allowSkip);
  const dryRun = Boolean(options.dryRun);
  const capturedAt = options.capturedAt || new Date().toISOString().slice(0, 10);

  const sources = readJsonl(paths.sources);
  const rawRows = readJsonl(paths.raw);
  const normalizedRows = readJsonl(paths.normalized);
  const candidates = readJsonl(input);

  const sourceIds = new Set(sources.map((row) => row.id));
  const rawIds = new Set(rawRows.map((row) => row.id));
  const normalizedIds = new Set(normalizedRows.map((row) => row.id));
  const evidenceUrls = new Set(normalizedRows.flatMap((row) => row.evidence_urls || []));
  const errors = [];
  const rawToAppend = [];
  const normalizedToAppend = [];
  let skipped = 0;

  for (const row of candidates) {
    const rawId = `raw_${row.id}`;
    const caseId = `case_${row.id}`;
    const rowErrors = validateCandidate(row, sourceIds);

    if (rawIds.has(rawId)) rowErrors.push(`duplicate raw id "${rawId}"`);
    if (normalizedIds.has(caseId)) rowErrors.push(`duplicate normalized id "${caseId}"`);
    if (evidenceUrls.has(row.url)) rowErrors.push(`duplicate evidence URL "${row.url}"`);

    if (rowErrors.length > 0) {
      skipped += 1;
      errors.push(`${row.id || "candidate"}: ${rowErrors.join("; ")}`);
      if (!allowSkip) break;
      continue;
    }

    const rows = candidateToRows(row, capturedAt);
    rawToAppend.push(rows.raw);
    normalizedToAppend.push(rows.normalized);
    rawIds.add(rows.raw.id);
    normalizedIds.add(rows.normalized.id);
    evidenceUrls.add(row.url);
  }

  if (errors.length > 0 && !allowSkip) {
    return { imported: 0, skipped, errors };
  }

  if (!dryRun) {
    appendJsonl(paths.raw, rawToAppend);
    appendJsonl(paths.normalized, normalizedToAppend);
  }

  return {
    imported: rawToAppend.length,
    skipped,
    errors,
  };
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  const result = importCaseCandidates(options);
  const ok = result.errors.length === 0 || options.allowSkip;
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exit(1);
}

module.exports = { importCaseCandidates };
