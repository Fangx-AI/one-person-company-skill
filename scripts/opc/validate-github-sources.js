#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const requiredSourceFields = [
  "id",
  "repo",
  "url",
  "language",
  "category",
  "why_relevant",
  "allowed_use",
  "risk_level",
];

const requiredSignalFields = [
  "id",
  "source_id",
  "signal_type",
  "scenario",
  "practical_signal",
  "business_implication",
  "china_adaptation",
  "risk_or_limit",
  "evidence_url",
  "date_checked",
];

const allowedSignalTypes = new Set([
  "payment",
  "delivery",
  "acquisition",
  "business_model",
  "china_reality",
  "solo_infrastructure",
  "operating_principle",
]);

function parseArgs(argv) {
  const config = { minSources: 1, minSignals: 1 };
  for (const arg of argv) {
    if (arg.startsWith("--min-sources=")) config.minSources = Number(arg.split("=")[1]);
    else if (arg.startsWith("--min-signals=")) config.minSignals = Number(arg.split("=")[1]);
  }
  return config;
}

function paths(root) {
  const base = path.join(root, "knowledge", "github-sources");
  return {
    sources: path.join(base, "source-map.jsonl"),
    signals: path.join(base, "practice-signals.jsonl"),
  };
}

function readJsonl(filePath, errors) {
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing JSONL file: ${filePath}`);
    return [];
  }

  return fs
    .readFileSync(filePath, "utf8")
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

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function validateRequired(kind, rows, fields, errors) {
  for (const { row, number } of rows) {
    for (const field of fields) {
      if (!isText(row[field])) errors.push(`${kind}:${row.id || `line ${number}`} missing required field "${field}"`);
    }
  }
}

function validateUnique(kind, rows, errors) {
  const ids = new Set();
  for (const { row, number } of rows) {
    if (!isText(row.id)) {
      errors.push(`${kind}:line ${number} has invalid id`);
      continue;
    }
    if (ids.has(row.id)) errors.push(`${kind}:${row.id} is duplicated`);
    ids.add(row.id);
  }
  return ids;
}

function validateGithubSources(options = {}) {
  const root = options.root || path.resolve(__dirname, "..", "..");
  const minSources = options.minSources || 1;
  const minSignals = options.minSignals || 1;
  const errors = [];
  const sourcePaths = paths(root);
  const sources = readJsonl(sourcePaths.sources, errors);
  const signals = readJsonl(sourcePaths.signals, errors);

  validateRequired("source", sources, requiredSourceFields, errors);
  validateRequired("signal", signals, requiredSignalFields, errors);

  const sourceIds = validateUnique("source", sources, errors);
  validateUnique("signal", signals, errors);

  for (const { row } of sources) {
    if (!isUrl(row.url)) errors.push(`source:${row.id} url is invalid`);
    if (!["low", "medium", "high"].includes(row.risk_level)) {
      errors.push(`source:${row.id} risk_level must be low, medium, or high`);
    }
    if (!row.allowed_use.includes("structured")) {
      errors.push(`source:${row.id} allowed_use must clarify structured extraction`);
    }
  }

  for (const { row } of signals) {
    if (!sourceIds.has(row.source_id)) errors.push(`signal:${row.id} references missing source_id "${row.source_id}"`);
    if (!allowedSignalTypes.has(row.signal_type)) errors.push(`signal:${row.id} has unsupported signal_type "${row.signal_type}"`);
    if (!isUrl(row.evidence_url)) errors.push(`signal:${row.id} evidence_url is invalid`);
    for (const field of ["practical_signal", "business_implication", "china_adaptation", "risk_or_limit"]) {
      if (isText(row[field]) && row[field].length < 30) {
        errors.push(`signal:${row.id} field "${field}" is too shallow`);
      }
    }
    const serialized = JSON.stringify(row);
    if (serialized.length > 1600) errors.push(`signal:${row.id} is too long; store structured notes, not copied articles`);
  }

  if (sources.length < minSources) errors.push(`Need at least ${minSources} github sources; found ${sources.length}`);
  if (signals.length < minSignals) errors.push(`Need at least ${minSignals} practice signals; found ${signals.length}`);

  return {
    ok: errors.length === 0,
    counts: { sources: sources.length, signals: signals.length },
    errors,
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const result = validateGithubSources(args);
  if (result.ok) {
    console.log("github source validation passed");
    console.log(JSON.stringify(result.counts, null, 2));
    process.exit(0);
  }
  console.error("github source validation failed");
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}

module.exports = { validateGithubSources };
