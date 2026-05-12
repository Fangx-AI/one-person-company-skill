#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REQUIRED_SCENARIO_FIELDS = [
  "id",
  "user_message",
  "intent",
  "stage",
  "must_include",
  "must_avoid",
  "scoring_focus",
  "pass_bar",
];

const REQUIRED_GOLD_FIELDS = ["scenario_id", "answer", "why_it_works"];

const REQUIRED_MUST_INCLUDE = [
  "business_judgment",
  "case_or_pattern",
  "china_reality_or_constraint",
  "next_action",
  "stop_loss",
];

function evalPaths(root) {
  const base = path.join(root, "knowledge", "evals", "answer-quality");
  return {
    scenarios: path.join(base, "scenarios.jsonl"),
    goldAnswers: path.join(base, "gold-answers.jsonl"),
    rubric: path.join(base, "rubric.json"),
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

function readJson(filePath, errors) {
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing JSON file: ${filePath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${filePath} is not valid JSON: ${error.message}`);
    return null;
  }
}

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyTextArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyText);
}

function validateRequired(kind, rows, fields, errors) {
  for (const { row, number } of rows) {
    for (const field of fields) {
      if (row[field] === undefined || row[field] === null || row[field] === "") {
        errors.push(`${kind}:${row.id || row.scenario_id || `line ${number}`} missing required field "${field}"`);
      }
    }
  }
}

function validateAnswerQualityEvals(options = {}) {
  const root = options.root || path.resolve(__dirname, "..", "..");
  const minScenarios = options.minScenarios || 1;
  const minGoldAnswers = options.minGoldAnswers || 0;
  const errors = [];
  const paths = evalPaths(root);

  const scenarios = readJsonl(paths.scenarios, errors);
  const goldAnswers = readJsonl(paths.goldAnswers, errors);
  const rubric = readJson(paths.rubric, errors);

  validateRequired("scenario", scenarios, REQUIRED_SCENARIO_FIELDS, errors);
  validateRequired("gold", goldAnswers, REQUIRED_GOLD_FIELDS, errors);

  const scenarioIds = new Set();
  for (const { row } of scenarios) {
    if (scenarioIds.has(row.id)) errors.push(`scenario:${row.id} is duplicated`);
    scenarioIds.add(row.id);

    for (const field of ["must_include", "must_avoid", "scoring_focus"]) {
      if (!isNonEmptyTextArray(row[field])) {
        errors.push(`scenario:${row.id} field "${field}" must be a non-empty string array`);
      }
    }

    const missingMustInclude = REQUIRED_MUST_INCLUDE.filter((item) => !(row.must_include || []).includes(item));
    if (missingMustInclude.length > 0) {
      errors.push(`scenario:${row.id} must_include missing ${missingMustInclude.join(", ")}`);
    }

    if (!isNonEmptyText(row.pass_bar) || row.pass_bar.length < 60) {
      errors.push(`scenario:${row.id} pass_bar must be specific and at least 60 chars`);
    }
  }

  for (const { row } of goldAnswers) {
    if (!scenarioIds.has(row.scenario_id)) errors.push(`gold:${row.scenario_id} references missing scenario`);
    if (!isNonEmptyText(row.answer) || row.answer.length < 120) {
      errors.push(`gold:${row.scenario_id} answer must be a substantive example`);
    }
    if (!isNonEmptyTextArray(row.why_it_works)) {
      errors.push(`gold:${row.scenario_id} why_it_works must be a non-empty string array`);
    }
  }

  const rubricItems = Array.isArray(rubric?.items) ? rubric.items : [];
  if (rubricItems.length === 0) errors.push("rubric.items must be a non-empty array");
  for (const item of rubricItems) {
    if (!isNonEmptyText(item.id)) errors.push("rubric item missing id");
    if (!isNonEmptyText(item.label)) errors.push(`rubric:${item.id || "unknown"} missing label`);
    if (!Number.isFinite(item.points) || item.points <= 0) errors.push(`rubric:${item.id || "unknown"} points must be positive`);
    if (!isNonEmptyText(item.pass)) errors.push(`rubric:${item.id || "unknown"} missing pass`);
  }

  if (scenarios.length < minScenarios) errors.push(`Need at least ${minScenarios} scenarios; found ${scenarios.length}`);
  if (goldAnswers.length < minGoldAnswers) errors.push(`Need at least ${minGoldAnswers} gold answers; found ${goldAnswers.length}`);

  return {
    ok: errors.length === 0,
    counts: {
      scenarios: scenarios.length,
      goldAnswers: goldAnswers.length,
      rubricItems: rubricItems.length,
    },
    errors,
  };
}

if (require.main === module) {
  const result = validateAnswerQualityEvals({
    minScenarios: Number(process.argv.find((arg) => arg.startsWith("--min-scenarios="))?.split("=")[1] || 1),
    minGoldAnswers: Number(process.argv.find((arg) => arg.startsWith("--min-gold-answers="))?.split("=")[1] || 0),
  });

  if (result.ok) {
    console.log("answer quality eval validation passed");
    console.log(JSON.stringify(result.counts, null, 2));
    process.exit(0);
  }

  console.error("answer quality eval validation failed");
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}

module.exports = { validateAnswerQualityEvals };
