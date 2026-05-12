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
  assert(fields.description.length < 500);
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

function testSkillDefaultsToMainlandChinaContext() {
  [
    "默认面向中国大陆语境",
    "国内用户",
    "海外案例只作为商业机制参照",
    "不能直接照搬国外模式",
  ].forEach((marker) => {
    assert(skill.includes(marker), `SKILL.md should include domestic context marker ${marker}`);
  });

  const chinaReality = fs.readFileSync(
    path.join(root, "skills", "one-person-company", "references", "china-reality.md"),
    "utf8"
  );
  [
    "默认判断语境是中国大陆",
    "海外模式不能直接照搬",
    "渠道",
    "支付",
    "合规",
    "信任",
    "交付",
  ].forEach((marker) => {
    assert(chinaReality.includes(marker), `china reality reference should include ${marker}`);
  });
}

function testReferencesExistAndAreLinked() {
  [
    "business-judgment.md",
    "china-reality.md",
    "case-intelligence.md",
  ].forEach((file) => {
    assert(skill.includes(`references/${file}`), `SKILL.md should link ${file}`);
    const text = fs.readFileSync(path.join(root, "skills", "one-person-company", "references", file), "utf8");
    assert(text.length > 500, `${file} should contain substantive guidance`);
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
testSkillDefaultsToMainlandChinaContext();
testReferencesExistAndAreLinked();
testAgentMetadataExists();

console.log("skill surface tests passed");
