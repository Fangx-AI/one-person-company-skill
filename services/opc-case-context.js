"use strict";

const path = require("path");

const { matchProductIdea } = require("../scripts/opc/match-product-idea");

const DEFAULT_MAX_CHARS = 1800;

const triggerPattern =
  /一人公司|创业|商业化|产品|定价|获客|付费|用户|需求|赛道|小红书|公众号|知乎|即刻|抖音|SaaS|API|模板|课程|知识付费|独立开发|自由职业|接单|副业|大模型|LLM|startup|product|pricing|customer|revenue|mrr|arr|saas|template|boilerplate|founder|indie/i;

const aiBusinessPattern =
  /AI.+(产品|工具|商业化|创业|获客|付费|定价|用户|需求|SaaS|自动化|选题|内容|客服|销售|邮件|小红书)|((产品|工具|商业化|创业|获客|付费|定价|用户|需求|SaaS|自动化|选题|内容|客服|销售|邮件|小红书).+AI)/i;

function latestUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && message.role === "user") {
      return String(message.content || "").trim();
    }
  }
  return "";
}

function shouldBuildCaseContext(text) {
  return Boolean(text && (triggerPattern.test(text) || aiBusinessPattern.test(text)));
}

function compactList(items, limit, formatter) {
  return (items || []).slice(0, limit).map(formatter).filter(Boolean);
}

function buildCaseContextForMessages(options = {}) {
  const messages = Array.isArray(options.messages) ? options.messages : [];
  const idea = latestUserText(messages);
  if (!shouldBuildCaseContext(idea)) return null;

  const root = options.root || path.resolve(__dirname, "..");
  const maxChars = Number(options.maxChars) || DEFAULT_MAX_CHARS;
  const match = matchProductIdea({ root, idea, limit: 3 });

  if (!match.similarCases.length) return null;

  const lines = [
    "一人公司案例情报：以下内容只作为回答依据，不要逐条复述；回答时要提炼成判断、路径和下一步动作。",
    `用户想法：${idea.slice(0, 180)}`,
    "相似案例：",
    ...compactList(match.similarCases, 3, (item, index) => {
      const route = (item.route || []).slice(0, 2).join(" / ");
      const risk = (item.risks || []).slice(0, 2).join(" / ");
      return `${index + 1}. ${item.name}：${item.summary} 路径：${route}。风险：${risk}。`;
    }),
    "相似路径：",
    ...compactList(match.similarRoutes, 2, (item, index) => {
      return `${index + 1}. ${item.route}（参考：${(item.cases || []).join(" / ")}）`;
    }),
    "商业卡点：",
    ...compactList(match.businessBottlenecks, 3, (item, index) => `${index + 1}. ${item}`),
  ];

  if (match.chinaRisks.length) {
    lines.push(
      "国内现实风险：",
      ...compactList(match.chinaRisks, 3, (item, index) => `${index + 1}. ${item.risk}`),
    );
  }

  lines.push(
    "最短验证动作：",
    ...compactList(match.shortestValidationPath, 3, (item, index) => `${index + 1}. ${item}`),
  );

  return {
    kind: "opc_case_context",
    text: lines.join("\n").slice(0, maxChars),
    match,
  };
}

module.exports = {
  buildCaseContextForMessages,
  shouldBuildCaseContext,
  _internal: {
    latestUserText,
  },
};
