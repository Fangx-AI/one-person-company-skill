#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_MINIMUMS = {
  minSources: 1,
  minRaw: 1,
  minNormalized: 1,
  minGold: 1,
};

const V01_MINIMUMS = {
  minSources: 20,
  minRaw: 1000,
  minNormalized: 300,
  minGold: 50,
};

const requiredSourceFields = [
  "id",
  "name",
  "url",
  "platform",
  "language",
  "priority",
  "access",
  "collection_method",
  "allowed_use",
  "risk_level",
  "notes",
];

const requiredRawFields = [
  "id",
  "source_id",
  "url",
  "title",
  "captured_at",
  "language",
  "raw_signal",
  "evidence_type",
  "rights_note",
];

const requiredNormalizedFields = [
  "id",
  "raw_ids",
  "name",
  "founder_type",
  "geography",
  "target_user",
  "product_form",
  "route",
  "acquisition",
  "delivery",
  "pricing",
  "evidence_urls",
  "summary",
  "commercial_path",
  "risks",
  "confidence",
  "date_checked",
];

const requiredGoldFields = [
  "id",
  "case_id",
  "score",
  "why_gold",
  "reusable_lessons",
  "applicable_to",
  "warning_flags",
];

function parseArgs(argv) {
  const config = { ...DEFAULT_MINIMUMS };
  for (const arg of argv) {
    if (arg === "--target=v0.1") Object.assign(config, V01_MINIMUMS);
    else if (arg.startsWith("--min-sources=")) config.minSources = Number(arg.split("=")[1]);
    else if (arg.startsWith("--min-raw=")) config.minRaw = Number(arg.split("=")[1]);
    else if (arg.startsWith("--min-normalized=")) config.minNormalized = Number(arg.split("=")[1]);
    else if (arg.startsWith("--min-gold=")) config.minGold = Number(arg.split("=")[1]);
  }
  return config;
}

function casePaths(root) {
  const base = path.join(root, "knowledge", "cases");
  return {
    sourceMap: path.join(base, "source-map.jsonl"),
    rawCases: path.join(base, "raw", "raw-cases.jsonl"),
    normalizedCases: path.join(base, "normalized", "normalized-cases.jsonl"),
    goldCases: path.join(base, "gold", "gold-cases.jsonl"),
  };
}

function readJsonl(filePath, errors) {
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing JSONL file: ${filePath}`);
    return [];
  }

  const text = fs.readFileSync(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, number }) => {
      try {
        return { row: JSON.parse(line), number };
      } catch (error) {
        errors.push(`${filePath}:${number} is not valid JSON: ${error.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyText);
}

function validateRequiredFields(kind, rows, requiredFields, errors) {
  for (const { row, number } of rows) {
    for (const field of requiredFields) {
      if (row[field] === undefined || row[field] === null || row[field] === "") {
        errors.push(`${kind}:${row.id || `line ${number}`} missing required field "${field}"`);
      }
    }
  }
}

function validateUniqueIds(kind, rows, errors) {
  const seen = new Set();
  for (const { row, number } of rows) {
    if (!isNonEmptyText(row.id)) {
      errors.push(`${kind}:line ${number} has invalid id`);
      continue;
    }
    if (seen.has(row.id)) errors.push(`${kind}:${row.id} is duplicated`);
    seen.add(row.id);
  }
  return seen;
}

function validateUrls(kind, rows, fields, errors) {
  for (const { row } of rows) {
    for (const field of fields) {
      const values = Array.isArray(row[field]) ? row[field] : [row[field]];
      for (const value of values) {
        try {
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol)) {
            errors.push(`${kind}:${row.id} field "${field}" must use http or https`);
          }
        } catch {
          errors.push(`${kind}:${row.id} field "${field}" is not a valid URL`);
        }
      }
    }
  }
}

function validateArrayFields(kind, rows, fields, errors) {
  for (const { row } of rows) {
    for (const field of fields) {
      if (!isNonEmptyArray(row[field])) {
        errors.push(`${kind}:${row.id} field "${field}" must be a non-empty string array`);
      }
    }
  }
}

function validateCaseIntelligence(options = {}) {
  const root = options.root || path.resolve(__dirname, "..", "..");
  const minimums = { ...DEFAULT_MINIMUMS, ...options };
  const errors = [];
  const paths = casePaths(root);

  const sources = readJsonl(paths.sourceMap, errors);
  const rawCases = readJsonl(paths.rawCases, errors);
  const normalizedCases = readJsonl(paths.normalizedCases, errors);
  const goldCases = readJsonl(paths.goldCases, errors);

  validateRequiredFields("source", sources, requiredSourceFields, errors);
  validateRequiredFields("raw", rawCases, requiredRawFields, errors);
  validateRequiredFields("normalized", normalizedCases, requiredNormalizedFields, errors);
  validateRequiredFields("gold", goldCases, requiredGoldFields, errors);

  const sourceIds = validateUniqueIds("source", sources, errors);
  const rawIds = validateUniqueIds("raw", rawCases, errors);
  const normalizedIds = validateUniqueIds("normalized", normalizedCases, errors);
  validateUniqueIds("gold", goldCases, errors);

  validateUrls("source", sources, ["url"], errors);
  validateUrls("raw", rawCases, ["url"], errors);
  validateUrls("normalized", normalizedCases, ["evidence_urls"], errors);

  validateArrayFields("normalized", normalizedCases, [
    "raw_ids",
    "geography",
    "target_user",
    "product_form",
    "route",
    "acquisition",
    "delivery",
    "pricing",
    "evidence_urls",
    "risks",
  ], errors);
  validateArrayFields("gold", goldCases, ["reusable_lessons", "applicable_to", "warning_flags"], errors);

  for (const { row } of rawCases) {
    if (!sourceIds.has(row.source_id)) errors.push(`raw:${row.id} references missing source_id "${row.source_id}"`);
    if (isNonEmptyText(row.raw_signal) && row.raw_signal.length > 600) {
      errors.push(`raw:${row.id} raw_signal is too long; store a short signal, not copied content`);
    }
  }

  for (const { row } of normalizedCases) {
    for (const rawId of row.raw_ids || []) {
      if (!rawIds.has(rawId)) errors.push(`normalized:${row.id} references missing raw_id "${rawId}"`);
    }
    if (!["low", "medium", "high"].includes(row.confidence)) {
      errors.push(`normalized:${row.id} confidence must be low, medium, or high`);
    }
    if (isNonEmptyText(row.summary) && row.summary.length > 700) {
      errors.push(`normalized:${row.id} summary is too long; keep summaries compact`);
    }
  }

  for (const { row } of goldCases) {
    if (!normalizedIds.has(row.case_id)) errors.push(`gold:${row.id} references missing case_id "${row.case_id}"`);
    if (!Number.isInteger(row.score) || row.score < 0 || row.score > 100) {
      errors.push(`gold:${row.id} score must be an integer from 0 to 100`);
    }
  }

  const counts = {
    sources: sources.length,
    rawCases: rawCases.length,
    normalizedCases: normalizedCases.length,
    goldCases: goldCases.length,
  };

  if (counts.sources < minimums.minSources) errors.push(`Need at least ${minimums.minSources} sources; found ${counts.sources}`);
  if (counts.rawCases < minimums.minRaw) errors.push(`Need at least ${minimums.minRaw} raw cases; found ${counts.rawCases}`);
  if (counts.normalizedCases < minimums.minNormalized) errors.push(`Need at least ${minimums.minNormalized} normalized cases; found ${counts.normalizedCases}`);
  if (counts.goldCases < minimums.minGold) errors.push(`Need at least ${minimums.minGold} gold cases; found ${counts.goldCases}`);

  return {
    ok: errors.length === 0,
    counts,
    errors,
  };
}

if (require.main === module) {
  const result = validateCaseIntelligence(parseArgs(process.argv.slice(2)));
  if (result.ok) {
    console.log("case intelligence validation passed");
    console.log(JSON.stringify(result.counts, null, 2));
    process.exit(0);
  }

  console.error("case intelligence validation failed");
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}

module.exports = { validateCaseIntelligence };
