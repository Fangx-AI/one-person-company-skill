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

function testReadmeHasHeroFirstProjectPage() {
  assertIncludes(
    [
      "# 一人公司.skill",
      "![一人公司.skill](assets/hero.svg)",
      "不是帮你想点子，是判断这个点子能不能收钱",
      "大多数创业建议死在一句话里：先做 MVP",
      "这个 Skill 从不这样回答",
      "谁现在付钱？为什么现在付？竞品怎么收？替代方案是什么？",
      "先看效果",
      "怎么用",
      "三个入口",
      "它判断什么",
      "为什么不是提示词合集",
      "证据资产",
      "工作原理",
      "背后的判断",
      "路线图",
      "License",
    ],
    "hero-first project page",
  );
}

function testReadmeShowsEffectBeforeMechanism() {
  assert(readme.indexOf("## 先看效果") < readme.indexOf("## 怎么用"));
  assert(readme.indexOf("## 先看效果") < readme.indexOf("## 工作原理"));
  assertIncludes(
    [
      "/产品判断` 我想做一个 AI 换装小程序",
      "/产品判断` 我想做 Markdown 转 HTML",
      "/定价获客` 我想做一个一人公司案例库",
      "普通 AI 往往会说",
      "一人公司.skill 会先判断",
      "一人公司.skill 不会把“能转格式”当成生意",
      "一人公司.skill 会先反驳",
    ],
    "effect examples",
  );
}

function testReadmeSupportsLowFrictionCommands() {
  assertIncludes(
    [
      "入口是自然语言命令，不是表单",
      "最多先追问 1 个最关键的问题",
      "/产品判断 我想做一个 AI 小红书选题工具",
      "/相似案例 我想做一个一人公司案例检索库",
      "/定价获客 我想做一个给本地商家的 AI 获客工具",
    ],
    "low-friction commands",
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
      "13 个回答质量评估场景",
      "13 条金标回答样本",
      "中文商业语境",
      "本土执行现实",
      "备案",
      "微信生态",
      "竞品",
      "替代方案",
      "收费机制",
      "交付边界",
      "证据边界",
      "停损线",
      "npm test",
      "node scripts/opc/match-product-idea.js",
    ],
    "trust signal",
  );
}

function testHeroAssetExists() {
  const heroPath = path.join(root, "assets", "hero.svg");
  assert(fs.existsSync(heroPath), "README hero image should exist");
  const hero = fs.readFileSync(heroPath, "utf8");
  assert(hero.includes("一人公司.skill"));
  assert(hero.includes("谁现在付钱"));
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
      "idea:",
      "target_user:",
      "paid_trigger:",
      "use_case:",
      "acquisition_channel:",
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

testReadmeHasHeroFirstProjectPage();
testReadmeShowsEffectBeforeMechanism();
testReadmeSupportsLowFrictionCommands();
testReadmeUsesTrustSignals();
testHeroAssetExists();
testReadmeAvoidsAwkwardPublicRegionalFraming();
testReadmeAvoidsStaleGenericHero();
testLicenseFileExists();

console.log("readme publication tests passed");
