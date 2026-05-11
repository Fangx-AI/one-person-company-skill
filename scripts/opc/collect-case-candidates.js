#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function casePaths(root) {
  const base = path.join(root, "knowledge", "cases");
  return {
    raw: path.join(base, "raw", "raw-cases.jsonl"),
    normalized: path.join(base, "normalized", "normalized-cases.jsonl"),
    candidates: path.join(base, "candidates", "case-candidates.jsonl"),
  };
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, number }) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${number} is not valid JSON: ${error.message}`);
      }
    });
}

function appendJsonl(filePath, rows) {
  if (rows.length === 0) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function extractAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`${escapedName}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? decodeHtml(match[1].trim()) : "";
}

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function firstMetaContent(html, selectors) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const property = extractAttribute(tag, "property").toLowerCase();
    const name = extractAttribute(tag, "name").toLowerCase();
    for (const selector of selectors) {
      if (property === selector || name === selector) {
        const content = extractAttribute(tag, "content");
        if (content) return content;
      }
    }
  }
  return "";
}

function firstTitle(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1].replace(/\s+/g, " ").trim()) : "";
}

function canonicalUrl(html, fallbackUrl) {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of links) {
    if (extractAttribute(tag, "rel").toLowerCase() === "canonical") {
      const href = extractAttribute(tag, "href");
      if (href) return new URL(href, fallbackUrl).toString();
    }
  }
  return fallbackUrl;
}

function sanitizeId(input) {
  const url = new URL(input);
  const raw = `${url.hostname}_${url.pathname}`.toLowerCase();
  const id = raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 72);
  return id || "candidate";
}

function compactText(text, maxLength) {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function fetchHtml(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "opc-case-candidate-collector/0.1",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) {
      throw new Error(`unsupported content-type "${contentType}"`);
    }
    return {
      finalUrl: response.url,
      html: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function metadataToCandidate(metadata, options = {}) {
  const description = compactText(metadata.description || metadata.title || metadata.url, 260);
  const id = sanitizeId(metadata.url);

  return {
    id,
    source_id: options.sourceId || "src_public_product_pages",
    url: metadata.url,
    title: compactText(metadata.title || metadata.url, 180),
    language: options.language || "en",
    raw_signal: compactText(description, 600),
    name: compactText(metadata.title || metadata.url, 120),
    founder_type: "solo_or_tiny_team_founder",
    geography: ["global"],
    target_user: ["founders"],
    product_form: ["unknown_product"],
    route: ["candidate_requires_review"],
    acquisition: ["unknown"],
    delivery: ["website"],
    pricing: ["unknown"],
    summary: compactText(description, 700),
    commercial_path: "Candidate generated from public metadata; review required before formal import.",
    risks: ["metadata_only_candidate_requires_review"],
    confidence: "low",
    captured_at: options.capturedAt,
    date_checked: options.capturedAt,
  };
}

async function collectCaseCandidateUrls(options = {}) {
  const root = options.root || path.resolve(__dirname, "..", "..");
  const paths = casePaths(root);
  const urls = options.urls || [];
  const dryRun = Boolean(options.dryRun);
  const capturedAt = options.capturedAt || new Date().toISOString().slice(0, 10);
  const timeoutMs = options.timeoutMs || 10000;

  const rawRows = readJsonl(paths.raw);
  const normalizedRows = readJsonl(paths.normalized);
  const candidateRows = readJsonl(paths.candidates);
  const existingUrls = new Set([
    ...rawRows.map((row) => row.url),
    ...normalizedRows.flatMap((row) => row.evidence_urls || []),
  ]);
  const candidateUrls = new Set(candidateRows.map((row) => row.url));
  const candidatesToAppend = [];
  const errors = [];
  let skipped = 0;

  for (const inputUrl of urls) {
    try {
      const requestedUrl = new URL(inputUrl).toString();
      const { finalUrl, html } = await fetchHtml(requestedUrl, timeoutMs);
      const url = canonicalUrl(html, finalUrl);

      if (existingUrls.has(url)) {
        skipped += 1;
        errors.push(`${inputUrl}: duplicate existing evidence URL "${url}"`);
        continue;
      }
      if (candidateUrls.has(url)) {
        skipped += 1;
        errors.push(`${inputUrl}: duplicate candidate URL "${url}"`);
        continue;
      }

      const title = firstMetaContent(html, ["og:title", "twitter:title"]) || firstTitle(html) || url;
      const description =
        firstMetaContent(html, ["description", "og:description", "twitter:description"]) || title;
      const candidate = metadataToCandidate(
        {
          url,
          title,
          description,
        },
        {
          capturedAt,
          sourceId: options.sourceId,
          language: options.language,
        },
      );

      candidatesToAppend.push(candidate);
      candidateUrls.add(url);
    } catch (error) {
      skipped += 1;
      errors.push(`${inputUrl}: ${error.message}`);
    }
  }

  if (!dryRun) appendJsonl(paths.candidates, candidatesToAppend);

  return {
    collected: candidatesToAppend.length,
    skipped,
    errors,
  };
}

function parseArgs(argv) {
  const options = { urls: [] };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--root=")) options.root = arg.slice("--root=".length);
    else if (arg.startsWith("--source-id=")) options.sourceId = arg.slice("--source-id=".length);
    else if (arg.startsWith("--language=")) options.language = arg.slice("--language=".length);
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    else options.urls.push(arg);
  }
  return options;
}

if (require.main === module) {
  collectCaseCandidateUrls(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.errors.length > 0) process.exit(1);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = { collectCaseCandidateUrls };
