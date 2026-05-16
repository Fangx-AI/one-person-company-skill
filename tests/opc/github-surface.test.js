#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assertIncludes(text, markers, label) {
  markers.forEach((marker) => {
    assert(text.includes(marker), `${label} should include ${marker}`);
  });
}

function testIssueTemplatesCaptureCommercialSignal() {
  const templates = [
    ".github/ISSUE_TEMPLATE/product-question.yml",
    ".github/ISSUE_TEMPLATE/case-submission.yml",
    ".github/ISSUE_TEMPLATE/correction.yml",
  ];

  templates.forEach((templatePath) => {
    assert(exists(templatePath), `issue template should exist: ${templatePath}`);
  });

  assertIncludes(
    read(".github/ISSUE_TEMPLATE/product-question.yml"),
    ["产品想法", "目标用户", "现在怎么解决", "愿意为什么结果付费", "第一单"],
    "product question template",
  );

  assertIncludes(
    read(".github/ISSUE_TEMPLATE/case-submission.yml"),
    ["案例名称", "链接", "目标用户", "收费方式", "获客路径", "可复制部分", "不可复制风险"],
    "case submission template",
  );

  assertIncludes(
    read(".github/ISSUE_TEMPLATE/correction.yml"),
    ["需要纠正的内容", "证据链接", "为什么会影响商业判断", "建议改法"],
    "correction template",
  );
}

testIssueTemplatesCaptureCommercialSignal();

console.log("github surface tests passed");
