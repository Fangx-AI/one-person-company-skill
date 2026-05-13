#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const conversionTools = fs.readFileSync(
  path.join(root, "knowledge", "market-patterns", "conversion-tools.md"),
  "utf8",
);
const aiCommerceVisuals = fs.readFileSync(
  path.join(root, "knowledge", "market-patterns", "ai-commerce-visuals.md"),
  "utf8",
);

[
  "Typora",
  "Markdown Monster",
  "Marked 2",
  "CloudConvert",
  "ConvertAPI",
  "payment mechanism",
  "API credits",
  "batch processing",
  "Domestic content distribution",
  "A generic paste-and-convert web page",
].forEach((marker) => {
  assert(conversionTools.includes(marker), `expected conversion tool market pattern marker ${marker}`);
});

[
  "AI Commerce Visuals",
  "virtual try-on",
  "direct competitors",
  "FASHN AI",
  "VModel",
  "Botika",
  "VTry",
  "adjacent substitutes",
  "free substitutes",
  "high-price alternatives",
  "payment mechanism",
  "API credits",
  "commerce-material service",
  "Xiaohongshu fashion sellers",
  "stop-loss",
].forEach((marker) => {
  assert(aiCommerceVisuals.includes(marker), `expected AI commerce visual market pattern marker ${marker}`);
});

console.log("market pattern tests passed");
