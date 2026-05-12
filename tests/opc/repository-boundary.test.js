#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const legacySlug = ["book", "of", "elon"].join("-");
const legacyTitle = ["Book", "of", "Elon"].join(" ");
const legacyDomain = ["bookof", "elon.cn"].join("");
const legacyServer = ["server", "js"].join(".");
const legacyMonitor = ["monitor", "server"].join("-");
const legacyPreflight = ["preflight", "check"].join("-");
const legacyContainerSpec = ["Docker", "file"].join("");
const legacyEcosystem = ["ecosystem", "config", "js"].join(".");
const legacyPm2 = ["P", "M2"].join("");
const legacyReverseProxy = ["N", "ginx"].join("");
const legacyPhoneLogin = ["手机", "号"].join("");
const legacySqlite = ["SQL", "ite"].join("");

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function testOldApplicationAssetsAreRemoved() {
  [
    legacyServer,
    `${legacyMonitor}.js`,
    `${legacyPreflight}.js`,
    legacyContainerSpec,
    legacyEcosystem,
    `nginx.${legacySlug}.conf.example`,
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "auth",
    "db",
    "routes",
    "web",
    "prompts",
    "scripts/ops",
    "scripts/tools",
    "tests/smoke",
    "tests/e2e",
    "tests/calibration",
    "tests/probe",
    "docs/ARCHITECTURE.md",
    "docs/DEPLOYMENT.md",
    "docs/runbooks",
    "docs/security",
    `The ${legacyTitle}.epub`,
    `The ${legacyTitle} A Guide to Purpose and Success.pdf`,
  ].forEach((relativePath) => {
    assert(!exists(relativePath), `old application asset should be removed: ${relativePath}`);
  });
}

function testSkillRepositorySurfaceExists() {
  [
    "README.md",
    "skills/one-person-company/SKILL.md",
    "skills/one-person-company/references/business-judgment.md",
    "skills/one-person-company/references/china-reality.md",
    "skills/one-person-company/references/case-intelligence.md",
    "knowledge/cases/normalized/normalized-cases.jsonl",
    "knowledge/cases/gold/gold-cases.jsonl",
    "knowledge/evals/answer-quality/rubric.json",
    "scripts/opc/match-product-idea.js",
    "scripts/opc/validate-case-intelligence.js",
    "scripts/opc/validate-answer-quality-evals.js",
  ].forEach((relativePath) => {
    assert(exists(relativePath), `skill repository surface should exist: ${relativePath}`);
  });
}

function testPackageIdentityIsOnePersonCompanySkill() {
  const pkg = JSON.parse(read("package.json"));
  assert.strictEqual(pkg.name, "one-person-company-skill");
  assert.strictEqual(pkg.private, false);
  assert(!Object.keys(pkg.scripts).some((name) => /^smoke:|^db:|^auth:|^persist:|^northstar:|^probe:|^start/.test(name)));
}

function testReadmePresentsSkillInsteadOfOldSite() {
  const readme = read("README.md");
  [
    "# 一人公司Skill",
    "商业化可行性是第一准则",
    "产品判断",
    "相似案例",
    "定价获客",
    "案例情报库",
    "Codex",
  ].forEach((marker) => {
    assert(readme.includes(marker), `README should include ${marker}`);
  });

  [
    legacyTitle,
    legacyDomain,
    legacyPm2,
    legacyReverseProxy,
    legacyPhoneLogin,
    legacySqlite,
  ].forEach((marker) => {
    assert(!readme.includes(marker), `README should not present old site marker: ${marker}`);
  });
}

testOldApplicationAssetsAreRemoved();
testSkillRepositorySurfaceExists();
testPackageIdentityIsOnePersonCompanySkill();
testReadmePresentsSkillInsteadOfOldSite();

console.log("repository boundary tests passed");
