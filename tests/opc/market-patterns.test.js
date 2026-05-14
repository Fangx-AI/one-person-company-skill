#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const base = path.join(root, "knowledge", "market-patterns");

const requiredPatterns = [
  {
    file: "conversion-tools.md",
    markers: ["Typora", "Markdown Monster", "Marked 2", "CloudConvert", "ConvertAPI"],
  },
  {
    file: "ai-commerce-visuals.md",
    markers: ["AI Commerce Visuals", "FASHN AI", "VModel", "Botika", "VTry"],
  },
  {
    file: "ai-xiaohongshu-content.md",
    markers: ["AI Xiaohongshu Content", "direct competitors", "KOL运营", "千瓜", "灰豚"],
  },
  {
    file: "developer-tools-api.md",
    markers: ["Developer Tools And APIs", "direct competitors", "Postman", "Stripe", "Sentry"],
  },
  {
    file: "knowledge-products.md",
    markers: ["Knowledge Products", "direct competitors", "小报童", "知识星球", "Gumroad"],
  },
  {
    file: "case-intelligence.md",
    markers: ["Case Intelligence", "direct competitors", "Trends.vc", "Exploding Topics", "FounderPal"],
  },
  {
    file: "ai-automation-services.md",
    markers: ["AI Automation Services", "direct competitors", "Zapier", "Make", "n8n"],
  },
  {
    file: "notion-site-builders.md",
    markers: ["Notion Site Builders", "direct competitors", "Super", "Potion", "Feather"],
  },
  {
    file: "local-lead-gen.md",
    markers: ["Local Lead Generation", "direct competitors", "美团", "大众点评", "企业微信"],
  },
  {
    file: "templates-boilerplates.md",
    markers: ["Templates And Boilerplates", "direct competitors", "Tailwind UI", "ShipFast", "Notion templates"],
  },
];

const commonMarkers = [
  "direct competitors",
  "adjacent substitutes",
  "free substitutes",
  "high-price alternatives",
  "payment mechanism",
  "evidence boundary",
  "one-person company wedge",
  "stop-loss",
  "date_checked",
];

assert.strictEqual(requiredPatterns.length, 10, "should cover 10 high-frequency market patterns");

for (const pattern of requiredPatterns) {
  const filePath = path.join(base, pattern.file);
  assert(fs.existsSync(filePath), `market pattern file should exist: ${pattern.file}`);
  const text = fs.readFileSync(filePath, "utf8");

  for (const marker of [...commonMarkers, ...pattern.markers]) {
    assert(text.includes(marker), `${pattern.file} should include marker ${marker}`);
  }
}

console.log("market pattern tests passed");
