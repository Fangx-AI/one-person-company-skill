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
testReferencesExistAndAreLinked();
testAgentMetadataExists();

console.log("skill surface tests passed");
