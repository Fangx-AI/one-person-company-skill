const aliyun = require("./sms-aliyun");

function getProvider() {
  const explicit = String(process.env.SMS_PROVIDER || "").trim().toLowerCase();
  if (explicit === "aliyun") return "aliyun";
  if (explicit === "mock") return "mock";
  return aliyun.isConfigured() ? "aliyun" : "mock";
}

function isDevMode() {
  return getProvider() === "mock";
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
  sendVerificationCode,
};
