const crypto = require("crypto");

const USER_COOKIE = "boe_user_token";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let cachedFallbackSecret = null;

function getSecret() {
  const explicit =
    (process.env.USER_SESSION_SECRET || process.env.SESSION_TOKEN_SECRET || "").trim();
  if (explicit && explicit.length >= 32) return explicit;

  // 生产环境硬拒绝：随机 fallback 会让用户每次部署都被踢下线
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[auth/session] USER_SESSION_SECRET (>=32 chars) is REQUIRED in production. " +
        "Set it as a real system env var. Refusing to start."
    );
  }

  if (!cachedFallbackSecret) {
    cachedFallbackSecret = require("crypto").randomBytes(32).toString("hex");
    console.warn(
      "[auth/session] USER_SESSION_SECRET not set or too short. Generated random fallback. " +
        "User tokens will invalidate on every server restart. Set USER_SESSION_SECRET in .env to fix."
    );
  }
  return cachedFallbackSecret;
}

function createUserToken(userId, options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : TOKEN_TTL_MS;
  const expiresAt = Date.now() + ttlMs;
  const payload = `${userId}.${expiresAt}`;
  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
  return `${userId}.${expiresAt}.${signature}`;
}

function verifyUserToken(token) {
  if (typeof token !== "string" || token.length < 30) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [userIdStr, expiresAtStr, providedSig] = parts;
  const userId = Number.parseInt(userIdStr, 10);
  const expiresAt = Number.parseInt(expiresAtStr, 10);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  const payload = `${userId}.${expiresAt}`;
  const expectedSig = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  return { userId, expiresAt };
}

function buildSetCookie(token, { secure = false, ttlMs = TOKEN_TTL_MS } = {}) {
  const parts = [
    `${USER_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function buildClearCookie({ secure = false } = {}) {
  const parts = [
    `${USER_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function extractTokenFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of String(cookieHeader).split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== USER_COOKIE) continue;
    const raw = part.slice(idx + 1).trim();
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

module.exports = {
  USER_COOKIE,
  TOKEN_TTL_MS,
  createUserToken,
  verifyUserToken,
  buildSetCookie,
  buildClearCookie,
  extractTokenFromCookie,
};
