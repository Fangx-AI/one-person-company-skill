#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

function assertIncludes(markers, label) {
  markers.forEach((marker) => {
    assert(readme.includes(marker), `README should include ${label} marker ${marker}`);
  });
}

function assertExcludes(markers, label) {
  markers.forEach((marker) => {
    assert(!readme.includes(marker), `README should avoid ${label} marker ${marker}`);
  });
}

function testReadmeHasSharpPublicLaunchSections() {
  assertIncludes(
    [
      "# 一人公司Skill",
      "v0.1 public alpha",
      "大多数创业建议死在一句话里：先做 MVP",
      "这个 Skill 从不这样回答",
      "它不负责鼓励你创业",
      "谁现在付钱",
      "什么时候该停",
      "它判断什么",
      "三个入口",
      "/产品判断",
      "/相似案例",
      "/定价获客",
      "三个例子",
      "AI 换装小程序",
      "Markdown 转 HTML",
      "一人公司案例库",
      "为什么不是提示词合集",
      "商业化可行性是第一准则",
      "证据资产",
      "快速开始",
      "项目结构",
      "质量门槛",
      "路线图",
      "License",
    ],
    "public launch",
  );
}

function testReadmeUsesTrustSignals() {
  assertIncludes(
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
      "竞品",
      "替代方案",
      "收费机制",
      "交付边界",
      "停损线",
      "npm test",
      "node scripts/opc/match-product-idea.js",
    ],
    "trust signal",
  );
}

function testReadmeAvoidsAwkwardPublicRegionalFraming() {
  assertExcludes(
    [
      "中国大陆",
      "mainland",
      "China solo business",
      "China-specific",
      "默认面向",
      "国内用户",
    ],
    "awkward public regional framing",
  );
}

function testReadmeAvoidsStaleGenericHero() {
  assertExcludes(
    [
      "30 秒看懂输出差异",
      "给一人公司创业者的产品判断、相似案例、定价获客与交付路径",
      "可以先做 MVP，找到目标用户，持续优化体验，打造差异化。",
    ],
    "stale generic hero",
  );
}

function testLicenseFileExists() {
  const licensePath = path.join(root, "LICENSE");
  assert(fs.existsSync(licensePath), "LICENSE file should exist for GitHub launch");
  const license = fs.readFileSync(licensePath, "utf8");
  assert(license.includes("MIT License"));
  assert(license.includes("Copyright"));
}

testReadmeHasSharpPublicLaunchSections();
testReadmeUsesTrustSignals();
testReadmeAvoidsAwkwardPublicRegionalFraming();
testReadmeAvoidsStaleGenericHero();
testLicenseFileExists();

console.log("readme publication tests passed");
