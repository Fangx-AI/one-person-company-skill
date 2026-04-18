// ════════════════════════════════════════════════════════════════
// services/fact-extractor.js
// ────────────────────────────────────────────────────────────────
// 从一轮对话里抽出关于用户的关键事实，按 5 类落库：
//   intend   — 我打算 ___
//   blocker  — 我卡在 ___
//   deadline — 我要在 X 月之前 ___
//   done     — 我已经 ___
//   belief   — 我认为 ___（用户的关键判断）
//
// 设计要点：
//   1. fire-and-forget：上层不等返回，extraction 独立失败不影响主流程
//   2. 严格 JSON：用 deepseek-chat 的 response_format=json，避免裸文本解析
//   3. 去重：写之前查最近 30 天同 kind 同义 fact，跳过
//   4. 短消息跳过：用户消息 < 20 字基本没信号，省钱
//   5. 速率自我保护：单用户单 session 每 30s 最多触发 1 次
// ════════════════════════════════════════════════════════════════

const facts = require("../db/facts");

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const VALID_KINDS = new Set(["intend", "blocker", "deadline", "done", "belief"]);
// 中文一句完整的 blocker/belief 通常 12-18 字，阈值定 12 比较合中文密度
const MIN_USER_TEXT_LEN = 12;
const MAX_FACTS_PER_TURN = 3;
// 按用户连续发言节奏放宽到 6s。一次抽取 ≈ $0.0001，没必要憋着
const PER_USER_COOLDOWN_MS = 6_000;
const EXTRACT_TIMEOUT_MS = 12_000;
const EXTRACT_MAX_TOKENS = 320;
const DEDUP_LOOKBACK_LIMIT = 30;

const lastExtractAt = new Map();

const SYSTEM_PROMPT = [
  "你是一个事实抽取器，从用户与教练的一轮对话中抽出关于「用户本人」的关键事实。",
  "",
  "5 个类别（kind）只能取其中之一：",
  "  intend   — 用户明确表达「打算/想要/计划」做某件具体的事",
  "  blocker  — 用户明确说自己「卡在/困在/搞不定/在纠结」某件事",
  "  deadline — 用户提到「X 时间之前要 ___」的时间锚定",
  "  done     — 用户说自己「已经做了/完成了/试过了」某件事",
  "  belief   — 用户表达了一个明确的关键判断/信念，例如「我觉得 X 是关键」",
  "",
  "硬规则：",
  "  1. 只抽用户说的内容。教练的话不算事实。",
  "  2. 必须是关于「用户自己」的，不是关于第三方/抽象概念的。",
  "  3. 模糊的、客套的、问句、抱怨气话 — 一律不要抽。",
  "  4. 每条 fact 必须自包含、可独立读懂，不要「如上所述」这种代词。",
  "  5. fact text 用第一人称、20-60 字以内、保留用户原话的关键名词。",
  "  6. 没有清晰事实就返回空数组。宁可漏抽，不要硬凑。",
  "  7. 最多返回 3 条。",
  "",
  "输出严格 JSON，结构：",
  '  {"facts":[{"kind":"intend","text":"我打算下周做出第一版 landing page 给 5 个朋友看","confidence":0.9}]}',
  "",
  "confidence 0-1，反映你对「这是真实表达」的信心。低于 0.6 不要返回。",
].join("\n");

function shouldExtract({ userText, userId }) {
  if (!userId) return false;
  const trimmed = String(userText || "").trim();
  if (trimmed.length < MIN_USER_TEXT_LEN) return false;
  const last = lastExtractAt.get(userId) || 0;
  if (Date.now() - last < PER_USER_COOLDOWN_MS) return false;
  return true;
}

function buildUserPrompt({ userText, assistantText, northStar, existingFacts }) {
  const parts = [];
  if (northStar) {
    parts.push(`【该用户的北极星目标】\n${northStar}`);
  }
  if (Array.isArray(existingFacts) && existingFacts.length) {
    const summarised = existingFacts
      .slice(0, 12)
      .map((f) => `- [${f.kind}] ${f.text}`)
      .join("\n");
    parts.push(`【已经记录的事实，不要重复】\n${summarised}`);
  }
  parts.push(`【用户刚说】\n${userText}`);
  parts.push(`【教练回应】\n${assistantText}`);
  parts.push(
    "请抽出这一轮里「用户本人」新表达的、未在上面已记录里出现过的关键事实。"
  );
  return parts.join("\n\n");
}

async function callDeepSeekForExtraction({ apiKey, model, userPromptText }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
  try {
    const resp = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: EXTRACT_MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPromptText },
        ],
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`extractor_http_${resp.status}: ${errBody.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "";
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

function parseExtractionResponse(raw) {
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.facts) ? parsed.facts : [];
  const cleaned = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const kind = String(item.kind || "").trim().toLowerCase();
    const text = String(item.text || "").trim();
    const confidence = Number(item.confidence);
    if (!VALID_KINDS.has(kind)) continue;
    if (!text || text.length < 4 || text.length > 200) continue;
    if (Number.isFinite(confidence) && confidence < 0.6) continue;
    cleaned.push({
      kind,
      text,
      confidence: Number.isFinite(confidence) ? confidence : null,
    });
    if (cleaned.length >= MAX_FACTS_PER_TURN) break;
  }
  return cleaned;
}

function normaliseForDedup(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, "")
    .slice(0, 120);
}

function isDuplicate(candidate, existingFacts) {
  const candNorm = normaliseForDedup(candidate.text);
  if (!candNorm) return true;
  for (const existing of existingFacts) {
    if (existing.kind !== candidate.kind) continue;
    const existNorm = normaliseForDedup(existing.text);
    if (!existNorm) continue;
    if (existNorm === candNorm) return true;
    if (candNorm.length >= 8 && existNorm.includes(candNorm)) return true;
    if (existNorm.length >= 8 && candNorm.includes(existNorm)) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────
// 对外主入口：fire-and-forget 安全
// ────────────────────────────────────────────────────────────────
async function extractFactsFromTurn({
  userId,
  sessionId = null,
  userMessageId = null,
  userText,
  assistantText,
  northStar = null,
  apiKey,
  model = "deepseek-chat",
  logger = null,
}) {
  if (!apiKey) return { skipped: "no_api_key", inserted: 0 };
  const trimmedText = String(userText || "").trim();
  if (trimmedText.length < MIN_USER_TEXT_LEN) {
    if (logger) {
      logger("info", "fact_extract_skipped", {
        userId,
        sessionId,
        reason: "too_short",
        textLen: trimmedText.length,
        threshold: MIN_USER_TEXT_LEN,
      });
    }
    return { skipped: "too_short", inserted: 0 };
  }
  const last = lastExtractAt.get(userId) || 0;
  const sinceLast = Date.now() - last;
  if (sinceLast < PER_USER_COOLDOWN_MS) {
    if (logger) {
      logger("info", "fact_extract_skipped", {
        userId,
        sessionId,
        reason: "cooldown",
        sinceLastMs: sinceLast,
        cooldownMs: PER_USER_COOLDOWN_MS,
      });
    }
    return { skipped: "cooldown", inserted: 0 };
  }

  lastExtractAt.set(userId, Date.now());

  const existingFacts = facts.listForUser(userId, { limit: DEDUP_LOOKBACK_LIMIT });
  const userPromptText = buildUserPrompt({
    userText,
    assistantText,
    northStar,
    existingFacts,
  });

  let rawJson;
  try {
    rawJson = await callDeepSeekForExtraction({
      apiKey,
      model,
      userPromptText,
    });
  } catch (err) {
    if (logger) {
      logger("warning", "fact_extract_call_failed", {
        userId,
        details: String(err?.message || err).slice(0, 240),
      });
    }
    return { skipped: "call_failed", inserted: 0 };
  }

  const candidates = parseExtractionResponse(rawJson);
  if (!candidates.length) {
    if (logger) {
      logger("info", "fact_extract_empty", {
        userId,
        sessionId,
        textLen: trimmedText.length,
        reason: "llm_returned_no_facts",
      });
    }
    return { inserted: 0, candidates: 0 };
  }

  let inserted = 0;
  const insertedRecords = [];
  for (const candidate of candidates) {
    if (isDuplicate(candidate, existingFacts)) continue;
    try {
      const fact = facts.createFact({
        userId,
        kind: candidate.kind,
        text: candidate.text,
        sourceSessionId: sessionId,
        sourceMessageId: userMessageId,
        confidence: candidate.confidence,
      });
      existingFacts.unshift(fact);
      insertedRecords.push(fact);
      inserted += 1;
    } catch (err) {
      if (logger) {
        logger("warning", "fact_insert_failed", {
          userId,
          kind: candidate.kind,
          details: String(err?.message || err).slice(0, 200),
        });
      }
    }
  }

  if (logger && inserted > 0) {
    logger("info", "facts_extracted", {
      userId,
      sessionId,
      inserted,
      candidates: candidates.length,
    });
  }

  return { inserted, candidates: candidates.length, records: insertedRecords };
}

module.exports = {
  extractFactsFromTurn,
  // exported for tests
  _internal: {
    parseExtractionResponse,
    isDuplicate,
    normaliseForDedup,
    shouldExtract,
    buildUserPrompt,
    SYSTEM_PROMPT,
  },
};
