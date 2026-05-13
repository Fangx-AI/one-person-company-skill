#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { matchProductIdea } = require("../../scripts/opc/match-product-idea");

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opc-idea-match-"));
  const base = path.join(root, "knowledge", "cases");

  writeJsonl(path.join(base, "normalized", "normalized-cases.jsonl"), [
    {
      id: "case_xhs_content_tool",
      raw_ids: ["raw_xhs_content_tool"],
      name: "XHS Content Tool",
      founder_type: "solo_founder",
      geography: ["cn"],
      target_user: ["creators", "xiaohongshu_sellers"],
      product_form: ["ai_tool", "content_tool"],
      route: ["xiaohongshu_to_paid_tool", "content_workflow_automation"],
      acquisition: ["xiaohongshu", "public_posts", "community_feedback"],
      delivery: ["web_app"],
      pricing: ["subscription"],
      evidence_urls: ["https://example.com/xhs"],
      summary: "A tool for Xiaohongshu creators to plan titles and posts.",
      commercial_path: "Validate with creators, sell a narrow paid workflow, then expand.",
      risks: ["platform_algorithm_dependency", "ai_output_commodity"],
      confidence: "medium",
      date_checked: "2026-05-11",
    },
    {
      id: "case_api_tool",
      raw_ids: ["raw_api_tool"],
      name: "API Tool",
      founder_type: "solo_founder",
      geography: ["global"],
      target_user: ["developers"],
      product_form: ["api_saas"],
      route: ["developer_tool_to_b2b_saas"],
      acquisition: ["content"],
      delivery: ["api"],
      pricing: ["subscription"],
      evidence_urls: ["https://example.com/api"],
      summary: "A developer API SaaS.",
      commercial_path: "Ship API docs and sell to developers.",
      risks: ["developer_tool_distribution_is_slow"],
      confidence: "medium",
      date_checked: "2026-05-11",
    },
    {
      id: "case_daily_journal",
      raw_ids: ["raw_daily_journal"],
      name: "Daily Journal",
      founder_type: "solo_founder",
      geography: ["global"],
      target_user: ["writers"],
      product_form: ["habit_app"],
      route: ["daily_writing_habit"],
      acquisition: ["email"],
      delivery: ["web_app"],
      pricing: ["subscription"],
      evidence_urls: ["https://example.com/daily"],
      summary: "A daily writing app with email reminders.",
      commercial_path: "Build a habit loop and charge for continuity.",
      risks: ["consumer_churn"],
      confidence: "high",
      date_checked: "2026-05-11",
    },
    {
      id: "case_ai_headshot",
      raw_ids: ["raw_ai_headshot"],
      name: "AI Headshot Tool",
      founder_type: "solo_founder",
      geography: ["global"],
      target_user: ["professionals", "small_teams"],
      product_form: ["ai_image_service", "professional_photo_tool"],
      route: ["ai_outcome_product", "clear_willingness_to_pay"],
      acquisition: ["seo"],
      delivery: ["web_app"],
      pricing: ["one_time_purchase"],
      evidence_urls: ["https://example.com/headshot"],
      summary: "A professional AI headshot product for individuals and teams.",
      commercial_path: "Sell finished professional photos against the offline alternative cost.",
      risks: ["output_quality_variance"],
      confidence: "medium",
      date_checked: "2026-05-11",
    },
    {
      id: "case_ai_virtual_try_on",
      raw_ids: ["raw_ai_virtual_try_on"],
      name: "AI Virtual Try-On Commerce Visuals",
      founder_type: "solo_founder",
      geography: ["global", "cn"],
      target_user: ["fashion_sellers", "xiaohongshu_sellers", "ecommerce_operators"],
      product_form: ["ai_image_tool", "virtual_try_on", "commerce_visual_tool"],
      route: ["ai_commerce_visuals", "virtual_try_on_api", "commerce_material_service"],
      acquisition: ["xiaohongshu", "taobao_seller_groups", "douyin_shop_operators"],
      delivery: ["web_app", "api", "service"],
      pricing: ["credits", "subscription", "service_fee"],
      evidence_urls: ["https://example.com/try-on"],
      summary: "A virtual try-on and commerce material workflow for fashion sellers.",
      commercial_path: "Sell usable product-on-model images against model shooting, design outsourcing, and API alternatives.",
      risks: ["output_quality_variance", "portrait_rights", "commodity_api_cost"],
      confidence: "medium",
      date_checked: "2026-05-13",
    },
    {
      id: "case_case_library",
      raw_ids: ["raw_case_library"],
      name: "Founder Case Library",
      founder_type: "solo_founder",
      geography: ["global"],
      target_user: ["founders", "business_idea_researchers"],
      product_form: ["case_library", "paid_research"],
      route: ["case_intelligence_product", "content_database_to_paid_research"],
      acquisition: ["seo", "newsletter"],
      delivery: ["website"],
      pricing: ["subscription"],
      evidence_urls: ["https://example.com/cases"],
      summary: "A structured case library for founders evaluating product ideas.",
      commercial_path: "Normalize many founder stories into searchable commercial patterns.",
      risks: ["case_facts_age_quickly"],
      confidence: "medium",
      date_checked: "2026-05-11",
    },
    {
      id: "case_notion_site",
      raw_ids: ["raw_notion_site"],
      name: "Notion Site Builder",
      founder_type: "solo_founder",
      geography: ["global"],
      target_user: ["notion_users", "creators"],
      product_form: ["notion_site_builder", "no_code_tool"],
      route: ["notion_to_website_workflow", "platform_layer_on_existing_tool"],
      acquisition: ["notion_community", "templates"],
      delivery: ["web_app"],
      pricing: ["subscription"],
      evidence_urls: ["https://example.com/notion"],
      summary: "A tool that turns Notion pages into creator websites.",
      commercial_path: "Sell the missing publishing layer to users already maintaining content in Notion.",
      risks: ["platform_dependency"],
      confidence: "medium",
      date_checked: "2026-05-11",
    },
  ]);

  writeJsonl(path.join(base, "gold", "gold-cases.jsonl"), [
    {
      id: "gold_xhs_content_tool",
      case_id: "case_xhs_content_tool",
      score: 90,
      why_gold: "Strong fit for domestic creator tools.",
      reusable_lessons: ["Validate with platform-native content before building features."],
      applicable_to: ["xiaohongshu_tool", "ai_content_tool"],
      warning_flags: ["Do not confuse saves and comments with payment intent."],
    },
    {
      id: "gold_daily_journal",
      case_id: "case_daily_journal",
      score: 95,
      why_gold: "Strong habit-product benchmark, but irrelevant to Xiaohongshu AI content tooling.",
      reusable_lessons: ["Habit loops matter."],
      applicable_to: ["habit_app"],
      warning_flags: ["Consumer churn is high."],
    },
    {
      id: "gold_ai_virtual_try_on",
      case_id: "case_ai_virtual_try_on",
      score: 92,
      why_gold: "Strong fit for virtual try-on and AI commerce material ideas.",
      reusable_lessons: ["Sell commerce-ready product images, not consumer entertainment."],
      applicable_to: ["virtual_try_on", "ai_commerce_visuals", "fashion_sellers"],
      warning_flags: ["C端玩法 can burn API cost without proving merchant willingness to pay."],
    },
  ]);

  return root;
}

function testMatchesDomesticAiContentIdea() {
  const result = matchProductIdea({
    root: createFixture(),
    idea:
      "\u6211\u60f3\u505a\u4e00\u4e2a AI \u5c0f\u7ea2\u4e66\u9009\u9898\u52a9\u624b\uff0c\u5e2e\u535a\u4e3b\u751f\u6210\u6807\u9898\u548c\u7b14\u8bb0\u65b9\u5411",
    limit: 3,
  });

  assert.strictEqual(result.similarCases[0].id, "case_xhs_content_tool");
  assert(!result.similarCases.some((row) => row.id === "case_api_tool"));
  assert(!result.similarCases.some((row) => row.id === "case_daily_journal"));
  assert(result.extractedSignals.keywords.includes("xiaohongshu"));
  assert(result.extractedSignals.keywords.includes("ai"));
  assert(result.similarRoutes.some((route) => route.route === "xiaohongshu_to_paid_tool"));
  assert(result.chinaRisks.some((risk) => risk.risk.includes("\u5e73\u53f0")));
  assert(result.shortestValidationPath.length >= 3);
}

function testDoesNotTreatPaidAsAiSignal() {
  const result = matchProductIdea({
    root: createFixture(),
    idea: "paid template for github developers",
    limit: 3,
  });

  assert(!result.extractedSignals.keywords.includes("ai"));
  assert(result.extractedSignals.keywords.includes("knowledge_product"));
  assert(!result.similarCases.some((row) => row.id === "case_xhs_content_tool"));
  assert(result.similarCases.some((row) => row.id === "case_api_tool"));
  assert.strictEqual(result.chinaRisks.length, 0);
}

function testMatchesAiHeadshotOutcomeProduct() {
  const result = matchProductIdea({
    root: createFixture(),
    idea: "AI headshot product for professionals and small teams",
    limit: 3,
  });

  assert(result.extractedSignals.keywords.includes("visual_ai"));
  assert(result.similarCases.some((row) => row.id === "case_ai_headshot"));
  assert(result.similarCases.find((row) => row.id === "case_ai_headshot").score >= result.similarCases[0].score - 5);
}

function testMatchesVirtualTryOnCommerceVisuals() {
  const result = matchProductIdea({
    root: createFixture(),
    idea: "我想做一个换装小程序，用户上传人物图和商品图，就可以生成虚拟试衣和小红书商品图",
    limit: 3,
  });

  assert(result.extractedSignals.keywords.includes("virtual_try_on"));
  assert(result.extractedSignals.keywords.includes("ecommerce_visuals"));
  assert(result.extractedSignals.keywords.includes("xiaohongshu"));
  assert(result.similarCases.some((row) => row.id === "case_ai_virtual_try_on"));
  assert(result.similarRoutes.some((route) => route.route === "ai_commerce_visuals"));
  assert(result.businessBottlenecks.some((risk) => risk.includes("商家") || risk.includes("API")));
}

function testRepositoryMatchesVirtualTryOnDirectCases() {
  const root = path.resolve(__dirname, "..", "..");
  const result = matchProductIdea({
    root,
    idea: "我想做一个换装小程序 用户输入一张人物图和一张商品图 就可以换衣服",
    limit: 5,
  });

  assert(result.extractedSignals.keywords.includes("virtual_try_on"));
  assert(result.extractedSignals.keywords.includes("ecommerce_visuals"));
  assert.strictEqual(result.similarCases[0].id, "case_fashn_ai_tryon_api");
  assert(result.similarCases.some((row) => row.id === "case_botika_ai_fashion_models"));
  assert(result.similarCases.some((row) => row.id === "case_vtry_virtual_tryon"));
  assert(result.similarRoutes[0].route === "ai_commerce_visuals");
}

function testMatchesCaseIntelligenceIdea() {
  const result = matchProductIdea({
    root: createFixture(),
    idea:
      "\u6211\u60f3\u505a\u4e00\u4e2a\u4e00\u4eba\u516c\u53f8\u6848\u4f8b\u68c0\u7d22\u548c\u5546\u4e1a\u8def\u7ebf\u89c4\u5212\u5de5\u5177",
    limit: 3,
  });

  assert(result.extractedSignals.keywords.includes("case_intelligence"));
  assert(result.similarCases.some((row) => row.id === "case_case_library"));
  assert(result.similarCases.find((row) => row.id === "case_case_library").score >= result.similarCases[0].score - 5);
}

function testMatchesNotionSiteBuilder() {
  const result = matchProductIdea({
    root: createFixture(),
    idea: "Notion \u5efa\u7ad9\u5de5\u5177 for creators",
    limit: 3,
  });

  assert(result.extractedSignals.keywords.includes("notion"));
  assert(result.similarCases.some((row) => row.id === "case_notion_site"));
  assert(result.similarCases.find((row) => row.id === "case_notion_site").score >= result.similarCases[0].score - 5);
}

testMatchesDomesticAiContentIdea();
testDoesNotTreatPaidAsAiSignal();
testMatchesAiHeadshotOutcomeProduct();
testMatchesVirtualTryOnCommerceVisuals();
testRepositoryMatchesVirtualTryOnDirectCases();
testMatchesCaseIntelligenceIdea();
testMatchesNotionSiteBuilder();
console.log("product-idea-matcher tests passed");
