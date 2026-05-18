#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assertIncludes(text, markers, label) {
  markers.forEach((marker) => {
    assert(text.includes(marker), `${label} should include ${marker}`);
  });
}

function testReadmeLinksInstallAndBenchmarkDocs() {
  const readme = read("README.md");
  assertIncludes(
    readme,
    [
      "docs/INSTALL.md",
      "knowledge/evals/manual-benchmark.md",
      "安装验证",
      "回答质量 Benchmark",
    ],
    "README",
  );
}

function testInstallDocGivesVerifiedPaths() {
  assert(exists("docs/INSTALL.md"), "docs/INSTALL.md should exist");
  const install = read("docs/INSTALL.md");
  assertIncludes(
    install,
    [
      "Codex",
      "skill-installer",
      "Fangx-AI/one-person-company-skill",
      "skills/opc",
      "重启 Codex",
      "npx skills add",
      "未作为主安装路径",
      "验证命令",
    ],
    "install doc",
  );
  assert(!install.includes("skills/one-person-company"), "install doc should use short skill path");
}

function testManualBenchmarkHasTenScenariosAndJudgmentRubric() {
  assert(exists("knowledge/evals/manual-benchmark.md"), "manual benchmark should exist");
  const benchmark = read("knowledge/evals/manual-benchmark.md");
  const scenarioCount = (benchmark.match(/^### /gm) || []).length;
  assert(scenarioCount >= 10, `manual benchmark should include at least 10 scenarios, got ${scenarioCount}`);
  assertIncludes(
    benchmark,
    [
      "回答质量 Benchmark",
      "用户问题",
      "普通 AI 容易回答",
      "一人公司.skill 必须命中",
      "失败判定",
      "AI 换装",
      "本地门店获客",
      "Markdown 转 HTML",
      "Notion 建站",
      "开发者工具",
    ],
    "manual benchmark",
  );
}

testReadmeLinksInstallAndBenchmarkDocs();
testInstallDocGivesVerifiedPaths();
testManualBenchmarkHasTenScenariosAndJudgmentRubric();

console.log("install and benchmark tests passed");
