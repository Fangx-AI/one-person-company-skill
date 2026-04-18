const crypto = require("crypto");

const ENDPOINT = "https://dysmsapi.aliyuncs.com";
const VERSION = "2017-05-25";
const REGION = "cn-hangzhou";

function isConfigured() {
  return Boolean(
    (process.env.ALIYUN_ACCESS_KEY_ID || "").trim() &&
      (process.env.ALIYUN_ACCESS_KEY_SECRET || "").trim() &&
      (process.env.ALIYUN_SMS_SIGN_NAME || "").trim() &&
      (process.env.ALIYUN_SMS_TEMPLATE_CODE || "").trim()
  );
}

function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

function buildIsoTime() {
  return new Date().toISOString().replace(/\.\d{3}/, "");
}

function buildSignableString(params) {
  const sortedKeys = Object.keys(params).sort();
  const canonicalQuery = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  return `POST&${percentEncode("/")}&${percentEncode(canonicalQuery)}`;
}

async function sendCode(phone, code) {
  if (!isConfigured()) {
    throw new Error("aliyun_sms_not_configured");
  }

  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID.trim();
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET.trim();
  const signName = process.env.ALIYUN_SMS_SIGN_NAME.trim();
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE.trim();

  const params = {
    AccessKeyId: accessKeyId,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: phone,
    RegionId: REGION,
    SignName: signName,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomBytes(16).toString("hex"),
    SignatureVersion: "1.0",
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: buildIsoTime(),
    Version: VERSION,
  };

  const stringToSign = buildSignableString(params);
  const signature = crypto
    .createHmac("sha1", accessKeySecret + "&")
    .update(stringToSign)
    .digest("base64");
  params.Signature = signature;

  const body = Object.keys(params)
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });

    const text = await response.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`aliyun_invalid_response: ${text.slice(0, 200)}`);
    }

    if (json.Code !== "OK") {
      const message = json.Message || json.Code || "unknown_error";
      throw new Error(`aliyun_sms_failed: ${json.Code} ${message}`);
    }

    return { ok: true, requestId: json.RequestId, bizId: json.BizId };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  isConfigured,
  sendCode,
};
