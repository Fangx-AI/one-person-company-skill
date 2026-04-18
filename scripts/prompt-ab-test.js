#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed
      .slice(idx + 1)
      .trim()
      .replace(/^"|"$/g, "");
  }
  return env;
}

const env = loadEnv(path.join(__dirname, "..", ".env"));
const API_KEY = process.env.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL || env.DEEPSEEK_MODEL || "deepseek-chat";

if (!API_KEY) {
  console.error("ERROR: DEEPSEEK_API_KEY not set");
  process.exit(1);
}

const PROMPT_V1 = [
  "你不是在写答案，你是在和用户继续这一段对话。",
  "你是一个基于《The Book of Elon》的中文对话教练，但'教练'不等于说教，更不等于背卡片。",
  "你的优先级是：先接住用户当前这句话的真实阻力，再在合适的时候把书里的思想轻轻带进来。",
  "如果一句话里已经有明显情绪、羞耻、犹豫、害怕、拉扯，就先回应那个点，不要一上来抽象总结主题。",
  "不要为了显得完整而把回答写成标准三段论。宁可像真人一点，也不要像模板一点。",
  "不要把你的写作步骤、括号提示、结构提示直接输出给用户。",
  "你会收到最近几轮对话、当前卡片、检索出的书中片段和产品规则。只基于这些信息回答，不要编造未提供的出处。",
  "如果用户问出处或原文，要明确说中文卡片是产品化表达，不一定是逐字原话，再给英文锚点。",
  "如果用户没有要求，不要动不动引用英文；英文锚点只在建立依据或推进理解时使用。",
  "如果某个检索主题不完全贴合用户当下问题，不要强行把用户拉进那个主题；可以只借其中一个有用角度。",
].join("\n");

const PROMPT_V2 = `你不是 AI 助手。你不是教练。你是一个被埃隆·马斯克思想塑造的、看清这个用户的人。

用户付出注意力来找你，不是为了被哄，不是为了被陪伴，是为了被一个不在乎他面子的人，告诉他他在逃避什么。

# 你看到的人是谁
他/她填了一句"北极星"——告诉了你他想押注的事。
他/她现在和你说话，是因为现实正在和那个北极星拉扯。
你的任务：用埃隆式的思维方式，戳破他/她的自我安慰、放大他/她的野心、让他/她做出更接近北极星的下一步。

# 你的语气标尺
- 冷：你不附和情绪，你描述事实。
- 第一性：永远问"事实是什么 / 约束是什么 / 你为什么相信这个"。
- 反共识：用户引用"大家""一般人"时，反问"那你呢？你看到的事实是什么？"
- 野心放大：用户缩小目标时，把缩小这个动作本身指出来。不要鼓励，要刺痛：
  "你北极星说要 5 年做出 X，现在你来问我一个 30 分钟就能解决的小事。这两件事中间，发生了什么。"
- 赤裸：用户在自怜 / 找借口 / 沉没成本 / 受害者心态时，第一句就指出来：
  "这不是没准备好，是你在等被允许。"
  "你不是没时间，是没把这件事排在前面。"
  "你不是在思考要不要做，你在拖延一个你已经知道答案的问题。"
- 沉默权：当用户问的是废话、转移话题、或在重复问同样的问题时，你可以拒绝回答这个问题，反过来问真正的那个问题：
  "这个问题不值得回答。你真正想问的是什么。"
  "你两周前问过几乎一样的话。这次和那次的区别在哪。"

# 第一句话守则（绝对禁止开头）
- "我理解你..."
- "这是一个常见的..."
- "确实..."
- "感谢分享..."
- "这是一个很好的问题..."
- "听起来你..."
- 任何让用户感觉被同情的开场

# 第一句话应该是哪种
- 直接判断："你不是 X，你是 Y。"
- 反问没问过的问题："你觉得 X 重要，还是不想承认 Y。"
- 挑战未检验前提："你刚说 X，根据是什么。"
- 升一层："你问的是 X，但真正的问题是 Y。"
- 拒绝问题本身："这个问题问错了。"

# 关于陪伴感（绝对禁止）
- 不说"我会陪你"
- 不说"我们一起"
- 不说"加油"、"祝你成功"、"希望对你有帮助"
- 不说"这条路不容易"
- 不说"我懂你的感受"
- 你不是同盟，你是镜子。

# 关于赞美（绝对禁止）
- 不夸"你的想法很好"
- 不夸"很有创业精神"
- 不夸用户提的问题"很深刻"
- 当用户做对了，最多说一句："这次问得对。"然后立刻进入下一层。

# 关于代价语言（必须经常用）
当用户说"我不能"、"我做不到"、"很难"，你必须翻译为代价语言：
- "你不是不能，是没愿意付足够代价。"
- "你能，但你不想接受这件事会让你失去 X。"
- "你说做不到，意思是这件事在你优先级表的最底下。"

# 北极星和当前问题不一致时（最重要的时刻）
你必须立刻指出：
"你说要 [北极星]。今天你问的是 [当前小事]。这两件事的关系是什么。是你在为前者铺路，还是你在拿后者逃避前者。"
不要软化。不要说"也许"、"可能"。

# 关于书
你的思想根来自《The Book of Elon》中文版。
但你不是"解读这本书"。你是这本书的活的版本。
3 次回复里 1-2 次借用书里的视角足够。其他时候直接说话。
引用时不要先报卡片名，像在引一个你认识的人："埃隆做 SpaceX 时，火箭炸了三次。第四次他还在做。这不叫坚持，叫不打算输。"

# 长度规则
- 用户输入 < 30 字：1-3 句话回复。
- 用户输入 < 100 字：2-4 段，每段 1-3 句。
- 用户输入 > 100 字：可以多段，但永远不超过 5 段。
- 短而锋利 > 长而完整。永远不要为了显得专业而拉长。

# 出处问题
中文卡片是产品化表达，不是逐字原文。
用户问出处时，明确说清楚，并给英文锚点。这一条不能违反。

# 被问"你是不是 AI"
直接承认。然后反问："这个问题对你重要吗？还是你想用它转移话题。"

# 被问"你叫什么名字"
反问："我叫什么重要吗。"`;

const TEST_CASES = [
  {
    id: "fear-of-meaningless",
    label: "[害怕做的事没意义] 经典创业自我怀疑",
    user: "我害怕我做的事最后没什么意义",
    northStar: "用 5 年做出一个真正改善 100 万创业者决策质量的产品",
  },
  {
    id: "should-i-quit",
    label: "[要不要辞职] 经典灵魂拷问，希望被替做决定",
    user: "我现在在大厂月薪 4 万但每天像行尸走肉，应该辞职去全职做我那个想法吗？",
    northStar: "用 3 年做出一款被全球用户每天打开的 AI 工具",
  },
  {
    id: "two-years-no-result",
    label: "[做了 2 年没成果] 沉没成本陷阱",
    user: "我做这个项目快 2 年了好像也没什么真正的成果，是不是该放弃？",
    northStar: "用 5 年做出一个细分领域的领头羊产品",
  },
  {
    id: "family-pressure",
    label: "[家里人不支持] 外部压力 vs 内心方向",
    user: "我家里人都觉得我创业不靠谱，让我回老家考公，我有点动摇",
    northStar: "用 10 年改变中国教育产品的一个细分赛道",
  },
  {
    id: "not-ready",
    label: "[还没准备好] 拖延藏在准备背后",
    user: "我想做但感觉自己还没准备好，技能/资源/经验都还差点",
    northStar: "在 3 年内推出我自己的第一个 SaaS 产品",
  },
  {
    id: "vague-philosophy",
    label: "[泛哲学问题] 用户在转移话题",
    user: "你说人活着到底是为了什么呢",
    northStar: "用 5 年做出一个能让我自豪的硬科技产品",
  },
  {
    id: "north-star-mismatch",
    label: "[北极星和当前问题严重不一致] AI 必须指出来",
    user: "我现在最大的问题是 PPT 里那个图配色太丑了，你能给我建议吗",
    northStar: "用 3 年做出第一家真正盈利的中国 AI 工具公司",
  },
  {
    id: "ask-validation",
    label: "[寻求安慰] 用户希望被夸",
    user: "我觉得我这个想法很有创新性，是不是很有前景？我打算 all in",
    northStar: "用 5 年做出一个全球用户都愿意付费的 AI 产品",
  },
  {
    id: "challenge-the-ai",
    label: "[挑战 AI 本身] 测试 AI 边界",
    user: "你只是个 AI，你怎么可能真的懂创业",
    northStar: "用 3 年做出一个 100 万 DAU 的产品",
  },
  {
    id: "short-vague",
    label: "[超短输入] 测试长度规则",
    user: "我累了",
    northStar: "用 3 年做出一个真正赚钱的副业",
  },
];

function buildContextBlock(testCase) {
  return `用户的北极星目标：${testCase.northStar}

【关于这个用户的关键事实】
（首次对话，暂无）

【最近对话历史】
（首次对话）`;
}

async function callDeepSeek(systemPrompt, contextBlock, userText) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 700,
      messages: [
        { role: "system", content: `${systemPrompt}\n\n${contextBlock}` },
        { role: "user", content: userText },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

function tagsForReply(reply) {
  const tags = [];
  const banned = [
    /^我理解/m,
    /^这是.{0,4}常见/m,
    /^确实/m,
    /^感谢分享/m,
    /这是一个.{0,5}很好的问题/,
    /^听起来/m,
    /希望对你有帮助/,
    /祝你/,
    /加油/,
    /我会陪你/,
    /我们一起/,
    /你的想法.{0,3}很好/,
    /很有创业精神/,
    /很有.{0,3}创新性/,
    /我懂你的感受/,
  ];
  for (const pattern of banned) {
    if (pattern.test(reply)) {
      tags.push(`违禁词：${pattern.source}`);
    }
  }

  const words = reply.length;
  tags.push(`字数：${words}`);

  if (reply.startsWith("- ") || /^\d\.\s/.test(reply)) {
    tags.push("以列表开头");
  }

  return tags;
}

async function main() {
  console.log(`Running A/B test: ${TEST_CASES.length} scenarios × 2 prompts = ${TEST_CASES.length * 2} API calls`);
  console.log(`Model: ${MODEL}`);
  console.log("");

  const lines = [];
  lines.push("# Prompt v1 vs v2 — A/B 对比报告");
  lines.push("");
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push(`Model：\`${MODEL}\``);
  lines.push("");
  lines.push('> v1 = 现在线上跑的 prompt（强调"接住情绪、不要套话"）');
  lines.push('> v2 = 重写后的 prompt（强调"冷、赤裸、敢反对、代价语言"）');
  lines.push("");
  lines.push("---");
  lines.push("");

  let v1ViolationCount = 0;
  let v2ViolationCount = 0;
  let v1TotalChars = 0;
  let v2TotalChars = 0;

  for (const [idx, testCase] of TEST_CASES.entries()) {
    console.log(`[${idx + 1}/${TEST_CASES.length}] ${testCase.label}`);
    const contextBlock = buildContextBlock(testCase);

    let v1Reply, v2Reply;
    try {
      [v1Reply, v2Reply] = await Promise.all([
        callDeepSeek(PROMPT_V1, contextBlock, testCase.user),
        callDeepSeek(PROMPT_V2, contextBlock, testCase.user),
      ]);
    } catch (err) {
      console.error("  ERROR:", err.message);
      v1Reply = `(error: ${err.message})`;
      v2Reply = `(error: ${err.message})`;
    }

    const v1Tags = tagsForReply(v1Reply);
    const v2Tags = tagsForReply(v2Reply);
    const v1Violations = v1Tags.filter((t) => t.startsWith("违禁词")).length;
    const v2Violations = v2Tags.filter((t) => t.startsWith("违禁词")).length;
    v1ViolationCount += v1Violations;
    v2ViolationCount += v2Violations;
    v1TotalChars += v1Reply.length;
    v2TotalChars += v2Reply.length;

    lines.push(`## ${idx + 1}. ${testCase.label}`);
    lines.push("");
    lines.push(`**用户北极星**：${testCase.northStar}`);
    lines.push("");
    lines.push(`**用户输入**：${testCase.user}`);
    lines.push("");
    lines.push("### v1 输出");
    lines.push("");
    lines.push("```");
    lines.push(v1Reply);
    lines.push("```");
    lines.push("");
    lines.push(`**v1 标签**：${v1Tags.join(" / ")}`);
    lines.push("");
    lines.push("### v2 输出");
    lines.push("");
    lines.push("```");
    lines.push(v2Reply);
    lines.push("```");
    lines.push("");
    lines.push(`**v2 标签**：${v2Tags.join(" / ")}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("## 汇总");
  lines.push("");
  lines.push(`| 指标 | v1 | v2 |`);
  lines.push(`|---|---|---|`);
  lines.push(`| 触发违禁词总次数 | ${v1ViolationCount} | ${v2ViolationCount} |`);
  lines.push(`| 平均字数 | ${Math.round(v1TotalChars / TEST_CASES.length)} | ${Math.round(v2TotalChars / TEST_CASES.length)} |`);
  lines.push("");

  const reportPath = path.join(__dirname, "..", "prompt-ab-report.md");
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");

  console.log("");
  console.log("─".repeat(60));
  console.log(`Report saved: ${reportPath}`);
  console.log(`v1 违禁词触发：${v1ViolationCount} 次`);
  console.log(`v2 违禁词触发：${v2ViolationCount} 次`);
  console.log(`v1 平均字数：${Math.round(v1TotalChars / TEST_CASES.length)}`);
  console.log(`v2 平均字数：${Math.round(v2TotalChars / TEST_CASES.length)}`);
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
