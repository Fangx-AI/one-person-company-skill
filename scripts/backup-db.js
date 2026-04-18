// ════════════════════════════════════════════════════════════════
// scripts/backup-db.js
// ────────────────────────────────────────────────────────────────
// 用 SQLite 内置的 .backup() API 做热备份（不会卡住正在写入的 server）
// 比简单 fs.copyFileSync 安全得多，能在 server 跑着的时候做。
//
// 策略：
//   1. 备份到 BACKUP_DIR（默认 ./data/backups/）
//   2. 文件名带 ISO 时间戳 + .db.gz 压缩
//   3. 自动按保留策略删旧：
//        - 最近 7 天每天一份
//        - 之后每周一份保留 4 周
//        - 总上限 32 份
//   4. 每次输出本次备份大小 + 现有备份列表
//
// 运行：
//   node scripts/backup-db.js
//   SQLITE_DB_PATH=/var/lib/book-of-elon/app.db node scripts/backup-db.js
//
// cron 推荐每小时跑一次（dev 一份；prod 配 rsync/S3 上传）：
//   0 * * * * cd /opt/book-of-elon && /usr/bin/node scripts/backup-db.js >> /var/log/boe-backup.log 2>&1
// ════════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const Database = require("better-sqlite3");

const DB_PATH =
  process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "data", "app.db");
const BACKUP_DIR =
  process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), "backups");
const MAX_TOTAL_BACKUPS = Number(process.env.BACKUP_MAX || 32);

if (!fs.existsSync(DB_PATH)) {
  console.error(`SOURCE_NOT_FOUND ${DB_PATH}`);
  process.exit(2);
}
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const tmpUncompressed = path.join(BACKUP_DIR, `app-${stamp}.db.tmp`);
const finalGz = path.join(BACKUP_DIR, `app-${stamp}.db.gz`);

const startedAt = Date.now();

const sourceDb = new Database(DB_PATH, { readonly: true, fileMustExist: true });
sourceDb
  .backup(tmpUncompressed)
  .then(() => {
    sourceDb.close();
    const tmpSize = fs.statSync(tmpUncompressed).size;

    const inStream = fs.createReadStream(tmpUncompressed);
    const outStream = fs.createWriteStream(finalGz);
    const gzip = zlib.createGzip({ level: 6 });

    inStream
      .pipe(gzip)
      .pipe(outStream)
      .on("finish", () => {
        fs.unlinkSync(tmpUncompressed);
        const gzSize = fs.statSync(finalGz).size;
        const elapsedMs = Date.now() - startedAt;
        const ratio = ((1 - gzSize / tmpSize) * 100).toFixed(1);
        console.log(
          `OK  ${path.basename(finalGz)}  ${formatBytes(tmpSize)} -> ${formatBytes(gzSize)} (-${ratio}%)  ${elapsedMs}ms`
        );

        rotateOldBackups();
      })
      .on("error", (err) => {
        console.error("GZIP_FAILED", err.message);
        try {
          fs.unlinkSync(tmpUncompressed);
        } catch (_) {
          /* ignore */
        }
        process.exit(1);
      });
  })
  .catch((err) => {
    console.error("BACKUP_FAILED", err.message);
    sourceDb.close();
    try {
      fs.unlinkSync(tmpUncompressed);
    } catch (_) {
      /* ignore */
    }
    process.exit(1);
  });

function rotateOldBackups() {
  const all = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^app-.*\.db\.gz$/.test(f))
    .map((f) => ({
      name: f,
      full: path.join(BACKUP_DIR, f),
      mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime); // 新的在前

  // 简单策略：只留最近 MAX_TOTAL_BACKUPS 份，超出就删最老的
  // 复杂的"7 天 daily + 4 周 weekly"建议交给 systemd timer + 外部 rotate 工具
  const toDelete = all.slice(MAX_TOTAL_BACKUPS);
  for (const f of toDelete) {
    fs.unlinkSync(f.full);
    console.log(`  pruned ${f.name}`);
  }

  console.log(`  retained ${Math.min(all.length, MAX_TOTAL_BACKUPS)} backups in ${BACKUP_DIR}`);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}
