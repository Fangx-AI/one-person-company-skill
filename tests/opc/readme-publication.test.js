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
    "别再问",
    "谁现在付钱",
    "为什么现在付",
    "一个人能不能低成本交付",
    "三个入口",
    "/产品判断",
    "/相似案例",
    "/定价获客",
    "30 秒看懂输出差异",
    "普通大模型",
    "为什么不是提示词合集",
    "商业化可行性是第一准则",
    "快速开始",
    "案例情报库",
    "知识库规模",
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
    "100+ 标准化案例",
    "30 条 gold cases",
    "10 个 GitHub 高价值开源知识源",
    "16 条 GitHub 实操信号",
    "10 个高频市场模式",
    "13 条金标回答样本",
    "中文商业语境",
    "本土执行现实",
    "备案",
    "微信生态",
    "npm test",
    "node scripts/opc/match-product-idea.js",
  ].forEach((marker) => {
    assert(readme.includes(marker), `README should include trust signal ${marker}`);
  });
}

function testReadmeAvoidsAwkwardPublicRegionalFraming() {
  [
    "中国大陆",
    "mainland",
    "China solo business",
    "China-specific",
    "默认面向",
    "国内用户",
  ].forEach((marker) => {
    assert(!readme.includes(marker), `README should avoid public framing marker ${marker}`);
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
testReadmeAvoidsAwkwardPublicRegionalFraming();
testLicenseFileExists();

console.log("readme publication tests passed");
