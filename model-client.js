var runtimeConfig = {
  provider: "local",
  model: "local-rag",
  llmEnabled: false,
  chatEndpoint: "/api/chat",
  requestTimeoutMs: 15000,
  ...window.BOOK_OF_ELON_RUNTIME_CONFIG,
};

async function generateAssistantReply(userText, card) {
  const fallbackReply = generateReply(userText, card);
  if (!runtimeConfig.llmEnabled || !runtimeConfig.chatEndpoint) {
    return {
      text: fallbackReply,
      degraded: true,
      notice: buildDegradedNotice("missing_runtime"),
    };
  }

  const controller = new AbortController();
  const requestTimeoutMs = getRequestTimeoutMs();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(runtimeConfig.chatEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(runtimeConfig.chatSessionToken ? { "X-Book-Of-Elon-Token": runtimeConfig.chatSessionToken } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify(buildModelPayload(userText, card)),
    });

    if (!response.ok) {
      throw await buildChatRequestError(response);
    }

    const data = await response.json();
    if (!data.reply || typeof data.reply !== "string") {
      throw new Error("missing_reply");
    }

    return {
      text: data.reply.trim(),
      degraded: Boolean(data.degraded),
      notice: data.degraded ? buildDegradedNotice(data.reason) : "",
    };
  } catch (error) {
    console.warn("DeepSeek request failed, falling back to local reply.", error);
    const fallbackReason = mapChatFailureReason(error);
    return {
      text: fallbackReply,
      degraded: true,
      notice: buildDegradedNotice(fallbackReason, error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildModelPayload(userText, card) {
  const suggestions = card ? [] : findRelevantCards(userText).slice(0, 3);
  const activeCard = card || suggestions[0] || null;
  const userContext = buildUserContext(userText);
  const knowledgeHits = searchKnowledgeBase(userText, {
    activeCardId: activeCard?.id,
    limit: 8,
  }).slice(0, 6);
  const replyContext = activeCard ? buildReplyContext(userText, activeCard) : null;
  const conversationHistory = chatMessages
    .filter((message) => !message.pending)
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.text,
    }));
  const hasAssistantHistory = conversationHistory.some((message) => message.role === "assistant");
  const detectedIntent = classifyIntent(userText.toLowerCase());

  return {
    model: runtimeConfig.model,
    systemPrompt: buildModelSystemPrompt(),
    messages: buildModelMessages(conversationHistory, userText),
    context: {
      activeCard: activeCard
        ? {
            id: activeCard.id,
            title_zh: activeCard.frontend.title_zh,
            hook_zh: activeCard.frontend.hook_zh,
            summary_zh: activeCard.frontend.summary_zh,
            theme_en: activeCard.backend.theme_en,
            part_en: activeCard.backend.part_en,
            knowledge_points_zh: activeCard.backend.knowledge_points_zh.slice(0, 3),
            coaching_angles_zh: activeCard.backend.coaching_angles_zh.slice(0, 3),
            source_excerpt_en: activeCard.backend.source_excerpt_en.slice(0, 3),
          }
        : null,
      suggestedCards: suggestions.map((item) => ({
        id: item.id,
        title_zh: item.frontend.title_zh,
        hook_zh: item.frontend.hook_zh,
      })),
      userContext: {
        emotions: userContext.emotions,
        scenario: userContext.scenario,
        snippet: userContext.snippet,
      },
      conversationMeta: {
        hasAssistantHistory,
        turnStyle: hasAssistantHistory ? "continuation" : "opening",
        detectedIntent,
      },
      chapterTitle: replyContext?.primaryChapterTitle || "",
      knowledgeHits: knowledgeHits.map((hit) => ({
        type: hit.type,
        text: hit.text,
        chapterTitle: hit.chapterTitle || "",
        cardId: hit.cardId || "",
      })),
      productRules: [
        "必须用简体中文回答。",
        "先像在跟用户继续对话，再像在引用这本书。",
        "第一句先回应用户刚刚这句话里最具体、最有情绪或最有阻力的那一点，不要先开讲大道理。",
        "不要写成标准答案、文章、客服话术或总结报告。",
        "不要输出括号里的舞台提示、结构提示、写作提示，不要暴露你的组织过程。",
        "优先使用提供的书中内容和英文锚点，不要编造出处。",
        "如果用户问出处或原文，要明确区分中文产品化表达与英文锚点。",
        "除非用户明确要列表，否则优先用 2 到 4 小段自然说话，不要动不动分点。",
        "不要每次都重复卡片标题、章节标题或'书里说'；只有真的能推进理解时再提。",
        "如果用户问的是社会评价、羞耻、家人压力，要先拆情绪和真实代价，不要直接套创新创业叙事。",
        "如果用户问的是起步困难，先帮他把动作压小，不要先讲完整世界观。",
        "如果检索到的主题和用户眼前问题只有部分相关，不要硬套；先说眼前问题，再谨慎借书里的一个角度。",
        "结尾可以轻轻追问，但不要每次都像固定追问模板。",
      ],
    },
  };
}

function buildModelSystemPrompt() {
  return [
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
}

function buildModelMessages(history, userText) {
  if (!history.length) {
    return [{ role: "user", content: userText }];
  }

  const normalizedHistory = history.map((message, index) => {
    if (index === history.length - 1 && message.role === "user") {
      return {
        role: "user",
        content: userText,
      };
    }

    return message;
  });

  const lastMessage = normalizedHistory[normalizedHistory.length - 1];
  if (!lastMessage || lastMessage.role !== "user" || lastMessage.content !== userText) {
    normalizedHistory.push({ role: "user", content: userText });
  }

  return normalizedHistory;
}

function buildChatContextLabel(baseLabel) {
  return baseLabel;
}

function buildPendingMessage() {
  return "我先结合这本书的内容想一下。";
}

function buildDegradedNotice(reason) {
  if (reason === "rate_limited") {
    return "你这会儿提问有点快，我先按书里的知识继续陪你聊。";
  }

  if (reason === "request_timeout") {
    return "当前响应有点慢，我先基于书里的知识继续陪你聊。";
  }

  if (reason === "circuit_open" || reason === "upstream_timeout" || reason === "request_failed") {
    return "当前网络有点忙，我先基于书里的知识继续陪你聊。";
  }

  if (reason === "missing_api_key" || reason === "missing_runtime") {
    return "当前先按书里的知识脉络继续陪你聊。";
  }

  return "我先基于书里的知识继续陪你聊。";
}

function getRequestTimeoutMs() {
  const timeoutMs = Number(runtimeConfig.requestTimeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    return 15000;
  }
  return timeoutMs;
}

async function buildChatRequestError(response) {
  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  const code = response.status === 429 ? "rate_limited" : "request_failed";
  const error = new Error(code);
  error.code = code;
  error.status = response.status;
  error.retryAfterSeconds = Number(payload?.retryAfterSeconds || 0);
  error.details = payload?.message || payload?.error || "";
  return error;
}

function mapChatFailureReason(error) {
  if (error?.name === "AbortError") {
    return "request_timeout";
  }

  if (error?.code === "rate_limited") {
    return "rate_limited";
  }

  return "request_failed";
}
