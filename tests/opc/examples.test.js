#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const { validateExamples } = require("../../scripts/opc/validate-examples");

const root = path.resolve(__dirname, "..", "..");

function testExamplesArePublicationReady() {
  const result = validateExamples({ root, minExamples: 10 });
  assert(result.ok, result.errors.join("\n"));
  assert.strictEqual(result.counts.examples, 10);
}

testExamplesArePublicationReady();

console.log("examples tests passed");
