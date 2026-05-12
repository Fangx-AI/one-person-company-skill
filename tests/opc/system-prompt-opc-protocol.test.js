#!/usr/bin/env node
"use strict";

const assert = require("assert");

const systemPrompt = require("../../services/system-prompt");

function testV2ContainsOnePersonCompanyAnswerProtocol() {
  const v2 = systemPrompt.getSystemPrompt("v2");

  [
    "一人公司作战库",
    "商业判断",
    "相似案例",
    "国内现实",
    "低阻力下一步",
    "停损条件",
    "一人公司案例情报",
  ].forEach((marker) => {
    assert(v2.includes(marker), `expected V2 system prompt to include ${marker}`);
  });
}

function testV2BlocksGenericStartupAdviceAsFinalAnswers() {
  const v2 = systemPrompt.getSystemPrompt("v2");

  [
    "持续输出",
    "打造个人品牌",
    "做 MVP",
    "找到痛点",
    "做差异化",
    "先做 SEO",
  ].forEach((phrase) => {
    assert(v2.includes(phrase), `expected V2 system prompt to explicitly constrain ${phrase}`);
  });
}

function testFallbackKeepsBusinessProtocol() {
  const fallback = systemPrompt.getSystemPrompt("unknown-version");

  assert(fallback.includes("一人公司作战库"));
  assert(fallback.includes("商业判断"));
}

testV2ContainsOnePersonCompanyAnswerProtocol();
testV2BlocksGenericStartupAdviceAsFinalAnswers();
testFallbackKeepsBusinessProtocol();

console.log("system prompt OPC protocol tests passed");
