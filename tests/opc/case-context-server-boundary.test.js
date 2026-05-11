#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf8");
const sanitizeContextStart = serverSource.indexOf("function sanitizeContext(context)");
const requestDeepSeekStart = serverSource.indexOf("async function requestDeepSeek");
assert(sanitizeContextStart > -1, "sanitizeContext function exists");
assert(requestDeepSeekStart > sanitizeContextStart, "requestDeepSeek follows sanitizeContext");

const sanitizeContextSource = serverSource.slice(sanitizeContextStart, requestDeepSeekStart);

assert(
  !sanitizeContextSource.includes("opcCaseContext"),
  "sanitizeContext must not accept client-supplied opcCaseContext",
);
assert(
  serverSource.includes("attachOpcCaseContextToBody(body);"),
  "server must attach opcCaseContext after request validation",
);

console.log("opc case context server-boundary tests passed");
