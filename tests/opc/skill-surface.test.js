#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const skillPath = path.join(root, "skills", "one-person-company", "SKILL.md");
const skill = fs.readFileSync(skillPath, "utf8");

function frontmatter() {
  const match = skill.match(/^---\n([\s\S]*?)\n---/);
  assert(match, "SKILL.md must have YAML-style frontmatter");
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const [key, ...rest] = line.split(":");
    fields[key.trim()] = rest.join(":").trim();
  }
  return fields;
}

function testFrontmatterIsDiscoverable() {
  const fields = frontmatter();
  assert.strictEqual(fields.name, "one-person-company");
  assert(fields.description.startsWith("Use when"), "description should start with Use when");
  assert(fields.description.includes("product ideas"));
  assert(fields.description.includes("commercial viability"));
  assert(fields.description.includes("local execution constraints"));
  assert(fields.description.length < 500);
  assert(!fields.description.includes("China-specific"), "description should avoid awkward public regional framing");
}

function testSkillDefinesThreeCoreEntrypoints() {
  [
    "商业化可行性是第一准则",
    "/产品判断",
    "/相似案例",
    "/定价获客",
    "信息增量",
    "能不能收费",
    "能不能低成本触达",
    "能不能持续交付",
    "停损",
  ].forEach((marker) => {
    assert(skill.includes(marker), `SKILL.md should include ${marker}`);
  });
}

function testSkillDefaultsToChineseBusinessContext() {
  [
    "中文商业语境",
    "本土执行现实",
    "海外案例只作为商业机制参照",
    "不能直接照搬",
    "渠道、支付、合规、信任和交付",
  ].forEach((marker) => {
    assert(skill.includes(marker), `SKILL.md should include local business context marker ${marker}`);
  });

  const localExecution = fs.readFileSync(
    path.join(root, "skills", "one-person-company", "references", "local-execution.md"),
    "utf8"
  );
  [
    "中文商业语境",
    "本土执行现实",
    "海外模式不能直接照搬",
    "渠道",
    "支付",
    "合规",
    "信任",
    "交付",
  ].forEach((marker) => {
    assert(localExecution.includes(marker), `local execution reference should include ${marker}`);
  });

  [
    "中国大陆",
    "mainland",
    "China-specific",
  ].forEach((marker) => {
    assert(!skill.includes(marker), `SKILL.md should avoid public framing marker ${marker}`);
    assert(!localExecution.includes(marker), `local execution reference should avoid public framing marker ${marker}`);
  });
}

function testReferencesExistAndAreLinked() {
  [
    "answer-quality.md",
    "business-judgment.md",
    "business-model-delivery.md",
    "local-execution.md",
    "case-intelligence.md",
  ].forEach((file) => {
    assert(skill.includes(`references/${file}`), `SKILL.md should link ${file}`);
    const text = fs.readFileSync(path.join(root, "skills", "one-person-company", "references", file), "utf8");
    assert(text.length > 500, `${file} should contain substantive guidance`);
  });
}

function testSkillRequiresEvidenceDenseAnswers() {
  [
    "直接竞品",
    "相邻替代",
    "免费替代",
    "收费机制",
    "证据边界",
    "不能把不确定事实写成确定事实",
    "不要随口列竞品",
    "数字化下一步",
  ].forEach((marker) => {
    assert(skill.includes(marker), `SKILL.md should require evidence-dense answer marker ${marker}`);
  });

  const answerQuality = fs.readFileSync(
    path.join(root, "skills", "one-person-company", "references", "answer-quality.md"),
    "utf8"
  );
  [
    "直接竞品",
    "相邻替代",
    "免费替代",
    "收费机制",
    "证据边界",
    "错误示例",
    "合格示例",
  ].forEach((marker) => {
    assert(answerQuality.includes(marker), `answer quality reference should include ${marker}`);
  });
}

function testBusinessModelDeliveryReferenceIsHardNosed() {
  assert(
    skill.includes("references/business-model-delivery.md"),
    "SKILL.md should link the business model and delivery reference"
  );

  const delivery = fs.readFileSync(
    path.join(root, "skills", "one-person-company", "references", "business-model-delivery.md"),
    "utf8"
  );
  [
    "收费",
    "支付",
    "交付",
    "毛利",
    "复购",
    "售后",
    "停损",
    "服务",
    "模板",
    "工具",
    "咨询",
    "社群",
    "数据",
    "自动化",
    "先收钱",
  ].forEach((marker) => {
    assert(delivery.includes(marker), `business model reference should include ${marker}`);
  });
}

function testAgentMetadataExists() {
  const metadata = fs.readFileSync(
    path.join(root, "skills", "one-person-company", "agents", "openai.yaml"),
    "utf8"
  );
  assert(metadata.includes("display_name: 一人公司Skill"));
  assert(metadata.includes("short_description:"));
  assert(metadata.includes("default_prompt:"));
}

testFrontmatterIsDiscoverable();
testSkillDefinesThreeCoreEntrypoints();
testSkillDefaultsToChineseBusinessContext();
testReferencesExistAndAreLinked();
testSkillRequiresEvidenceDenseAnswers();
testBusinessModelDeliveryReferenceIsHardNosed();
testAgentMetadataExists();

console.log("skill surface tests passed");
