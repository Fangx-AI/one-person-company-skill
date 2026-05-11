#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const base = path.join(root, "knowledge", "cases");

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const normalized = readJsonl(path.join(base, "normalized", "normalized-cases.jsonl"));
const routes = {};

for (const row of normalized) {
  for (const route of row.route || []) {
    routes[route] = routes[route] || [];
    routes[route].push({
      id: row.id,
      name: row.name,
      target_user: row.target_user,
      product_form: row.product_form,
      acquisition: row.acquisition,
      pricing: row.pricing,
      confidence: row.confidence,
    });
  }
}

const output = {
  generated_at: new Date().toISOString(),
  route_count: Object.keys(routes).length,
  routes,
};

fs.writeFileSync(path.join(base, "indexes", "case-route-index.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(`wrote ${Object.keys(routes).length} routes`);
