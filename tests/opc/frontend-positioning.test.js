#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const indexHtml = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "web", "app.js"), "utf8");
const modelClient = fs.readFileSync(path.join(root, "web", "model-client.js"), "utf8");

function testHomepagePositionsOnePersonCompanyProduct() {
  [
    "<title>一人公司作战库",
    'content="面向国内一人公司创业者',
    "一人公司作战库",
    "输入你的产品思路",
    "相似案例",
    "商业路径",
    "现实坑位",
    "我想做一个 AI 小红书选题助手，怎么商业化？",
  ].forEach((marker) => {
    assert(indexHtml.includes(marker), `expected homepage to include ${marker}`);
  });
}

function testHomepageNoLongerSellsElonBookAsPrimaryExperience() {
  [
    "The Book of Elon",
    "埃隆之书",
    "THE BOOK OF ELON",
    "互动思想卡片",
    "下载《埃隆之书》中文版 PDF",
  ].forEach((marker) => {
    assert(!indexHtml.includes(marker), `homepage should not include old primary positioning: ${marker}`);
  });
}

function testClientPromptIncludesOpcProtocolForLegacyCaches() {
  [
    "一人公司作战库回答协议",
    "商业判断",
    "相似案例",
    "国内现实",
    "低阻力下一步",
    "停损条件",
  ].forEach((marker) => {
    assert(modelClient.includes(marker), `expected model client prompt to include ${marker}`);
  });
}

function testRandomCasePromptDoesNotOpenOldCardLibrary() {
  assert(appJs.includes("OPC_RANDOM_CASE_PROMPTS"), "expected random OPC prompt list");
  assert(appJs.includes("openGenericCoach(pick)"), "expected random prompt to open a generic business chat");
  assert(!appJs.includes("openCard(pick.id)"), "random footer action should not open old card library");
}

function testSlashCommandEntryExists() {
  [
    'id="quick-slash-menu"',
    'id="chat-slash-menu"',
    "slash-command-menu",
  ].forEach((marker) => {
    assert(indexHtml.includes(marker), `expected slash command container ${marker}`);
  });

  [
    "OPC_SLASH_COMMANDS",
    "产品判断",
    "相似案例",
    "路线规划",
    "国内坑位",
    "定价获客",
    "停损复盘",
    "renderSlashMenu",
    "applySlashCommand",
  ].forEach((marker) => {
    assert(appJs.includes(marker), `expected slash command implementation marker ${marker}`);
  });

  assert(appJs.includes("input.value.trim() === \"/\""), "slash menu should open only for slash trigger");
  assert(appJs.includes("message === \"/\""), "quick submit should not send the slash trigger");
  assert(appJs.includes("value === \"/\""), "chat submit should not send the slash trigger");
  assert(!appJs.includes("openGenericCoach(command.prompt)"), "selecting a slash command should not auto-send");
  assert(!appJs.includes("pushUserMessage(command.prompt)"), "selecting a slash command should not consume API");
}

testHomepagePositionsOnePersonCompanyProduct();
testHomepageNoLongerSellsElonBookAsPrimaryExperience();
testClientPromptIncludesOpcProtocolForLegacyCaches();
testRandomCasePromptDoesNotOpenOldCardLibrary();
testSlashCommandEntryExists();

console.log("frontend OPC positioning tests passed");
