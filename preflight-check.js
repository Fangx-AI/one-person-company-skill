const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const env = loadEnvFile(path.join(projectRoot, ".env"));
const args = new Set(process.argv.slice(2));
const allowDegraded = args.has("--allow-degraded");
const strictProduction = args.has("--strict-production");

const checks = [];

checks.push(checkNodeVersion());
checks.push(checkPort());
checks.push(checkRuntimeNumber("DEEPSEEK_MAX_TOKENS", 100, 2000));
checks.push(checkRuntimeNumber("DEEPSEEK_TEMPERATURE", 0, 2));
checks.push(checkRuntimeNumber("UPSTREAM_TIMEOUT_MS", 1000, 120000));
checks.push(checkRuntimeNumber("CHAT_RATE_LIMIT_WINDOW_MS", 1000, 3600000));
checks.push(checkRuntimeNumber("CHAT_RATE_LIMIT_MAX_REQUESTS", 1, 1000));
checks.push(checkRuntimeNumber("CHAT_BURST_WINDOW_MS", 1000, 600000));
checks.push(checkRuntimeNumber("CHAT_BURST_MAX_REQUESTS", 1, 1000));
checks.push(checkRuntimeNumber("CHAT_CACHE_TTL_MS", 0, 3600000));
checks.push(checkRuntimeNumber("CHAT_CACHE_MAX_ENTRIES", 1, 5000));
checks.push(checkRuntimeNumber("CIRCUIT_BREAKER_FAIL_THRESHOLD", 1, 100));
checks.push(checkRuntimeNumber("CIRCUIT_BREAKER_COOLDOWN_MS", 1000, 600000));
checks.push(checkRuntimeNumber("SLOW_REQUEST_THRESHOLD_MS", 100, 120000));
checks.push(checkRuntimeNumber("CHAT_TOKEN_TTL_MS", 60000, 604800000));
checks.push(checkRuntimeNumber("DAILY_TOTAL_TOKEN_BUDGET", 10000, 100000000));
checks.push(checkRuntimeNumber("DAILY_TOKEN_PER_IP", 1000, 10000000));
checks.push(checkRuntimeNumber("DAILY_ANON_CHAT_PER_SESSION", 1, 1000));
checks.push(checkRateLimitConsistency());
checks.push(checkSessionTokenSecret());
checks.push(checkDeepSeekConfig());

const errors = checks.filter((item) => item.level === "error");
const warnings = checks.filter((item) => item.level === "warning");
const infos = checks.filter((item) => item.level === "info");

for (const item of [...errors, ...warnings, ...infos]) {
  console.log(`[${item.level.toUpperCase()}] ${item.message}`);
}

if (errors.length) {
  console.error(`PRECHECK FAILED (${errors.length} error${errors.length > 1 ? "s" : ""})`);
  process.exit(1);
}

console.log(`PRECHECK PASSED${warnings.length ? ` WITH ${warnings.length} WARNING${warnings.length > 1 ? "S" : ""}` : ""}`);

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    return {
      level: "error",
      message: `Node.js ${process.versions.node} is too old. Require >=20.`,
    };
  }

  return {
    level: "info",
    message: `Node.js ${process.versions.node} satisfies >=20.`,
  };
}

function checkPort() {
  const raw = getConfigValue("PORT", "3000");
  const port = Number(raw);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return {
      level: "error",
      message: `PORT is invalid: ${String(raw)}`,
    };
  }

  return {
    level: "info",
    message: `PORT is set to ${port}.`,
  };
}

function checkRuntimeNumber(key, min, max) {
  const raw = getConfigValue(key, "");
  if (!raw) {
    return {
      level: strictProduction ? "error" : "warning",
      message: strictProduction
        ? `${key} is required in strict production mode.`
        : `${key} is not set. Server fallback value will be used.`,
    };
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    return {
      level: "error",
      message: `${key} is invalid: ${raw}. Expected ${min} to ${max}.`,
    };
  }

  return {
    level: "info",
    message: `${key} is set to ${value}.`,
  };
}

function checkDeepSeekConfig() {
  const apiKey = getConfigValue("DEEPSEEK_API_KEY", "");
  const model = getConfigValue("DEEPSEEK_MODEL", "deepseek-chat");

  if (!apiKey) {
    return {
      level: allowDegraded ? "warning" : "error",
      message:
        strictProduction && !allowDegraded
          ? "DEEPSEEK_API_KEY is required in strict production mode."
          : allowDegraded
            ? "DEEPSEEK_API_KEY is missing. Chat will run in degraded local knowledge mode."
            : "DEEPSEEK_API_KEY is missing. Use --allow-degraded only if you intentionally accept local fallback mode.",
    };
  }

  if (looksLikePlaceholderValue(apiKey)) {
    return {
      level: "error",
      message: "DEEPSEEK_API_KEY is still using the placeholder value.",
    };
  }

  if (!/^sk-/.test(apiKey)) {
    return {
      level: strictProduction ? "error" : "warning",
      message: strictProduction
        ? "DEEPSEEK_API_KEY does not look like a standard DeepSeek key."
        : "DEEPSEEK_API_KEY does not look like a standard DeepSeek key. Please verify it manually.",
    };
  }

  return {
    level: "info",
    message: `DeepSeek is configured with model ${model}.`,
  };
}

function checkSessionTokenSecret() {
  const secret = getConfigValue("SESSION_TOKEN_SECRET", "");
  if (!secret) {
    return {
      level: strictProduction ? "warning" : "info",
      message: strictProduction
        ? "SESSION_TOKEN_SECRET is not set. Anonymous chat tokens will rotate on every server restart."
        : "SESSION_TOKEN_SECRET is not set. Server will generate an ephemeral secret at startup.",
    };
  }

  if (looksLikePlaceholderValue(secret)) {
    return {
      level: strictProduction ? "error" : "warning",
      message: "SESSION_TOKEN_SECRET is still using a placeholder value. Replace it with a long random secret.",
    };
  }

  if (secret.length < 24) {
    return {
      level: strictProduction ? "warning" : "info",
      message: "SESSION_TOKEN_SECRET is set but looks short. Consider using a longer random secret.",
    };
  }

  return {
    level: "info",
    message: "SESSION_TOKEN_SECRET is configured.",
  };
}

function checkRateLimitConsistency() {
  const minuteWindow = Number(getConfigValue("CHAT_RATE_LIMIT_WINDOW_MS", ""));
  const burstWindow = Number(getConfigValue("CHAT_BURST_WINDOW_MS", ""));
  const minuteLimit = Number(getConfigValue("CHAT_RATE_LIMIT_MAX_REQUESTS", ""));
  const burstLimit = Number(getConfigValue("CHAT_BURST_MAX_REQUESTS", ""));

  if (Number.isFinite(minuteWindow) && Number.isFinite(burstWindow) && burstWindow > minuteWindow) {
    return {
      level: "error",
      message: "CHAT_BURST_WINDOW_MS cannot be greater than CHAT_RATE_LIMIT_WINDOW_MS.",
    };
  }

  if (Number.isFinite(minuteLimit) && Number.isFinite(burstLimit) && burstLimit > minuteLimit) {
    return {
      level: "warning",
      message: "CHAT_BURST_MAX_REQUESTS is greater than CHAT_RATE_LIMIT_MAX_REQUESTS. Burst protection may be ineffective.",
    };
  }

  return {
    level: "info",
    message: "Rate limit window and burst settings look consistent.",
  };
}

function looksLikePlaceholderValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized === "your_deepseek_api_key_here" ||
    normalized === "sk-your-real-production-key" ||
    normalized === "replace_with_a_long_random_secret" ||
    normalized.includes("replace_with") ||
    normalized.includes("your_real") ||
    normalized.includes("changeme")
  );
}

function getConfigValue(key, fallback) {
  return process.env[key] || env[key] || fallback;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const entries = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"|"$/g, "");
    entries[key] = value;
  }
  return entries;
}
