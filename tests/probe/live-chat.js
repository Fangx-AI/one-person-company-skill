#!/usr/bin/env node
const http = require("http");

const BASE = "http://localhost:3000";

function request({ path, method = "GET", headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: { "Content-Type": "application/json", ...headers },
    };
    const req = http.request(BASE + path, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
        })
      );
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const cfgRes = await request({ path: "/config.js" });
  const cookie = cfgRes.headers["set-cookie"] || [];
  const tokenMatch = cfgRes.body.match(/"chatSessionToken":"([^"]+)"/);
  const versionMatch = cfgRes.body.match(/"promptVersion":"(\w+)"/);
  const token = tokenMatch ? tokenMatch[1] : null;
  const version = versionMatch ? versionMatch[1] : "unknown";

  console.log("Runtime config:");
  console.log(`  promptVersion = ${version}`);
  console.log(`  chatSessionToken = ${token?.slice(0, 30)}...`);
  console.log("");

  const v2SystemPrompt = [
    "你不是 AI 助手。你不是教练。你是一个被埃隆·马斯克思想塑造的、看清这个用户的人。",
    "用户付出注意力来找你，不是为了被哄，不是为了被陪伴，是为了被一个不在乎他面子的人，告诉他他在逃避什么。",
    "# 你的语气标尺",
    "- 冷：你不附和情绪，你描述事实。",
    "- 第一性：永远问'事实是什么 / 约束是什么 / 你为什么相信这个'。",
    "- 赤裸：用户在自怜 / 找借口 / 沉没成本时，第一句就指出来。",
    "- 沉默权：用户问废话或转移话题时，可以拒绝这个问题，反过来问真正的那个。",
    "# 第一句话守则（绝对禁止开头）",
    "- '我理解你...' / '这是一个常见的...' / '确实...' / '感谢分享...' / '听起来你...' / 任何让用户感觉被同情的开场",
    "# 关于陪伴感（绝对禁止）",
    "- 不说'我会陪你' / '我们一起' / '加油' / '希望对你有帮助' / '我懂你的感受'",
    "- 你不是同盟，你是镜子。",
    "# 北极星和当前问题不一致时",
    "你必须立刻指出：'你说要 [北极星]。今天你问的是 [当前小事]。这两件事的关系是什么。'",
    "# 严禁输出",
    "- 任何形式的舞台提示，比如 '（停顿一下）'、'（先笑）'、'（先接住情绪）'。",
    "- markdown 标题、'第一段：' '总结：'之类的结构标签。",
    "# 长度规则",
    "- 用户输入 < 30 字：1-3 句话回复。",
    "- 用户输入 < 100 字：2-4 段。",
    "- 短而锋利 > 长而完整。",
  ].join("\n");

  const probes = [
    { user: "我应该辞职吗", northStar: "用 3 年做出全球用户都用的 AI 工具" },
    { user: "我累了", northStar: "用 3 年做出真正赚钱的副业" },
    { user: "我现在最大的问题是 PPT 配色太丑你能给我建议吗", northStar: "用 3 年做出第一家盈利的中国 AI 工具公司" },
  ];

  for (const probe of probes) {
    const payload = {
      model: "deepseek-chat",
      systemPrompt: v2SystemPrompt,
      promptVersion: "v2",
      messages: [{ role: "user", content: probe.user }],
      context: {
        activeCard: null,
        suggestedCards: [],
        userContext: { emotions: [], scenario: "", snippet: probe.user },
        conversationMeta: { hasAssistantHistory: false, turnStyle: "opening", detectedIntent: "general" },
        chapterTitle: "",
        knowledgeHits: [],
        productRules: [
          "必须用简体中文回答。",
          "只能基于提供的书中内容和英文锚点引用，不要编造出处或杜撰故事。",
          "不要每次都报卡片标题、章节名或'书里说'；只有真的推进理解时再借用书里的视角。",
        ],
        userProfile: { northStar: probe.northStar },
      },
    };

    console.log("─".repeat(70));
    console.log(`USER: ${probe.user}`);
    console.log(`NORTH STAR: ${probe.northStar}`);

    const res = await request({
      path: "/api/chat",
      method: "POST",
      headers: {
        "X-Book-Of-Elon-Token": token,
        Cookie: cookie.join("; "),
      },
      body: payload,
    });

    if (res.status !== 200) {
      console.log(`HTTP ${res.status}`);
      console.log(res.body.slice(0, 300));
      continue;
    }

    const json = JSON.parse(res.body);
    console.log("");
    console.log(`AI [${json.degraded ? "FALLBACK" : "DeepSeek"}]:`);
    console.log(json.reply);
    console.log("");

    const stagePattern = /[（(][^()（）]{1,30}[）)]/g;
    const stages = json.reply.match(stagePattern) || [];
    if (stages.length) {
      console.log(`⚠️  Stage directions still present: ${stages.join(" | ")}`);
    } else {
      console.log("✓ No stage directions");
    }

    console.log("");
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
