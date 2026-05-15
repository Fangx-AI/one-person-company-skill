#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REQUIRED_SECTIONS = [
  "## 用户输入",
  "## 普通 AI 容易回答",
  "## 一人公司.skill 商业判断卡",
  "## 为什么更好",
  "## 可参考市场模式",
];

const REQUIRED_CARD_MARKERS = [
  "结论：",
  "付费可能性：",
  "最可能付费的人：",
  "直接竞品：",
  "替代方案：",
  "可收费切口：",
  "第一单动作：",
  "7 天验证：",
  "停损线：",
];

function validateExamples(options = {}) {
  const root = options.root || path.resolve(__dirname, "..", "..");
  const minExamples = options.minExamples || 10;
  const examplesDir = path.join(root, "examples");
  const errors = [];

  if (!fs.existsSync(examplesDir)) {
    return { ok: false, counts: { examples: 0 }, errors: [`Missing examples directory: ${examplesDir}`] };
  }

  const files = fs
    .readdirSync(examplesDir)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort();

  if (files.length < minExamples) {
    errors.push(`Need at least ${minExamples} example files; found ${files.length}`);
  }

  for (const file of files) {
    const text = fs.readFileSync(path.join(examplesDir, file), "utf8");
    for (const section of REQUIRED_SECTIONS) {
      if (!text.includes(section)) errors.push(`${file} missing section ${section}`);
    }
    for (const marker of REQUIRED_CARD_MARKERS) {
      if (!text.includes(marker)) errors.push(`${file} missing business card marker ${marker}`);
    }
    if (!/\/(opc|product|cases|pricing)\s+/.test(text)) {
      errors.push(`${file} should include an English slash command input`);
    }
    if (!text.includes("../knowledge/market-patterns/")) {
      errors.push(`${file} should link to a market pattern`);
    }
  }

  const readmePath = path.join(examplesDir, "README.md");
  if (!fs.existsSync(readmePath)) {
    errors.push("examples/README.md should exist");
  } else {
    const readme = fs.readFileSync(readmePath, "utf8");
    for (const file of files) {
      if (!readme.includes(file)) errors.push(`examples/README.md should link ${file}`);
    }
  }

  return {
    ok: errors.length === 0,
    counts: { examples: files.length },
    errors,
  };
}

if (require.main === module) {
  const minExamples = Number(process.argv.find((arg) => arg.startsWith("--min-examples="))?.split("=")[1] || 10);
  const result = validateExamples({ minExamples });

  if (result.ok) {
    console.log("examples validation passed");
    console.log(JSON.stringify(result.counts, null, 2));
    process.exit(0);
  }

  console.error("examples validation failed");
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}

module.exports = { validateExamples };
