#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const signalDictionary = [
  { pattern: /\u5c0f\u7ea2\u4e66|xiaohongshu|xhs/i, keyword: "xiaohongshu" },
  { pattern: /\bAI\b|\u4eba\u5de5\u667a\u80fd|\u5927\u6a21\u578b|\bLLM\b/i, keyword: "ai" },
  {
    pattern:
      /headshot|profile\s*picture|avatar|photo|image|\u804c\u4e1a\u7167|\u8bc1\u4ef6\u7167|\u5934\u50cf|\u7167\u7247|\u56fe\u7247|\u4fee\u56fe|\u6444\u5f71/i,
    keyword: "visual_ai",
  },
  {
    pattern:
      /virtual\s*try[-\s]*on|try[-\s]*on|\u6362\u88c5|\u8bd5\u8863|\u865a\u62df\u8bd5\u8863|\u4e0a\u8eab\u56fe|\u6a21\u7279\u56fe|\u670d\u88c5|\u8863\u670d|\u5546\u54c1\u56fe|\u8be6\u60c5\u9875|\u7535\u5546\u7d20\u6750|\u79cd\u8349\u56fe|\u5973\u88c5|\u6dd8\u5b9d|\u6296\u97f3\u5c0f\u5e97/i,
    keyword: "virtual_try_on",
  },
  {
    pattern:
      /\u5546\u54c1\u56fe|\u4e3b\u56fe|\u8be6\u60c5\u9875|\u7535\u5546|\u79cd\u8349\u56fe|\u5e7f\u544a\u56fe|\u4e0a\u65b0|\u6dd8\u5b9d|\u6296\u97f3\u5c0f\u5e97|\u5c0f\u7ea2\u4e66\u5546\u5bb6|\u670d\u88c5\u5546\u5bb6|\u5973\u88c5\u5546\u5bb6/i,
    keyword: "ecommerce_visuals",
  },
  {
    pattern: /headshot|\u804c\u4e1a\u7167|\u8bc1\u4ef6\u7167|\u5546\u52a1\u7167|\u5de5\u4f5c\u7167/i,
    keyword: "headshot",
  },
  {
    pattern:
      /\u6848\u4f8b|case|\u60c5\u62a5|\u6570\u636e\u5e93|\u8d44\u6599\u5e93|\u5546\u4e1a\u8def\u7ebf|\u5546\u4e1a\u8def\u5f84|\u8def\u7ebf\u89c4\u5212|\u4e00\u4eba\u516c\u53f8|\u521b\u4e1a\u6848\u4f8b|founder\s*story/i,
    keyword: "case_intelligence",
  },
  { pattern: /notion/i, keyword: "notion" },
  {
    pattern:
      /\u9009\u9898|\u6807\u9898|\u7b14\u8bb0|\u5185\u5bb9|\u516c\u4f17\u53f7|\u81ea\u5a92\u4f53|\u535a\u4e3b|creator|\u77ed\u89c6\u9891|\u89c6\u9891|\u64ad\u5ba2/i,
    keyword: "content",
  },
  { pattern: /SaaS|\u8ba2\u9605|\u8f6f\u4ef6|\u5de5\u5177|\u7cfb\u7edf|\u4ea7\u54c1/i, keyword: "saas" },
  { pattern: /API|\u63a5\u53e3|\u81ea\u52a8\u5316|\u6279\u91cf|\u5de5\u4f5c\u6d41/i, keyword: "automation" },
  {
    pattern:
      /\u62a5\u4ef7|\u5408\u540c|\u53d1\u7968|\u6536\u6b3e|\u81ea\u7531\u804c\u4e1a|\u63a5\u5355|\u5ba2\u6237|\u4ea4\u4ed8/i,
    keyword: "freelancer_ops",
  },
  { pattern: /\u5f00\u53d1\u8005|\u7a0b\u5e8f\u5458|\u4ee3\u7801|github/i, keyword: "developer" },
  {
    pattern:
      /\u6a21\u677f|\u8bfe\u7a0b|\u77e5\u8bc6\u4ed8\u8d39|\u54a8\u8be2|\u8bad\u7ec3\u8425|template|boilerplate|course|playbook/i,
    keyword: "knowledge_product",
  },
  {
    pattern:
      /\u56fd\u5185|\u4e2d\u56fd|\u5907\u6848|\u5fae\u4fe1|\u652f\u4ed8\u5b9d|\u6296\u97f3|\u516c\u4f17\u53f7|\u5373\u523b|\u77e5\u4e4e|\u9999\u6e2f\u670d\u52a1\u5668|ICP\u5907\u6848/i,
    keyword: "china",
  },
];

const keywordAliases = {
  ai: [
    "ai_tool",
    "ai_saas",
    "ai_support_tool",
    "ai_voice_tool",
    "ai_email_tool",
    "ai_lead_discovery",
    "ai_augmented_service",
    "customer_support_agent",
    "voice_to_text",
    "manual_workflow_to_automation",
    "ai_output_commodity",
  ],
  visual_ai: [
    "ai_image_tool",
    "ai_image_service",
    "ai_avatar_tool",
    "ai_photo_pack",
    "professional_photo_tool",
    "visual_workflow_automation",
    "ai_outcome_product",
    "clear_willingness_to_pay",
    "professionals",
    "photo",
    "image",
    "avatar",
    "headshot",
  ],
  virtual_try_on: [
    "virtual_try_on",
    "virtual_try_on_api",
    "commerce_visual_tool",
    "ai_commerce_visuals",
    "product_on_model",
    "fashion_sellers",
    "ai_image_tool",
    "commerce_material_service",
  ],
  ecommerce_visuals: [
    "commerce_visual_tool",
    "ai_commerce_visuals",
    "commerce_material_service",
    "ecommerce_operators",
    "fashion_sellers",
    "xiaohongshu_sellers",
    "taobao_seller_groups",
    "douyin_shop_operators",
    "product_on_model",
  ],
  headshot: [
    "headshot",
    "professional_photo_tool",
    "ai_outcome_product",
    "clear_willingness_to_pay",
  ],
  case_intelligence: [
    "case_library",
    "founder_story_library",
    "case_intelligence_product",
    "content_database_to_paid_research",
    "founder_intelligence",
    "business_idea_researchers",
    "paid_research",
    "research_archive",
    "founder stories",
  ],
  notion: [
    "notion",
    "notion_tool",
    "notion_site_builder",
    "notion_to_website_workflow",
    "notion_community",
    "platform_layer_on_existing_tool",
  ],
  xiaohongshu: [
    "xiaohongshu",
    "xiaohongshu_sellers",
    "xiaohongshu_to_paid_tool",
    "public_posts",
    "community_feedback",
    "domestic_channel_intelligence",
  ],
  content: [
    "content_tool",
    "content_workflow_automation",
    "creator_content",
    "creators",
    "creator_service",
    "newsletter_tool",
    "podcasters",
    "writer_tool",
    "writing_tool",
  ],
  saas: [
    "api_saas",
    "analytics_saas",
    "ai_saas",
    "b2b_saas",
    "email_saas",
    "form_builder",
    "newsletter_tool",
    "support_widget",
  ],
  automation: [
    "automation_builders",
    "api",
    "workflow",
    "content_workflow_automation",
    "manual_workflow_to_automation",
    "support_workflow_ai_agent",
  ],
  freelancer_ops: [
    "productized_service",
    "manual_service",
    "retainer",
    "client",
    "service_productization",
    "manual_service_with_ai_leverage",
  ],
  developer: [
    "developers",
    "developer_tool",
    "developer_template",
    "developer_tool_to_b2b_saas",
    "code_template",
    "documentation",
    "github",
    "open_source",
    "self_hosted",
    "desktop_app",
  ],
  knowledge_product: [
    "template",
    "paid_template",
    "developer_template",
    "paid_boilerplate",
    "course",
    "digital_download",
    "knowledge_product",
    "one_time",
  ],
  china: ["cn", "xiaohongshu", "wechat", "domestic_channel_intelligence"],
};

const keywordWeights = {
  ai: 7,
  content: 7,
  saas: 6,
  automation: 7,
  freelancer_ops: 10,
  developer: 10,
  knowledge_product: 10,
  china: 10,
  xiaohongshu: 18,
  visual_ai: 14,
  virtual_try_on: 22,
  ecommerce_visuals: 20,
  headshot: 18,
  case_intelligence: 18,
  notion: 18,
};

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function flattenCase(row) {
  return [
    row.id,
    row.name,
    row.founder_type,
    row.summary,
    row.commercial_path,
    ...(row.geography || []),
    ...(row.target_user || []),
    ...(row.product_form || []),
    ...(row.route || []),
    ...(row.acquisition || []),
    ...(row.delivery || []),
    ...(row.pricing || []),
    ...(row.risks || []),
  ]
    .join(" ")
    .toLowerCase();
}

function extractSignals(idea) {
  const keywords = [];
  for (const entry of signalDictionary) {
    if (entry.pattern.test(idea)) keywords.push(entry.keyword);
  }
  return {
    original: idea,
    keywords: [...new Set(keywords)],
  };
}

function scoreCase(row, signals) {
  const haystack = flattenCase(row);
  let baseScore = 0;
  const reasons = [];

  for (const keyword of signals.keywords) {
    const aliases = keywordAliases[keyword] || [keyword];
    const matched = aliases.filter((alias) => haystack.includes(alias.toLowerCase()));
    if (matched.length > 0) {
      const cappedMatchCount = Math.min(matched.length, 4);
      baseScore += (keywordWeights[keyword] || 10) + cappedMatchCount * 2;
      reasons.push(`${keyword}: ${matched.slice(0, 3).join(", ")}`);
    }
  }

  let qualityBoost = 0;
  if (baseScore > 0 && (row.confidence || "") === "high") qualityBoost += 3;
  if (baseScore > 0 && (row.confidence || "") === "medium") qualityBoost += 1;

  return { baseScore, qualityBoost, reasons };
}

function topRoutes(cases) {
  const routeScores = new Map();
  for (const item of cases) {
    for (const route of item.route || []) {
      const current = routeScores.get(route) || { route, score: 0, cases: [] };
      current.score += item.match_score || 0;
      current.cases.push(item.name);
      routeScores.set(route, current);
    }
  }
  return [...routeScores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((route) => ({ ...route, cases: [...new Set(route.cases)].slice(0, 3) }));
}

function inferBottlenecks(signals, cases) {
  const risks = new Set();

  if (signals.keywords.includes("ai")) {
    risks.add("\u0041\u0049 \u8f93\u51fa\u540c\u8d28\u5316\uff0c\u7528\u6237\u53ef\u80fd\u89c9\u5f97\u81ea\u5df1\u76f4\u63a5\u7528\u901a\u7528\u6a21\u578b\u4e5f\u80fd\u505a\u3002");
  }
  if (signals.keywords.includes("virtual_try_on") || signals.keywords.includes("ecommerce_visuals")) {
    risks.add("\u0043\u7aef\u6362\u88c5\u5a31\u4e50\u5bb9\u6613\u70e7\u0041\u0050\u0049\u6210\u672c\uff0c\u66f4\u5e94\u8be5\u9a8c\u8bc1\u670d\u88c5\u5546\u5bb6\u662f\u5426\u613f\u610f\u4e3a\u53ef\u53d1\u5e03\u7684\u5546\u54c1\u4e0a\u8eab\u56fe\u4ed8\u94b1\u3002");
    risks.add("\u5546\u5bb6\u4ed8\u8d39\u4e0d\u770b\u751f\u6210\u662f\u5426\u70ab\uff0c\u800c\u770b\u8863\u670d\u7eb9\u7406\u3001\u7248\u578b\u3001\u906e\u6321\u3001\u80cc\u666f\u548c\u5e73\u53f0\u53d1\u5e03\u662f\u5426\u53ef\u7528\u3002");
  }
  for (const row of cases) {
    for (const risk of row.risks || []) risks.add(risk);
  }
  if (signals.keywords.includes("xiaohongshu")) {
    risks.add("\u5e73\u53f0\u4e92\u52a8\u4e0d\u7b49\u4e8e\u4ed8\u8d39\u610f\u613f\uff0c\u5fc5\u987b\u5355\u72ec\u9a8c\u8bc1\u4ed8\u6b3e\u52a8\u4f5c\u3002");
  }
  if (signals.keywords.includes("freelancer_ops")) {
    risks.add("\u5de5\u5177\u4ef7\u503c\u5bb9\u6613\u88ab\u4f4e\u4f30\uff0c\u9700\u8981\u7ed1\u5b9a\u6536\u6b3e\u3001\u5408\u540c\u3001\u4ea4\u4ed8\u8fd9\u7c7b\u786c\u7ed3\u679c\u3002");
  }
  if (signals.keywords.includes("developer")) {
    risks.add("\u5f00\u53d1\u8005\u5de5\u5177\u83b7\u5ba2\u6162\uff0c\u6587\u6863\u548c\u771f\u5b9e\u7528\u4f8b\u6bd4\u529f\u80fd\u5217\u8868\u66f4\u91cd\u8981\u3002");
  }

  return [...risks].slice(0, 5);
}

function chinaRisks(signals, cases) {
  const risks = [];
  const text = `${signals.original} ${cases.map((row) => (row.risks || []).join(" ")).join(" ")}`;
  if (/\u5c0f\u7ea2\u4e66|xiaohongshu|xhs|\u6296\u97f3|\u5fae\u4fe1|\u516c\u4f17\u53f7/i.test(text)) {
    risks.push({
      risk: "\u5e73\u53f0\u89c4\u5219\u548c\u7b97\u6cd5\u53d8\u5316\u4f1a\u76f4\u63a5\u5f71\u54cd\u83b7\u5ba2\uff0c\u4e0d\u80fd\u628a\u5355\u4e00\u5e73\u53f0\u5f53\u6210\u7a33\u5b9a\u6e20\u9053\u3002",
    });
  }
  if (/SaaS|\u8ba2\u9605|\u7f51\u7ad9|\u652f\u4ed8|\u56fd\u5185|\u4e2d\u56fd|\u5907\u6848/i.test(text)) {
    risks.push({
      risk: "\u56fd\u5185 SaaS \u9700\u8981\u63d0\u524d\u5904\u7406\u5907\u6848\u3001\u652f\u4ed8\u3001\u767b\u5f55\u3001\u5185\u5bb9\u5408\u89c4\u548c\u670d\u52a1\u5668\u9009\u62e9\u7684\u6743\u8861\u3002",
    });
  }
  if (/\bAI\b|\u5927\u6a21\u578b|\u5185\u5bb9|\u9009\u9898/i.test(text)) {
    risks.push({
      risk: "\u0041\u0049 \u5185\u5bb9\u5de5\u5177\u5728\u56fd\u5185\u5f88\u5bb9\u6613\u88ab\u8ba4\u4e3a\u662f\u6cdb\u5de5\u5177\uff0c\u5fc5\u987b\u7ed1\u5b9a\u5177\u4f53\u573a\u666f\u548c\u53ef\u4ea4\u4ed8\u7ed3\u679c\u3002",
    });
  }
  return risks.slice(0, 3);
}

function shortestValidationPath(signals) {
  const path = [
    "\u4eca\u5929\u53ea\u9a8c\u8bc1\u4e00\u4ef6\u4e8b\uff1a\u627e 10 \u4e2a\u6700\u50cf\u76ee\u6807\u7528\u6237\u7684\u4eba\uff0c\u4e0d\u8bb2\u529f\u80fd\uff0c\u53ea\u95ee\u4ed6\u73b0\u5728\u600e\u4e48\u89e3\u51b3\u3002",
    "\u62ff 3 \u4e2a\u771f\u5b9e\u8f93\u5165\u624b\u5de5\u4ea4\u4ed8\u7ed3\u679c\uff0c\u4e0d\u505a\u767b\u5f55\u3001\u540e\u53f0\u548c\u5b8c\u6574\u4ea7\u54c1\u3002",
    "\u8bbe\u4e00\u4e2a 19-99 \u5143\u4ed8\u6b3e\u52a8\u4f5c\uff0c\u4e0d\u4ed8\u94b1\u5c31\u628a\u539f\u56e0\u8bb0\u4e0b\u6765\uff0c\u4e0d\u7528\u53e3\u5934\u5174\u8da3\u505a\u51b3\u7b56\u3002",
  ];

  if (signals.keywords.includes("xiaohongshu")) {
    path.splice(
      1,
      0,
      "\u53d1 3 \u6761\u573a\u666f\u5316\u5c0f\u7ea2\u4e66\u7b14\u8bb0\uff0c\u770b\u79c1\u4fe1\u548c\u95ee\u9898\uff0c\u4e0d\u770b\u70b9\u8d5e\u3002",
    );
  }

  if (signals.keywords.includes("ai")) {
    path.splice(
      2,
      0,
      "\u628a AI \u85cf\u5230\u540e\u53f0\uff0c\u524d\u53f0\u53ea\u5356\u4e00\u4e2a\u7ed3\u679c\uff1a\u7701\u65f6\u3001\u63d0\u9ad8\u901a\u8fc7\u7387\u6216\u51cf\u5c11\u8fd4\u5de5\u3002",
    );
  }

  return path.slice(0, 5);
}

function matchProductIdea(options) {
  const root = options.root || path.resolve(__dirname, "..", "..");
  const idea = options.idea || "";
  const limit = options.limit || 5;
  const casesPath = path.join(root, "knowledge", "cases", "normalized", "normalized-cases.jsonl");
  const goldPath = path.join(root, "knowledge", "cases", "gold", "gold-cases.jsonl");
  const cases = readJsonl(casesPath);
  const gold = readJsonl(goldPath);
  const goldByCase = new Map(gold.map((row) => [row.case_id, row]));
  const signals = extractSignals(idea);

  const scored = cases
    .map((row) => {
      const match = scoreCase(row, signals);
      const goldCase = goldByCase.get(row.id);
      const goldBoost = match.baseScore > 0 && goldCase ? Math.round(goldCase.score / 20) : 0;
      return {
        ...row,
        match_score: match.baseScore + match.qualityBoost + goldBoost,
        match_reasons: match.reasons,
        gold_reason: goldCase ? goldCase.why_gold : null,
      };
    })
    .filter((row) => row.match_reasons.length > 0)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, limit);

  return {
    idea,
    extractedSignals: signals,
    similarCases: scored.map((row) => ({
      id: row.id,
      name: row.name,
      score: row.match_score,
      reasons: row.match_reasons,
      route: row.route,
      product_form: row.product_form,
      acquisition: row.acquisition,
      pricing: row.pricing,
      summary: row.summary,
      commercial_path: row.commercial_path,
      risks: row.risks,
      evidence_urls: row.evidence_urls,
      gold_reason: row.gold_reason,
    })),
    similarRoutes: topRoutes(scored),
    businessBottlenecks: inferBottlenecks(signals, scored),
    chinaRisks: chinaRisks(signals, scored),
    shortestValidationPath: shortestValidationPath(signals),
  };
}

if (require.main === module) {
  const idea = process.argv.slice(2).join(" ").trim();
  if (!idea) {
    console.error("Usage: node scripts/opc/match-product-idea.js <product idea>");
    process.exit(1);
  }
  console.log(JSON.stringify(matchProductIdea({ idea }), null, 2));
}

module.exports = { matchProductIdea };
