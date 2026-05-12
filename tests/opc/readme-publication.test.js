#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

function testReadmeHasPublicLaunchSections() {
  [
    "# 一人公司Skill",
    "v0.1 public alpha",
    "商业化可行性是第一准则",
    "快速开始",
    "真实问题示例",
    "知识库规模",
    "工具路径图",
    "项目结构",
    "质量门槛",
    "路线图",
    "License",
  ].forEach((marker) => {
    assert(readme.includes(marker), `README should include ${marker}`);
  });
}

function testReadmeUsesTrustSignals() {
  [
    "https://img.shields.io",
    "100 条标准化案例",
    "30 条 gold cases",
    "10 个 GitHub 高价值开源知识源",
    "16 条 GitHub 实操信号",
    "npm test",
    "node scripts/opc/match-product-idea.js",
  ].forEach((marker) => {
    assert(readme.includes(marker), `README should include trust signal ${marker}`);
  });
}

function testLicenseFileExists() {
  const licensePath = path.join(root, "LICENSE");
  assert(fs.existsSync(licensePath), "LICENSE file should exist for GitHub launch");
  const license = fs.readFileSync(licensePath, "utf8");
  assert(license.includes("MIT License"));
  assert(license.includes("Copyright"));
}

testReadmeHasPublicLaunchSections();
testReadmeUsesTrustSignals();
testLicenseFileExists();

console.log("readme publication tests passed");
