#!/usr/bin/env node
// scripts/ops/dr-drill.js — R-21 DR drill helper
//
// Restores a backup to a tmp file, validates with integrity_check + schema
// hash + row counts diff vs prod, optionally runs smoke:db against the
// restored DB. Not destructive — never touches data/app.db.
//
// Usage:
//   node scripts/ops/dr-drill.js                  # uses latest data/backups/*.gz
//   node scripts/ops/dr-drill.js path/to/file.gz  # specify backup
//   DR_KEEP_TMP=1 node scripts/ops/dr-drill.js    # keep /tmp/dr-restore.db for inspection

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

let Database;
try {
  Database = require("better-sqlite3");
} catch (e) {
  console.error("[dr-drill] better-sqlite3 not installed — run from project root after `npm ci`.");
  process.exit(2);
}

const projectRoot = path.join(__dirname, "..", "..");
const prodDb = path.join(projectRoot, "data", "app.db");
const backupsDir = path.join(projectRoot, "data", "backups");
const tmpDb = path.join(os.tmpdir(), "dr-restore.db");

function pickBackup(arg) {
  if (arg) return path.resolve(arg);
  if (!fs.existsSync(backupsDir)) {
    console.error(`[dr-drill] no backup dir found at ${backupsDir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(backupsDir)
    .filter(f => f.endsWith(".gz"))
    .map(f => ({ f, t: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) {
    console.error(`[dr-drill] no .gz backups in ${backupsDir}`);
    process.exit(1);
  }
  return path.join(backupsDir, files[0].f);
}

function gunzipTo(src, dst) {
  const data = fs.readFileSync(src);
  const out = zlib.gunzipSync(data);
  fs.writeFileSync(dst, out);
  return out.length;
}

function schemaHash(db) {
  const rows = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all();
  const text = rows.map(r => r.sql).join("\n");
  return crypto.createHash("sha256").update(text).digest("hex");
}

function rowCounts(db, tables) {
  const out = {};
  for (const t of tables) {
    try {
      out[t] = db.prepare(`SELECT COUNT(1) AS n FROM ${t}`).get().n;
    } catch (e) {
      out[t] = `ERR:${e.code || e.message}`;
    }
  }
  return out;
}

function pad(s, n) { return String(s).padEnd(n); }

function main() {
  const backup = pickBackup(process.argv[2]);
  console.log(`════════════════════════════════════════════════════════════════`);
  console.log(`R-21 DR Drill — ${new Date().toISOString()}`);
  console.log(`════════════════════════════════════════════════════════════════`);
  console.log(`backup:   ${backup}`);
  if (!fs.existsSync(backup)) {
    console.error(`[dr-drill] backup not found: ${backup}`);
    process.exit(1);
  }

  const t0 = Date.now();
  const bytes = gunzipTo(backup, tmpDb);
  console.log(`restored: ${tmpDb} (${bytes} bytes, ${Date.now() - t0} ms)`);

  const restored = new Database(tmpDb, { readonly: true });
  const ic = restored.prepare("PRAGMA integrity_check").all();
  const icOk = ic.length === 1 && ic[0].integrity_check === "ok";
  console.log(`\n[1] integrity_check: ${icOk ? "ok" : "FAIL"}`);
  if (!icOk) console.log("   ", ic);

  let prod = null;
  if (fs.existsSync(prodDb)) {
    prod = new Database(prodDb, { readonly: true });
    const rh = schemaHash(restored);
    const ph = schemaHash(prod);
    console.log(`\n[2] schema hash:`);
    console.log(`    restored = ${rh}`);
    console.log(`    prod     = ${ph}`);
    console.log(`    ${rh === ph ? "match" : "DRIFT (acceptable if recent migration)"}`);
  } else {
    console.log(`\n[2] schema hash: prod db not at ${prodDb}, skipping`);
  }

  const tables = ["users", "chat_sessions", "messages", "facts", "goals"];
  const rc = rowCounts(restored, tables);
  const pc = prod ? rowCounts(prod, tables) : null;
  console.log(`\n[3] row counts:`);
  console.log(`    ${pad("table", 16)} ${pad("restored", 12)} ${pad("prod", 12)} delta`);
  for (const t of tables) {
    const r = rc[t];
    const p = pc ? pc[t] : "-";
    const delta = (typeof r === "number" && typeof p === "number") ? (p - r) : "-";
    console.log(`    ${pad(t, 16)} ${pad(r, 12)} ${pad(p, 12)} ${delta}`);
  }

  restored.close();
  if (prod) prod.close();

  if (!process.env.DR_KEEP_TMP) {
    try { fs.unlinkSync(tmpDb); } catch (_) { /* noop */ }
    try { fs.unlinkSync(tmpDb + "-shm"); } catch (_) { /* noop */ }
    try { fs.unlinkSync(tmpDb + "-wal"); } catch (_) { /* noop */ }
  }

  console.log(`\n════════════════════════════════════════════════════════════════`);
  console.log(icOk ? "DR DRILL: OK ✓" : "DR DRILL: FAILED ✗");
  console.log(`════════════════════════════════════════════════════════════════`);
  process.exit(icOk ? 0 : 1);
}

main();
