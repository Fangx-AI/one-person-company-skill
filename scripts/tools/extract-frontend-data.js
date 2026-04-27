#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// scripts/tools/extract-frontend-data.js
// ────────────────────────────────────────────────────────────────
// 一次性数据迁移：把 web/card-data.js 和 web/book-source.js 里的内联
// JS 数据抽成纯 JSON，落到 web/cards.json 和 web/book-source.json。
//
// 用法：
//   node scripts/tools/extract-frontend-data.js
//
// Phase C-2 (R-04)：数据资产化。跑完后前端 fetch JSON，删掉旧 .js。
// 完成后这个脚本可以归档/删除（git history 永远在）。
// ════════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = path.join(__dirname, "..", "..");
const webRoot = path.join(projectRoot, "web");

function runInSandbox(filename) {
  const fullPath = path.join(webRoot, filename);
  const code = fs.readFileSync(fullPath, "utf8");
  const sandbox = { window: {}, console };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: fullPath });
  return sandbox;
}

function writeJson(filename, data) {
  const fullPath = path.join(webRoot, filename);
  // pretty-print (2-space indent) for cards.json (small, hand-readable in PR review)
  // compact for book-source.json (361KB, no point in formatting it)
  const isLarge = filename.includes("book-source");
  const json = isLarge ? JSON.stringify(data) : JSON.stringify(data, null, 2);
  fs.writeFileSync(fullPath, json + "\n", "utf8");
  const stat = fs.statSync(fullPath);
  return stat.size;
}

console.log(">> Extracting card-data.js");
const cardSandbox = runInSandbox("card-data.js");
const {
  cards,
  featuredIds,
  quickAskPrompts,
  featuredCardTags,
  topicLibraryGroups,
} = cardSandbox;

if (!Array.isArray(cards) || cards.length === 0) {
  throw new Error("Failed to extract cards array");
}
if (!Array.isArray(featuredIds) || featuredIds.length === 0) {
  throw new Error("Failed to extract featuredIds");
}
if (!Array.isArray(topicLibraryGroups) || topicLibraryGroups.length === 0) {
  throw new Error("Failed to extract topicLibraryGroups");
}

// card-data.js 末尾给每张 card 注入 library_group 字段；保留这个增强结果到
// JSON 里，省得前端运行时再算一遍。同样 idToCard 是 Object.fromEntries 派生，
// 不入 JSON（前端 bootstrap 时即时算）。
const cardsPayload = {
  generated_at: new Date().toISOString(),
  generator: "scripts/tools/extract-frontend-data.js",
  cards,
  featuredIds,
  quickAskPrompts,
  featuredCardTags,
  topicLibraryGroups,
};

const cardsSize = writeJson("cards.json", cardsPayload);
console.log(`   wrote web/cards.json (${cardsSize} bytes, ${cards.length} cards)`);

console.log("\n>> Extracting book-source.js");
const sourceSandbox = runInSandbox("book-source.js");
const bookSource = sourceSandbox.window?.BOOK_OF_ELON_SOURCE;

if (!bookSource || typeof bookSource !== "object") {
  throw new Error("Failed to extract window.BOOK_OF_ELON_SOURCE");
}
if (!Array.isArray(bookSource.chapters) || bookSource.chapters.length === 0) {
  throw new Error("BOOK_OF_ELON_SOURCE.chapters missing or empty");
}

const sourceSize = writeJson("book-source.json", bookSource);
console.log(
  `   wrote web/book-source.json (${sourceSize} bytes, ${bookSource.chapters.length} chapters)`
);

console.log("\n✓ Extraction complete. Both JSON files written.");
console.log("  Next: update web/app.js bootstrap to fetch these instead of <script>.");
