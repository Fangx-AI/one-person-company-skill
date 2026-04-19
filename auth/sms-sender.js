const aliyun = require("./sms-aliyun");

function isProduction() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

// 生产环境硬拒绝 mock 通道。否则一旦 ALIYUN_* env vars 漂移，
// getProvider() 会静默 fallback 到 mock，handleSendCode 会把验证码
// 直接写进 HTTP 响应里 → 任何人都能冒名登录。文档不是 enforcement，
// 必须在代码里强制。
function getProvider() {
  const explicit = String(process.env.SMS_PROVIDER || "").trim().toLowerCase();

  if (explicit === "aliyun") {
    if (!aliyun.isConfigured()) {
      const msg =
        "[sms-sender] SMS_PROVIDER=aliyun but ALIYUN_* env vars are incomplete. " +
        "Need ALIYUN_ACCESS_KEY_ID + ALIYUN_ACCESS_KEY_SECRET + " +
        "ALIYUN_SMS_SIGN_NAME + ALIYUN_SMS_TEMPLATE_CODE.";
      if (isProduction()) throw new Error(msg);
      console.warn(msg + " (dev mode: falling back to mock)");
      return "mock";
    }
    return "aliyun";
  }

  if (explicit === "mock") {
    if (isProduction()) {
      throw new Error(
        "[sms-sender] SMS_PROVIDER=mock is REFUSED in production. " +
          "Mock provider returns OTP in the HTTP response — that means anyone " +
          "can log in as any phone. Set SMS_PROVIDER=aliyun and configure " +
          "ALIYUN_* env vars."
      );
    }
    return "mock";
  }

  // 没显式配 SMS_PROVIDER：根据 aliyun config 是否齐全自动选择
  if (aliyun.isConfigured()) return "aliyun";

  if (isProduction()) {
    throw new Error(
      "[sms-sender] No SMS provider configured in production. " +
        "Set SMS_PROVIDER=aliyun and ALIYUN_* env vars. Refusing to fall back " +
        "to mock — that would expose OTP in HTTP responses."
    );
  }

  return "mock";
}

function isDevMode() {
  return getProvider() === "mock";
}

// 启动期校验：让服务在 boot 时就崩，而不是等第一个用户点登录才发现。
// 调用方（server.js）在初始化阶段调用一次。
function assertProviderUsable() {
  const provider = getProvider();
  return { provider, production: isProduction() };
}

async function sendVerificationCode(phone, code) {
  const provider = getProvider();
  if (provider === "aliyun") {
    const result = await aliyun.sendCode(phone, code);
    return { provider, ...result };
  }

  console.log(
    `\n[SMS MOCK] phone=${phone} code=${code}\n` +
      `             (Set SMS_PROVIDER=aliyun and ALIYUN_* env vars to send real SMS)\n`
  );
  return { provider: "mock", ok: true, dev: true };
}

module.exports = {
  getProvider,
  isDevMode,
  assertProviderUsable,
  sendVerificationCode,
};
