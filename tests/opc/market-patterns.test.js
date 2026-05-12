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

console.log("market pattern tests passed");
