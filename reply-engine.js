function generateReply(userText, card) {
  const normalized = normalizeSearchText(userText);
  const intent = classifyIntent(normalized);
  const userContext = buildUserContext(userText);

  if (!card) {
    const suggestions = findRelevantCards(userText);
    if (!suggestions.length) {
      return [
        "这个问题可以聊，只是我还没抓到你最具体的卡点。",
        "",
        "你可以补一句更像现实处境的话，比如你现在是在害怕失败、看不清方向、卡在第一步，还是纠结值不值得继续。",
      ].join("\n");
    }

    if (intent === "source") return buildOpenSourceReply(suggestions);
    if (intent === "related") return buildOpenRelatedReply(suggestions);

    return buildOpenQuestionReply(userContext, suggestions);
  }

  if (intent === "source") return buildSourceReply(card);
  if (intent === "related") return buildRelatedReply(card);
  if (intent === "meaning") return buildMeaningReply(card, userContext);
  if (intent === "example") return buildExampleReply(card, userContext);

  return buildGroundedReply(userText, card, intent, userContext);
}

function buildOpeningMessage(card) {
  return `你可以直接说你现在的处境，我会围绕 **${card.frontend.title_zh}** 这个主题陪你往下拆。`;
}

function buildGroundedReply(userText, card, intent, userContext) {
  const replyContext = buildReplyContext(userText, card);
  const knowledge = pickKnowledgePoints(card, userText);
  const evidence = pickEvidence(card, userText)[0];
  const mirror = buildMirroringLine(userContext, card);
  const interpretation = buildInterpretationLine(card, knowledge, intent);
  const nextStep = buildNextStepLine(card, userContext);
  const chapterLine = replyContext.primaryChapterTitle
    ? `更贴近你现在问题的内容，主要落在书里的 **${replyContext.primaryChapterTitle}** 这一节。`
    : "";
  const quoteLine = evidence ? `书里有一句很贴近你现在的问题：\"${evidence}\"` : "";

  return [mirror, "", chapterLine, "", interpretation, "", quoteLine, "", nextStep, "", buildClosingPrompt(userContext, card)]
    .filter(Boolean)
    .join("\n");
}

function buildSourceReply(card) {
  const replyContext = buildReplyContext(card.backend.theme_en, card);
  return [
    "这张卡的中文标题是产品化表达，不是书里的逐字原话。",
    "",
    `它对应的原主题更接近：**${card.backend.theme_en}**。`,
    "",
    replyContext.primaryChapterTitle ? `更贴近的章节是：**${replyContext.primaryChapterTitle}**。` : "",
    "",
    "这张卡保留的英文锚点包括：",
    ...card.backend.source_excerpt_en.slice(0, 3).map((quote) => `- ${quote}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildOpenSourceReply(suggestions) {
  const suggestedCard = suggestions[0];
  return [
    "这些中文卡片是产品化表达，不是书里的逐字原话。",
    "",
    suggestedCard ? `如果按你这句来猜，最接近的可能是 **${suggestedCard.frontend.title_zh}**。` : "",
    suggestedCard ? `它对应的原主题更接近 **${suggestedCard.backend.theme_en}**。` : "",
    "",
    "如果你是在问某一张具体卡，直接把标题发我，我可以把更贴近的英文锚点和章节位置给你。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRelatedReply(card) {
  const related = card.backend.related_cards.map((id) => idToCard[id]).filter(Boolean);
  return [
    `如果你想顺着 **${card.frontend.title_zh}** 往下看，我建议你接着看这几张：`,
    ...related.map((item) => `- **${item.frontend.title_zh}**：${item.frontend.hook_zh}`),
  ].join("\n");
}

function buildOpenRelatedReply(suggestions) {
  return [
    "如果你想先顺着当前问题往外扩，我建议先只看这几张：",
    ...suggestions.slice(0, 3).map((item) => `- **${item.frontend.title_zh}**：${item.frontend.hook_zh}`),
  ].join("\n");
}

function buildMeaningReply(card, userContext) {
  const framing = getCardFraming(card);
  const replyContext = buildReplyContext(userContext.combinedText, card);
  return [
    "这张卡真正想讲的，不是表面上的口号，而是一个更底层的判断。",
    "",
    card.frontend.summary_zh,
    "",
    `它在书里最想纠正的误解更接近：${framing.coreTension}。`,
    "",
    replyContext.primaryChapterTitle ? `如果放回书里的上下文，它更靠近 **${replyContext.primaryChapterTitle}** 这一节。` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildExampleReply(card, userContext) {
  const scenario = buildScenarioExample(userContext, card);
  return [
    "可以，我不用抽象话，直接给你一个更贴近现实的例子。",
    "",
    scenario,
    "",
    `如果按 **${card.frontend.title_zh}** 这张卡的逻辑，关键不是先问“舒不舒服”，而是先问：${pickRelevantChecks(card, userContext).slice(0, 2).join("；")}。`,
  ].join("\n");
}

function buildOpenQuestionReply(userContext, suggestions) {
  const suggestedCard = suggestions[0];
  const replyContext = buildReplyContext(userContext.combinedText, suggestedCard);
  const mirror = userContext.emotions.length
    ? `我听下来，你现在更像是在 **${userContext.emotions.slice(0, 2).join("，")}** 的处境里打转。`
    : "我不想直接给你一个标准答案，我更想先把你真实的处境对准。";

  return [
    mirror,
    "",
    `按书里的内容，你这个问题我会先落在 **${suggestedCard.frontend.title_zh}**。`,
    "",
    replyContext.primaryChapterTitle ? `这一层内容在书里更靠近 **${replyContext.primaryChapterTitle}**。` : "",
    "",
    `如果你愿意，下一条直接告诉我：${buildClarifyingPrompt(userContext, suggestedCard)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function getCardFraming(card) {
  const map = {
    "feel-the-fear-do-it-anyway": {
      coreTension: "你是不是把害怕本身，当成了停止行动的理由",
      coreLesson: "恐惧本身不等于你不该做，很多时候它只说明这件事足够重要",
      checks: ["这件事是否重要到值得你带着不适推进", "你现在是在谨慎，还是在用焦虑替你做决定", "有没有更小的第一步"],
    },
    "start-before-world-ready": {
      coreTension: "你是不是把“还没人认可”直接等同于“这件事没价值”",
      coreLesson: "足够新的东西，在一开始常常不在多数人的认知范围里，要看的是证据是否在累积",
      checks: ["有没有真实小信号出现", "推进后反馈有没有变具体", "你是在耐心积累证据，还是一直没进展"],
    },
    "first-principles-thinking": {
      coreTension: "你是不是太快沿用了别人现成的答案",
      coreLesson: "重要问题要先回到底层事实、约束和逻辑，再重新推导答案",
      checks: ["最确定的底层事实是什么", "哪些前提只是惯例", "如果从零推导，结论会不会一样"],
    },
  };

  return map[card.id] || {
    coreTension: "你还没有把真正的问题命名清楚",
    coreLesson: card.backend.knowledge_points_zh[0] || card.frontend.summary_zh,
    checks: card.backend.coaching_angles_zh.slice(0, 3),
  };
}

function classifyIntent(text) {
  if (looksLikeRelatedQuestion(text)) return "related";
  if (looksLikeSourceQuestion(text)) return "source";
  if (looksLikeMeaningQuestion(text)) return "meaning";
  if (/举例|例子|比如|示范/.test(text)) return "example";
  if (/怎么|怎么办|如何|适合我|我现在|我该/.test(text)) return "application";
  return "default";
}

function findRelevantCards(userText) {
  const groupedScores = new Map();

  for (const hit of searchKnowledgeBase(userText, { limit: 18 })) {
    if (!hit.cardId) continue;
    groupedScores.set(hit.cardId, (groupedScores.get(hit.cardId) || 0) + hit.score);
  }

  for (const { cardId, weight } of getHeuristicCardMatches(userText)) {
    groupedScores.set(cardId, (groupedScores.get(cardId) || 0) + weight);
  }

  return [...groupedScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cardId]) => idToCard[cardId])
    .filter(Boolean);
}

function getHeuristicCardMatches(userText) {
  const text = normalizeSearchText(userText);
  const rules = [
    { pattern: /改口|错了|认错|修正|打脸|松口/, ids: ["aspire-to-be-less-wrong"], weight: 42 },
    { pattern: /自欺|骗自己|自我感动|wishful|真相|面对现实/, ids: ["obsess-over-truth"], weight: 42 },
    { pattern: /第一性原理/, ids: ["first-principles-thinking"], weight: 42 },
    { pattern: /物理学家|底层约束|边界|限制/, ids: ["think-like-a-physicist", "first-principles-thinking"], weight: 38 },
    { pattern: /赚钱|收入|回报|现金流|积蓄|安全感/, ids: ["obsess-for-success", "mission-no-money-topic"], weight: 40 },
    { pattern: /价值|有用|帮到谁|意义/, ids: ["be-useful", "fight-for-the-future"], weight: 38 },
    { pattern: /方向|迷茫|未来|兴奋/, ids: ["fight-for-the-future", "seek-the-nature-of-the-universe"], weight: 38 },
    { pattern: /别人怎么看|认可|支持|家里人|孤独|没人理解/, ids: ["fear-of-judgment-topic", "family-pressure-topic", "founder-loneliness-topic"], weight: 38 },
    { pattern: /开始|第一步|行动|拖延|起步/, ids: ["small-step-topic", "feel-the-fear-do-it-anyway"], weight: 38 },
    { pattern: /害怕|失败|不敢|很蠢/, ids: ["feel-the-fear-do-it-anyway"], weight: 38 },
  ];

  const matched = [];
  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      matched.push(...rule.ids.map((cardId) => ({ cardId, weight: rule.weight })));
    }
  }

  const deduped = new Map();
  for (const item of matched) {
    deduped.set(item.cardId, Math.max(deduped.get(item.cardId) || 0, item.weight));
  }

  return [...deduped.entries()].map(([cardId, weight]) => ({ cardId, weight }));
}

function pickKnowledgePoints(card, userText) {
  const hits = searchKnowledgeBase(userText, {
    activeCardId: card.id,
    types: ["summary", "point", "angle", "book_paragraph"],
    limit: 4,
  });
  const hitTexts = dedupeTexts(hits.map((hit) => hit.text));
  if (hitTexts.length) return hitTexts.slice(0, 3);
  return [...card.backend.knowledge_points_zh.slice(0, 2), card.backend.coaching_angles_zh[0]].filter(Boolean);
}

function pickEvidence(card, userText) {
  const hits = searchKnowledgeBase(userText, {
    activeCardId: card.id,
    types: ["quote", "book_quote", "book_paragraph"],
    limit: 2,
  });
  if (hits.length) return hits.map((hit) => hit.text);
  return card.backend.source_excerpt_en.slice(0, 2);
}

function buildUserContext(currentText) {
  const recentUserTexts = chatMessages
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.text);
  const combinedText = dedupeTexts([...recentUserTexts, currentText]).join(" ");
  const normalized = normalizeSearchText(combinedText);

  return {
    currentText,
    combinedText,
    snippet: pickUserSnippet(currentText),
    emotions: collectLabels(normalized, [
      { label: "害怕失败", pattern: /害怕|不敢|恐惧|焦虑|慌|失败/ },
      { label: "看不清方向", pattern: /迷茫|不确定|看不清|方向/ },
      { label: "低兴奋感", pattern: /不兴奋|没那么兴奋|不让我兴奋/ },
      { label: "在意别人反馈", pattern: /别人|认可|支持|理解|评价|家里人|怎么看我|孤独/ },
      { label: "纠结现实回报", pattern: /赚钱|收入|回报|变现|钱|现金流|安全感|积蓄/ },
      { label: "担心代价太高", pattern: /代价|透支|太累|撑不住|高强度|疲惫|烧没|累/ },
      { label: "启动阻力很大", pattern: /第一步|起步|一直在准备|迟迟没有真正开始|不知道第一步/ },
    ]),
    scenario: collectLabels(normalized, [
      { label: "项目或创业推进", pattern: /项目|创业|公司|产品|做事|自己的东西/ },
      { label: "工作选择", pattern: /工作|上班|职场|换工作|离职/ },
      { label: "人生方向", pattern: /人生|未来|长期|选择|方向|稳的路/ },
    ]),
  };
}

function pickUserSnippet(text) {
  const snippet = String(text || "")
    .split(/[，。！？；\n]/)
    .map((item) => item.trim())
    .find(Boolean);
  return snippet ? snippet.slice(0, 24) : "";
}

function collectLabels(text, definitions) {
  return definitions.filter((item) => item.pattern.test(text)).map((item) => item.label);
}

function buildReplyContext(query, card) {
  const hits = searchKnowledgeBase(query, {
    activeCardId: card?.id,
    limit: 10,
  });
  const primaryBookHit = hits.find((hit) => hit.chapterTitle);
  const chapterTitles = dedupeTexts(hits.map((hit) => hit.chapterTitle).filter(Boolean));

  return {
    hits,
    primaryBookHit,
    primaryChapterTitle: chapterTitles[0] || "",
    chapterTitles,
  };
}

function buildMirroringLine(userContext, card) {
  const signals = [...userContext.emotions, ...userContext.scenario].slice(0, 2);
  if (signals.length) {
    return `你现在像是同时在面对 **${signals.join("，")}**，所以这个问题才会卡住你。`;
  }

  if (userContext.snippet) {
    return `你刚刚提到的“${userContext.snippet}”，和 **${card.frontend.title_zh}** 这张卡的核心矛盾是对得上的。`;
  }

  return `你现在的问题，和 **${card.frontend.title_zh}** 这张卡的核心矛盾是对得上的。`;
}

function buildInterpretationLine(card, relevantKnowledge, intent) {
  const first = relevantKnowledge[0] || card.backend.knowledge_points_zh[0] || card.frontend.summary_zh;
  const second = relevantKnowledge[1];
  if (intent === "application") {
    return `如果把书里的意思落到现实里，它不是在催你立刻表态，而是在提醒你：${first}${second ? ` ${second}` : ""}`;
  }

  return `按书里这部分的意思，更重要的是：${first}${second ? ` ${second}` : ""}`;
}

function pickRelevantChecks(card, userContext) {
  const framing = getCardFraming(card);
  if (userContext.emotions.includes("害怕失败")) return framing.checks;
  if (userContext.emotions.includes("看不清方向")) return framing.checks;
  if (userContext.emotions.includes("纠结现实回报")) return framing.checks;
  return framing.checks;
}

function buildNextStepLine(card, userContext) {
  const checks = pickRelevantChecks(card, userContext);
  const prompt = checks.slice(0, 2).join("；");
  if (!prompt) return "";

  if (userContext.emotions.includes("害怕失败")) {
    return `如果先不谈最终成败，我会建议你先把问题缩小到两个判断：${prompt}。`;
  }

  if (userContext.emotions.includes("看不清方向")) {
    return `如果你现在最难的是看不清方向，那先别急着选答案，先把这两件事说清：${prompt}。`;
  }

  return `如果先不急着下结论，我会建议你先看这两件事：${prompt}。`;
}

function buildClarifyingPrompt(userContext, card) {
  if (userContext.emotions.includes("启动阻力很大")) {
    return "这件事如果只允许你先做一个 30 分钟内能完成的小动作，它会是什么";
  }
  if (userContext.emotions.includes("害怕失败")) {
    return "你最怕的具体后果是什么，以及这件事为什么又让你放不下";
  }
  if (userContext.emotions.includes("在意别人反馈")) {
    return "这件事里你最怕别人怎么看你，还是最怕因此失去什么现实关系";
  }
  if (userContext.emotions.includes("纠结现实回报")) {
    return "你现在更在意短期回报，还是更在意这件事值不值得长期做";
  }
  if (card && card.id === "be-useful") {
    return "你现在做的这件事，具体想帮到谁";
  }
  return "你现在最卡的一件现实小事是什么";
}

function buildClosingPrompt(userContext, card) {
  const prompts = [
    `如果你愿意，你下一条可以直接告诉我：${buildClarifyingPrompt(userContext, card)}`,
    `你要是想继续拆，我建议你下一条直接回答：${buildClarifyingPrompt(userContext, card)}`,
    `我们可以继续往下走，你下一条最值得补的是：${buildClarifyingPrompt(userContext, card)}`,
  ];
  return pickVariant(`${userContext.currentText}:${card.id}`, prompts);
}

function buildScenarioExample(userContext, card) {
  if (userContext.emotions.includes("害怕失败")) {
    return "比如你想开始一个项目，但一想到做出来没人买单、还可能显得自己很蠢，于是你一直在准备却迟迟不动。这个主题不是让你等到不怕，而是逼你先分清：你怕的是现实损失，还是只是害怕自尊受伤。";
  }
  if (userContext.emotions.includes("纠结现实回报")) {
    return "比如你手上有一个短期更赚钱的选项，也有一个你真正想长期做成的方向。这里不会直接让你无脑追热爱，而是先让你把“现金流问题”和“长期值得投入的问题”拆开看。";
  }
  return `比如你现在说的“${userContext.snippet || "这个问题"}”，如果放进现实里，它通常不是单纯缺道理，而是你还没有把最关键的约束和真正想要的东西分开。`;
}

function pickVariant(seed, options) {
  if (!options.length) return "";
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  }
  return options[Math.abs(hash) % options.length];
}
