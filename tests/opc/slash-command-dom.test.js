#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..", "..");
const dom = new JSDOM(fs.readFileSync(path.join(root, "web", "index.html"), "utf8"), {
  url: "http://127.0.0.1:3000/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});

const { window } = dom;
const appSource = fs.readFileSync(path.join(root, "web", "app.js"), "utf8");
const commandStart = appSource.indexOf("const OPC_SLASH_COMMANDS");
const commandEnd = appSource.indexOf("const CHAT_SESSION_STORAGE_KEY");
const functionsStart = appSource.indexOf("function renderSlashMenu");
const functionsEnd = appSource.indexOf("function openGenericCoach");

assert(commandStart > -1, "app.js should contain slash commands");
assert(commandEnd > commandStart, "app.js should contain slash command end");
assert(functionsStart > -1, "app.js should contain slash functions");
assert(functionsEnd > functionsStart, "app.js should contain slash function end");

const harness = `
const quickAskInput = document.getElementById("quick-ask-input");
const quickSlashMenu = document.getElementById("quick-slash-menu");
const chatInput = document.getElementById("chat-input");
const chatSlashMenu = document.getElementById("chat-slash-menu");
`;

vm.runInContext(
  harness +
    appSource.slice(commandStart, commandEnd) +
    appSource.slice(functionsStart, functionsEnd) +
    "window.__slashTest = { updateSlashMenuForInput, applySlashCommand, OPC_SLASH_COMMANDS };",
  dom.getInternalVMContext(),
);

const quickInput = window.document.getElementById("quick-ask-input");
const quickMenu = window.document.getElementById("quick-slash-menu");

quickInput.value = "/";
window.__slashTest.updateSlashMenuForInput(quickInput, quickMenu);

assert(!quickMenu.classList.contains("hidden"), "slash menu should show when quick input is /");
assert.strictEqual(quickMenu.querySelectorAll("[data-slash-command-id]").length, 6);
assert(quickMenu.textContent.includes("/产品判断"));
assert(quickMenu.textContent.includes("/相似案例"));

window.__slashTest.applySlashCommand("cases", "quick");

assert(quickMenu.classList.contains("hidden"), "slash menu should hide after selecting command");
assert(quickInput.value.includes("/相似案例"));
assert(quickInput.value.includes("类似案例"));

const chatInput = window.document.getElementById("chat-input");
const chatMenu = window.document.getElementById("chat-slash-menu");

chatInput.value = "/";
window.__slashTest.updateSlashMenuForInput(chatInput, chatMenu);
window.__slashTest.applySlashCommand("china", "chat");

assert(chatInput.value.includes("/国内坑位"));
assert(chatInput.value.includes("备案"));

window.__slashTest.applySlashCommand("judge", "quick");
assert(quickInput.value.includes("竞品或替代方案"));
assert(quickInput.value.includes("付费机制"));
assert(quickInput.value.includes("具体工作流"));

console.log("slash command DOM tests passed");
