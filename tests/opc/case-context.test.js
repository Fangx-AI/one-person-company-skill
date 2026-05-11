#!/usr/bin/env node
"use strict";

const assert = require("assert");

const { buildCaseContextForMessages } = require("../../services/opc-case-context");

function testBuildsCompactContextForBusinessQuestion() {
  const result = buildCaseContextForMessages({
    messages: [
      {
        role: "user",
        content: "我想做一个 AI 小红书选题助手，帮一人公司老板生成标题和笔记方向，怎么商业化？",
      },
    ],
  });

  assert(result, "expected case context for business question");
  assert.strictEqual(result.kind, "opc_case_context");
  assert(result.text.includes("一人公司案例情报"));
  assert(result.text.includes("相似案例"));
  assert(result.text.includes("小红书"));
  assert(result.text.includes("最短验证动作"));
  assert(result.text.length <= 1800, `context too long: ${result.text.length}`);
}

function testSkipsUnrelatedPersonalQuestion() {
  const result = buildCaseContextForMessages({
    messages: [
      {
        role: "user",
        content: "我最近很焦虑，也不知道自己到底怕什么。",
      },
    ],
  });

  assert.strictEqual(result, null);
}

function testSkipsIdentityQuestionThatMentionsAi() {
  const result = buildCaseContextForMessages({
    messages: [
      {
        role: "user",
        content: "你是不是 AI？",
      },
    ],
  });

  assert.strictEqual(result, null);
}

testBuildsCompactContextForBusinessQuestion();
testSkipsUnrelatedPersonalQuestion();
testSkipsIdentityQuestionThatMentionsAi();
console.log("opc case context tests passed");
